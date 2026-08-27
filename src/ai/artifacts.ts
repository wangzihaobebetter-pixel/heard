/**
 * The AI layer's artifacts — summary, chapters, concepts, exam flags —
 * for every recording (v3 B5, PRODUCT-SPEC §4.4).
 *
 * Two sources, one shape (src/content/schema.ts StarterArtifacts):
 *
 *  - Starter entries ship theirs precomputed and verified at build time
 *    (166 quotes through the reference aligner AND the publisher's own
 *    transcript — scripts/build-content.mjs). The no-key experience is
 *    complete because these never need a provider.
 *  - User recordings generate theirs here, under the same prompt law the
 *    notes model lives by (src/notes/prompt.ts): the model sees word indices
 *    and never a clock, every claim carries a VERBATIM quote, and every quote
 *    must re-align to the word timeline (src/audio/align.ts). Generated
 *    summaries and answers fail closed when any claim lacks a verified
 *    citation; unsupported prose never ships beside a valid receipt.
 *
 * Generated artifacts persist in versioned IndexedDB (`artifacts:v2:<id>`), outside the
 * JSON-serialised store, same reasoning as the starter bundles (B1).
 */
import { del, get, set } from 'idb-keyval';
import { useStore } from '../store';
import { fetchStarterBundle, starterMeta } from '../content/load';
import { alignQuote, buildTokenIndex } from '../audio/align';
import { completeJson } from '../notes/generate';
import { renderWindow } from '../notes/prompt';
import type { Citation, StarterArtifacts } from '../content/schema';
import type { Word } from '../types';

const legacyArtifactsKey = (id: string) => `artifacts:${id}`;
const artifactsKey = (id: string) => `artifacts:v2:${id}`;
const MIN_ALIGN = 0.85;

/* ----------------------------------------------------------------- reading */

const memory = new Map<string, StarterArtifacts>();

export async function getArtifacts(interviewId: string): Promise<StarterArtifacts | null> {
  const m = memory.get(interviewId);
  if (m) return m;
  if (starterMeta(interviewId)) {
    const bundle = await fetchStarterBundle(interviewId);
    if (bundle) memory.set(interviewId, bundle.artifacts);
    return bundle?.artifacts ?? null;
  }
  try {
    const stored = await get<StarterArtifacts>(artifactsKey(interviewId));
    if (stored) memory.set(interviewId, stored);
    return stored ?? null;
  } catch {
    return null;
  }
}

export async function removeArtifacts(interviewId: string): Promise<void> {
  memory.delete(interviewId);
  try { await del(artifactsKey(interviewId)); } catch { /* gone is fine */ }
  try { await del(legacyArtifactsKey(interviewId)); } catch { /* old cache may not exist */ }
}

/* -------------------------------------------------------------- generation */

export const ARTIFACTS_SYSTEM = [
  'You are reading the transcript of a recorded lecture or talk and writing study material that will be checked against the tape.',
  '',
  'Absolute rules:',
  '1. Every `quote` field MUST be copied VERBATIM from the transcript — exact characters, punctuation, transcription oddities and all. Never paraphrase inside a quote, never join non-adjacent passages, never repair grammar.',
  '2. A claim you cannot support with a verbatim quote does not get a citation — and a chapter, concept or flag you cannot quote does not get written.',
  '3. The word indices in square brackets exist so you can read; never use them in your answer, and never invent timestamps.',
  '',
  'What to write:',
  '- `summary`: 2–4 short paragraphs. Mark cited claims inline with [1], [2]… in reading order; `citations` lists the verbatim quote for each marker, in order.',
  '- `chapters`: 4–10 entries covering the whole recording in order; `quote` is the verbatim opening words of that section.',
  '- `concepts`: the 2–6 terms a student would need defined; one-sentence `definition` in your words, `quote` verbatim where the term is used.',
  '- `flags`: only genuinely actionable items — deadlines, exam mentions, assignments, explicit "remember this" moments. Empty is correct when there are none.',
  '',
  'Answer with JSON only, exactly this shape:',
  '{"summary":{"text":"…[1]…","citations":["…"]},"chapters":[{"title":"…","quote":"…"}],"concepts":[{"term":"…","definition":"…","quote":"…"}],"flags":[{"text":"…","quote":"…"}]}',
].join('\n');

interface RawArtifacts {
  summary?: { text?: unknown; citations?: unknown };
  chapters?: unknown;
  concepts?: unknown;
  flags?: unknown;
}

/** Tolerant JSON extraction — fences and prose happen (notes/generate.ts). */
function parseRaw(raw: string): RawArtifacts | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  try { return JSON.parse(m[0]) as RawArtifacts; } catch { return null; }
}

