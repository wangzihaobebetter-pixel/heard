/**
 * Seeds the v3 starter library into the store (PRODUCT-SPEC §4.7: the user's
 * first act is using the product on real content, not staring at an empty
 * screen).
 *
 * The shape mirrors the sample's A4 discipline exactly, because the failure
 * modes are the same:
 *
 *  - `ui.starterV` records which manifest version was seeded; a bump replaces
 *    what we authored (interview, transcript, point/quote notes, artifacts)
 *    and preserves what the user wrote (`yours` notes, re-anchored honestly).
 *  - Bundles are fetched lazily from `starter/<id>.json` — they are not
 *    compiled into the JS. A fetch that fails (offline first run) seeds
 *    nothing and does NOT mark the version done, so the next boot retries;
 *    the NASA sample remains the bundled offline fallback.
 *  - Audio takes the A3 door (src/audio/player.ts): fetched on first play,
 *    then IndexedDB.
 *
 * Precomputed AI artifacts stay OUT of the persisted store: the store is
 * JSON-serialised wholesale on every write, and artifacts are read-only
 * display data. `fetchStarterBundle` keeps them one cheap, SW-cached fetch
 * away for the AI panel (B5).
 */
import manifestJson from './manifest.json';
import {
  isStarterBundle,
  type StarterBundle,
  type StarterManifest,
  type StarterManifestEntry,
} from './schema';
import { useStore } from '../store';
import { removeAudio } from '../lib/storage';
import { seedPeaks } from '../audio/peaks';
import { alignQuote } from '../audio/align';
import { now } from '../lib/ids';
import type { Interview, Note, PersistedState } from '../types';

const manifest = manifestJson as StarterManifest;

export function starterManifest(): StarterManifest {
  return manifest;
}

export function starterMeta(id: string): StarterManifestEntry | null {
  return manifest.entries.find((e) => e.id === id) ?? null;
}

/** Relative URL of an entry's audio, or null if the id is not a starter's. */
export function starterAudioUrl(id: string): string | null {
  return starterMeta(id) ? `${manifest.base}${id}.mp3` : null;
}

/* ------------------------------------------------------------- bundle fetch */

const bundles = new Map<string, Promise<StarterBundle | null>>();

/** The full per-entry bundle (transcript, artifacts, notes, peaks). Cached. */
export function fetchStarterBundle(id: string): Promise<StarterBundle | null> {
  if (!starterMeta(id)) return Promise.resolve(null);
  const running = bundles.get(id);
  if (running) return running;
  const job = (async () => {
    try {
      const res = await fetch(new URL(`${manifest.base}${id}.json`, document.baseURI).href);
      if (!res.ok) return null;
      const data: unknown = await res.json();
      return isStarterBundle(data) ? data : null;
    } catch {
      return null;
    }
  })();
  bundles.set(id, job);
  // A failed fetch must not be pinned for the session — the next call retries.
  void job.then((b) => { if (!b) bundles.delete(id); });
  return job;
}

/* ---------------------------------------------------------------- seeding */

/** `ui.starterV` is additive persisted state, same pattern as `sampleV`. */
type UiWithStarterV = PersistedState['ui'] & { starterV?: number };

function readStarterV(ui: PersistedState['ui']): number {
  return (ui as UiWithStarterV).starterV ?? 0;
}
function writeStarterV(v: number): void {
  useStore.getState().setUi({ starterV: v } as unknown as Partial<PersistedState['ui']>);
}

/** A user's note survives a re-seed; where it points is re-derived (A4). */
function reanchor(note: Note, b: StarterBundle): Note {
  if (note.anchor.pinnedByUser) {
    return { ...note, anchor: { ...note.anchor, quality: 'unpinned' }, updatedAt: now() };
  }
  const quote = note.quote ?? note.text;
  const { anchor } = alignQuote(quote, b.transcript.words, { segments: b.transcript.segments });
  return { ...note, anchor, updatedAt: now() };
}

function seedEntry(b: StarterBundle): void {
  const store = useStore.getState();
  const existing = store.interviews[b.meta.id];
  const interview: Interview = {
    id: b.meta.id,
    title: b.meta.title,
    createdAt: existing?.createdAt ?? now(),
    recordedAt: b.meta.recordedAt,
    durationSec: b.audio.durationSec,
    file: { name: b.audio.file, size: b.audio.size, type: 'audio/mpeg', kept: false },
    lang: b.meta.lang,
    status: 'ready',
    starter: true,
  };
  const yours = existing
    ? (store.notes[b.meta.id] ?? []).filter((n) => n.kind === 'yours').map((n) => reanchor(n, b))
    : [];
  store.upsertInterview(interview);
  store.setTranscript(b.meta.id, b.transcript);
  store.setNotes(b.meta.id, [...b.notes, ...yours].sort((x, y) => x.anchor.s - y.anchor.s));
  void seedPeaks(b.meta.id, b.peaks);
  // A replaced entry's audio belongs to the old cut; drop it so A3 re-fetches.
  if (existing) void removeAudio(b.meta.id);
}

/**
 * Ensures every starter entry is present and current. Resolves to the id the
 * first run should land in (the flagship demo — manifest order is curated),
 * or null when nothing could be seeded (offline first run).
 * Safe to call on every boot: up to date means zero fetches.
 */
export async function ensureStarterLibrary(): Promise<string | null> {
  if (manifest.entries.length === 0) return null;
  const firstId = manifest.entries[0].id;
  const store = useStore.getState();
  if (manifest.v <= readStarterV(store.ui)) return firstId;

  const results = await Promise.all(manifest.entries.map(async (e) => {
    const b = await fetchStarterBundle(e.id);
    if (!b) return false;
    seedEntry(b);
    return true;
  }));

  const seeded = results.filter(Boolean).length;
  // Partial seeds stay unversioned so the next boot completes the set —
  // seedEntry is idempotent, nothing is double-created.
  if (seeded === manifest.entries.length) writeStarterV(manifest.v);
  return results[0] ? firstId : null;
}
