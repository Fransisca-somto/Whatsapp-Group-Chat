"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  aiModelsInputSchema,
  openRouterKeyInputSchema,
  type AiModelsInput,
} from "@soft-agent-support/shared";
import { KeyRound, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { removeOpenRouterKey, saveOpenRouterKey, updateAiModels } from "@/server/actions/settings";
import type { OpenRouterModel } from "@/server/openrouter";

function formatPrice(model: OpenRouterModel): string {
  if (model.inputPricePerMillion === null || model.outputPricePerMillion === null) {
    return model.name;
  }
  const price = (value: number) => (value === 0 ? "free" : `$${value.toFixed(2)}`);
  return `${model.name} · ${price(model.inputPricePerMillion)} in / ${price(model.outputPricePerMillion)} out per 1M tokens`;
}

/** OpenRouter key and model choice (ADR-027). The saved key is never sent back here. */
export function AiProviderForm({
  keyHint,
  models,
  defaults,
}: {
  keyHint: string | null;
  models: OpenRouterModel[] | null;
  defaults: AiModelsInput;
}) {
  return (
    <div className="grid gap-8 sm:max-w-lg">
      <KeySection keyHint={keyHint} />
      <ModelsSection models={models} defaults={defaults} />
    </div>
  );
}

function KeySection({ keyHint }: { keyHint: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(keyHint === null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const parsed = openRouterKeyInputSchema.safeParse({ apiKey });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the key.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveOpenRouterKey(parsed.data);
      if (result.ok) {
        toast.success("Key checked with OpenRouter and saved.");
        setApiKey("");
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await removeOpenRouterKey();
      if (result.ok) {
        toast.success("Key removed. The bot stops answering until a new key is saved.");
        setRemoveOpen(false);
        setEditing(true);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">OpenRouter API key</h3>

      {keyHint !== null && !editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-2 text-sm">
            <KeyRound aria-hidden="true" className="size-4 text-muted-foreground" />
            Key saved, ends in <span className="font-mono">…{keyHint}</span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Replace
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRemoveOpen(true)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Label htmlFor="openrouter-key" className="sr-only">
            OpenRouter API key
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="openrouter-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-or-v1-…"
              value={apiKey}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setApiKey(event.target.value)}
              className="font-mono"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={pending || apiKey.trim() === ""}>
                {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
                Save key
              </Button>
              {keyHint !== null && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setEditing(false);
                    setApiKey("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The key is checked with OpenRouter, then stored encrypted. Nobody can view it again
            after saving, not even you.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      )}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove the OpenRouter key?"
        description="The bot stops answering questions in every group until a new key is saved."
        confirmLabel="Remove key"
        destructive
        pending={pending}
        onConfirm={remove}
      />
    </div>
  );
}

type ModelsForm = { chatModel: string; fallbackModel: string | null };

function ModelsSection({
  models,
  defaults,
}: {
  models: OpenRouterModel[] | null;
  defaults: AiModelsInput;
}) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ModelsForm>({
    resolver: zodResolver(aiModelsInputSchema),
    defaultValues: defaults,
  });

  const onSubmit = async (values: ModelsForm) => {
    const result = await updateAiModels(values);
    if (result.ok) {
      toast.success("Models saved. The bot uses them within a minute.");
      reset(values);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  const toNullable = (value: string | null) => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      <h3 className="text-sm font-medium">Models</h3>
      {models === null && (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load the model list from OpenRouter. Reload the page to try again.
        </p>
      )}
      <datalist id="openrouter-models">
        {(models ?? []).map((model) => (
          <option key={model.id} value={model.id} label={formatPrice(model)} />
        ))}
      </datalist>

      <div className="flex flex-col gap-2">
        <Label htmlFor="chat-model">Chat model</Label>
        <Input
          id="chat-model"
          list="openrouter-models"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. anthropic/claude-haiku-5.5"
          className="font-mono"
          aria-invalid={errors.chatModel ? true : undefined}
          {...register("chatModel", { setValueAs: (value: string) => value.trim() })}
        />
        <p className="text-xs text-muted-foreground">
          Answers every question. A small, fast model keeps replies quick and cheap.
        </p>
        {errors.chatModel && <p className="text-sm text-destructive">{errors.chatModel.message}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="fallback-model">Fallback model (optional)</Label>
        <Input
          id="fallback-model"
          list="openrouter-models"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. google/gemini-2.5-flash"
          className="font-mono"
          aria-invalid={errors.fallbackModel ? true : undefined}
          {...register("fallbackModel", { setValueAs: toNullable })}
        />
        <p className="text-xs text-muted-foreground">
          Used when the chat model is down or slow. Pick one from a different provider.
        </p>
        {errors.fallbackModel && (
          <p className="text-sm text-destructive">{errors.fallbackModel.message}</p>
        )}
      </div>

      <Button
        type="submit"
        disabled={isSubmitting || !isDirty || models === null}
        className="w-fit"
      >
        {isSubmitting && <Loader2 aria-hidden="true" className="animate-spin" />}
        Save models
      </Button>
    </form>
  );
}
