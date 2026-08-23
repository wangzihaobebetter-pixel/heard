/**
 * Reference implementation of DESIGN §4.6's quote aligner, for the sample
 * pipeline (`scripts/make-sample.mjs`) and `verify-sample.mjs`.
 *
 * The app uses WP1's `src/audio/align.ts` at runtime; `make-sample.mjs` bundles
 * and prefers that one when it exists, and falls back to this file — reporting
 * loudly which it used — so the sample can be produced before WP1 lands.
 *
 * Algorithm, per the design: normalised tokens, sliding window, ≥ 0.85 match
 * ratio. Similarity is LCS-based (`2·LCS / (|Q| + |W|)`), so a dropped comma or
 * a swapped filler word degrades the score smoothly instead of breaking it.
 */

/** Lowercase, fold smart punctuation, drop everything that is not a letter/digit. */
export function normToken(t) {
  return String(t)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—‒]/g, '-')
    .replace(/[^\p{L}\p{N}']/gu, '')
    .replace(/^'+|'+$/g, '');
}

export function tokenize(s) {
  return String(s).split(/\s+/).map(normToken).filter(Boolean);
}

/** Longest common subsequence length, O(|a|·|b|) with a rolling row. */
export function lcs(a, b) {
  const n = b.length;
  let prev = new Uint16Array(n + 1), cur = new Uint16Array(n + 1);
  for (let i = 0; i < a.length; i++) {
    cur[0] = 0;
    for (let j = 0; j < n; j++) {
      cur[j + 1] = a[i] === b[j] ? prev[j] + 1 : Math.max(cur[j], prev[j + 1]);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}

export function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  return (2 * lcs(a, b)) / (a.length + b.length);
}

/** How far the window length may stray from the quote's token count. */
const SLACK = 3;

/**
 * @param quote  the model's verbatim quote
 * @param words  Transcript.words
 * @param hint   {wi, wj} — search this range first
 * @returns {{wi:number, wj:number, score:number}|null}
 */
export function alignQuote(quote, words, hint) {
  const Q = tokenize(quote);
  if (Q.length === 0 || words.length === 0) return null;
  const W = words.map((w) => normToken(w.t));

  const search = (lo, hi) => {
    // candidate starts: positions whose token equals one of the quote's first
    // two tokens — cheap filter that never rejects a true full-length match
    const heads = new Set([Q[0], Q[1]].filter(Boolean));
    let best = null;
    for (let i = lo; i < hi; i++) {
      if (!heads.has(W[i])) continue;
      for (let L = Math.max(1, Q.length - SLACK); L <= Q.length + SLACK; L++) {
        const j = i + L;
        if (j > hi) break;
        const score = similarity(Q, W.slice(i, j));
        if (!best || score > best.score) best = { wi: i, wj: j, score };
      }
    }
    return best;
  };

  const inHint = hint && Number.isFinite(hint.wi) && Number.isFinite(hint.wj)
    ? search(Math.max(0, hint.wi), Math.min(words.length, hint.wj))
    : null;
  if (inHint && inHint.score >= 0.85) return round(inHint);

  const global = search(0, words.length);
  const best = !inHint ? global : (!global || inHint.score >= global.score ? inHint : global);
  return best ? round(best) : null;
}

function round(h) { return { wi: h.wi, wj: h.wj, score: +h.score.toFixed(4) }; }
