/**
 * Quote → word span (DESIGN §4.6, "Notes are written by a text model that never
 * sees timestamps").
 *
 * WP1 owns this file.
 *
 * This is the mechanism behind the product's one promise. The notes model is
 * shown the transcript and returns a **verbatim quote**; it is never shown a
 * timestamp and its numbers are never trusted. This module finds where that
 * quote actually occurs in the word array, and the timecode is derived from the
 * words themselves. A model that invents a plausible-sounding time cannot fool
 * it, because its times are never read.
 *
 * The honesty channel is the return value's `quality`:
 *   'word'     — matched a word span at or above `minRatio`. Solid chip.
 *   'segment'  — only a provider segment matched; position interpolated inside
 *                it by character offset. `≈` chip, wider pre-roll.
 *   'unpinned' — nothing matched well enough. `≈` chip, and the copy says so.
 *                We still return the best-scoring position, because DESIGN §5
 *                promises "nearest place shown" rather than a dead chip.
 *
 * Matching runs on normalised tokens (case, punctuation and whitespace folded
 * away) because the model paraphrases punctuation constantly and a quote that
 * differs only by a comma is the same quote. It tolerates small insertions and
 * deletions via a longest-common-subsequence score, because providers split
 * hyphenated words unpredictably and the model sometimes drops a filler word.
 */
import type { Anchor, Segment, Word } from '../types';

/** DESIGN §4.6: "≥ 0.85 match ratio". */
export const MIN_MATCH_RATIO = 0.85;

/**
 * Fold a string to comparison tokens.
 *
 * CJK gets one token per character on purpose: 听证 has no spaces to split on,
 * and character-level tokens make the ratio behave the same way in both
 * languages the product ships in.
 */
export interface TokenSpan {
  tokens: string[];
  /** character offset in the source string where each token starts */
  starts: number[];
  /** character offset one past each token's last character */
  ends: number[];
}

/**
 * Fold a string to comparison tokens, keeping each token's character span.
 *
 * CJK gets one token per character on purpose: 听证 has no spaces to split on,
 * and character-level tokens make the ratio behave the same way in both
 * languages the product ships in.
 */
export function tokenizeWithSpans(text: string): TokenSpan {
  const tokens: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const src = (text || '').toLowerCase().normalize('NFKC');

  let buf = '';
  let bufStart = 0;
  const flush = (at: number) => {
    if (!buf) return;
    tokens.push(buf);
    starts.push(bufStart);
    ends.push(at);
    buf = '';
  };

  let i = 0;
  for (const ch of src) {
    const width = ch.length;
    const code = ch.codePointAt(0) ?? 0;
    const isCjk =
      (code >= 0x3040 && code <= 0x30ff) ||   // kana
      (code >= 0x3400 && code <= 0x4dbf) ||   // CJK ext A
      (code >= 0x4e00 && code <= 0x9fff) ||   // CJK
      (code >= 0xf900 && code <= 0xfaff);     // compatibility
    if (isCjk) {
      flush(i);
      tokens.push(ch);
      starts.push(i);
      ends.push(i + width);
    } else if (/[a-z0-9\u00c0-\u024f]/.test(ch)) {
      if (!buf) bufStart = i;
      buf += ch;
    } else if ((ch === "'" || ch === '\u2019') && buf) {
      // An apostrophe inside a word is part of the word: "don't" is one token.
    } else {
      flush(i);
    }
    i += width;
  }
  flush(i);

  return { tokens, starts, ends };
}

export function normalizeTokens(text: string): string[] {
  return tokenizeWithSpans(text).tokens;
}

/** Ordered overlap. 1.0 on an exact match; symmetric; tolerant of small edits. */
export function lcsLength(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  // Rolling single row — the quote is short but the window can be 40+ tokens,
  // and this is called for every candidate position.
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1
        : (cur[j - 1] > prev[j] ? cur[j - 1] : prev[j]);
    }
    const swap = prev; prev = cur; cur = swap;
    cur.fill(0);
  }
  return prev[b.length];
}

function ratio(a: string[], b: string[]): number {
  const total = a.length + b.length;
  return total ? (2 * lcsLength(a, b)) / total : 0;
}

/* ------------------------------------------------------- the token index */

/**
 * Words flattened to tokens, with a map back to the word that produced each.
 * Built once per transcript and reused across every note, which matters when
 * WP4 aligns fourteen quotes against a 12 000-word transcript.
 */
