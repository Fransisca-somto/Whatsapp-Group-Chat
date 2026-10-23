import { describe, expect, it } from "vitest";

import { formatReply, LONG_REPLY_CHARS } from "./formatReply.ts";

describe("formatReply", () => {
  it("leaves a plain short answer alone", () => {
    expect(formatReply("8am, Monday to Friday.")).toEqual({
      text: "8am, Monday to Friday.",
      long: false,
    });
  });

  it("converts Markdown to WhatsApp formatting", () => {
    const raw =
      "## Leave\nUse **the HR portal**.\n* Fill the form\n* Wait for approval\nSee [the portal](https://hr.example.com).";
    expect(formatReply(raw).text).toBe(
      "*Leave*\nUse *the HR portal*.\n- Fill the form\n- Wait for approval\nSee the portal (https://hr.example.com).",
    );
  });

  it("drops tables and horizontal rules", () => {
    expect(formatReply("Hours:\n| Day | Time |\n|---|---|\n| Mon | 8am |\n---\nAsk HR.").text).toBe(
      "Hours:\nAsk HR.",
    );
  });

  it("removes filler openers and sign-offs", () => {
    expect(
      formatReply("Great question! Salaries are paid on the 25th. I hope this helps!").text,
    ).toBe("Salaries are paid on the 25th.");
    expect(
      formatReply(
        "Certainly, it's 8am. Let me know if you need anything else. Is there anything else I can help with?",
      ).text,
    ).toBe("It's 8am.");
  });

  it("keeps real sentences that mention the same words", () => {
    const text = "Bring anything else you need to the kickoff call.";
    expect(formatReply(text).text).toBe(text);
  });

  it("flags long replies without cutting them", () => {
    const long = "word ".repeat(LONG_REPLY_CHARS / 4).trim();
    const result = formatReply(long);
    expect(result.long).toBe(true);
    expect(result.text).toBe(long);
  });
});
