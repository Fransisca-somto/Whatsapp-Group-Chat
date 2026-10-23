import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = {
  upsertAuthorizedUser: vi.fn(),
  setAuthorizedUserActive: vi.fn(),
  deleteAuthorizedUser: vi.fn(),
};
vi.mock("@/server/actions/authorizedUsers", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AuthorizedUserDialog } = await import("./AuthorizedUserDialog");
const { AuthorizedUsersList } = await import("./AuthorizedUsersList");

const SALES = { id: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", name: "Sales" };
const OPS = { id: "8b3f4e5d-6c70-4b82-8c9d-1e2f3a4b5c6d", name: "Ops" };
const USER = {
  id: "7a2e3d4c-5b6f-4a71-9b8c-0d1e2f3a4b5c",
  display_name: "Ada",
  phone_e164: "+2348012345678",
  all_groups: false,
  is_active: true,
  authorized_user_groups: [{ group_id: OPS.id }],
};

beforeEach(() => {
  for (const action of Object.values(actions)) {
    action.mockReset();
    action.mockResolvedValue({ ok: true, data: { id: USER.id } });
  }
});

describe("AuthorizedUserDialog", () => {
  it("adds someone for all groups, normalising the number", async () => {
    render(<AuthorizedUserDialog groups={[SALES]} open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tunde" } });
    fireEvent.change(screen.getByLabelText("WhatsApp number"), {
      target: { value: "+234 801-234 5678" },
    });
    expect(screen.getByText("Saved as +234 801 234 5678")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(actions.upsertAuthorizedUser).toHaveBeenCalledWith({
        displayName: "Tunde",
        phoneE164: "+2348012345678",
        allGroups: true,
        groupIds: [],
        isActive: true,
      }),
    );
  });

  it("needs a valid number and, without all groups, at least one group", () => {
    render(<AuthorizedUserDialog groups={[SALES]} open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tunde" } });
    fireEvent.change(screen.getByLabelText("WhatsApp number"), { target: { value: "0801234" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText(/in international format, starting with \+/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("WhatsApp number"), {
      target: { value: "+2348012345678" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "All groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Choose at least one group, or allow all groups")).toBeInTheDocument();
    expect(actions.upsertAuthorizedUser).not.toHaveBeenCalled();
  });

  it("edits someone's groups", async () => {
    render(<AuthorizedUserDialog groups={[SALES, OPS]} user={USER} open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Ops" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Sales" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(actions.upsertAuthorizedUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: USER.id, allGroups: false, groupIds: [OPS.id, SALES.id] }),
      ),
    );
  });

  it("shows a duplicate number from the server", async () => {
    actions.upsertAuthorizedUser.mockResolvedValue({
      ok: false,
      error: "This number is already on the list.",
    });
    render(<AuthorizedUserDialog groups={[]} open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tunde" } });
    fireEvent.change(screen.getByLabelText("WhatsApp number"), {
      target: { value: "+2348012345678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("This number is already on the list.")).toBeInTheDocument();
  });
});

describe("AuthorizedUsersList", () => {
  it("shows each person's number and groups, and can turn them off", async () => {
    render(<AuthorizedUsersList users={[USER]} groups={[SALES, OPS]} />);
    expect(screen.getByText("+234 801 234 5678")).toBeInTheDocument();
    expect(screen.getByText("Ops")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Allow Ada to set reminders" }));
    await waitFor(() =>
      expect(actions.setAuthorizedUserActive).toHaveBeenCalledWith({
        id: USER.id,
        isActive: false,
      }),
    );
  });

  it("explains an empty list", () => {
    render(<AuthorizedUsersList users={[]} groups={[]} />);
    expect(screen.getByText(/No authorized users yet/)).toBeInTheDocument();
  });
});
