// Per-group training (knowledge_entries, ADR-026). Each entry belongs to one group; the bot in a
// group only ever reads that group's entries. Limits mirror the migration 0009 constraints.
import { z } from "zod";

export const TRAINING_TITLE_MAX = 200;
export const TRAINING_CONTENT_MAX = 8000;
export const TRAINING_IMPORT_MAX_ENTRIES = 100;
export const BOT_INSTRUCTIONS_MAX = 1000;

const titleSchema = z
  .string()
  .trim()
  .min(1, "Give it a heading")
  .max(TRAINING_TITLE_MAX, `Keep the heading under ${TRAINING_TITLE_MAX} characters`);

const contentSchema = z
  .string()
  .trim()
  .min(1, "Add some details")
  .max(
    TRAINING_CONTENT_MAX,
    `This entry is over ${TRAINING_CONTENT_MAX.toLocaleString("en")} characters. Split it into two entries.`,
  );

/** One subheading and its details in the editor. An empty subheading is the entry's intro. */
export const trainingSectionSchema = z.object({
  subheading: z.string().trim().max(TRAINING_TITLE_MAX, "Keep the subheading shorter"),
  body: z.string(),
});
export type TrainingSection = z.infer<typeof trainingSectionSchema>;

export const trainingEntryInputSchema = z.object({
  title: titleSchema,
  content: contentSchema,
});
export type TrainingEntryInput = z.infer<typeof trainingEntryInputSchema>;

export const upsertTrainingEntryInputSchema = trainingEntryInputSchema.extend({
  id: z.uuid().optional(),
  groupId: z.uuid(),
  isActive: z.boolean(),
});
export type UpsertTrainingEntryInput = z.infer<typeof upsertTrainingEntryInputSchema>;

export const setTrainingEntryActiveInputSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  isActive: z.boolean(),
});
export type SetTrainingEntryActiveInput = z.infer<typeof setTrainingEntryActiveInputSchema>;

export const deleteTrainingEntryInputSchema = z.object({ id: z.uuid(), groupId: z.uuid() });
export type DeleteTrainingEntryInput = z.infer<typeof deleteTrainingEntryInputSchema>;

export const importTrainingInputSchema = z.object({
  groupId: z.uuid(),
  entries: z
    .array(trainingEntryInputSchema)
    .min(1, "Nothing to import")
    .max(
      TRAINING_IMPORT_MAX_ENTRIES,
      `Import at most ${TRAINING_IMPORT_MAX_ENTRIES} entries at once`,
    ),
});
export type ImportTrainingInput = z.infer<typeof importTrainingInputSchema>;

/** Copies every entry of one group into another (P1). Copies are independent afterwards. */
export const copyTrainingInputSchema = z
  .object({ fromGroupId: z.uuid(), toGroupId: z.uuid() })
  .refine((value) => value.fromGroupId !== value.toGroupId, {
    message: "Pick a different group to copy from",
    path: ["fromGroupId"],
  });
export type CopyTrainingInput = z.infer<typeof copyTrainingInputSchema>;

/** Per-group bot instructions (P2). Empty text clears them. */
export const updateBotInstructionsInputSchema = z.object({
  groupId: z.uuid(),
  instructions: z
    .string()
    .trim()
    .max(BOT_INSTRUCTIONS_MAX, `Keep the instructions under ${BOT_INSTRUCTIONS_MAX} characters`)
    .transform((value) => (value === "" ? null : value)),
});
export type UpdateBotInstructionsInput = z.infer<typeof updateBotInstructionsInputSchema>;
