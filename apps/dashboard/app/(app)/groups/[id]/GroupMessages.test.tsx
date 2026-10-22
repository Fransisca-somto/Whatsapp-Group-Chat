import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GroupMessageView } from "@/lib/groups";

vi.mock("@/server/actions/groups", () => ({ loadOlderGroupMessages: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { GroupMessages } = await import("./GroupMessages");

const base: GroupMessageView = {
  id: "m1",
  sender_name: "Ada",
  sender_phone_e164: "+2348012345678",
  body: "Morning all",
  message_type: "text",
  sent_at: "2026-10-19T08:00:00.000Z",
  mentions_bot: false,
  is_from_bot: false,
};

function renderMessages(messages: GroupMessageView[]) {
  return render(<GroupMessages groupId="g1" initial={messages} timeZone="Africa/Lagos" />);
}

describe("GroupMessages", () => {
  it("shows an empty state", () => {
    renderMessages([]);
    expect(screen.getByText(/No messages stored yet/)).toBeInTheDocument();
  });

  it("labels senders, tags and the bot's own messages", () => {
    renderMessages([
      { ...base, id: "m1", mentions_bot: true, body: "@bot when is payday?" },
      { ...base, id: "m2", is_from_bot: true, sender_name: null, body: "On the 25th." },
      { ...base, id: "m3", sender_name: null, body: "no push name" },
      { ...base, id: "m4", sender_name: null, sender_phone_e164: null, body: "lid only" },
    ]);
    expect(screen.getByText("Tagged")).toBeInTheDocument();
    expect(screen.getByText("Bot")).toBeInTheDocument();
    expect(screen.getByText("+234 801 234 5678")).toBeInTheDocument();
    expect(screen.getByText("Unknown sender")).toBeInTheDocument();
  });

  it("describes media without a caption", () => {
    renderMessages([{ ...base, body: null, message_type: "audio" }]);
    expect(screen.getByText("Voice note / audio")).toBeInTheDocument();
  });

  it("offers older messages only when a full page was loaded", () => {
    const { unmount } = renderMessages([base]);
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
    unmount();
    renderMessages(Array.from({ length: 50 }, (_, i) => ({ ...base, id: `m${i}` })));
    expect(screen.getByRole("button", { name: "Load older" })).toBeInTheDocument();
  });
});
