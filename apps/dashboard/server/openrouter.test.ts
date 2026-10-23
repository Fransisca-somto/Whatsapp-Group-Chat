import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test re-imports the module (fresh model cache), which is slow when the whole suite runs.
vi.setConfig({ testTimeout: 20_000 });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules(); // fresh model-list cache per test
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const load = () => import("./openrouter");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("checkOpenRouterKey", () => {
  it("sends the key as a bearer token and reports a valid key", async () => {
    fetchMock.mockResolvedValue(json({ data: {} }));
    const { checkOpenRouterKey } = await load();
    await expect(checkOpenRouterKey("sk-or-v1-abc")).resolves.toBe("valid");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/key");
    expect(init?.headers).toEqual({ Authorization: "Bearer sk-or-v1-abc" });
  });

  it("reports a rejected key as invalid", async () => {
    fetchMock.mockResolvedValue(json({ error: { message: "User not found." } }, 401));
    const { checkOpenRouterKey } = await load();
    await expect(checkOpenRouterKey("sk-or-v1-bad")).resolves.toBe("invalid");
  });

  it("reports outages and network errors as unreachable", async () => {
    const { checkOpenRouterKey } = await load();
    fetchMock.mockResolvedValueOnce(json({}, 503));
    await expect(checkOpenRouterKey("sk-or-v1-abc")).resolves.toBe("unreachable");
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(checkOpenRouterKey("sk-or-v1-abc")).resolves.toBe("unreachable");
  });
});

describe("listOpenRouterModels", () => {
  const models = {
    data: [
      {
        id: "openai/gpt-5-mini",
        name: "GPT-5 Mini",
        pricing: { prompt: "0.00000025", completion: "0.000002" },
        architecture: { output_modalities: ["text"] },
      },
      { id: "openai/gpt-5-mini:batch", name: "GPT-5 Mini (batch)" },
      { id: "black-forest/flux", architecture: { output_modalities: ["image"] } },
      { id: "anthropic/claude-haiku-5.5", pricing: { prompt: "0", completion: "0" } },
    ],
  };

  it("keeps live text models, sorted, with prices per million tokens", async () => {
    fetchMock.mockResolvedValue(json(models));
    const { listOpenRouterModels } = await load();
    const result = await listOpenRouterModels();
    expect(result?.map((m) => m.id)).toEqual(["anthropic/claude-haiku-5.5", "openai/gpt-5-mini"]);
    expect(result?.[1]).toMatchObject({
      name: "GPT-5 Mini",
      inputPricePerMillion: 0.25,
      outputPricePerMillion: 2,
    });
    expect(result?.[0]?.name).toBe("anthropic/claude-haiku-5.5");
  });

  it("caches the list", async () => {
    fetchMock.mockResolvedValue(json(models));
    const { listOpenRouterModels } = await load();
    await listOpenRouterModels();
    await listOpenRouterModels();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when OpenRouter cannot be reached or answers oddly", async () => {
    const { listOpenRouterModels } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(listOpenRouterModels()).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(json({ models: [] }));
    await expect(listOpenRouterModels()).resolves.toBeNull();
  });
});
