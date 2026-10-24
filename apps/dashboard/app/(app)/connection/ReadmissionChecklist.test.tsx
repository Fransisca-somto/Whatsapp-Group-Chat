import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReadmissionChecklist } from "./ReadmissionChecklist";

describe("ReadmissionChecklist (7.1)", () => {
  it("lists the groups still waiting for the new number", () => {
    render(
      <ReadmissionChecklist
        timeZone="Africa/Lagos"
        groups={[
          { id: "g1", name: "Sales", relinked_at: "2026-10-24T09:00:00Z" },
          { id: "g2", name: "Ops", relinked_at: "2026-10-24T09:00:00Z" },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Add the new number to 2 groups" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sales" })).toHaveAttribute("href", "/groups/g1");
    expect(screen.getAllByText("Waiting for the new number")).toHaveLength(2);
  });

  it("shows nothing once every group is back", () => {
    const { container } = render(<ReadmissionChecklist timeZone="Africa/Lagos" groups={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