export interface TokenIndex {
  tokens: string[];
  /** tokens[k] begins inside words[owner[k]] */
  owner: Int32Array;
  /** tokens[k] ends inside words[lastOwner[k]] — usually, but not always, the same word */
  lastOwner: Int32Array;
  /** token → every position it occupies, for candidate generation */
  positions: Map<string, number[]>;
}

/**
 * Words flattened to tokens, with a map back to the word that produced each.
 * Built once per transcript and reused across every note, which matters when
 * WP4 aligns fourteen quotes against a 12 000-word transcript.
 *
 * **It tokenises the joined transcript text, not each word in isolation, and
 * that is the whole point.** Whisper splits words across tokens constantly — a
 * name arrives as `" Kran"` + `"z"`, a number as `" 19"` + `"60s"`. Tokenising
 * per word yields `["kran", "z"]`; the notes model, which is shown the joined
 * transcript, quotes `"Kranz"` and yields `["kranz"]`. Those never match, and
 * the note silently degrades to an `≈` chip for no reason the user can see.
 * Joining first makes both sides produce the same tokens, and the character
 * spans carry the mapping back to word indices so the anchor is still exact.
 */
export function buildTokenIndex(words: Word[]): TokenIndex {
  // Character → word index, over the same joined text a quote is taken from.
  let full = '';
  const charOwner: number[] = [];
  for (let w = 0; w < words.length; w++) {
    const t = words[w].t ?? '';
    // The provider never emits leading whitespace on a Word.t (0 of 1740 in the
    // NASA sample), but the joined text a quote is taken from DOES have spaces
    // between words. Stitch them in here so the tokeniser counts them.
    if (full) { full += ' '; charOwner.push(w); }
    full += t;
    for (let c = 0; c < t.length; c++) charOwner.push(w);
  }

  // `toLowerCase()` and NFKC can change string length (ﬁ → fi, İ → i̇), which
  // would slide every char offset. Tokenise the already-folded text so the
  // spans index the same string `charOwner` describes.
  const folded = full.toLowerCase().normalize('NFKC');
  const spans = folded.length === full.length
    ? tokenizeWithSpans(full)
    : tokenizeWithSpansAligned(full, charOwner);

  const owner = new Int32Array(spans.tokens.length);
  const lastOwner = new Int32Array(spans.tokens.length);
  for (let k = 0; k < spans.tokens.length; k++) {
    owner[k] = charOwner[Math.min(spans.starts[k], charOwner.length - 1)] ?? 0;
    lastOwner[k] = charOwner[Math.min(Math.max(spans.ends[k] - 1, 0), charOwner.length - 1)] ?? owner[k];
  }

  const positions = new Map<string, number[]>();
  for (let k = 0; k < spans.tokens.length; k++) {
    const list = positions.get(spans.tokens[k]);
    if (list) list.push(k);
    else positions.set(spans.tokens[k], [k]);
  }
  return { tokens: spans.tokens, owner, lastOwner, positions };
}

/**
 * Rare fallback: a locale fold changed the string length, so character offsets
 * into the folded text no longer index the original. Tokenise word by word and
 * stitch adjacent fragments, which loses the joined-text benefit for this one
 * transcript but never mis-maps a token to the wrong word.
 */
function tokenizeWithSpansAligned(full: string, charOwner: number[]): TokenSpan {
  const tokens: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  while (at < full.length) {
    let to = at;
    while (to < full.length && charOwner[to] === charOwner[at]) to++;
    const piece = tokenizeWithSpans(full.slice(at, to));
    for (let k = 0; k < piece.tokens.length; k++) {
      tokens.push(piece.tokens[k]);
      starts.push(at + piece.starts[k]);
      ends.push(at + piece.ends[k]);
    }
    at = to;
  }
  return { tokens, starts, ends };
}

export interface AlignOptions {
  minRatio?: number;
  /** How much longer or shorter than the quote a candidate window may be. */
  slack?: number;
  index?: TokenIndex;
  segments?: Segment[];
}

export interface AlignResult {
  anchor: Anchor;
  ratio: number;
}

/**
 * Find `quote` in `words`.
 *
 * Candidates come from the quote's **rarest** token rather than its first: a
 * quote beginning with "the" would otherwise propose every "the" in an hour of
 * speech, while its rarest token usually occurs a handful of times. Each
 * candidate is then scored properly at three window lengths, since providers
 * split and join tokens unpredictably.
 */
