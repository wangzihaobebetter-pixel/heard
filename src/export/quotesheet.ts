/**
 * The quote sheet (DESIGN §4.5). WP3 owns this file.
 *
 * This is the artifact from DESIGN §2 and §6 moment 3: the thing Dana pastes
 * into an email at the fact-check. §4.5's format block is **normative**, so the
 * bytes here are not a style choice — `verify-export.mjs` lifts that block
 * straight out of DESIGN.md and compares this output to it character by
 * character. If you change the spacing below, that verifier fails, and it is
 * right to.
 *
 * The shape, annotated:
 *
 *     # <Title>
 *     Recorded <date> · <duration> · <filename> · transcribed with Heard
 *                                                                          <- blank
 *     ## Points
 *     - [14:32] ✓ <the note's text>
 *           "…<the verbatim quote it was pinned to>…"
 *     - [27:05]   <text of a note the user has not checked> (not yet checked)
 *
 * Two details that are easy to get wrong and are deliberate:
 *   - the ✓ column is one character wide and holds a SPACE when unset, so the
 *     text of every line in a section starts at the same column;
 *   - the quote continuation line is indented six spaces, not a tab and not
 *     four, and only a `point` carries one (for `quote`/`yours` the text *is*
 *     the quote, so a second copy would be noise).
 */
import type { Interview, Note, NoteKind } from '../types';
import { formatAnchorLocation, formatDuration } from '../lib/time';
import { translate } from '../i18n';

/** `2026-08-18` — the same date shape the Interview context strip uses (§4.2). */
export function formatSheetDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Sections in DESIGN §4.5's order. An empty section is omitted, not left as a bare heading. */
const SECTIONS: { kind: NoteKind; labelKey: string }[] = [
  { kind: 'point', labelKey: 'interview.sectionPoints' },
  { kind: 'quote', labelKey: 'interview.sectionQuotable' },
  { kind: 'yours', labelKey: 'interview.sectionYours' },
];

export interface QuoteSheetInput {
  interview: Interview;
  notes: Note[];
  /** Injectable for verification; defaults to the live i18n table. */
  t?: (key: string, vars?: Record<string, string | number>) => string;
}

export function buildQuoteSheet({ interview, notes, t = translate }: QuoteSheetInput): string {
  const lines: string[] = [];

  lines.push(`# ${interview.title}`);
  lines.push(
    t('exportSheet.subtitle', {
      date: formatSheetDate(interview.recordedAt ?? interview.createdAt),
      duration: formatDuration(interview.durationSec),
      filename: interview.file.name,
    }),
  );

  for (const section of SECTIONS) {
    const items = notes.filter((n) => n.kind === section.kind);
    if (!items.length) continue;

    lines.push('');
    lines.push(`## ${t(section.labelKey)}`);

    for (const note of items) {
      // One character, always present: '✓' when the person marked it heard, a
      // space when they did not. This is what keeps the column aligned.
      const mark = note.heard ? '✓' : ' ';
      // A point paraphrases; a quote or a saved selection IS the line, so it is
      // rendered in quotation marks the way it would be pasted into copy.
      const body = section.kind === 'point' ? note.text : `"${note.text}"`;
      const tail = note.heard ? '' : ` ${t('exportSheet.notChecked')}`;
      lines.push(`- [${formatAnchorLocation(note.anchor)}] ${mark} ${body}${tail}`);

      if (section.kind === 'point' && note.quote) {
        // Ellipses on both ends: the quote is an excerpt of continuous speech,
        // and saying so is cheaper than pretending it is a whole sentence.
        lines.push(`      "…${note.quote}…"`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

/** `callsign-white-flight.md` — a filename that survives being in a Downloads folder. */
export function quoteSheetFilename(interview: Interview): string {
  const stem = interview.title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${stem || 'quote-sheet'}.md`;
}

/** True when there is nothing worth exporting — the sheet says so rather than showing an empty document. */
export function isQuoteSheetEmpty(notes: Note[]): boolean {
  return notes.length === 0;
}
