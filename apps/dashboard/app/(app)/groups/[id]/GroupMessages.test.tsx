import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupMessageView } from "@/lib/groups";

const loadOlderGroupMessages = vi.fn();
vi.mock("@/server/actions/groups", () => ({ loadOlderGroupMessages }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { GroupMessages } = await import("./GroupMessages");

const BOT_LID = "52055741849776";

const base: GroupMessageView = {
  id: "m1",
  wa_message_id: "W1",
  quoted_wa_message_id: null,
  sender_name: "Ada",
  sender_phone_e164: "+2348012345678",
  body: "Morning all",
  message_type: "text",
  sent_at: "2026-10-22T08:00:00.000Z",
  mentions_bot: false,
  is_from_bot: false,
};

/** `messages` newest first, as the server sends them. */
function renderMessages(messages: GroupMessageView[]) {
  return render(
    <GroupMessages
      groupId="g1"
      initial={messages}
      timeZone="Africa/Lagos"
      botName="Assistant"
      botMentionIds={[BOT_LID]}
    />,
  );
}

const bubbleTexts = () =>
  within(screen.getByRole("list", { name: "Messages, oldest first" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");

beforeEach(() => loadOlderGroupMessages.mockReset());

describe("GroupMessages", () => {
  it("shows an empty state", () => {
    renderMessages([]);
    expect(screen.getByText(/No messages stored yet/)).toBeInTheDocument();
  });

  it("reads like a chat: oldest first, with a day divider and local times", () => {
    renderMessages([
      { ...base, id: "m2", wa_message_id: "W2", body: "Second", sent_at: "2026-10-22T08:05:00Z" },
      { ...base, id: "m1", body: "First", sent_at: "2026-10-22T08:00:00Z" },
    ]);
    const items = bubbleTexts();
    expect(items[0]).toBe("Thu 22 Oct 2026");
    expect(items[1]).toContain("First");
    expect(items[1]).toContain("9:00 AM");
    expect(items[2]).toContain("Second");
  });

  it("shows the sender once per run and names the bot from Settings", () => {
    renderMessages([
      { ...base, id: "m3", wa_message_id: "W3", is_from_bot: true, sender_name: null, body: "Hi." },
      { ...base, id: "m2", wa_message_id: "W2", body: "Still me" },
      { ...base, id: "m1", body: "Me" },
    ]);
    expect(screen.getAllByText("Ada")).toHaveLength(1);
    expect(screen.getByText("Assistant")).toBeInTheDocument();
  });

  it("puts the bot's replies on the right and staff on the left", () => {
    renderMessages([
      { ...base, id: "m2", wa_message_id: "W2", is_from_bot: true, sender_name: null, body: "Bot" },
      { ...base, id: "m1", body: "Staff" },
    ]);
    expect(screen.getByText("Bot").closest("li")).toHaveClass("items-end");
    expect(screen.getByText("Staff").closest("li")).toHaveClass("items-start");
  });

  it("shows mentions of the bot by name and marks tagged messages", () => {
    renderMessages([
      { ...base, mentions_bot: true, body: `@${BOT_LID} what's the wifi password?` },
    ]);
    expect(screen.getByText("@Assistant")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(BOT_LID))).toBeNull();
    expect(screen.getByText("Tagged")).toBeInTheDocument();
  });

  it("quotes the question a bot reply answers", () => {
    renderMessages([
      {
        ...base,
        id: "m2",
        wa_message_id: "W2",
        is_from_bot: true,
        sender_name: null,
        quoted_wa_message_id: "W1",
        body: "I don't have that information.",
      },
      { ...base, mentions_bot: true, body: `@${BOT_LID} What's the wifi password?` },
    ]);
    const reply = screen.getByText("I don't have that information.").closest("li")!;
    expect(within(reply).getByText("Ada")).toBeInTheDocument();
    expect(within(reply).getByText("@Assistant What's the wifi password?")).toBeInTheDocument();
  });

  it("labels senders without a name and media without a caption", () => {
    renderMessages([
      {
        ...base,
        id: "m2",
        wa_message_id: "W2",
        sender_name: null,
        sender_phone_e164: null,
        body: null,
        message_type: "audio",
      },
      { ...base, sender_name: null, body: "no push name" },
    ]);
    expect(screen.getByText("+234 801 234 5678")).toBeInTheDocument();
    expect(screen.getByText("Unknown sender")).toBeInTheDocument();
    expect(screen.getByText("Voice note / audio")).toBeInTheDocument();
  });

  it("loads older messages above the current ones", async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({
      ...base,
      id: `m${i}`,
      wa_message_id: `W${i}`,
      body: `Message ${i}`,
      sent_at: new Date(Date.parse("2026-10-22T10:00:00Z") - i * 60_000).toISOString(),
    }));
    loadOlderGroupMessages.mockResolvedValue({
      ok: true,
      data: [
        {
          ...base,
          id: "old",
          wa_message_id: "WOLD",
          body: "Oldest",
          sent_at: "2026-10-21T08:00:00Z",
        },
      ],
    });
    renderMessages(page);
    fireEvent.click(screen.getByRole("button", { name: "Load older" }));
    await waitFor(() => expect(screen.getByText("Oldest")).toBeInTheDocument());
    expect(bubbleTexts()[1]).toContain("Oldest"); // after the 21 Oct divider, at the top
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
  });

  it("offers older messages only when a full page was loaded", () => {
    renderMessages([base]);
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
  });
});
