import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const changeGroupStatus = vi.fn();
vi.mock("@/server/actions/groups", () => ({ changeGroupStatus }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ApproveGroupButton, GroupStatusActions } = await import("./GroupStatusActions");

const GROUP_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

beforeEach(() => {
  changeGroupStatus.mockReset();
  changeGroupStatus.mockResolvedValue({ ok: true, data: { status: "active" } });
});

const buttonNames = () => screen.queryAllByRole("button").map((b) => b.textContent?.trim());

describe("GroupStatusActions", () => {
  it.each([
    ["pending", ["Approve", "Archive"]],
    ["active", ["Pause", "Archive"]],
    ["paused", ["Resume", "Archive"]],
    ["removed", ["Archive"]],
  ] as const)("shows the allowed actions for a %s group", (status, expected) => {
    render(<GroupStatusActions groupId={GROUP_ID} groupName="Team" status={status} />);
    expect(buttonNames()).toEqual(expected);
  });

  it("shows nothing for an archived group", () => {
    const { container } = render(
      <GroupStatusActions groupId={GROUP_ID} groupName="Team" status="archived" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("runs a non-destructive action straight away", () => {
    render(<GroupStatusActions groupId={GROUP_ID} groupName="Team" status="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(changeGroupStatus).toHaveBeenCalledWith({ groupId: GROUP_ID, action: "pause" });
  });

  it("asks for confirmation before archiving", () => {
    render(<GroupStatusActions groupId={GROUP_ID} groupName="Team" status="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(changeGroupStatus).not.toHaveBeenCalled();
    expect(screen.getByText("Archive “Team”?")).toBeInTheDocument();
  });
});

describe("ApproveGroupButton", () => {
  it("approves the group", () => {
    render(<ApproveGroupButton groupId={GROUP_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(changeGroupStatus).toHaveBeenCalledWith({ groupId: GROUP_ID, action: "approve" });
  });
});
