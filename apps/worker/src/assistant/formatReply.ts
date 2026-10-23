// Safety net for the reply style (ADR-029): models do not always follow instructions. Converts
// Markdown to WhatsApp formatting and trims AI-sounding filler. It never cuts a reply short;
// overly long replies are only flagged so they show up in the logs.

export const LONG_REPLY_CHARS = 700;

const FILLER_OPENERS =
  /^(?:(?:great|good|excellent) question|certainly|absolutely|of course|sure thing|sure|happy to help)[!.,:]*\s+/i;

const FILLER_CLOSERS = [
  /\s*(?:i )?hope (?:this|that) helps[!.]*\s*$/i,
  /\s*let me know if (?:you )?(?:have|need)[^.!?\n]*[.!?]*\s*$/i,
  /\s*feel free to (?:ask|reach out)[^.!?\n]*[.!?]*\s*$/i,
  /\s*is there anything else[^.!?\n]*\?\s*$/i,
];

export type FormattedReply = { text: string; long: boolean };

export function formatReply(raw: string): FormattedReply {
  let text = raw.replace(/\r\n?/g, "\n").trim();

  // Markdown → WhatsApp.
  text = text
    .split("\n")
    .filter((line) => !/^\s*\|.*\|\s*$/.test(line)) // table rows
    .filter((line) => !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) // horizontal rules
    .map((line) => line.replace(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/, "*$1*")) // headings → bold line
    .map((line) => line.replace(/^(\s*)[*•]\s+/, "$1- ")) // "* item" → "- item"
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");

  // Filler. A stripped opener can leave a lowercase first letter ("Sure, it's…" → "it's…").
  const withoutOpener = text.replace(FILLER_OPENERS, "");
  if (withoutOpener !== text) {
    text = withoutOpener.charAt(0).toUpperCase() + withoutOpener.slice(1);
  }
  let previous: string;
  do {
    previous = text;
    for (const closer of FILLER_CLOSERS) text = text.replace(closer, "");
  } while (text !== previous);

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return { text, long: text.length > LONG_REPLY_CHARS };
}