const asStr = (x: unknown): string => (typeof x === 'string' ? x : '');
const asArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/**
 * Generated prose is only useful to Heard when every claim carries a receipt.
 * Normalize the common `claim.[1]` form, then require every sentence/paragraph
 * to contain a canonical marker whose quote survived alignment. Extra citation
 * entries are rejected too: the provider must not smuggle unused evidence into
 * an otherwise plausible response.
 */
function hasCompleteCitationCoverage(text: string, citations: (Citation | null)[]): boolean {
  const prose = text.trim();
  if (!prose || citations.length === 0 || !citations.every(Boolean)) return false;

  const markerMatches = [...prose.matchAll(/\[(\d+)\]/g)];
  if (markerMatches.length === 0) return false;
  const referenced = new Set<number>();
  for (const match of markerMatches) {
    const raw = match[1];
    const n = Number(raw);
    if (raw !== String(n) || !Number.isInteger(n) || n < 1 || n > citations.length || !citations[n - 1]) {
      return false;
    }
    referenced.add(n);
  }
  if (!citations.every((_, index) => referenced.has(index + 1))) return false;

  const normalized = prose.replace(
    /([.!?。！？;；])\s*((?:\[\d+\]\s*)+)/g,
    '$2$1 ',
  );
  const delimited = normalized.replace(/([!?。！？;；]|\.(?!\d))/g, '$1\n');
  const claimUnits = delimited
    .split(/\n+/)
    .map((unit) => unit.trim())
    .filter((unit) => unit.replace(/\[\d+\]/g, '').replace(/[.!?。！？;；]/g, '').trim().length > 0);
  return claimUnits.length > 0 && claimUnits.every((unit) => /\[\d+\]/.test(unit));
}

export type GenerateResult =
  | { ok: true; artifacts: StarterArtifacts }
  | { ok: false; reason: 'no-key' | 'no-transcript' | 'failed' };

/** §4.4 summary style presets — reshaping is a legitimate re-read, not a new law. */
export type SummaryStyle = 'concise' | 'detailed' | 'study';

const STYLE_LINES: Record<SummaryStyle, string> = {
  concise: 'Style: CONCISE — the summary is 1–2 short paragraphs, only the load-bearing claims.',
  detailed: 'Style: DETAILED — the summary is 4–6 paragraphs and follows the recording\'s own order.',
  study: 'Style: STUDY GUIDE — the summary is organised as points a student would revise from, each one checkable.',
};

/**
 * Generate, verify, persist. One provider call for the whole recording; the
 * verification is the same shape as the build-time gate: align or drop.
 */
export async function generateArtifacts(
  interviewId: string,
  opts: { style?: SummaryStyle } = {},
): Promise<GenerateResult> {
  const store = useStore.getState();
  const llm = store.settings.llm;
  if (!llm.key.trim()) return { ok: false, reason: 'no-key' };
  const t = store.transcripts[interviewId];
  const words = t?.words ?? [];
  if (words.length < 40) return { ok: false, reason: 'no-transcript' };

  const title = store.interviews[interviewId]?.title;
  const user = [
    title ? `Recording: ${title}` : '',
    opts.style ? STYLE_LINES[opts.style] : '',
    `Language: ${t.lang}. Write in this language.`,
    'Each transcript line begins with the word index of its first word, in square brackets.',
    '',
    '--- TRANSCRIPT ---',
    renderWindow(words, 0, words.length),
    '--- END TRANSCRIPT ---',
  ].filter(Boolean).join('\n');

  let raw: string;
  try {
    raw = await completeJson(ARTIFACTS_SYSTEM, user, {
      baseUrl: llm.baseUrl, key: llm.key, model: llm.model,
    });
  } catch {
    return { ok: false, reason: 'failed' };
  }
  const parsed = parseRaw(raw);
  if (!parsed) return { ok: false, reason: 'failed' };

  const index = buildTokenIndex(words);
  const resolve = (quote: string): Citation | null => {
    const q = quote.trim();
    if (!q) return null;
    const { anchor, ratio } = alignQuote(q, words, { index, segments: t.segments });
    if (anchor.quality !== 'word' || anchor.wi == null || anchor.wj == null || (ratio ?? 0) < MIN_ALIGN) return null;
    return {
      // The shipped quote is what the span SAYS, never the model's copy.
      quote: words.slice(anchor.wi, anchor.wj).map((w) => w.t).join(' '),
      wi: anchor.wi, wj: anchor.wj, s: anchor.s, e: anchor.e,
      corrob: +(ratio ?? 0).toFixed(4),
    };
  };

  const artifacts: StarterArtifacts = {
    summary: {
      text: asStr(parsed.summary?.text).trim(),
      // Nullable per marker: a failed citation keeps its [n] as plain text
      // instead of renumbering every other marker.
      citations: asArr(parsed.summary?.citations).map((q) => resolve(asStr(q))),
    },
    chapters: asArr(parsed.chapters).flatMap((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const at = resolve(asStr(o.quote));
      return at && asStr(o.title) ? [{ title: asStr(o.title), at }] : [];
    }),
    concepts: asArr(parsed.concepts).flatMap((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const cite = resolve(asStr(o.quote));
      return cite && asStr(o.term) ? [{ term: asStr(o.term), definition: asStr(o.definition), cite }] : [];
    }),
    flags: asArr(parsed.flags).flatMap((f) => {
      const o = (f ?? {}) as Record<string, unknown>;
      const cite = resolve(asStr(o.quote));
      return cite && asStr(o.text) ? [{ text: asStr(o.text), cite }] : [];
    }),
  };

  const summaryText = artifacts.summary.text.trim();
  if (summaryText && !hasCompleteCitationCoverage(summaryText, artifacts.summary.citations)) {
    return { ok: false, reason: 'failed' };
  }
  if (!artifacts.summary.text && !artifacts.chapters.length) return { ok: false, reason: 'failed' };

  memory.set(interviewId, artifacts);
  try { await set(artifactsKey(interviewId), artifacts); } catch { /* memory copy still serves */ }
  return { ok: true, artifacts };
}


