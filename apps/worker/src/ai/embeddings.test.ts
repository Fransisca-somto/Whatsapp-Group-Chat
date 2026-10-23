import { describe, expect, it, vi } from "vitest";

import {
  createEmbeddingsClient,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  toVectorLiteral,
} from "./embeddings.ts";
import { OpenRouterError } from "./openrouter.ts";

const vector = (seed: number) => new Array<number>(EMBEDDING_DIMENSIONS).fill(seed);

const ok = (vectors: number[][], usage: Record<string, number> = { prompt_tokens: 12 }) =>
  new Response(
    JSON.stringify({
      model: EMBEDDING_MODEL,
      // OpenRouter may return items in any order; `index` says which input each belongs to.
      data: vectors.map((embedding, index) => ({ embedding, index })).reverse(),
      usage,
    }),
    { status: 200 },
  );

function client(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  return { fetchMock, embeddings: createEmbeddingsClient({ fetch: fetchMock }) };
}

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OpenRouterError);
  return (error as OpenRouterError).failure;
}

describe("embeddings client", () => {
  it("sends the fixed model and the key, and returns vectors in input order", async () => {
    const { fetchMock, embeddings } = client(ok([vector(1), vector(2)]));
    const result = await embeddings.embed("sk-or-v1-test", ["first", "second"]);
    expect(result.vectors.map((v) => v[0])).toEqual([1, 2]);
    expect(result.inputTokens).toBe(12);
    expect(result.costUsd).toBeCloseTo(12 * 0.00000002);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-v1-test");
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "openai/text-embedding-3-small",
      input: ["first", "second"],
    });
  });

  it("uses the cost OpenRouter reports when there is one", async () => {
    const { embeddings } = client(ok([vector(1)], { prompt_tokens: 5, cost: 0.0001 }));
    expect((await embeddings.embed("k", ["a"])).costUsd).toBe(0.0001);
  });

  it("cuts very long text before sending", async () => {
    const { fetchMock, embeddings } = client(ok([vector(1)]));
    await embeddings.embed("k", ["x".repeat(20_000)]);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string) as { input: string[] };
    expect(body.input[0]).toHaveLength(8_000);
  });

  it("makes no call for an empty list and refuses more than 64 texts", async () => {
    const { fetchMock, embeddings } = client();
    expect(await embeddings.embed("k", [])).toEqual({ vectors: [], inputTokens: 0, costUsd: 0 });
    await expect(embeddings.embed("k", new Array<string>(65).fill("a"))).rejects.toThrow(
      "at most 64",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the failure: bad key, no credits, rate limit, timeout, network", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const { embeddings } = client(
      new Response("{}", { status: 401 }),
      new Response("{}", { status: 402 }),
      new Response("{}", { status: 429 }),
      timeout,
      new TypeError("fetch failed"),
    );
    expect(await failureOf(embeddings.embed("k", ["a"]))).toBe("invalid_key");
    expect(await failureOf(embeddings.embed("k", ["a"]))).toBe("no_credits");
    expect(await failureOf(embeddings.embed("k", ["a"]))).toBe("rate_limited");
    expect(await failureOf(embeddings.embed("k", ["a"]))).toBe("timeout");
    expect(await failureOf(embeddings.embed("k", ["a"]))).toBe("network");
  });

  it("rejects a response with the wrong shape, a missing vector or the wrong size", async () => {
    const { embeddings } = client(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
      ok([vector(1)]), // two texts, one vector
      ok([[0.1, 0.2]]),
    );
    expect(await failureOf(embeddings.embed("k", ["a"]))).toBe("bad_response");
    expect(await failureOf(embeddings.embed("k", ["a", "b"]))).toBe("bad_response");
    expect(await failureOf(embeddings.embed("k", ["a"]))).toBe("bad_response");
  });
});

describe("toVectorLiteral", () => {
  it("writes pgvector's text form", () => {
    expect(toVectorLiteral([0.5, -1, 2])).toBe("[0.5,-1,2]");
  });
});
