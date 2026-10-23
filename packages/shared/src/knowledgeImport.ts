// Training content format and file import (Workflow/Phases/05-Tagged-QA.md, "How a group is
// trained"). An entry is a heading (title) plus Markdown content in which `## Subheading` lines
// separate its sections. Uploaded .txt / .md files are split into entries at their headings in
// the browser; nothing is stored until the owner reviews and saves them.
import {
  TRAINING_CONTENT_MAX,
  TRAINING_IMPORT_MAX_ENTRIES,
  TRAINING_TITLE_MAX,
  type TrainingEntryInput,
  type TrainingSection,
} from "./schemas/knowledge.ts";

const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const SUBHEADING_REGEX = /^##\s+(.+?)\s*#*\s*$/;

const BYTE_ORDER_MARK = 0xfeff;

function normalize(text: string): string {
  const withoutBom = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
  return withoutBom
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits stored content into editor sections. The text before the first `##` is the intro. */
export function sectionsFromContent(content: string): TrainingSection[] {
  const sections: TrainingSection[] = [];
  let current: { subheading: string; lines: string[] } = { subheading: "", lines: [] };
  const flush = () => {
    const body = current.lines.join("\n").trim();
    if (current.subheading || body) sections.push({ subheading: current.subheading, body });
  };
  for (const line of normalize(content).split("\n")) {
    const match = SUBHEADING_REGEX.exec(line);
    if (match) {
      flush();
      current = { subheading: match[1]!.trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return sections.length > 0 ? sections : [{ subheading: "", body: "" }];
}

/** Joins editor sections back into stored content. Empty sections are dropped. */
export function contentFromSections(sections: readonly TrainingSection[]): string {
  return sections
    .map((section) => ({ subheading: section.subheading.trim(), body: normalize(section.body) }))
    .filter((section) => section.subheading || section.body)
    .map((section) =>
      section.subheading ? `## ${section.subheading}\n${section.body}`.trim() : section.body,
    )
    .join("\n\n");
}

/** Turns a file name into a fallback heading: "refund-policy.md" → "Refund policy". */
export function titleFromFileName(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!base) return "Imported training";
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, TRAINING_TITLE_MAX);
}

/** Splits content over the limit into parts at paragraph breaks (hard-splits huge paragraphs). */
function splitLongContent(content: string): string[] {
  if (content.length <= TRAINING_CONTENT_MAX) return [content];
  const pieces: string[] = [];
  for (const paragraph of content.split("\n\n")) {
    let rest = paragraph;
    while (rest.length > TRAINING_CONTENT_MAX) {
      const cut = rest.lastIndexOf(" ", TRAINING_CONTENT_MAX);
      const at = cut > TRAINING_CONTENT_MAX / 2 ? cut : TRAINING_CONTENT_MAX;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  const parts: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const next = current ? `${current}\n\n${piece}` : piece;
    if (next.length > TRAINING_CONTENT_MAX && current) {
      parts.push(current);
      current = piece;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export type TrainingImportResult = {
  entries: TrainingEntryInput[];
  /** Plain-language notes for the review screen (skipped, split or dropped entries). */
  warnings: string[];
};

/**
 * Splits a .txt / .md document into training entries.
 * - The top heading level in the file (`#`, or `##` if the file has no `#`) starts a new entry.
 * - Deeper headings become `## Subheading` lines inside the entry.
 * - Text before the first heading, or a file with no headings, becomes an entry titled
 *   `fallbackTitle` (usually from the file name).
 * - Entries over the size limit are split into "(part 2)", "(part 3)" …; empty ones are skipped.
 */
export function splitTrainingDocument(text: string, fallbackTitle: string): TrainingImportResult {
  const lines = normalize(text).split("\n");
  const levels = lines
    .map((line) => HEADING_REGEX.exec(line)?.[1]?.length)
    .filter((level): level is number => level !== undefined);
  const topLevel = levels.length > 0 ? Math.min(...levels) : null;

  const drafts: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    const match = HEADING_REGEX.exec(line);
    if (match && topLevel !== null) {
      const level = match[1]!.length;
      const heading = match[2]!.trim();
      if (level === topLevel) {
        current = { title: heading, lines: [] };
        drafts.push(current);
        continue;
      }
      if (!current) {
        current = { title: fallbackTitle, lines: [] };
        drafts.push(current);
      }
      current.lines.push(`## ${heading}`);
      continue;
    }
    if (!current) {
      if (!line.trim()) continue;
      current = { title: fallbackTitle, lines: [] };
      drafts.push(current);
    }
    current.lines.push(line);
  }

  const entries: TrainingEntryInput[] = [];
  const warnings: string[] = [];
  for (const draft of drafts) {
    const title = draft.title.slice(0, TRAINING_TITLE_MAX).trim() || fallbackTitle;
    const content = normalize(draft.lines.join("\n"));
    if (!content) {
      warnings.push(`“${title}” has no details under it, so it was skipped.`);
      continue;
    }
    const parts = splitLongContent(content);
    if (parts.length > 1) {
      warnings.push(`“${title}” was long, so it was split into ${parts.length} parts.`);
    }
    parts.forEach((part, index) => {
      const suffix = index === 0 ? "" : ` (part ${index + 1})`;
      entries.push({
        title: `${title.slice(0, TRAINING_TITLE_MAX - suffix.length)}${suffix}`,
        content: part,
      });
    });
  }

  if (entries.length > TRAINING_IMPORT_MAX_ENTRIES) {
    warnings.push(
      `The file has ${entries.length} entries; only the first ${TRAINING_IMPORT_MAX_ENTRIES} will be imported. Upload the rest separately.`,
    );
    entries.length = TRAINING_IMPORT_MAX_ENTRIES;
  }
  return { entries, warnings };
}
