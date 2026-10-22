import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { createOpenRouterClient, OpenRouterError, type ChatRequest } from "./openrouter.ts";

const logger = pino({ level: "silent" });

const REQUEST: ChatRequest = {
  apiKey: "sk-or-v1-test",
  model: "anthropic/claude-haiku-5.5",
  fallbackModel: "google/gemini-2.5-flash-lite",
  messages: [{ role: "user", content: "hi" }],
  temperature: 0,
  maxTokens: 50,
};

const ok = (text: string, model = REQUEST.model, cost = 0.0001) =>
  new Response(
    JSON.stringify({
      model,
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 10, cost },
    }),
    { status: 200 },
  );
const status = (code: number, body = "{}") => new Response(body, { status: code });

function client(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  return { fetchMock, ai: createOpenRouterClient({ logger, fetch: fetchMock }) };
}

const bodyOf = (call: Parameters<typeof fetch>) =>
  JSON.parse(call[1]?.body as string) as { model: string; max_tokens: number; usage: unknown };

describe("OpenRouter client", () => {
  it("sends the key, model and limits, and returns text with usage and cost", async () => {
    const { fetchMock, ai } = client(ok(" 8am, Monday to Friday. "));
    const result = await ai.chat(REQUEST);
    expect(result).toEqual({
      text: "8am, Monday to Friday.",
      model: REQUEST.model,
      usedFallback: false,
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 0.0001,
    });
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((call[1]?.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-v1-test");
    expect(bodyOf(call)).toMatchObject({
      model: REQUEST.model,
      max_tokens: 50,
      usage: { include: true },
    });
  });

  it.each([
    ["a 5xx", status(503)],
    ["a 429", status(429)],
    ["a network error", new TypeError("fetch failed")],
    ["an empty answer", ok("")],
  ])("retries once with the fallback model after %s", async (_, first) => {
    const { fetchMock, ai } = client(first, ok("Fine.", REQUEST.fallbackModel!));
    const result = await ai.chat(REQUEST);
    expect(result).toMatchObject({ text: "Fine.", usedFallback: true });
    expect(bodyOf(fetchMock.mock.calls[1]!).model).toBe(REQUEST.fallbackModel);
  });

  it("reports a timeout and retries with the fallback", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const { ai } = client(timeout, ok("Fine."));
    await expect(ai.chat(REQUEST)).resolves.toMatchObject({ usedFallback: true });
  });

  it.each([
    [401, "invalid_key"],
    [402, "no_credits"],
    [400, "bad_request"],
  ] as const)("does not retry a %i (%s)", async (code, failure) => {
    const { fetchMock, ai } = client(status(code, '{"error":{"message":"nope"}}'));
    const error = await ai.chat(REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpenRouterError);
    expect((error as OpenRouterError).failure).toBe(failure);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retry without a fallback model", async () => {
    const { fetchMock, ai } = client(status(503));
    await expect(ai.chat({ ...REQUEST, fallbackModel: null })).rejects.toMatchObject({
      failure: "unavailable",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails when the fallback fails too", async () => {
    const { ai } = client(status(503), status(502));
    await expect(ai.chat(REQUEST)).rejects.toMatchObject({ failure: "unavailable", status: 502 });
  });

  it("rejects a response it does not understand", async () => {
    const { ai } = client(new Response('{"oops":true}', { status: 200 }), status(500));
    await expect(ai.chat(REQUEST)).rejects.toBeInstanceOf(OpenRouterError);
  });
});
