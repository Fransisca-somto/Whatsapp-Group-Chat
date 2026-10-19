import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={() => {}}
      title="Relink number"
      description="This logs the bot out."
      confirmLabel="Relink"
      confirmWord="RELINK"
      destructive
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, button: screen.getByRole("button", { name: "Relink" }) };
}

describe("ConfirmDialog", () => {
  it("keeps confirm disabled until the exact word is typed", () => {
    const { button, onConfirm } = renderDialog();
    expect(button).toBeDisabled();

    const input = screen.getByLabelText(/to confirm/);
    fireEvent.change(input, { target: { value: "relink" } });
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "RELINK" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("respects an extra canConfirm condition", () => {
    const { button } = renderDialog({ confirmWord: undefined, canConfirm: false });
    expect(button).toBeDisabled();
  });

  it("disables both buttons while pending", () => {
    const { button } = renderDialog({ confirmWord: undefined, pending: true });
    expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
