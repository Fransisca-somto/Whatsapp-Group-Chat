import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const importTraining = vi.fn();
vi.mock("@/server/actions/knowledge", () => ({ importTraining }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ImportTrainingDialog } = await import("./ImportTrainingDialog");

const GROUP_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

beforeEach(() => {
  importTraining.mockReset();
  importTraining.mockResolvedValue({ ok: true, data: { count: 1 } });
});

function upload(file: File) {
  render(<ImportTrainingDialog groupId={GROUP_ID} open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("File"), { target: { files: [file] } });
}

describe("ImportTrainingDialog", () => {
  it("shows how the file was split, then saves the ticked entries", async () => {
    upload(new File(["# Leave\nAsk HR.\n# Hours\n8 to 5."], "handbook.md"));
    expect(await screen.findByText("Leave")).toBeInTheDocument();
    expect(screen.getByText("Hours")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[1]!); // untick "Hours"
    fireEvent.click(screen.getByRole("button", { name: "Save 1 entry" }));
    await waitFor(() =>
      expect(importTraining).toHaveBeenCalledWith({
        groupId: GROUP_ID,
        entries: [{ title: "Leave", content: "Ask HR." }],
      }),
    );
  });

  it("rejects other file types", async () => {
    upload(new File(["%PDF"], "policy.pdf"));
    expect(await screen.findByText("Upload a .txt or .md file.")).toBeInTheDocument();
  });

  it("rejects files over 200 KB", async () => {
    upload(new File(["x".repeat(201 * 1024)], "big.txt"));
    expect(await screen.findByText(/over 200 KB/)).toBeInTheDocument();
    expect(importTraining).not.toHaveBeenCalled();
  });
});
