/**
 * The shape of `sample.json` (DESIGN §4.6, §9 WP0/WP4).
 *
 * WP4 replaces the stub with the real Kranz excerpt. The schema is frozen here
 * so WP2 can build the Interview screen against the stub tonight and the real
 * sample drops in without a UI change.
 *
 * `loadSample()` is the only door into the store for sample data, so the
 * invariants (id, sample flag, kept:false until the mp3 is fetched) live in
 * one place.
 */
import type { Interview, Note, Transcript } from '../types';

export const SAMPLE_ID = 'sample';
/** Lazily fetched on first play, never precached — it is ~4 MB (DESIGN §4.6). */
export const SAMPLE_AUDIO_URL = 'sample.mp3';

export interface SampleBundle {
  /** bump when the sample content changes so a cached copy is replaced */
  v: number;
  interview: Omit<Interview, 'createdAt'> & { createdAt?: number };
  transcript: Transcript;
  notes: Note[];
  /** shown on the Library card and in About; NASA must be acknowledged */
  credit: string;
}

export function isSampleBundle(x: unknown): x is SampleBundle {
  if (!x || typeof x !== 'object') return false;
  const b = x as Partial<SampleBundle>;
  return (
    typeof b.v === 'number' &&
    !!b.interview && typeof b.interview.id === 'string' &&
    !!b.transcript && Array.isArray(b.transcript.words) && Array.isArray(b.transcript.segments) &&
    Array.isArray(b.notes) &&
    typeof b.credit === 'string'
  );
}
