import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ALL_STATUSES, StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it.each(ALL_STATUSES)("renders a text label for %s", (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.querySelector(`[data-status="${status}"]`);
    expect(badge).not.toBeNull();
    expect(badge?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("uses human-readable labels", () => {
    render(<StatusBadge status="delivery_uncertain" />);
    expect(screen.getByText("Delivery uncertain")).toBeInTheDocument();
  });
});
