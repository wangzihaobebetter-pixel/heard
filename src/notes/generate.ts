/**
 * Notes generation (DESIGN §4.6, §9 WP4).
 *
 * The pipeline, and the reason for each step:
 *   1. split the transcript into ~15-minute windows of *word indices*
 *   2. ask the notes model for `{points:[{text,quote}], quotable:[{quote}]}`
 *      — it never sees a clock, so it cannot emit a timestamp we might trust
 *   3. align every returned `quote` back to the word sequence
 *   4. derive the anchor from the WORDS, never from anything the model said
 *   5. a quote that will not align becomes `quality: 'unpinned'` → the `≈` chip
 *      and the honest "couldn't pin this to the tape" line, rather than a
 *      silently wrong timecode
 *
 * The aligner itself is WP1's (`src/audio/align.ts`). It is injectable through
 * `deps.align` so this module can be tested against a stub, but the default is
 * the real one — a note's timecode must come from the same code the player
 * seeks with.
 *
 * WP4 owns this file.
 */
import type { Anchor, Note, Segment, Transcript, Word } from '../types';
import { alignQuote, buildTokenIndex, type AlignResult, type TokenIndex } from '../audio/align';
import {
  buildUserPrompt, planWindows, SYSTEM_PROMPT, WINDOW_SEC,
  type NoteWindow, type Quota, type RawNotes,
} from './prompt';

/* ------------------------------------------------------------- the aligner */

/** WP1's `alignQuote`, narrowed to what this module needs. */
export type AlignQuote = (
  quote: string,
  words: Word[],
  opts?: { index?: TokenIndex; segments?: Segment[] },
) => AlignResult;

/** two notes whose spans overlap by more than this are the same note */
export const DEDUPE_OVERLAP = 0.6;

/* ------------------------------------------------------------ the provider */

export interface NotesProvider {
  baseUrl: string;
  key: string;
  model: string;
}

export interface GenerateDeps {
  /** defaults to WP1's `alignQuote` */
  align?: AlignQuote;
  /** injected so the sample pipeline and tests can run without a network */
  complete?: (system: string, user: string, provider: NotesProvider, signal?: AbortSignal) => Promise<string>;
  newId?: (prefix: string) => string;
  now?: () => number;
  /** share one token index across windows */
  index?: TokenIndex;
}

