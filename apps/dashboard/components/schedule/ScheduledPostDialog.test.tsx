import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = {
  createScheduledPost: vi.fn(),
  updateScheduledPost: vi.fn(),
  cancelScheduledPost: vi.fn(),
  resendScheduledPost: vi.fn(),
  dismissScheduledPost: vi.fn(),
};
vi.mock("@/server/actions/schedule", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ScheduledPostDialog } = await import("./ScheduledPostDialog");

const GROUP_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const GROUPS = [{ id: GROUP_ID, name: "Sales", status: "active" }];
const TZ = "Africa/Lagos";

/** A time a few days ahead, as the picker holds it. */
const inThreeDays = () => {
  const date = new Date(Date.now() + 3 * 24 * 60 * 60_000);
  return `${date.toISOString().slice(0, 10)}T09:00`;
};

beforeEach(() => {
  for (const action of Object.values(actions)) {
    action.mockReset();
    action.mockResolvedValue({ ok: true, data: { id: "p1" } });
  }
});

describe("ScheduledPostDialog", () => {
  it("creates a one-off reminder and previews what the group will see", async () => {
    const onOpenChange = vi.fn();
    render(
      <ScheduledPostDialog
        groups={GROUPS}
        timeZone={TZ}
        defaultGroupId={GROUP_ID}
        open
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Submit the weekly report" },
    });
    const due = inThreeDays();
    fireEvent.change(screen.getByLabelText("Date and time"), { target: { value: due } });

    expect(screen.getByText("Reminder:")).toBeInTheDocument();
    expect(screen.getByText(/^Posts /)).toBeInTheDocument();
    expect(screen.getByText("Africa/Lagos time")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Schedule post" }));
    await waitFor(() =>
      expect(actions.createScheduledPost).toHaveBeenCalledWith({
        groupId: GROUP_ID,
        kind: "reminder",
        body: "Submit the weekly report",
        dueAtLocal: due,
        repeat: null,
        attachment: null,
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows the problem instead of saving an empty message", () => {
    render(
      <ScheduledPostDialog
        groups={GROUPS}
        timeZone={TZ}
        defaultGroupId={GROUP_ID}
        open
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Schedule post" }));
    expect(screen.getByText("Write the message")).toBeInTheDocument();
    expect(actions.createScheduledPost).not.toHaveBeenCalled();
  });

  it("edits a weekly post: days can be changed, and at least one is needed", async () => {
    const due = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    render(
      <ScheduledPostDialog
        groups={GROUPS}
        timeZone={TZ}
        post={{
          id: "7a2e3d4c-5b6f-4a71-9b8c-0d1e2f3a4b5c",
          group_id: GROUP_ID,
          kind: "announcement",
          body: "Stand-up in 10 minutes",
          due_at: due.toISOString(),
          recurrence_rule: "FREQ=WEEKLY;BYDAY=MO",
          status: "scheduled",
          sent_at: null,
          sent_late: false,
          last_error: null,
          dismissed_at: null,
          created_via: "dashboard",
          created_by_phone_e164: null,
          attachment_path: null,
          attachment_kind: null,
          attachment_mime: null,
          attachment_name: null,
          attachment_size: null,
          attachment_seconds: null,
          attachment_deleted_at: null,
          groups: { name: "Sales" },
        }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Monday" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Pick at least one day")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wednesday" }));
    fireEvent.click(screen.getByRole("button", { name: "Friday" }));
    expect(screen.getByText(/Every Wednesday and Friday at/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(actions.updateScheduledPost).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "7a2e3d4c-5b6f-4a71-9b8c-0d1e2f3a4b5c",
          repeat: { kind: "weekly", days: [3, 5] },
        }),
      ),
    );
  });

  it("shows the server's error", async () => {
    actions.createScheduledPost.mockResolvedValue({
      ok: false,
      error: "The bot can only post in active or paused groups.",
    });
    render(
      <ScheduledPostDialog
        groups={GROUPS}
        timeZone={TZ}
        defaultGroupId={GROUP_ID}
        open
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("Date and time"), { target: { value: inThreeDays() } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule post" }));
    expect(
      await screen.findByText("The bot can only post in active or paused groups."),
    ).toBeInTheDocument();
  });
});
