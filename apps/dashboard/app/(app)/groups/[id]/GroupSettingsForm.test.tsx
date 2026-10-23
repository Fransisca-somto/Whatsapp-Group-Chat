import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateGroupSettings = vi.fn();
vi.mock("@/server/actions/groups", () => ({ updateGroupSettings }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { GroupSettingsForm } = await import("./GroupSettingsForm");

const GROUP_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const DEFAULTS = {
  reminderPermission: "admins_only" as const,
  aiEnabled: true,
  allowGeneralKnowledge: true,
  dailyReplyCap: 200,
  retentionDays: null,
};

beforeEach(() => {
  updateGroupSettings.mockReset();
  updateGroupSettings.mockResolvedValue({ ok: true, data: undefined });
});

describe("GroupSettingsForm", () => {
  it('saves "keep forever" retention (empty) as null', async () => {
    render(<GroupSettingsForm groupId={GROUP_ID} defaults={DEFAULTS} />);
    fireEvent.change(screen.getByLabelText("Daily reply limit"), { target: { value: "150" } });
    const save = screen.getByRole("button", { name: "Save settings" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() =>
      expect(updateGroupSettings).toHaveBeenCalledWith(
        expect.objectContaining({ dailyReplyCap: 150, retentionDays: null }),
      ),
    );
  });

  it("shows the general-questions switch, on by default", () => {
    render(<GroupSettingsForm groupId={GROUP_ID} defaults={DEFAULTS} />);
    expect(screen.getByRole("switch", { name: "Answer general questions too" })).toBeChecked();
  });

  it("saves the switch with the other settings", async () => {
    render(<GroupSettingsForm groupId={GROUP_ID} defaults={DEFAULTS} />);
    fireEvent.click(screen.getByRole("switch", { name: "Answer general questions too" }));
    const save = screen.getByRole("button", { name: "Save settings" });
    await waitFor(() => expect(save).toBeEnabled()); // enabled once the form sees the change
    fireEvent.click(save);
    await waitFor(() =>
      expect(updateGroupSettings).toHaveBeenCalledWith({
        groupId: GROUP_ID,
        ...DEFAULTS,
        allowGeneralKnowledge: false,
      }),
    );
  });
});
