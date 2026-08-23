/**
 * Which word is under the playhead — WP2's read-side copy of the containment
 * rule (DESIGN §5.4).
 *
 * WP1's engine owns the *live* cursor: it runs a rAF binary search and writes
 * `usePlayer.wordIndex` on the frame the voice crosses `word.start`, which is
 * the only way to hit the "within one animation frame" commitment. That loop
 * only runs while audio is playing, though, and the screen still has to answer
 * the question when it is not — paused mid-sentence, scrubbed to a moment, or
 * stopped at the end of a span. This is that answer, and it is deliberately the
 * same rule: the word whose `[s, e)` contains `t`, and nothing in the gaps
 * between words, because in a gap nothing is being spoken.
 */
import type { Word } from '../types';

export function wordAt(words: Word[], t: number): number {
  const n = words.length;
  if (!n) return -1;
  let lo = 0;
  let hi = n - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].s <= t) { at = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (at < 0) return -1;
  return t < words[at].e ? at : -1;
}
