import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const upload = {
  uploadFile: vi.fn(),
  uploadVoiceNote: vi.fn(),
  discardUpload: vi.fn(() => Promise.resolve()),
};
vi.mock("@/lib/attachmentUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attachmentUpload")>()),
  ...upload,
}));

const { AttachmentPicker } = await import("./AttachmentPicker");
const { VoiceRecorder } = await import("./VoiceRecorder");
const { checkFile } = await import("@/lib/attachmentUpload");

const PDF = {
  path: "3f0c2a1b-4d5e-4f60-8a7b-9c0d1e2f3a4b/report.pdf",
  kind: "document" as const,
  mime: "application/pdf",
  name: "Report.pdf",
  size: 120_000,
  seconds: null,
};

beforeEach(() => {
  upload.uploadFile.mockReset();
  upload.uploadVoiceNote.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("checkFile (P27)", () => {
  it("refuses wrong types, empty files and files over 16 MB", () => {
    expect(checkFile({ type: "application/zip", size: 10 })).toContain("can't be sent");
    expect(checkFile({ type: "application/pdf", size: 16 * 1024 * 1024 + 1 })).toBe(
      "Files can be up to 16 MB.",
    );
    expect(checkFile({ type: "image/png", size: 0 })).toBe("That file is empty.");
    expect(checkFile({ type: "image/png", size: 2_000 })).toBeNull();
  });
});

describe("AttachmentPicker", () => {
  it("uploads a picked file and hands it on with a preview", async () => {
    upload.uploadFile.mockResolvedValue({ ok: true, attachment: PDF });
    const onUploaded = vi.fn();
    render(
      <AttachmentPicker
        value={null}
        previewUrl={null}
        onUploaded={onUploaded}
        onRemove={vi.fn()}
      />,
    );
    const file = new File(["%PDF"], "Report.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose a file to attach"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(PDF, "blob:preview"));
    expect(upload.uploadFile).toHaveBeenCalledWith(file);
  });

  it("shows why an upload failed", async () => {
    upload.uploadFile.mockResolvedValue({ ok: false, error: "Files can be up to 16 MB." });
    render(
      <AttachmentPicker value={null} previewUrl={null} onUploaded={vi.fn()} onRemove={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Choose a file to attach"), {
      target: { files: [new File(["x"], "big.mp4", { type: "video/mp4" })] },
    });
    expect(await screen.findByText("Files can be up to 16 MB.")).toBeInTheDocument();
  });

  it("shows an attached file with its size and lets it be removed", () => {
    const onRemove = vi.fn();
    render(
      <AttachmentPicker value={PDF} previewUrl={null} onUploaded={vi.fn()} onRemove={onRemove} />,
    );
    expect(screen.getByText("Report.pdf")).toBeInTheDocument();
    expect(screen.getByText("117 KB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("labels a voice note with its length", () => {
    render(
      <AttachmentPicker
        value={{ ...PDF, kind: "voice", mime: "audio/webm", name: "Voice note", seconds: 75 }}
        previewUrl="blob:voice"
        onUploaded={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("Voice note (1:15)")).toBeInTheDocument();
    expect(screen.getByLabelText("Attached audio")).toBeInTheDocument();
  });
});

describe("pending recording reported to the form", () => {
  it("reports recording, then the finished recording until it is attached", async () => {
    class FakeRecorder {
      static isTypeSupported = () => true;
      state = "inactive";
      mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: unknown, options: { mimeType: string }) {
        this.mimeType = options.mimeType;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }) },
    });
    const onPendingChange = vi.fn();
    render(
      <AttachmentPicker
        value={null}
        previewUrl={null}
        onUploaded={vi.fn()}
        onRemove={vi.fn()}
        onPendingChange={onPendingChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record voice note" }));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith({ step: "recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(onPendingChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ step: "recorded", blob: expect.any(Blob) as unknown }),
      ),
    );
    expect(screen.getByRole("button", { name: /Attach recording/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(null));
    vi.unstubAllGlobals();
  });
});

describe("VoiceRecorder", () => {
  it("explains a blocked microphone", async () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new Error("NotAllowedError")) },
    });
    render(<VoiceRecorder onUse={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByText(/The microphone is blocked/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("says when the browser can't record", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<VoiceRecorder onUse={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByText(/This browser can't record audio/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
