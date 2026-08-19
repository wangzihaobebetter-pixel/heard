/**
 * Heard / 听证 — the frozen type contract.
 *
 * Authority: memory/traceable-notes/DESIGN.md §9 ("Types (normative —
 * implementers use these names)"), with §4 and §7 for the state vocabulary.
 * WP0 owns this file. WP1/WP2/WP3/WP4 import from it and never redefine a
 * shape here; if something is missing, the integrator adds it, not a package.
 *
 * Naming rule that runs through the whole file: seconds are seconds (`s`, `e`,
 * `*Sec`), never milliseconds; timestamps that are wall-clock are `*At` and are
 * epoch milliseconds. Word indices index into `Transcript.words`.
 */

/* ------------------------------------------------------------------ audio */

/** One spoken word with its own start/end. `i` is its index in `words`. */
export interface Word {
  /** index into Transcript.words — stable, dense, 0-based */
  i: number;
  /** the word as the provider transcribed it, including its own punctuation */
  t: string;
  /** start, seconds from the beginning of the whole recording */
  s: number;
  /** end, seconds */
  e: number;
}

/**
 * A provider segment (a phrase, typically 5–15 s). Carries the word range it
 * covers so a segment-only provider can still be anchored, coarsely.
 * `[wi, wj)` — half open, like every range in this codebase.
 */
export interface Segment {
  s: number;
  e: number;
  wi: number;
  wj: number;
}

/** State of one uploaded chunk of a long recording (DESIGN §4.6). */
export interface TranscriptChunk {
  i: number;
  s: number;
  e: number;
  state: 'done' | 'pending' | 'failed';
}

export interface Transcript {
  /** BCP-47-ish language the provider reported or we asked for */
  lang: string;
  words: Word[];
  segments: Segment[];
  /** how many seconds of the recording have actually been heard so far */
  heardSec: number;
  /** total length of the recording, seconds */
  durationSec: number;
  chunks: TranscriptChunk[];
}

/* ----------------------------------------------------------------- anchors */

/**
 * Where a note points on the tape.
 *
 * `quality` is the honesty channel and drives the chip's rendering (DESIGN §5):
 *   'word'     — aligned to a word span. Solid chip.
 *   'segment'  — only a segment matched; position interpolated. `≈` chip, wider pre-roll.
 *   'unpinned' — the quote could not be found. `≈` chip + "couldn't pin this to the tape".
 */
export interface Anchor {
  s: number;
  e: number;
  wi?: number;
  wj?: number;
  quality: 'word' | 'segment' | 'unpinned';
  /** set by "Pin here" — a human moved it, so nothing may move it back */
  pinnedByUser?: boolean;
}

/* ------------------------------------------------------------------- notes */

export type NoteKind = 'point' | 'quote' | 'yours';

export interface Note {
  id: string;
  kind: NoteKind;
  /** what the note says. For 'quote'/'yours' this is the verbatim line itself. */
  text: string;
  /** the verbatim span the note was pinned to (absent once unpinned/user-made) */
  quote?: string;
  anchor: Anchor;
  /** ✓ heard — set by the person, never by a model (DESIGN §3.3) */
  heard: boolean;
  createdAt: number;
  updatedAt: number;
}

/* -------------------------------------------------------------- interviews */

export interface InterviewFile {
  name: string;
  size: number;
  type: string;
  /** whether the blob is still in IndexedDB under `audio:<id>` */
  kept: boolean;
}

/**
 * status (DESIGN §4.2):
 *   'listening' — transcription in flight; transcript fills in from the top
 *   'reading'   — transcript complete, notes being written ("Reading it back…")
 *   'ready'     — done
 *   'partial'   — a chunk failed after retries; there is a gap
 *   'failed'    — nothing was heard
 */
export type InterviewStatus = 'listening' | 'reading' | 'ready' | 'partial' | 'failed';

export interface Interview {
  id: string;
  title: string;
  createdAt: number;
  recordedAt?: number;
  durationSec: number;
  file: InterviewFile;
  /** 'auto' or an ISO language code the user picked on Bring */
  lang: 'auto' | string;
  status: InterviewStatus;
  /** true for the bundled NASA sample; drives the Library tag and About credit */
  sample?: boolean;
}

/* ---------------------------------------------------------------- settings */

export type SttPreset = 'openai' | 'groq' | 'custom';
export type LlmPreset = 'openai' | 'deepseek' | 'openrouter' | 'moonshot' | 'siliconflow' | 'custom';
export type UiLang = 'en' | 'zh';
export type Theme = 'system' | 'paper' | 'ink';

export interface SttSettings {
  preset: SttPreset;
  baseUrl: string;
  key: string;
  model: string;
}

export interface LlmSettings {
  preset: LlmPreset;
  baseUrl: string;
  key: string;
  model: string;
}

export interface UiSettings {
  lang: UiLang;
  theme: Theme;
  /** "Keep the recording on this device" (DESIGN §4.3) */
  keepAudio: boolean;
  /** playback rate, persisted (1 | 1.25 | 1.5 | 2) */
  speed: number;
}

export interface Settings {
  stt: SttSettings;
  llm: LlmSettings;
  ui: UiSettings;
}

/* ------------------------------------------------------------------ player */

/**
 * Not persisted. Owned by WP1's player controller, read by WP2.
 * `mode: 'span'` means playback auto-stops at `span.e + 0.8` (DESIGN §5.5);
 * `'free'` is what "Keep listening" switches to.
 */
export interface PlayerState {
  interviewId: string | null;
  currentTime: number;
  playing: boolean;
  span?: { s: number; e: number };
  mode: 'span' | 'free';
  /** index of the word currently being spoken, or -1 */
  wordIndex: number;
}

/* ---------------------------------------------------------- persisted root */

export const STORE_VERSION = 1;

export interface PersistedState {
  v: number;
  settings: Settings;
  /** id → Interview */
  interviews: Record<string, Interview>;
  /** interviewId → Transcript */
  transcripts: Record<string, Transcript>;
  /** interviewId → the notes for it, in display order */
  notes: Record<string, Note[]>;
  /** the interview the app was last inside, so a reload lands where you were */
  currentInterviewId: string | null;
  ui: { firstRunSeen: boolean; sampleDismissed: boolean };
}
