/**
 * The starter library contract (v3, PRODUCT-SPEC §5, R1).
 *
 * v2 shipped one bundled sample; v3 ships a library of real recordings. The
 * split is deliberate:
 *
 *  - `src/content/manifest.json` is BUNDLED — one small entry per recording
 *    (title, credit, mini peaks) so Home/Library can render every card with
 *    zero fetches.
 *  - `public/starter/<id>.json` is FETCHED lazily — the full transcript, the
 *    curated notes and the precomputed AI artifacts. Seeded into the store the
 *    first time the library is ensured.
 *  - `public/starter/<id>.mp3` is FETCHED on first play, exactly like the v2
 *    sample (amendment A3: same door as every user recording).
 *
 * Both JSON files are emitted by `scripts/build-content.mjs`; nothing in them
 * is hand-maintained. Every quote in `artifacts` and `notes` was aligned to
 * the word timeline by the reference aligner and corroborated against the
 * publisher's own transcript at build time — the per-quote evidence ships in
 * `content-verification.md`, not here.
 */
import type { Note, Transcript } from '../types';

/* --------------------------------------------------------------- citations */

/**
 * Where an AI claim touches the tape. `quote` is rebuilt from the word span
 * the anchor points at (never the author's copy); `corrob` is the Layer-2
 * similarity against the publisher's transcript, kept as shipping evidence.
 */
export interface Citation {
  quote: string;
  wi: number;
  wj: number;
  s: number;
  e: number;
  corrob: number;
}

/* --------------------------------------------------------------- artifacts */

/** Precomputed AI layer for one starter entry (spec §4.4, no-key state). */
export interface StarterArtifacts {
  /** 2–4 short paragraphs; every load-bearing claim cited */
  summary: { text: string; citations: Citation[] };
  /** timestamped outline; every entry is a seek link */
  chapters: { title: string; at: Citation }[];
  /** key terms with definitions, each cited */
  concepts: { term: string; definition: string; cite: Citation }[];
  /** lecture-native "exam flags": deadlines, emphasis, assignments */
  flags: { text: string; cite: Citation }[];
}

/* ----------------------------------------------------------------- bundles */

export type StarterCategory = 'speech' | 'science' | 'oral-history' | 'lecture';
export type StarterLicense = 'public-domain' | 'cc-by-nc-sa-3.0';

export interface StarterEntryMeta {
  id: string;
  title: string;
  speaker: string;
  occasion: string;
  /** epoch ms of the original recording date (coarse where only a month is known) */
  recordedAt: number;
  category: StarterCategory;
  lang: string;
  license: StarterLicense;
  /** false for CC BY-NC-SA items (Yale) — Heard must stay free while bundled */
  commercialUse: boolean;
  /** one-line hook for the Home/Library card */
  blurb: string;
  /** attribution line (About sheet, exports) — see content-sources.md */
  credit: string;
  /** shown above the transcript for material that needs framing (LOC items) */
  contextNote?: string;
}

/** The full per-entry file at `starter/<id>.json`. */
export interface StarterBundle {
  v: number;
  meta: StarterEntryMeta;
  audio: { file: string; size: number; sha256: string; durationSec: number };
  transcript: Transcript;
  artifacts: StarterArtifacts;
  /** curated example notes demonstrating the primitive (2–3 per entry) */
  notes: Note[];
  /** 180 RMS buckets, normalised 0..1 — seeds the peaks cache pre-decode */
  peaks: number[];
}

/** One row of the bundled manifest. */
export interface StarterManifestEntry {
  id: string;
  title: string;
  speaker: string;
  category: StarterCategory;
  durationSec: number;
  recordedAt: number;
  wordCount: number;
  noteCount: number;
  license: StarterLicense;
  commercialUse: boolean;
  blurb: string;
  credit: string;
  /** bytes of starter/<id>.mp3, for the storage meter and Library rows */
  audioSize: number;
  /** coarse peaks for the Library mini waveform (bundled, pre-fetch) */
  peaks: number[];
}

export interface StarterManifest {
  /** bump when any bundle changes so seeded copies are replaced (A4 pattern) */
  v: number;
  base: string;
  entries: StarterManifestEntry[];
}

/* -------------------------------------------------------------- validation */

export function isStarterBundle(x: unknown): x is StarterBundle {
  if (!x || typeof x !== 'object') return false;
  const b = x as Partial<StarterBundle>;
  return (
    typeof b.v === 'number' &&
    !!b.meta && typeof b.meta.id === 'string' && typeof b.meta.credit === 'string' &&
    !!b.audio && typeof b.audio.file === 'string' && typeof b.audio.durationSec === 'number' &&
    !!b.transcript && Array.isArray(b.transcript.words) && Array.isArray(b.transcript.segments) &&
    !!b.artifacts && !!b.artifacts.summary && Array.isArray(b.artifacts.chapters) &&
    Array.isArray(b.artifacts.concepts) && Array.isArray(b.artifacts.flags) &&
    Array.isArray(b.notes) &&
    Array.isArray(b.peaks)
  );
}
