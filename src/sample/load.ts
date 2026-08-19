/**
 * Seeds the bundled sample into the store on first run (DESIGN §4, §6 moment 1).
 * First run lands INSIDE the sample — the product's first act is to do the
 * thing, not to explain itself.
 *
 * Idempotent: re-seeding an existing sample would wipe the user's ✓ marks and
 * their own quotes, so it only ever writes when the id is absent (or when the
 * bundle's `v` moved, which only happens on a deploy that changed the sample).
 */
import bundle from './sample.json';
import { SAMPLE_ID, isSampleBundle, type SampleBundle } from './schema';
import { useStore } from '../store';
import { now } from '../lib/ids';

export function sampleBundle(): SampleBundle | null {
  return isSampleBundle(bundle) ? bundle : null;
}

/** Returns the sample's interview id if it is present in the store afterwards. */
export function ensureSample(): string | null {
  const b = sampleBundle();
  if (!b) return null;

  const store = useStore.getState();
  const existing = store.interviews[SAMPLE_ID];
  if (existing) return SAMPLE_ID;
  if (store.ui.sampleDismissed) return null;

  store.upsertInterview({ ...b.interview, createdAt: b.interview.createdAt ?? now() });
  store.setTranscript(SAMPLE_ID, b.transcript);
  store.setNotes(SAMPLE_ID, b.notes);
  return SAMPLE_ID;
}
