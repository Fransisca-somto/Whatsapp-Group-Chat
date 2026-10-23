import { describe, expect, it } from "vitest";

import { attentionReason, formValuesFromPost, kindLabel, repeatLabel } from "./schedule";

const LAGOS = "Africa/Lagos";

describe("schedule labels", () => {
  it("names kinds", () => {
    expect(kindLabel("reminder")).toBe("Reminder");
    expect(kindLabel("announcement")).toBe("Announcement");
  });

  it("describes a repeating post, and nothing for a one-off or unknown rule", () => {
    const due_at = "2026-10-26T08:00:00Z";
    expect(
      repeatLabel({ recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", due_at }, LAGOS),
    ).toBe("Every weekday at 9:00 AM");
    expect(repeatLabel({ recurrence_rule: null, due_at }, LAGOS)).toBeNull();
    expect(repeatLabel({ recurrence_rule: "FREQ=HOURLY", due_at }, LAGOS)).toBeNull();
  });

  it("explains why a post needs attention", () => {
    expect(attentionReason({ status: "delivery_uncertain", last_error: null })).toContain(
      "Check the group before resending",
    );
    expect(attentionReason({ status: "skipped_late", last_error: null })).toContain(
      "more than 2 hours",
    );
    expect(attentionReason({ status: "failed", last_error: "not-authorized" })).toBe(
      "WhatsApp didn't accept it (not-authorized).",
    );
  });

  it("turns a stored post back into form values in the company timezone", () => {
    expect(
      formValuesFromPost(
        {
          group_id: "g1",
          kind: "reminder",
          body: "Reports",
          due_at: "2026-10-26T08:00:00Z",
          recurrence_rule: "FREQ=MONTHLY;BYMONTHDAY=-1",
        },
        LAGOS,
      ),
    ).toEqual({
      groupId: "g1",
      kind: "reminder",
      body: "Reports",
      dueAtLocal: "2026-10-26T09:00",
      repeat: { kind: "monthly", day: "last" },
    });
  });
});
