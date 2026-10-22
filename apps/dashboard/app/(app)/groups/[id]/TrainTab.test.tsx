import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = {
  upsertTrainingEntry: vi.fn(),
  setTrainingEntryActive: vi.fn(),
  deleteTrainingEntry: vi.fn(),
  importTraining: vi.fn(),
  copyTraining: vi.fn(),
  updateBotInstructions: vi.fn(),
};
vi.mock("@/server/actions/knowledge", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { TrainTab } = await import("./TrainTab");

const GROUP_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const ENTRY = {
  id: "7a2e3d4c-5b6f-4a71-9b8c-0d1e2f3a4b5c",
  title: "Refund policy",
  content: "Refunds are handled by finance.\n\n## Who qualifies\nCustomers within 30 days.",
  is_active: true,
  updated_at: "2026-10-22T09:00:00.000Z",
};

function renderTab(overrides: Partial<Parameters<typeof TrainTab>[0]> = {}) {
  return render(
    <TrainTab
      groupId={GROUP_ID}
      groupName="Sales"
      entries={[ENTRY]}
      sourceGroups={[]}
      botInstructions={null}
      timeZone="Africa/Lagos"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  for (const action of Object.values(actions)) {
    action.mockReset();
    action.mockResolvedValue({ ok: true, data: { id: ENTRY.id, count: 1 } });
  }
});

describe("TrainTab", () => {
  it("explains an untrained group", () => {
    renderTab({ entries: [] });
    expect(screen.getByText(/No training yet/)).toBeInTheDocument();
  });

  it("lists entries with a preview and subheading count", () => {
    renderTab();
    expect(screen.getByRole("heading", { name: "Refund policy" })).toBeInTheDocument();
    expect(screen.getByText(/Refunds are handled by finance\. Who qualifies/)).toBeInTheDocument();
    expect(screen.getByText(/1 subheading/)).toBeInTheDocument();
  });

  it("turns an entry off without deleting it", () => {
    renderTab();
    fireEvent.click(screen.getByRole("switch", { name: "Use “Refund policy”" }));
    expect(actions.setTrainingEntryActive).toHaveBeenCalledWith({
      id: ENTRY.id,
      groupId: GROUP_ID,
      isActive: false,
    });
  });

  it("asks before deleting", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Delete “Refund policy”" }));
    expect(actions.deleteTrainingEntry).not.toHaveBeenCalled();
    expect(screen.getByText("Delete “Refund policy”?")).toBeInTheDocument();
  });

  it("opens the editor with the entry split into subheadings", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Edit “Refund policy”" }));
    expect(screen.getByLabelText("Heading")).toHaveValue("Refund policy");
    expect(screen.getByDisplayValue("Who qualifies")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Customers within 30 days.")).toBeInTheDocument();
  });

  it("saves a new entry with its subheadings as one text", async () => {
    renderTab({ entries: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add training" }));
    fireEvent.change(screen.getByLabelText("Heading"), { target: { value: "Office hours" } });
    fireEvent.change(screen.getByLabelText("Details for section 1"), {
      target: { value: "8am to 5pm." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add subheading" }));
    fireEvent.change(screen.getByLabelText("Subheading"), { target: { value: "Holidays" } });
    fireEvent.change(screen.getByLabelText("Details for section 2"), {
      target: { value: "Closed." },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Add training" }).at(-1)!);
    await waitFor(() =>
      expect(actions.upsertTrainingEntry).toHaveBeenCalledWith({
        title: "Office hours",
        content: "8am to 5pm.\n\n## Holidays\nClosed.",
        id: undefined,
        groupId: GROUP_ID,
        isActive: true,
      }),
    );
  });

  it("does not save an entry without details", () => {
    renderTab({ entries: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add training" }));
    fireEvent.change(screen.getByLabelText("Heading"), { target: { value: "Empty" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add training" }).at(-1)!);
    expect(actions.upsertTrainingEntry).not.toHaveBeenCalled();
    expect(screen.getByText("Add some details")).toBeInTheDocument();
  });

  it("offers copying only when another group has training", () => {
    const { unmount } = renderTab();
    expect(screen.queryByRole("button", { name: "Copy from group" })).not.toBeInTheDocument();
    unmount();
    renderTab({ sourceGroups: [{ id: ENTRY.id, name: "Support", entryCount: 3 }] });
    expect(screen.getByRole("button", { name: "Copy from group" })).toBeInTheDocument();
  });

  it("saves bot instructions", () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Bot instructions"), {
      target: { value: "This is the sales team." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save instructions" }));
    expect(actions.updateBotInstructions).toHaveBeenCalledWith({
      groupId: GROUP_ID,
      instructions: "This is the sales team.",
    });
  });
});
