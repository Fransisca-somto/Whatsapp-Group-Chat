import { describe, expect, it } from "vitest";

import { actionLabel, auditActor, auditSummary } from "./audit";

describe("audit labels", () => {
  it("labels known actions and falls back for new ones", () => {
    expect(actionLabel("answered")).toBe("Answered");
    expect(actionLabel("something_new")).toBe("something new");
  });

  it("summarises bot outcomes", () => {
    expect(
      auditSummary({
        action: "answered",
        detail: { kind: "answer", inputTokens: 400, outputTokens: 12 },
      }),
    ).toBe("answered · 412 tokens");
    expect(auditSummary({ action: "answered", detail: { kind: "dont_know" } })).toBe("didn't know");
    expect(
      auditSummary({
        action: "answered",
        detail: { kind: "answer", historyMatches: 3, inputTokens: 400, outputTokens: 12 },
      }),
    ).toBe("answered · found 3 older messages · 412 tokens");
    expect(auditSummary({ action: "refused", detail: { reason: "injection" } })).toBe(
      "tried to change the rules",
    );
    expect(auditSummary({ action: "ai_failed", detail: { failure: "no_credits" } })).toBe(
      "no OpenRouter credit",
    );
    expect(auditSummary({ action: "rate_limited", detail: { scope: "group" } })).toBe(
      "daily limit reached",
    );
  });

  it("summarises dashboard changes and tolerates odd detail", () => {
    expect(auditSummary({ action: "group_paused", detail: { from: "active", to: "paused" } })).toBe(
      "active → paused",
    );
    expect(auditSummary({ action: "training_imported", detail: { count: 6 } })).toBe("6 entries");
    expect(
      auditSummary({ action: "messages_purged", detail: { count: 1250, retentionDays: 90 } }),
    ).toBe("1,250 messages older than 90 days");
    expect(actionLabel("messages_purged")).toBe("Old messages deleted");
    expect(actionLabel("post_uncertain")).toBe("Delivery uncertain");
    expect(actionLabel("attachment_deleted")).toBe("Unused attachment deleted");
    expect(auditSummary({ action: "attachment_deleted", detail: { kind: "voice" } })).toBe("voice");
    expect(auditSummary({ action: "refused_unauthorized", detail: { reason: "no_phone" } })).toBe(
      "number not visible",
    );
    expect(auditSummary({ action: "reminder_unclear", detail: { reason: "too_soon" } })).toBe(
      "time too soon",
    );
    expect(auditSummary({ action: "authorized_user_added", detail: { name: "Ada" } })).toBe("Ada");
    expect(auditSummary({ action: "post_sent", detail: { kind: "reminder", late: true } })).toBe(
      "reminder · sent late",
    );
    expect(
      auditSummary({
        action: "post_cancelled",
        detail: { kind: "announcement", endedSeries: true },
      }),
    ).toBe("announcement · series ended");
    expect(
      auditSummary({
        action: "post_failed",
        detail: { kind: "reminder", error: "not-authorized" },
      }),
    ).toBe("reminder · not-authorized");
    expect(auditSummary({ action: "ai_key_saved", detail: { hint: "7aec" } })).toBe(
      "ends in …7aec",
    );
    expect(auditSummary({ action: "answered", detail: null })).toBe("answered");
    expect(auditSummary({ action: "group_renamed", detail: [] })).toBe("");
  });

  it("names the actor", () => {
    expect(auditActor({ actor_type: "system", actor_ref: null }, {})).toBe("System");
    expect(auditActor({ actor_type: "dashboard_user", actor_ref: "u1" }, { u1: "Cisca" })).toBe(
      "Cisca",
    );
    expect(auditActor({ actor_type: "member", actor_ref: "+2348012345678" }, {})).toBe(
      "+234 801 234 5678",
    );
    expect(auditActor({ actor_type: "member", actor_ref: "99887766@lid" }, {})).toBe(
      "Group member",
    );
  });
});
