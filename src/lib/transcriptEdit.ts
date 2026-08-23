/**
 * Transcript text edits with undo/redo (v3 B4, PRODUCT-SPEC §4.2).
 *
 * The one law: an edit changes what a word SAYS (`Word.t`), never WHEN it is
 * (`s`, `e`) or WHERE it is (`i`). Timing and identity are what every note
 * anchor leans on; text is the only thing a human can know better than the
 * tape. This module is the only writer of word text, so the law has exactly
 * one place to hold.
 *
 * Undo is in-session and per-interview (the Notta lesson: an edit you cannot
 * take back turns every edit into a risk). Entries store inverse text pairs,
 * not transcript snapshots — a 4 000-word transcript is not copied because
 * one professor's name was fixed in it.
 */
import { create } from 'zustand';
import { useStore } from '../store';

interface Change { i: number; before: string; after: string }

const undoStacks = new Map<string, Change[][]>();
const redoStacks = new Map<string, Change[][]>();

/** Reactivity for toolbar buttons: bumps whenever any stack changes. */
export const useEditHistory = create<{ version: number }>()(() => ({ version: 0 }));
const bump = () => useEditHistory.setState((s) => ({ version: s.version + 1 }));

export const canUndo = (id: string): boolean => (undoStacks.get(id)?.length ?? 0) > 0;
export const canRedo = (id: string): boolean => (redoStacks.get(id)?.length ?? 0) > 0;

function writeWords(id: string, texts: Map<number, string>): void {
  const store = useStore.getState();
  const t = store.transcripts[id];
  if (!t) return;
  store.patchTranscript(id, {
    words: t.words.map((w) => (texts.has(w.i) ? { ...w, t: texts.get(w.i) as string } : w)),
  });
}

/** Apply text edits as ONE undoable step (a replace-all is one undo, not N). */
export function applyWordEdits(id: string, edits: { i: number; t: string }[]): void {
  const t = useStore.getState().transcripts[id];
  if (!t) return;
  const changes: Change[] = [];
  const texts = new Map<number, string>();
  for (const e of edits) {
    const w = t.words[e.i];
    if (!w || w.i !== e.i || w.t === e.t) continue;
    changes.push({ i: e.i, before: w.t, after: e.t });
    texts.set(e.i, e.t);
  }
  if (!changes.length) return;
  writeWords(id, texts);
  const stack = undoStacks.get(id) ?? [];
  stack.push(changes);
  undoStacks.set(id, stack);
  redoStacks.set(id, []);
  bump();
}

export function undoEdit(id: string): void {
  const entry = undoStacks.get(id)?.pop();
  if (!entry) return;
  writeWords(id, new Map(entry.map((c) => [c.i, c.before])));
  const redo = redoStacks.get(id) ?? [];
  redo.push(entry);
  redoStacks.set(id, redo);
  bump();
}

export function redoEdit(id: string): void {
  const entry = redoStacks.get(id)?.pop();
  if (!entry) return;
  writeWords(id, new Map(entry.map((c) => [c.i, c.after])));
  const undo = undoStacks.get(id) ?? [];
  undo.push(entry);
  undoStacks.set(id, undo);
  bump();
}

/* -------------------------------------------------------------- searching */

/** Fold a word to its comparable core — same folding on both sides. */
export function foldToken(t: string): string {
  return t.toLowerCase().normalize('NFKD')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^\p{L}\p{N}']/gu, '');
}

export interface SearchMatch { wi: number; wj: number }

/**
 * Consecutive-word phrase search over the transcript. Punctuation and case
 * are the transcriber's; the search is over what was SAID.
 */
export function findMatches(words: { i: number; t: string }[], query: string): SearchMatch[] {
  const Q = query.split(/\s+/).map(foldToken).filter(Boolean);
  if (!Q.length) return [];
  const W = words.map((w) => foldToken(w.t));
  const out: SearchMatch[] = [];
  for (let i = 0; i + Q.length <= W.length; i++) {
    let ok = true;
    for (let k = 0; k < Q.length; k++) if (W[i + k] !== Q[k]) { ok = false; break; }
    if (ok) out.push({ wi: i, wj: i + Q.length });
  }
  return out;
}

/**
 * Replace-all as one undoable step. Word-for-word only (the flagship case is
 * a misheard proper noun): each matched word takes the corresponding
 * replacement token and keeps its own trailing punctuation — "Dusik," fixed
 * with "Dusek" ships as "Dusek,". Returns how many matches were rewritten,
 * or -1 when the token counts differ and nothing was touched.
 */
export function replaceAll(id: string, matches: SearchMatch[], replacement: string): number {
  const t = useStore.getState().transcripts[id];
  if (!t || !matches.length) return 0;
  const span = matches[0].wj - matches[0].wi;
  const R = replacement.split(/\s+/).filter(Boolean);
  if (R.length !== span) return -1;
  const edits: { i: number; t: string }[] = [];
  for (const m of matches) {
    for (let k = 0; k < span; k++) {
      const w = t.words[m.wi + k];
      if (!w) continue;
      const tail = /[^\p{L}\p{N}']*$/u.exec(w.t)?.[0] ?? '';
      edits.push({ i: w.i, t: R[k] + tail });
    }
  }
  applyWordEdits(id, edits);
  return matches.length;
}
