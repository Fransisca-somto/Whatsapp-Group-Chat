import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { formatPairingCode, PairingCodeCard, type PairingRequestView } from "./PairingCodeCard";

const base: PairingRequestView = {
  id: "req-1",
  kind: "pair",
  status: "code_issued",
  pairing_code: "ABCD1234",
  code_expires_at: new Date(Date.now() + 90_000).toISOString(),
  error: null,
  phone_e164: "+2348012345678",
};

describe("PairingCodeCard", () => {
  it("formats codes the way WhatsApp shows them", () => {
    expect(formatPairingCode("ABCD1234")).toBe("ABCD-1234");
    expect(formatPairingCode("SHORT")).toBe("SHORT");
  });

  it("shows the code with a countdown and a Cancel button", () => {
    const onCancel = vi.fn();
    render(<PairingCodeCard request={base} onRetry={() => {}} onCancel={onCancel} />);
    expect(screen.getByTestId("pairing-code")).toHaveTextContent("ABCD-1234");
    expect(screen.getByText(/Code expires in \d+s/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows the error and a Retry button when pairing failed", () => {
    const onRetry = vi.fn();
    render(
      <PairingCodeCard
        request={{ ...base, status: "failed", error: "A number is already linked." }}
        onRetry={onRetry}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Pairing failed. A number is already linked.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
