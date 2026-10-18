import { describe, expect, it } from "vitest";

import { parseIntentResult } from "./intent.ts";

describe("parseIntentResult", () => {
  it("accepts every valid intent shape", () => {
    expect(parseIntentResult({ intent: "question" })).toEqual({ intent: "question" });
    expect(parseIntentResult({ intent: "smalltalk" })).toEqual({ intent: "smalltalk" });
    expect(
      parseIntentResult({ intent: "dashboard_only_action", action: "cancel_reminder" }),
    ).toEqual({ intent: "dashboard_only_action", action: "cancel_reminder" });
    expect(parseIntentResult({ intent: "refuse", reason: "injection" })).toEqual({
      intent: "refuse",
      reason: "injection",
    });
  });

  it("parses a reminder from a JSON string", () => {
    const raw = JSON.stringify({
      intent: "create_reminder",
      reminder: { body: "Submit reports", dueAtLocal: "2026-10-16T15:00", confidence: "high" },
    });
    expect(parseIntentResult(raw)).toEqual({
      intent: "create_reminder",
      reminder: { body: "Submit reports", dueAtLocal: "2026-10-16T15:00", confidence: "high" },
    });
  });

  it("falls back to question on invalid output", () => {
    expect(parseIntentResult("not json")).toEqual({ intent: "question" });
    expect(parseIntentResult({ intent: "grant_admin" })).toEqual({ intent: "question" });
    expect(parseIntentResult({ intent: "refuse", reason: "bored" })).toEqual({
      intent: "question",
    });
    expect(
      parseIntentResult({
        intent: "create_reminder",
        reminder: { body: "x", dueAtLocal: "Friday 3pm", confidence: "high" },
      }),
    ).toEqual({ intent: "question" });
    expect(parseIntentResult(null)).toEqual({ intent: "question" });
  });
});
