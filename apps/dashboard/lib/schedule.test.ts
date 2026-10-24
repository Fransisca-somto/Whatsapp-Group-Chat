import { describe, expect, it } from "vitest";

import {
  attachmentFromPost,
  attachmentLabel,
  attentionReason,
  createdInGroupLabel,
  formValuesFromPost,
  kindLabel,
  repeatLabel,
  type ScheduledPostView,
} from "./schedule";

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

  it("says who set a reminder in the group (P26)", () => {
    expect(
      createdInGroupLabel({ created_via: "group", created_by_phone_e164: "+2348012345678" }),
    ).toBe("Set in the group by +234 801 234 5678");
    expect(createdInGroupLabel({ created_via: "group", created_by_phone_e164: null })).toBe(
      "Set in the group",
    );
    expect(
      createdInGroupLabel({ created_via: "dashboard", created_by_phone_e164: null }),
    ).toBeNull();
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

  const POST: ScheduledPostView = {
    id: "p1",
    group_id: "g1",
    kind: "reminder",
    body: "Reports",
    due_at: "2026-10-26T08:00:00Z",
    recurrence_rule: "FREQ=MONTHLY;BYMONTHDAY=-1",
    status: "scheduled",
    sent_at: null,
    sent_late: false,
    last_error: null,
    dismissed_at: null,
    created_via: "dashboard",
    created_by_phone_e164: null,
    attachment_path: "3f0c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a4b/voice-note.webm",
    attachment_kind: "voice",
    attachment_mime: "audio/webm",
    attachment_name: "Voice note",
    attachment_size: 40_000,
    attachment_seconds: 42,
    attachment_deleted_at: null,
    groups: { name: "Sales" },
  };

  it("turns a stored post back into form values in the company timezone", () => {
    expect(formValuesFromPost(POST, LAGOS)).toEqual({
      groupId: "g1",
      kind: "reminder",
      body: "Reports",
      dueAtLocal: "2026-10-26T09:00",
      repeat: { kind: "monthly", day: "last" },
      attachment: {
        path: POST.attachment_path,
        kind: "voice",
        mime: "audio/webm",
        name: "Voice note",
        size: 40_000,
        seconds: 42,
      },
    });
    // A file the cleanup removed can't be sent again.
    expect(
      formValuesFromPost({ ...POST, attachment_deleted_at: "2026-11-30T00:00:00Z" }, LAGOS)
        .attachment,
    ).toBeNull();
  });

  it("labels attachments", () => {
    expect(attachmentLabel({ kind: "voice", name: "Voice note", seconds: 42 })).toBe(
      "Voice note (0:42)",
    );
    expect(attachmentLabel({ kind: "document", name: "Report.pdf", seconds: null })).toBe(
      "Report.pdf",
    );
    expect(attachmentFromPost({ ...POST, attachment_path: null })).toBeNull();
  });
});