/** One OpenAI-compatible chat completion, JSON out. */
export async function completeJson(
  system: string, user: string, provider: NotesProvider, signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.key}` },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`notes provider ${res.status}`);
  const j = await res.json();
  return j?.choices?.[0]?.message?.content ?? '';
}

/** Tolerant parse: models wrap JSON in prose or fences often enough to matter. */
export function parseRawNotes(raw: string): RawNotes {
  let s = (raw ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  if (s[0] !== '{') { const i = s.indexOf('{'), j = s.lastIndexOf('}'); if (i >= 0 && j > i) s = s.slice(i, j + 1); }
  let j: unknown;
  try { j = JSON.parse(s); } catch { return { points: [], quotable: [] }; }
  const o = (j ?? {}) as Partial<RawNotes>;
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  return {
    points: (Array.isArray(o.points) ? o.points : [])
      .map((p) => ({ text: str((p as RawPointLike)?.text), quote: str((p as RawPointLike)?.quote) }))
      .filter((p) => p.text && p.quote),
    quotable: (Array.isArray(o.quotable) ? o.quotable : [])
      .map((q) => ({ quote: str((q as RawPointLike)?.quote) }))
      .filter((q) => q.quote),
  };
}
type RawPointLike = { text?: unknown; quote?: unknown };

/* -------------------------------------------------------------- anchoring */

/** Fraction of the shorter span that the two anchors share. */
export function spanOverlap(a: Anchor, b: Anchor): number {
  const lo = Math.max(a.s, b.s), hi = Math.min(a.e, b.e);
  const shared = hi - lo;
  if (shared <= 0) return 0;
  const shortest = Math.min(a.e - a.s, b.e - b.s);
  return shortest > 0 ? shared / shortest : 0;
}

/** Keeps the first of any pair overlapping by more than DEDUPE_OVERLAP. */
export function dedupe(notes: Note[]): Note[] {
  const kept: Note[] = [];
  for (const n of notes) {
    if (n.anchor.quality === 'unpinned') { kept.push(n); continue; }
    if (kept.some((k) => k.anchor.quality !== 'unpinned' && spanOverlap(k.anchor, n.anchor) > DEDUPE_OVERLAP)) continue;
    kept.push(n);
  }
  return kept;
}

/* ------------------------------------------------------------------ driver */

export interface GenerateOptions {
  title?: string;
  windowSec?: number;
  /** overrides the per-hour note rate; the bundled sample uses this */
  quota?: Quota;
  signal?: AbortSignal;
  /** called as each window lands so the Interview screen can fill progressively */
  onWindow?: (notes: Note[], done: number, total: number) => void;
}

let seq = 0;
const defaultId = (p: string) => `${p}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Turns one window's raw model output into anchored notes. */
export function notesFromRaw(
  raw: RawNotes, transcript: Transcript, win: NoteWindow, deps: GenerateDeps,
): Note[] {
  const newId = deps.newId ?? defaultId;
  const stamp = (deps.now ?? Date.now)();
  const words = transcript.words;
  const align = deps.align ?? alignQuote;
  const index = deps.index ?? buildTokenIndex(words);
  const find = (q: string) => align(q, words, { index, segments: transcript.segments });
  const out: Note[] = [];

  for (const p of raw.points) {
    const { anchor } = find(p.quote);
    out.push({
      id: newId('n'), kind: 'point', text: p.text,
      // An unpinned point keeps its claim and loses its receipt: the `≈` chip
      // plus "couldn't pin this to the tape" is the honest rendering (DESIGN §5).
      quote: anchor.quality === 'unpinned' ? undefined : quoteFromWords(words, anchor, p.quote),
      anchor, heard: false, createdAt: stamp, updatedAt: stamp,
    });
  }
  for (const q of raw.quotable) {
    const { anchor } = find(q.quote);
    // A quotable line IS its receipt. If it is not on the tape it is nothing.
    if (anchor.quality === 'unpinned') continue;
    const text = quoteFromWords(words, anchor, q.quote);
    out.push({
      id: newId('n'), kind: 'quote', text, quote: text,
      anchor, heard: false, createdAt: stamp, updatedAt: stamp,
    });
  }
  return out;
}

/**
 * The shipped `quote` is rebuilt from the words the anchor points at, not from
 * the model's copy of them. If the model dropped a comma, the receipt still
 * matches the tape exactly — which is what `verify-sample.mjs` asserts.
 */
export function quoteFromWords(words: Word[], anchor: Anchor, fallback: string): string {
  if (anchor.wi == null || anchor.wj == null) return fallback;
  return words.slice(anchor.wi, anchor.wj).map((w) => w.t).join(' ');
}

export async function generateNotes(
  transcript: Transcript, provider: NotesProvider, deps: GenerateDeps, opts: GenerateOptions = {},
): Promise<Note[]> {
  const windowSec = opts.windowSec ?? WINDOW_SEC;
  const windows = planWindows(transcript.words, windowSec);
  const complete = deps.complete ?? completeJson;
  const shared: GenerateDeps = { ...deps, index: deps.index ?? buildTokenIndex(transcript.words) };
  const all: Note[] = [];
  let done = 0;

  const results = await Promise.all(windows.map(async (win) => {
    const raw = parseRawNotes(await complete(
      SYSTEM_PROMPT,
      buildUserPrompt(win, { title: opts.title, lang: transcript.lang, windowSec, quota: opts.quota }),
      provider, opts.signal,
    ));
    const notes = notesFromRaw(raw, transcript, win, shared);
    done += 1;
    opts.onWindow?.(notes, done, windows.length);
    return notes;
  }));

  for (const r of results) all.push(...r);
  all.sort((a, b) => a.anchor.s - b.anchor.s);
  return dedupe(all);
}
