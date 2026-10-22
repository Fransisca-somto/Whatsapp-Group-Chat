import { describe, expect, it } from "vitest";

import {
  contentFromSections,
  sectionsFromContent,
  splitTrainingDocument,
  titleFromFileName,
} from "./knowledgeImport.ts";
import { TRAINING_CONTENT_MAX, TRAINING_IMPORT_MAX_ENTRIES } from "./schemas/knowledge.ts";

describe("sections ↔ content", () => {
  it("round-trips an intro and subheadings", () => {
    const sections = [
      { subheading: "", body: "Refunds are handled by finance." },
      { subheading: "Who qualifies", body: "Customers within 30 days." },
      { subheading: "How long it takes", body: "5 working days." },
    ];
    const content = contentFromSections(sections);
    expect(content).toBe(
      "Refunds are handled by finance.\n\n## Who qualifies\nCustomers within 30 days.\n\n## How long it takes\n5 working days.",
    );
    expect(sectionsFromContent(content)).toEqual(sections);
  });

  it("drops empty sections and trims", () => {
    expect(
      contentFromSections([
        { subheading: "  ", body: "  " },
        { subheading: " Hours ", body: "\n8am to 5pm\n" },
      ]),
    ).toBe("## Hours\n8am to 5pm");
  });

  it("always returns at least one section", () => {
    expect(sectionsFromContent("")).toEqual([{ subheading: "", body: "" }]);
  });
});

describe("titleFromFileName", () => {
  it("turns a file name into a heading", () => {
    expect(titleFromFileName("refund-policy.md")).toBe("Refund policy");
    expect(titleFromFileName("office_hours.txt")).toBe("Office hours");
    expect(titleFromFileName(".md")).toBe("Imported training");
  });
});

describe("splitTrainingDocument", () => {
  it("starts an entry at each top heading and keeps deeper headings as subheadings", () => {
    const doc = [
      "# Refund policy",
      "Refunds are handled by finance.",
      "## Who qualifies",
      "Customers within 30 days.",
      "",
      "# Office hours",
      "8am to 5pm, Monday to Friday.",
      "### Holidays",
      "Closed on public holidays.",
    ].join("\r\n");
    const { entries, warnings } = splitTrainingDocument(doc, "Handbook");
    expect(warnings).toEqual([]);
    expect(entries).toEqual([
      {
        title: "Refund policy",
        content: "Refunds are handled by finance.\n## Who qualifies\nCustomers within 30 days.",
      },
      {
        title: "Office hours",
        content: "8am to 5pm, Monday to Friday.\n## Holidays\nClosed on public holidays.",
      },
    ]);
  });

  it("uses ## as the top level when the file has no #", () => {
    const { entries } = splitTrainingDocument("## A\none\n## B\ntwo", "File");
    expect(entries.map((e) => e.title)).toEqual(["A", "B"]);
  });

  it("puts text before the first heading under the fallback title", () => {
    const { entries } = splitTrainingDocument("Welcome text.\n\n# Leave\nAsk HR.", "Handbook");
    expect(entries).toEqual([
      { title: "Handbook", content: "Welcome text." },
      { title: "Leave", content: "Ask HR." },
    ]);
  });

  it("makes one entry from a plain text file", () => {
    const withBom = `${String.fromCharCode(0xfeff)}Just some notes.\nSecond line.`;
    const { entries } = splitTrainingDocument(withBom, "Notes");
    expect(entries).toEqual([{ title: "Notes", content: "Just some notes.\nSecond line." }]);
  });

  it("skips headings with nothing under them", () => {
    const { entries, warnings } = splitTrainingDocument("# Empty\n# Full\nText", "File");
    expect(entries).toEqual([{ title: "Full", content: "Text" }]);
    expect(warnings).toEqual(["“Empty” has no details under it, so it was skipped."]);
  });

  it("splits an entry that is over the size limit into parts", () => {
    const paragraph = "word ".repeat(400).trim(); // ~2,000 characters
    const doc = `# Long\n${Array.from({ length: 6 }, () => paragraph).join("\n\n")}`;
    const { entries, warnings } = splitTrainingDocument(doc, "File");
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.title)).toEqual(["Long", "Long (part 2)"]);
    for (const entry of entries)
      expect(entry.content.length).toBeLessThanOrEqual(TRAINING_CONTENT_MAX);
    expect(warnings).toEqual(["“Long” was long, so it was split into 2 parts."]);
  });

  it("hard-splits a single paragraph that is over the limit", () => {
    const { entries } = splitTrainingDocument("x".repeat(TRAINING_CONTENT_MAX * 2 + 10), "Blob");
    expect(entries.length).toBe(3);
    for (const entry of entries)
      expect(entry.content.length).toBeLessThanOrEqual(TRAINING_CONTENT_MAX);
  });

  it("caps the number of entries", () => {
    const doc = Array.from(
      { length: TRAINING_IMPORT_MAX_ENTRIES + 5 },
      (_, i) => `# E${i}\nx`,
    ).join("\n");
    const { entries, warnings } = splitTrainingDocument(doc, "File");
    expect(entries.length).toBe(TRAINING_IMPORT_MAX_ENTRIES);
    expect(warnings[0]).toMatch(/only the first 100/);
  });
});
