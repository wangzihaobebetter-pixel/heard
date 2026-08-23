/**
 * Seeds the bundled sample into the store (DESIGN §4, §6 moment 1).
 * First run lands INSIDE the sample — the product's first act is to do the
 * thing, not to explain itself.
 *
 * Amendment A4 (REVIEW-2026-08-23 §3). The old version of this file promised a
 * re-seed "when the bundle's `v` moved" and never compared versions: it
 * returned early whenever the sample id existed. Any browser that had seeded
 * the stub would have kept the stub forever, through every future deploy. It
 * now honours the version, and the re-seed is careful about exactly one thing:
 *
 *   the model's notes are OURS to replace; the user's notes are not.
 *
 * So `point` and `quote` notes are replaced wholesale along with the interview
 * and transcript, while `yours` notes are preserved and re-attached. Their
 * anchors are re-derived against the new transcript where the quote still
 * matches, because a new cut of the audio moves every timestamp; where it no
 * longer matches, the note survives as `unpinned` (the `≈` chip) rather than
 * pointing confidently at the wrong second.
 *
 * The stale audio blob is dropped so the A3 path re-fetches the new mp3.
 *
 * WP4 owns this file.
 */
import bundle from './sample.json';
import { SAMPLE_ID, isSampleBundle, type SampleBundle } from './schema';
import { useStore } from '../store';
import { removeAudio } from '../lib/storage';
import { alignQuote } from '../audio/align';
import { now } from '../lib/ids';
import type { Note, PersistedState } from '../types';

export function sampleBundle(): SampleBundle | null {
  return isSampleBundle(bundle) ? bundle : null;
}

/**
 * `ui.sampleV` is additive persisted state (A4). It is read and written through
 * these two helpers because the field belongs in `PersistedState['ui']` in
 * `src/types.ts` — a WP0-owned file that only the integrator may edit (A6).
 * Until that one-line addition lands, the cast keeps this behaviour real
 * without a package reaching into another package's contract. Zustand's `merge`
 * spreads persisted `ui` verbatim, so the field round-trips today.
 */
type UiWithSampleV = PersistedState['ui'] & { sampleV?: number };

function readSampleV(ui: PersistedState['ui']): number {
  return (ui as UiWithSampleV).sampleV ?? 0;
}
function writeSampleV(v: number): void {
  useStore.getState().setUi({ sampleV: v } as unknown as Partial<PersistedState['ui']>);
}

/**
 * Re-anchor a user's note against a new transcript. Their `text` is theirs and
 * is never touched; only where it points can change.
 */
function reanchor(note: Note, b: SampleBundle): Note {
  const quote = note.quote ?? note.text;
  const { anchor } = alignQuote(quote, b.transcript.words, { segments: b.transcript.segments });
  // "Pin here" is a human decision; a re-seed must not overrule it, but the
  // seconds it named belong to audio that no longer exists, so it degrades
  // honestly rather than silently pointing somewhere new.
  if (note.anchor.pinnedByUser) {
    return { ...note, anchor: { ...note.anchor, quality: 'unpinned' }, updatedAt: now() };
  }
  return { ...note, anchor, updatedAt: now() };
}

/**
 * Returns the sample's interview id if it is present in the store afterwards.
 * Safe to call on every boot.
 */
export function ensureSample(): string | null {
  const b = sampleBundle();
  if (!b) return null;

  const store = useStore.getState();
  const existing = store.interviews[SAMPLE_ID];
  const seededV = readSampleV(store.ui);

  if (existing) {
    if (b.v <= seededV) return SAMPLE_ID;          // up to date, leave everything alone

    // The bundle moved. Replace what we authored; keep what the user wrote.
    const yours = (store.notes[SAMPLE_ID] ?? []).filter((n) => n.kind === 'yours');
    store.upsertInterview({ ...b.interview, createdAt: existing.createdAt });
    store.setTranscript(SAMPLE_ID, b.transcript);
    store.setNotes(SAMPLE_ID, [
      ...b.notes,
      ...yours.map((n) => reanchor(n, b)),
    ].sort((x, y) => x.anchor.s - y.anchor.s));
    writeSampleV(b.v);
    // The old excerpt is not the new excerpt; drop it so A3 re-fetches.
    void removeAudio(SAMPLE_ID);
    return SAMPLE_ID;
  }

  // Never seeded. "Not now" on the first-run card is a decision we honour.
  if (store.ui.sampleDismissed) return null;

  store.upsertInterview({ ...b.interview, createdAt: b.interview.createdAt ?? now() });
  store.setTranscript(SAMPLE_ID, b.transcript);
  store.setNotes(SAMPLE_ID, b.notes);
  writeSampleV(b.v);
  return SAMPLE_ID;
}
