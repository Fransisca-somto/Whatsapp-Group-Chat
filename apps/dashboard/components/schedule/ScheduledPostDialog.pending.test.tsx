// A recording that was never attached must not be lost when the post is saved (live-test fix,
// 2026-10-24). The picker is replaced by a stand-in that reports what it holds.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingAttachment } from "./AttachmentPicker";

const actions = {
  createScheduledPost: vi.fn(),
  updateScheduledPost: vi.fn(),
  cancelScheduledPost: vi.fn(),
  resendScheduledPost: vi.fn(),
  dismissScheduledPost: vi.fn(),
};
const upload = {
  uploadVoiceNote: vi.fn(),
  uploadFile: vi.fn(),
  discardUpload: vi.fn(() => Promise.resolve()),
  checkFile: vi.fn(() => null),
};
vi.mock("@/server/actions/schedule", () => actions);
vi.mock("@/lib/attachmentUpload", () => upload);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Buttons that put the picker in each state. */
vi.mock("./AttachmentPicker", () => ({
  AttachmentPicker: ({
    onPendingChange,
  }: {
    onPendingChange?: (pending: PendingAttachment) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onPendingChange?.({ step: "recording" })}>
        fake: recording
      </button>
      <button type="button" onClick={() => onPendingChange?.({ step: "uploading" })}>
        fake: uploading
      </button>
      <button
        type="button"
        onClick={() =>
          onPendingChange?.({
            step: "recorded",
            blob: new Blob(["voice"], { type: "audio/webm" }),
            seconds: 7,
          })
        }
      >
        fake: recorded
      </button>
    </div>
  ),
}));

const { ScheduledPostDialog } = await import("./ScheduledPostDialog");

const GROUP_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const VOICE = {
  path: "3f0c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a4b/voice-note.webm",
  kind: "voice" as const,
  mime: "audio/webm",
  name: "Voice note",
  size: 5,
  seconds: 7,
};
const inThreeDays = () =>
  `${new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString().slice(0, 10)}T09:00`;

function renderDialog() {
  render(
    <ScheduledPostDialog
      groups={[{ id: GROUP_ID, name: "Sales", status: "active" }]}
      timeZone="Africa/Lagos"
      defaultGroupId={GROUP_ID}
      open
      onOpenChange={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Date and time"), { target: { value: inThreeDays() } });
}

beforeEach(() => {
  actions.createScheduledPost.mockReset();
  actions.createScheduledPost.mockResolvedValue({ ok: true, data: { id: "p1" } });
  upload.uploadVoiceNote.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:voice");
  URL.revokeObjectURL = vi.fn();
});

describe("saving with an unattached recording", () => {
  it("attaches the finished recording, then saves it with the post", async () => {
    upload.uploadVoiceNote.mockResolvedValue({ ok: true, attachment: VOICE });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "fake: recorded" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule post" }));

    await waitFor(() => expect(actions.createScheduledPost).toHaveBeenCalled());
    expect(upload.uploadVoiceNote).toHaveBeenCalledWith(expect.any(Blob), 7);
    expect(actions.createScheduledPost).toHaveBeenCalledWith(
      expect.objectContaining({ body: "", attachment: VOICE }),
    );
  });

  it("saves nothing if attaching the recording fails, and says why", async () => {
    upload.uploadVoiceNote.mockResolvedValue({
      ok: false,
      error: "The upload failed. Check your connection and try again.",
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "fake: recorded" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule post" }));
    expect(await screen.findByText(/The upload failed/)).toBeInTheDocument();
    expect(actions.createScheduledPost).not.toHaveBeenCalled();
  });

  it("waits while recording or uploading", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "fake: recording" }));
    expect(screen.getByRole("button", { name: "Schedule post" })).toBeDisabled();
    expect(screen.getByText("Finish the recording first (press Stop).")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "fake: uploading" }));
    expect(screen.getByRole("button", { name: "Schedule post" })).toBeDisabled();
    expect(screen.getByText("Wait for the upload to finish.")).toBeInTheDocument();
  });
});