/* ------------------------------------------------------------ saved prompts */

/**
 * §4.4 Saved prompts (the Tactiq table stake): a question re-runnable over any
 * recording, answered under the same law as everything else — verbatim quotes,
 * re-aligned or dropped. The four shipped presets live in the string table
 * (they are copy); user-defined ones persist in settings.llm.savedPrompts.
 */
export interface PromptResult {
  answer: string;
  citations: (Citation | null)[];
}

export async function runPrompt(interviewId: string, prompt: string): Promise<
  | { ok: true; result: PromptResult }
  | { ok: false; reason: 'no-key' | 'no-transcript' | 'failed' }
> {
  const store = useStore.getState();
  const llm = store.settings.llm;
  if (!llm.key.trim()) return { ok: false, reason: 'no-key' };
  const t = store.transcripts[interviewId];
  const words = t?.words ?? [];
  if (words.length < 40) return { ok: false, reason: 'no-transcript' };

  const system = [
    'You are answering ONE question about the transcript of a recording, for a student who will check you against the tape.',
    '',
    'Absolute rules:',
    '1. Ground every claim in the transcript. Mark grounded claims inline with [1], [2]… and list a VERBATIM quote for each marker in `citations`, in order — exact characters, never paraphrased, never joined from separate passages.',
    '2. If the transcript does not answer the question, say so plainly instead of inventing.',
    '3. Word indices exist so you can read; never use them in the answer, never invent timestamps.',
    '',
    'Answer with JSON only: {"answer":"…[1]…","citations":["…"]}',
  ].join('\n');

  const user = [
    `Question: ${prompt}`,
    `Language: answer in the language of the question.`,
    '',
    '--- TRANSCRIPT ---',
    renderWindow(words, 0, words.length),
    '--- END TRANSCRIPT ---',
  ].join('\n');

  let raw: string;
  try {
    raw = await completeJson(system, user, { baseUrl: llm.baseUrl, key: llm.key, model: llm.model });
  } catch {
    return { ok: false, reason: 'failed' };
  }
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return { ok: false, reason: 'failed' };
  let parsed: { answer?: unknown; citations?: unknown };
  try { parsed = JSON.parse(m[0]) as { answer?: unknown; citations?: unknown }; } catch { return { ok: false, reason: 'failed' }; }
  const answer = typeof parsed.answer === 'string' ? parsed.answer : '';
  if (!answer) return { ok: false, reason: 'failed' };

  const index = buildTokenIndex(words);
  const citations = (Array.isArray(parsed.citations) ? parsed.citations : []).map((q) => {
    const quote = typeof q === 'string' ? q.trim() : '';
    if (!quote) return null;
    const { anchor, ratio } = alignQuote(quote, words, { index, segments: t.segments });
    if (anchor.quality !== 'word' || anchor.wi == null || anchor.wj == null || (ratio ?? 0) < MIN_ALIGN) return null;
    return {
      quote: words.slice(anchor.wi, anchor.wj).map((w) => w.t).join(' '),
      wi: anchor.wi, wj: anchor.wj, s: anchor.s, e: anchor.e,
      corrob: +(ratio ?? 0).toFixed(4),
    };
  });
  if (!hasCompleteCitationCoverage(answer, citations)) return { ok: false, reason: 'failed' };
  return { ok: true, result: { answer, citations } };
}
