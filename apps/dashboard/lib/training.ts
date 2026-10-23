// Shapes shared by the Train tab, the Training overview and their server actions.

export const TRAINING_COLUMNS = "id, title, content, is_active, updated_at, embedding_status";

export type TrainingEntryView = {
  id: string;
  title: string;
  content: string;
  is_active: boolean;
  updated_at: string;
  /** Search indexing (Phase 4): pending → done, or failed after 3 attempts. */
  embedding_status: string;
};

/** A group the current group can copy training from. */
export type TrainingSourceGroup = { id: string; name: string; entryCount: number };

/** Largest file the import accepts (Workflow/Phases/05-Tagged-QA.md). */
export const TRAINING_FILE_MAX_BYTES = 200 * 1024;

/** One-line preview of an entry: subheading markers dropped, whitespace collapsed. */
export function trainingPreview(content: string, length = 160): string {
  const flat = content
    .replace(/^##\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat;
}

/** Number of `## Subheading` sections in an entry. */
export function subheadingCount(content: string): number {
  return content.match(/^##\s+\S/gm)?.length ?? 0;
}

/** P13: the Train tab marker for an entry's search indexing, or null once it is searchable. */
export function indexingMarker(status: string): { label: string; failed: boolean } | null {
  if (status === "pending") return { label: "Indexing…", failed: false };
  if (status === "failed") return { label: "Not searchable", failed: true };
  return null;
}