export function alignQuote(quote: string, words: Word[], opts: AlignOptions = {}): AlignResult {
  const minRatio = opts.minRatio ?? MIN_MATCH_RATIO;
  const slack = opts.slack ?? 3;
  const q = normalizeTokens(quote);

  const empty: AlignResult = {
    anchor: { s: 0, e: 0, quality: 'unpinned' },
    ratio: 0,
  };
  if (!q.length || !words.length) return empty;

  const idx = opts.index ?? buildTokenIndex(words);
  if (!idx.tokens.length) return empty;

  // Rarest token first; a quote made entirely of absent tokens has no
  // candidates and falls through to the coarse scan below.
  let seedTok = '';
  let seedPositions: number[] | undefined;
  for (const t of q) {
    const p = idx.positions.get(t);
    if (!p) continue;
    if (!seedPositions || p.length < seedPositions.length) { seedTok = t; seedPositions = p; }
  }

  const seedOffset = seedTok ? q.indexOf(seedTok) : 0;
  const starts = new Set<number>();
  if (seedPositions) {
    for (const p of seedPositions) {
      const s = p - seedOffset;
      // Nudge either side: the seed may itself be a token the provider split.
      for (let d = -2; d <= 2; d++) {
        const at = s + d;
        if (at >= 0 && at < idx.tokens.length) starts.add(at);
      }
    }
  }
  if (!starts.size) {
    // No shared token at all. Scan coarsely so "nearest place shown" still has
    // somewhere to point, rather than defaulting to zero.
    const stride = Math.max(1, Math.floor(q.length / 2));
    for (let at = 0; at < idx.tokens.length; at += stride) starts.add(at);
  }

  let best = { at: 0, len: q.length, r: 0 };
  const lengths = [q.length, Math.max(1, q.length - slack), q.length + slack];
  for (const at of starts) {
    for (const len of lengths) {
      const end = Math.min(idx.tokens.length, at + len);
      if (end <= at) continue;
      const r = ratio(q, idx.tokens.slice(at, end));
      if (r > best.r) best = { at, len: end - at, r };
      if (r === 1) break;
    }
    if (best.r === 1) break;
  }

  const lastTok = Math.min(idx.tokens.length - 1, best.at + best.len - 1);
  const wi = idx.owner[best.at];
  // The last token may end inside a later word than it began in (a token that
  // spans a Whisper split), so the span's right edge comes from `lastOwner`.
  const wj = Math.max(wi + 1, idx.lastOwner[lastTok] + 1);

  if (best.r >= minRatio) {
    return {
      anchor: { s: words[wi].s, e: words[wj - 1].e, wi, wj, quality: 'word' },
      ratio: best.r,
    };
  }

  // Word-level failed. If the provider gave us segments, a segment whose text
  // contains the quote is still a real, if coarse, answer (DESIGN §4.6).
  const viaSegment = alignInSegment(q, words, best, opts.segments);
  if (viaSegment) return viaSegment;

  return {
    anchor: { s: words[wi].s, e: words[wj - 1].e, wi, wj, quality: 'unpinned' },
    ratio: best.r,
  };
}

/**
 * Segment-only fallback: interpolate the quote's position inside the segment by
 * character offset, which is the best a segment-granularity provider allows.
 * The chip renders `≈` and the pre-roll widens to 2.5 s to cover the error.
 */
function alignInSegment(
  q: string[],
  words: Word[],
  best: { at: number; len: number; r: number },
  segments?: Segment[],
): AlignResult | null {
  if (!segments?.length) return null;
  const wi = words.length ? Math.min(words.length - 1, best.at) : 0;
  const t = words[wi]?.s ?? 0;
  const seg = segments.find((sg) => t >= sg.s && t <= sg.e);
  if (!seg) return null;

  const segWords = words.slice(seg.wi, seg.wj);
  if (!segWords.length) return null;
  const segTokens = segWords.flatMap((w) => normalizeTokens(w.t));
  const r = ratio(q, segTokens);
  if (r < 0.5) return null;

  const span = Math.min(seg.e - seg.s, Math.max(0.5, q.length * 0.35));
  return {
    anchor: { s: seg.s, e: Math.min(seg.e, seg.s + span), wi: seg.wi, wj: seg.wj, quality: 'segment' },
    ratio: r,
  };
}

/** Align many quotes against one transcript, sharing the token index. */
export function alignQuotes(quotes: string[], words: Word[], segments?: Segment[]): AlignResult[] {
  const index = buildTokenIndex(words);
  return quotes.map((quote) => alignQuote(quote, words, { index, segments }));
}

/** The verbatim text of `[wi, wj)`, for a note's `quote` field and the export. */
export function textOfSpan(words: Word[], wi: number, wj: number): string {
  return words.slice(Math.max(0, wi), Math.max(0, wj)).map((w) => w.t).join(' ').trim();
}
