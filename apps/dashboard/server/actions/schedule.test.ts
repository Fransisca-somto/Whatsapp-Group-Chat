import { beforeEach, describe, expect, it, vi } from "vitest";

/** A recorded query: table, the method calls in order, and the result it resolves to. */
type Call = { table: string; steps: [string, unknown[]][] };

let calls: Call[] = [];
let removed: string[][] = [];
let results: Record<string, unknown> = {};

/** A chainable stand-in for supabase-js; `results[table:op]` decides what each query returns. */
function fakeClient() {
  return {
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          removed.push(paths);
          return Promise.resolve({ error: null });
        },
      }),
    },
    from(table: string) {
      const call: Call = { table, steps: [] };
      calls.push(call);
      const op = () => call.steps.find(([m]) => ["select", "insert", "update"].includes(m))?.[0];
      const resolve = () => {
        const key = `${table}:${call.steps.some(([m]) => m === "update" || m === "insert") ? op() : "select"}`;
        return results[key] ?? { data: [], error: null };
      };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "insert", "update", "eq", "in", "is", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          call.steps.push([method, args]);
          return builder;
        };
      }
      builder.maybeSingle = () => Promise.resolve(resolve());
      builder.single = () => Promise.resolve(resolve());
      builder.then = (onOk: (value: unknown) => unknown, onError?: (error: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onOk, onError);
      return builder;
    },
  };
}

const access = {
  current: { kind: "allowed", userId: "u1", role: "staff" } as Record<string, unknown>,
};
const auditDashboardAction = vi.fn(() => Promise.resolve());
vi.mock("@/lib/supabase/server", () => ({ createClient: () => Promise.resolve(fakeClient()) }));
vi.mock("@/server/currentUser", () => ({
  getAccessDecision: () => Promise.resolve(access.current),
}));
vi.mock("@/server/audit", () => ({ auditDashboardAction }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  cancelScheduledPost,
  createScheduledPost,
  dismissScheduledPost,
  resendScheduledPost,
  updateScheduledPost,
} = await import("./schedule");

const GROUP_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const POST_ID = "7a2e3d4c-5b6f-4a71-9b8c-0d1e2f3a4b5c";
const NOW = new Date("2026-10-23T09:00:00Z"); // Fri 10:00 Lagos

const input = {
  groupId: GROUP_ID,
  kind: "announcement",
  body: "Office closes at 3pm",
  dueAtLocal: "2026-10-23T15:00",
  repeat: null,
};

const stepsOf = (table: string, method: string) =>
  calls.find((c) => c.table === table && c.steps.some(([m]) => m === method))?.steps ?? [];
const argOf = (table: string, method: string) =>
  stepsOf(table, method).find(([m]) => m === method)?.[1];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  calls = [];
  removed = [];
  access.current = { kind: "allowed", userId: "u1", role: "staff" };
  auditDashboardAction.mockClear();
  results = {
    "groups:select": { data: { status: "active" }, error: null },
    "company_settings:select": { data: { timezone: "Africa/Lagos" }, error: null },
    "scheduled_posts:insert": { data: { id: POST_ID }, error: null },
    "scheduled_posts:update": {
      data: [
        {
          id: POST_ID,
          group_id: GROUP_ID,
          kind: "reminder",
          recurrence_rule: null,
          status: "failed",
        },
      ],
      error: null,
    },
  };
});

describe("createScheduledPost", () => {
  it("stores the time in UTC from the company timezone, and audits", async () => {
    const result = await createScheduledPost(input);
    expect(result).toEqual({ ok: true, data: { id: POST_ID } });
    expect(argOf("scheduled_posts", "insert")).toEqual([
      {
        group_id: GROUP_ID,
        kind: "announcement",
        body: "Office closes at 3pm",
        due_at: "2026-10-23T14:00:00.000Z",
        recurrence_rule: null,
        created_via: "dashboard",
        created_by_user_id: "u1",
        attachment_path: null,
        attachment_kind: null,
        attachment_mime: null,
        attachment_name: null,
        attachment_size: null,
        attachment_seconds: null,
      },
    ]);
    expect(auditDashboardAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "post_created", groupId: GROUP_ID }),
    );
  });

  it("stores a repeating post's rule and its first matching date", async () => {
    await createScheduledPost({
      ...input,
      dueAtLocal: "2026-10-24T09:00",
      repeat: { kind: "weekdays" },
    });
    expect(argOf("scheduled_posts", "insert")).toEqual([
      expect.objectContaining({
        due_at: "2026-10-26T08:00:00.000Z", // Saturday start → Monday
        recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      }),
    ]);
  });

  it("refuses groups the bot can't post in, times in the past, and people without access", async () => {
    results["groups:select"] = { data: { status: "pending" }, error: null };
    expect(await createScheduledPost(input)).toEqual({
      ok: false,
      error: "The bot can only post in active or paused groups.",
    });

    results["groups:select"] = { data: { status: "paused" }, error: null };
    expect(await createScheduledPost({ ...input, dueAtLocal: "2026-10-23T09:00" })).toEqual({
      ok: false,
      error: "Pick a time at least a minute from now.",
    });

    access.current = { kind: "no_access" };
    expect(await createScheduledPost(input)).toMatchObject({ ok: false });
    expect(stepsOf("scheduled_posts", "insert")).toEqual([]);
  });
});

