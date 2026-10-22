import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveOpenRouterKey = vi.fn();
const removeOpenRouterKey = vi.fn();
const updateAiModels = vi.fn();
vi.mock("@/server/actions/settings", () => ({
  saveOpenRouterKey,
  removeOpenRouterKey,
  updateAiModels,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AiProviderForm } = await import("./AiProviderForm");

const MODELS = [
  {
    id: "anthropic/claude-haiku-5.5",
    name: "Claude Haiku 5.5",
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.5,
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 2.5,
  },
];
const KEY = "sk-or-v1-" + "a".repeat(40);

beforeEach(() => {
  for (const mock of [saveOpenRouterKey, removeOpenRouterKey, updateAiModels]) mock.mockReset();
});

describe("AiProviderForm key", () => {
  it("shows only the hint of a saved key, never the key", () => {
    render(
      <AiProviderForm
        keyHint="a1b2"
        models={MODELS}
        defaults={{ chatModel: "", fallbackModel: null }}
      />,
    );
    expect(screen.getByText("…a1b2")).toBeInTheDocument();
    expect(screen.queryByLabelText("OpenRouter API key")).not.toBeInTheDocument();
  });

  it("checks the format before calling the server", () => {
    render(
      <AiProviderForm
        keyHint={null}
        models={MODELS}
        defaults={{ chatModel: "", fallbackModel: null }}
      />,
    );
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(saveOpenRouterKey).not.toHaveBeenCalled();
    expect(screen.getByText("That doesn't look like an OpenRouter key")).toBeInTheDocument();
  });

  it("saves a key and shows OpenRouter's rejection", async () => {
    saveOpenRouterKey.mockResolvedValue({
      ok: false,
      error: "That key was rejected by OpenRouter.",
    });
    render(
      <AiProviderForm
        keyHint={null}
        models={MODELS}
        defaults={{ chatModel: "", fallbackModel: null }}
      />,
    );
    fireEvent.change(screen.getByLabelText("OpenRouter API key"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect(saveOpenRouterKey).toHaveBeenCalledWith({ apiKey: KEY });
    expect(await screen.findByText("That key was rejected by OpenRouter.")).toBeInTheDocument();
  });

  it("asks for confirmation before removing the key", () => {
    render(
      <AiProviderForm
        keyHint="a1b2"
        models={MODELS}
        defaults={{ chatModel: "", fallbackModel: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(removeOpenRouterKey).not.toHaveBeenCalled();
    expect(screen.getByText("Remove the OpenRouter key?")).toBeInTheDocument();
  });
});

describe("AiProviderForm models", () => {
  it("saves the chat model with no fallback", async () => {
    updateAiModels.mockResolvedValue({ ok: true, data: undefined });
    render(
      <AiProviderForm
        keyHint="a1b2"
        models={MODELS}
        defaults={{ chatModel: "", fallbackModel: null }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Chat model"), {
      target: { value: "anthropic/claude-haiku-5.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save models" }));
    await waitFor(() =>
      expect(updateAiModels).toHaveBeenCalledWith({
        chatModel: "anthropic/claude-haiku-5.5",
        fallbackModel: null,
      }),
    );
  });

  it("rejects the same model as fallback", async () => {
    render(
      <AiProviderForm
        keyHint="a1b2"
        models={MODELS}
        defaults={{ chatModel: "", fallbackModel: null }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Chat model"), { target: { value: "a/b" } });
    fireEvent.change(screen.getByLabelText("Fallback model (optional)"), {
      target: { value: "a/b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save models" }));
    expect(
      await screen.findByText("The fallback model must be different from the chat model"),
    ).toBeInTheDocument();
    expect(updateAiModels).not.toHaveBeenCalled();
  });

  it("disables saving when the model list could not be loaded", () => {
    render(
      <AiProviderForm
        keyHint="a1b2"
        models={null}
        defaults={{ chatModel: "", fallbackModel: null }}
      />,
    );
    expect(screen.getByRole("button", { name: "Save models" })).toBeDisabled();
  });
});
