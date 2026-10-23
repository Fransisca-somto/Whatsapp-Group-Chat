import { describe, expect, it, vi } from "vitest";

import type { ChatResult, OpenRouterClient } from "../ai/openrouter.ts";
import { answerQuestion, endAtLastSentence } from "./answerQuestion.ts";

const AI = { apiKey: "sk-or-v1-test", chatModel: "a/model", fallbackModel: null };
const INPUT = {
  companyName: "Acme",
  botName: "Ada",
  botInstructions: null,
  training: "### IT\nCall IT.",
  recent: [],
  question: "My mouse is not working",
  askerName: "Tunde",
  allowGeneralKnowledge: true,
};

function client(text: string, truncated: boolean) {
  const result: ChatResult = {
    text,
    model: "a/model",
    usedFallback: false,
    truncated,
    inputTokens: 10,
    outputTokens: 10,
    costUsd: 0,
  };
  const chat = vi.fn<OpenRouterClient["chat"]>(() => Promise.resolve(result));
  return { ai: { chat } satisfies OpenRouterClient, chat };
}

describe("endAtLastSentence", () => {
  it("drops an unfinished last sentence", () => {
    expect(endAtLastSentence("Restart it. If it still doesn")).toBe("Restart it.");
    expect(endAtLastSentence('Click "Forgot password." Then wait for the')).toBe(
      'Click "Forgot password."',
    );
  });

  it("keeps whole list lines", () => {
    expect(endAtLastSentence("Try these:\n1. Restart\n2. Check the ca")).toBe(
      "Try these:\n1. Restart",
    );
  });

  it("leaves text with no sentence end alone", () => {
    expect(endAtLastSentence("just a fragment")).toBe("just a fragment");
  });
});

describe("answerQuestion", () => {
  it("trims a reply cut off at the token limit", async () => {
    const answer = await answerQuestion(
      client("Restart it. If it still doesn", true).ai,
      AI,
      INPUT,
    );
    expect(answer).toMatchObject({ kind: "answer", text: "Restart it." });
  });

  it("leaves a complete reply alone and gives step-by-step answers room", async () => {
    const { ai, chat } = client("Restart it. Then try another USB port.", false);
    const answer = await answerQuestion(ai, AI, INPUT);
    expect(answer).toMatchObject({ text: "Restart it. Then try another USB port." });
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 700 }));
  });
});
