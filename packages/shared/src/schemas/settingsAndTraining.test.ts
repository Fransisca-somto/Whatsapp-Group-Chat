import { describe, expect, it } from "vitest";

import {
  aiModelsInputSchema,
  companySettingsSchema,
  isValidTimeZone,
  openRouterKeyInputSchema,
} from "./companySettings.ts";
import {
  copyTrainingInputSchema,
  importTrainingInputSchema,
  TRAINING_CONTENT_MAX,
  updateBotInstructionsInputSchema,
  upsertTrainingEntryInputSchema,
} from "./knowledge.ts";

const groupId = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const otherGroupId = "7a2e3d4c-5b6f-4a71-9b8c-0d1e2f3a4b5c";

describe("company settings", () => {
  it("checks time zones", () => {
    expect(isValidTimeZone("Africa/Lagos")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });

  it("trims names and rejects empty ones", () => {
    const ok = companySettingsSchema.parse({
      companyName: "  Acme  ",
      botDisplayName: "Ada",
      timezone: "Africa/Lagos",
    });
    expect(ok.companyName).toBe("Acme");
    expect(
      companySettingsSchema.safeParse({ companyName: " ", botDisplayName: "Ada", timezone: "UTC" })
        .success,
    ).toBe(false);
  });
});

describe("AI provider inputs", () => {
  it("accepts a plausible key and rejects short or spaced ones", () => {
    expect(
      openRouterKeyInputSchema.safeParse({ apiKey: "sk-or-v1-" + "a".repeat(40) }).success,
    ).toBe(true);
    expect(openRouterKeyInputSchema.safeParse({ apiKey: "short" }).success).toBe(false);
    expect(
      openRouterKeyInputSchema.safeParse({ apiKey: "sk-or-v1 " + "a".repeat(40) }).success,
    ).toBe(false);
  });

  it("accepts model ids and an optional, different fallback", () => {
    expect(
      aiModelsInputSchema.safeParse({
        chatModel: "anthropic/claude-haiku-4.5",
        fallbackModel: null,
      }).success,
    ).toBe(true);
    expect(
      aiModelsInputSchema.safeParse({
        chatModel: "anthropic/claude-haiku-4.5",
        fallbackModel: "google/gemini-2.5-flash:free",
      }).success,
    ).toBe(true);
    expect(aiModelsInputSchema.safeParse({ chatModel: "haiku", fallbackModel: null }).success).toBe(
      false,
    );
    expect(aiModelsInputSchema.safeParse({ chatModel: "a/b", fallbackModel: "a/b" }).success).toBe(
      false,
    );
  });
});

describe("training inputs", () => {
  it("requires a heading and details within the limit", () => {
    const base = { groupId, isActive: true, title: "Hours", content: "8am" };
    expect(upsertTrainingEntryInputSchema.safeParse(base).success).toBe(true);
    expect(upsertTrainingEntryInputSchema.safeParse({ ...base, title: " " }).success).toBe(false);
    expect(
      upsertTrainingEntryInputSchema.safeParse({
        ...base,
        content: "x".repeat(TRAINING_CONTENT_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it("requires at least one entry to import", () => {
    expect(importTrainingInputSchema.safeParse({ groupId, entries: [] }).success).toBe(false);
  });

  it("refuses to copy a group onto itself", () => {
    expect(
      copyTrainingInputSchema.safeParse({ fromGroupId: groupId, toGroupId: groupId }).success,
    ).toBe(false);
    expect(
      copyTrainingInputSchema.safeParse({ fromGroupId: otherGroupId, toGroupId: groupId }).success,
    ).toBe(true);
  });

  it("turns empty bot instructions into null", () => {
    expect(
      updateBotInstructionsInputSchema.parse({ groupId, instructions: "  " }).instructions,
    ).toBe(null);
  });
});
