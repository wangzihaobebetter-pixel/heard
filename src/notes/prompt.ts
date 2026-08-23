/**
 * The notes prompt (DESIGN §4.6, §9 WP4).
 *
 * The rule this file exists to enforce: **the model never sees a timestamp.**
 * It sees the transcript with word indices and it must answer with a *verbatim
 * quote*. The app then aligns that quote back to the word sequence and derives
 * the timecode from the words themselves (`generate.ts`). A number the model
 * emits is never trusted for anchoring — that is the whole mechanism behind
 * "no unanchored sentences".
 *
 * WP4 owns this file.
 */
import type { Word } from '../types';

/** One window of transcript handed to the model in a single call. */
export interface NoteWindow {
  /** half-open word range this window covers */
  wi: number;
  wj: number;
  /** the rendered transcript for the model */
  text: string;
}

/** What the model is asked to return. Shapes are validated in `generate.ts`. */
export interface RawPoint { text: string; quote: string }
export interface RawQuotable { quote: string }
export interface RawNotes { points: RawPoint[]; quotable: RawQuotable[] }

/** ~15 minutes of speech per window (DESIGN §9 WP4). */
export const WINDOW_SEC = 15 * 60;
/** words per rendered line — enough context to read, short enough to index */
const LINE_WORDS = 18;

/**
 * Renders `[startIndex]`-prefixed lines. Indices are the model's only
 * coordinate system; there is deliberately no clock anywhere in this string.
 */
export function renderWindow(words: Word[], wi: number, wj: number): string {
  const lines: string[] = [];
  for (let i = wi; i < wj; i += LINE_WORDS) {
    const end = Math.min(wj, i + LINE_WORDS);
    lines.push(`[${i}] ${words.slice(i, end).map((w) => w.t).join(' ')}`);
  }
  return lines.join('\n');
}

/** Splits the transcript into ~WINDOW_SEC windows, cutting on the largest gap. */
export function planWindows(words: Word[], windowSec = WINDOW_SEC): NoteWindow[] {
  if (words.length === 0) return [];
  const total = words[words.length - 1].e;
  const n = Math.max(1, Math.ceil(total / windowSec));
  const cuts: number[] = [0];
  for (let k = 1; k < n; k++) {
    const target = (total * k) / n;
    // cut at the quietest place near the target: the largest inter-word gap
    let best = -1, bestGap = -1;
    for (let i = 1; i < words.length; i++) {
      if (Math.abs(words[i].s - target) > 45) continue;
      const gap = words[i].s - words[i - 1].e;
      if (gap > bestGap) { bestGap = gap; best = i; }
    }
    cuts.push(best > 0 ? best : Math.floor((words.length * k) / n));
  }
  cuts.push(words.length);
  const out: NoteWindow[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    if (cuts[k + 1] <= cuts[k]) continue;
    out.push({ wi: cuts[k], wj: cuts[k + 1], text: renderWindow(words, cuts[k], cuts[k + 1]) });
  }
  return out;
}

/** Per-window quota, scaled from the per-hour rate in DESIGN §9 WP4. */
export function windowQuota(windowSec: number): { points: [number, number]; quotable: [number, number] } {
  const hours = Math.max(0.2, windowSec / 3600);
  const r = (lo: number, hi: number): [number, number] => [
    Math.max(2, Math.round(lo * hours)), Math.max(3, Math.round(hi * hours)),
  ];
  return { points: r(6, 12), quotable: r(4, 10) };
}

export const SYSTEM_PROMPT = [
  'You are reading a transcript of a recorded interview and writing notes that a journalist will check against the tape.',
  '',
  'Absolute rules:',
  '1. Every note you write MUST carry a `quote` copied VERBATIM from the transcript — the exact characters, including punctuation and any transcription oddity. Never paraphrase inside `quote`. Never join two non-adjacent passages into one quote. Never repair grammar.',
  '2. If you cannot support a claim with a verbatim quote, do not write the claim. Silence is correct; an unanchored sentence is not.',
  '3. Prefer the MOST CHECKABLE phrasing available: numbers, dates, names, places, titles. A note a reader can verify in one press beats a note that sounds profound.',
  '4. `text` for a point is one plain sentence in the transcript language stating what the speaker said. No hedging, no "the speaker discusses…", no commentary of your own.',
  '5. Quotes should be one sentence, or at most two, and long enough to stand alone when read aloud — roughly 6 to 40 words.',
  '6. Do not use the word indices in your answer. They are there so you can read the transcript, nothing else. There are no timestamps and you must not invent any.',
  '7. Do not cover the same passage twice. Points and quotable lines must come from different places.',
  '',
  '`points` are what the speaker claims or reveals. `quotable` are lines worth printing as they stand — voice, image, or a sentence with a spine.',
  '',
  'Answer with JSON only, no prose around it, in exactly this shape:',
  '{"points":[{"text":"...","quote":"..."}],"quotable":[{"quote":"..."}]}',
].join('\n');

export interface Quota { points: [number, number]; quotable: [number, number] }

export function buildUserPrompt(
  win: NoteWindow,
  opts: { title?: string; lang?: string; windowSec?: number; quota?: Quota } = {},
): string {
  // The default is DESIGN §9 WP4's per-hour rate. The bundled sample overrides
  // it deliberately: it is a 12-minute showcase that must carry 6–12 points
  // (REVIEW §5 Layer 1), which is denser than a normal recording earns.
  const q = opts.quota ?? windowQuota(opts.windowSec ?? WINDOW_SEC);
  return [
    opts.title ? `Recording: ${opts.title}` : '',
    opts.lang ? `Language: ${opts.lang}. Write the notes in this language.` : '',
    `Return ${q.points[0]}–${q.points[1]} points and ${q.quotable[0]}–${q.quotable[1]} quotable lines for the passage below.`,
    'Each line begins with the word index of its first word, in square brackets.',
    '',
    '--- TRANSCRIPT ---',
    win.text,
    '--- END TRANSCRIPT ---',
  ].filter(Boolean).join('\n');
}