describe("changing posts only while they are waiting", () => {
  it("updates only a scheduled post", async () => {
    await updateScheduledPost({ ...input, id: POST_ID });
    const steps = stepsOf("scheduled_posts", "update");
    expect(steps).toContainEqual(["eq", ["id", POST_ID]]);
    expect(steps).toContainEqual(["eq", ["status", "scheduled"]]);

    results["scheduled_posts:update"] = { data: [], error: null };
    expect(await updateScheduledPost({ ...input, id: POST_ID })).toEqual({
      ok: false,
      error: "This post is being sent or has already gone out.",
    });
  });

  it("cancels only a scheduled post", async () => {
    expect(await cancelScheduledPost({ id: POST_ID })).toEqual({ ok: true, data: undefined });
    expect(argOf("scheduled_posts", "update")).toEqual([{ status: "cancelled" }]);
    expect(stepsOf("scheduled_posts", "update")).toContainEqual(["eq", ["status", "scheduled"]]);
  });

  it("resends a post that needs attention as a one-off due now", async () => {
    expect(await resendScheduledPost({ id: POST_ID })).toEqual({ ok: true, data: undefined });
    expect(argOf("scheduled_posts", "update")).toEqual([
      {
        status: "scheduled",
        due_at: NOW.toISOString(),
        recurrence_rule: null,
        claim_token: null,
        claimed_at: null,
        last_error: null,
        dismissed_at: null,
      },
    ]);
    expect(stepsOf("scheduled_posts", "update")).toContainEqual([
      "in",
      ["status", ["failed", "delivery_uncertain", "skipped_late"]],
    ]);
    expect(auditDashboardAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "post_resent" }),
    );
  });

  it("dismisses a post that needs attention", async () => {
    expect(await dismissScheduledPost({ id: POST_ID })).toEqual({ ok: true, data: undefined });
    expect(argOf("scheduled_posts", "update")).toEqual([{ dismissed_at: NOW.toISOString() }]);
    expect(stepsOf("scheduled_posts", "update")).toContainEqual(["is", ["dismissed_at", null]]);
  });
});

describe("attachments (6.7)", () => {
  const PHOTO = {
    path: "3f0c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a4b/poster.png",
    kind: "image",
    mime: "image/png",
    name: "poster.png",
    size: 2_000,
    seconds: null,
  };

  it("saves a post with only an attachment", async () => {
    expect(await createScheduledPost({ ...input, body: "", attachment: PHOTO })).toMatchObject({
      ok: true,
    });
    expect(argOf("scheduled_posts", "insert")).toEqual([
      expect.objectContaining({
        body: "",
        attachment_path: PHOTO.path,
        attachment_kind: "image",
        attachment_mime: "image/png",
        attachment_name: "poster.png",
        attachment_size: 2_000,
        attachment_seconds: null,
      }),
    ]);
  });

  it("still needs text when there is no attachment", async () => {
    expect(await createScheduledPost({ ...input, body: "" })).toEqual({
      ok: false,
      error: "Write the message",
    });
  });

  it("deletes a replaced file that nothing else uses", async () => {
    results["scheduled_posts:select"] = {
      data: { attachment_path: "old0c2a1-4d5e-4f60-8a7b-9c0d1e2f3a4b/old.png" },
      error: null,
      count: 0,
    };
    await updateScheduledPost({ ...input, id: POST_ID, attachment: PHOTO });
    expect(removed).toEqual([["old0c2a1-4d5e-4f60-8a7b-9c0d1e2f3a4b/old.png"]]);
  });

  it("keeps a replaced file another post still uses", async () => {
    results["scheduled_posts:select"] = {
      data: { attachment_path: "old0c2a1-4d5e-4f60-8a7b-9c0d1e2f3a4b/old.png" },
      error: null,
      count: 1,
    };
    await updateScheduledPost({ ...input, id: POST_ID, attachment: PHOTO });
    expect(removed).toEqual([]);
  });
});
