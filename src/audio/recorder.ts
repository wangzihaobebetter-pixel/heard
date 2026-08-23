/**
 * Capture controller (v3 B2, PRODUCT-SPEC §4.1).
 *
 * One recorder, one microphone, for the life of the app — the same singleton
 * discipline as the player. The design centre is crash-safety:
 *
 *   MediaRecorder timeslice (4 s) → every slice lands in IndexedDB the moment
 *   it exists, alongside a meta record (elapsed, marks, live notes) that is
 *   rewritten with every slice. A tab kill, browser crash or dead battery
 *   loses at most the last slice; `listRecoverable()` finds the rest on the
 *   next boot and the Library offers a "We saved your recording up to X" card.
 *   Apple visibly loses recordings on interruption; we must not (§4.1).
 *
 * The recorder never re-encodes: the container the browser produced is the
 * recording. Duration comes from the recorder's own clock, not from probing
 * the blob — Chrome's WebM output reports Infinity until it is remuxed.
 *
 * Marks and live notes are captured here as plain seconds against that clock
 * and become `yours` notes on stop, anchored `unpinned` + `pinnedByUser`: a
 * human chose that second, no text alignment ever happened, and the chip
 * renders with the honest ≈. B3's marks-review flow resolves them to words
 * once a transcript exists.
 */
import { create } from 'zustand';
import { del, get, keys, set } from 'idb-keyval';
import { useStore } from '../store';
import { putAudio } from '../lib/storage';
import { id, now } from '../lib/ids';
import { maybeRunIntake } from './intake';
import type { Note } from '../types';

/* ------------------------------------------------------------------ state */

export type RecorderPhase = 'idle' | 'recording' | 'paused' | 'stopping';
export type RecorderDenial = 'denied' | 'unavailable';

export interface RecorderState {
  phase: RecorderPhase;
  elapsedSec: number;
  /** rolling RMS frames (10/s), newest last — the live waveform's data */
  levels: number[];
  markCount: number;
  noteCount: number;
  /** true after SILENCE_WARN_SEC of dead input while recording (§4.1) */
  silent: boolean;
}

interface RecorderActions { patch: (p: Partial<RecorderState>) => void; reset: () => void }

const EMPTY: RecorderState = {
  phase: 'idle', elapsedSec: 0, levels: [], markCount: 0, noteCount: 0, silent: false,
};

export const useRecorder = create<RecorderState & RecorderActions>()((setState) => ({
  ...EMPTY,
  patch: (p) => setState(p),
  reset: () => setState({ ...EMPTY, levels: [] }),
}));

/* ------------------------------------------------------------ persistence */

const metaKey = (sid: string) => `rec:${sid}:meta`;
const chunkKey = (sid: string, n: number) => `rec:${sid}:c:${String(n).padStart(5, '0')}`;

interface RecMeta {
  sid: string;
  startedAt: number;
  updatedAt: number;
  elapsedSec: number;
  mime: string;
  chunkCount: number;
  marks: number[];
  liveNotes: { text: string; atSec: number }[];
}

export const LEVELS_KEPT = 96;
export const SILENCE_WARN_SEC = 20;
const TIMESLICE_MS = 4000;
const SILENCE_RMS = 0.004;

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

const extOf = (mime: string) => (mime.includes('mp4') ? 'm4a' : 'webm');

function defaultTitle(startedAt: number): string {
  const d = new Date(startedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Mark / live-note → a `yours` note the rest of the app already understands. */
function noteAt(interviewId: string, seq: number, text: string, atSec: number, durationSec: number, createdAt: number): Note {
  const s = Math.max(0, Math.min(atSec, durationSec));
  return {
    id: `${interviewId}_r${seq}`,
    kind: 'yours',
    text,
    anchor: { s, e: Math.min(durationSec, s + 1), quality: 'unpinned', pinnedByUser: true },
    heard: false,
    createdAt, updatedAt: createdAt,
  };
}

/* -------------------------------------------------------------- controller */

class Recorder {
  private stream: MediaStream | null = null;
  private mr: MediaRecorder | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: number | undefined;
  private wakeLock: { release(): Promise<void> } | null = null;

  private sid = '';
  private mime = '';
  private startedAt = 0;
  private chunkN = 0;
  private parts: Blob[] = [];
  private pendingWrites: Promise<unknown>[] = [];
  private marks: number[] = [];
  private liveNotes: { text: string; atSec: number }[] = [];
  /** seconds accumulated across previous run segments (pause slices the clock) */
  private elapsedBase = 0;
  private runStartedAt: number | null = null;
  private silentRunSec = 0;

  elapsed(): number {
    return this.elapsedBase + (this.runStartedAt ? (Date.now() - this.runStartedAt) / 1000 : 0);
  }

  /** The live session's id — recovery must not offer the tape being made. */
  sessionId(): string {
    return this.sid;
  }

  async start(): Promise<'ok' | RecorderDenial> {
    if (useRecorder.getState().phase !== 'idle') return 'ok';
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return 'unavailable';

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as DOMException)?.name;
      return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable';
    }

    this.stream = stream;
    this.mime = pickMime();
    this.sid = id('rec');
    this.startedAt = now();
    this.chunkN = 0;
    this.parts = [];
    this.pendingWrites = [];
    this.marks = [];
    this.liveNotes = [];
    this.elapsedBase = 0;
    this.runStartedAt = Date.now();
    this.silentRunSec = 0;

    const mr = new MediaRecorder(stream, this.mime ? { mimeType: this.mime } : undefined);
    this.mr = mr;
    if (!this.mime) this.mime = mr.mimeType || 'audio/webm';
    mr.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      this.parts.push(e.data);
      const n = this.chunkN++;
      // Both writes are fire-and-forget but TRACKED, so stop() can await the
      // tail instead of assembling a recording whose last slice is in flight.
      this.pendingWrites.push(
        set(chunkKey(this.sid, n), e.data).catch(() => undefined),
        this.saveMeta().catch(() => undefined),
      );
    };
    mr.start(TIMESLICE_MS);

    this.startMeter(stream);
    void this.acquireWakeLock();
    document.addEventListener('visibilitychange', this.onVisibility);

    useRecorder.getState().patch({ phase: 'recording', elapsedSec: 0, markCount: 0, noteCount: 0, silent: false, levels: [] });
    this.levelTimer = window.setInterval(() => this.tick(), 100);
    return 'ok';
  }

  pause(): void {
    if (this.mr?.state !== 'recording') return;
    this.mr.pause();
    this.elapsedBase = this.elapsed();
    this.runStartedAt = null;
    useRecorder.getState().patch({ phase: 'paused' });
  }

  resume(): void {
    if (this.mr?.state !== 'paused') return;
    this.mr.resume();
    this.runStartedAt = Date.now();
    useRecorder.getState().patch({ phase: 'recording' });
  }

  /** One tap pins the current second; the student keeps listening (§4.1). */
  mark(): void {
    if (useRecorder.getState().phase === 'idle') return;
    this.marks.push(+this.elapsed().toFixed(2));
    useRecorder.getState().patch({ markCount: this.marks.length });
    this.pendingWrites.push(this.saveMeta().catch(() => undefined));
  }

  /** `atSec` is when typing BEGAN — the moment the thought occurred, not send. */
  addLiveNote(text: string, atSec: number): void {
    const clean = text.trim();
    if (!clean || useRecorder.getState().phase === 'idle') return;
    this.liveNotes.push({ text: clean, atSec: +Math.max(0, atSec).toFixed(2) });
    useRecorder.getState().patch({ noteCount: this.liveNotes.length });
    this.pendingWrites.push(this.saveMeta().catch(() => undefined));
  }

  /** Stop, persist, hand off. Returns the new interview's id. */
  async stop(): Promise<string | null> {
    const mr = this.mr;
    if (!mr || useRecorder.getState().phase === 'stopping') return null;
    useRecorder.getState().patch({ phase: 'stopping' });
    const durationSec = +this.elapsed().toFixed(2);

    await new Promise<void>((resolve) => {
      mr.onstop = () => resolve();
      try { mr.stop(); } catch { resolve(); }
    });
    await Promise.all(this.pendingWrites);

    const sid = this.sid;
    const blob = new Blob(this.parts, { type: this.mime });
    const interviewId = await finishRecording({
      blob,
      mime: this.mime,
      startedAt: this.startedAt,
      durationSec,
      marks: this.marks,
      liveNotes: this.liveNotes,
    });
    await clearSession(sid);
    this.teardown();
    return interviewId;
  }

  /** Throw the tape away. Asks nothing — the screen owns the confirm. */
  async discard(): Promise<void> {
    const mr = this.mr;
    if (mr && mr.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        mr.onstop = () => resolve();
        try { mr.stop(); } catch { resolve(); }
      });
    }
    await Promise.all(this.pendingWrites);
    await clearSession(this.sid);
    this.teardown();
  }

  /* ----------------------------------------------------------- internals */

  private async saveMeta(): Promise<void> {
    const meta: RecMeta = {
      sid: this.sid,
      startedAt: this.startedAt,
      updatedAt: now(),
      elapsedSec: +this.elapsed().toFixed(2),
      mime: this.mime,
      chunkCount: this.chunkN,
      marks: this.marks,
      liveNotes: this.liveNotes,
    };
    await set(metaKey(this.sid), meta);
  }

  private startMeter(stream: MediaStream): void {
    try {
      const Ctx: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
    } catch { /* no meter is a degraded UI, not a failed recording */ }
  }

  private tick(): void {
    const state = useRecorder.getState();
    if (state.phase === 'paused') { state.patch({ elapsedSec: this.elapsed() }); return; }

    let rms = 0;
    if (this.analyser) {
      const buf = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      rms = Math.sqrt(sum / buf.length);
    }
    // The §4.1 silence warning: the meter exists so a dead mic is discovered
    // during the lecture, not after it.
    this.silentRunSec = rms < SILENCE_RMS ? this.silentRunSec + 0.1 : 0;

    const levels = state.levels.length >= LEVELS_KEPT
      ? [...state.levels.slice(-(LEVELS_KEPT - 1)), rms]
      : [...state.levels, rms];
    state.patch({
      elapsedSec: this.elapsed(),
      levels,
      silent: this.silentRunSec >= SILENCE_WARN_SEC,
    });
  }

  private onVisibility = () => {
    // Wake locks are released by the platform when the page hides; take it
    // back the moment we are visible again and still recording.
    if (document.visibilityState === 'visible' && useRecorder.getState().phase !== 'idle') {
      void this.acquireWakeLock();
    }
  };

  private async acquireWakeLock(): Promise<void> {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl) this.wakeLock = await wl.request('screen');
    } catch { /* not granted — recording still works, the screen may sleep */ }
  }

  private teardown(): void {
    if (this.levelTimer) window.clearInterval(this.levelTimer);
    this.levelTimer = undefined;
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
    this.mr = null;
    this.parts = [];
    this.pendingWrites = [];
    useRecorder.getState().reset();
  }
}

/* ----------------------------------------------- interview creation (shared) */

interface FinishInput {
  blob: Blob;
  mime: string;
  startedAt: number;
  durationSec: number;
  marks: number[];
  liveNotes: { text: string; atSec: number }[];
}

/**
 * The one door from captured audio to a real interview — the live stop() and
 * the crash recovery both walk through it, so they cannot drift apart.
 * A recording's audio is ALWAYS kept: unlike an import, this blob is the only
 * copy in existence, and `ui.keepAudio` governs copies, not originals.
 */
async function finishRecording(input: FinishInput): Promise<string> {
  const store = useStore.getState();
  const hasKey = !!store.settings.stt.key.trim();
  const interview = store.createInterview({
    title: defaultTitle(input.startedAt),
    durationSec: input.durationSec,
    recordedAt: input.startedAt,
    lang: 'auto',
    status: hasKey ? 'listening' : 'waiting',
    file: {
      name: `recording-${new Date(input.startedAt).toISOString().slice(0, 10)}.${extOf(input.mime)}`,
      size: input.blob.size,
      type: input.mime,
      kept: true,
    },
  });
  await putAudio(interview.id, input.blob);

  const createdAt = now();
  let seq = 0;
  const notes: Note[] = [
    ...input.marks.map((at) => noteAt(interview.id, seq++, '⚑', at, input.durationSec, createdAt)),
    ...input.liveNotes.map((n) => noteAt(interview.id, seq++, n.text, n.atSec, input.durationSec, createdAt)),
  ].sort((a, b) => a.anchor.s - b.anchor.s);
  if (notes.length) store.setNotes(interview.id, notes);

  maybeRunIntake(interview.id);
  return interview.id;
}

/* ------------------------------------------------------------ crash recovery */

export interface Recoverable {
  sid: string;
  startedAt: number;
  elapsedSec: number;
  chunkCount: number;
}

async function clearSession(sid: string): Promise<void> {
  if (!sid) return;
  try {
    const all = (await keys()) as string[];
    await Promise.all(
      all.filter((k) => typeof k === 'string' && k.startsWith(`rec:${sid}:`)).map((k) => del(k)),
    );
  } catch { /* orphans are re-offered as recovery, never lost */ }
}

/** Sessions left behind by a crash — anything with meta that is not live now. */
export async function listRecoverable(): Promise<Recoverable[]> {
  try {
    const all = (await keys()) as string[];
    const metas = all.filter((k) => typeof k === 'string' && k.startsWith('rec:') && k.endsWith(':meta'));
    const out: Recoverable[] = [];
    for (const k of metas) {
      const meta = await get<RecMeta>(k);
      if (!meta || meta.sid === recorder.sessionId()) continue;
      if (meta.chunkCount === 0) { await clearSession(meta.sid); continue; }
      out.push({ sid: meta.sid, startedAt: meta.startedAt, elapsedSec: meta.elapsedSec, chunkCount: meta.chunkCount });
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

/** Rebuild the interview from the slices that made it to disk. */
export async function recoverSession(sid: string): Promise<string | null> {
  const meta = await get<RecMeta>(metaKey(sid));
  if (!meta) return null;
  const parts: Blob[] = [];
  for (let n = 0; n < meta.chunkCount; n++) {
    const part = await get<Blob>(chunkKey(sid, n));
    if (part) parts.push(part);
    else break; // a hole ends the recoverable prefix — never splice around it
  }
  if (parts.length === 0) { await clearSession(sid); return null; }
  const kept = parts.length / meta.chunkCount;
  const interviewId = await finishRecording({
    blob: new Blob(parts, { type: meta.mime }),
    mime: meta.mime,
    startedAt: meta.startedAt,
    // Honest length: the slices that survived, not the clock's last reading.
    durationSec: +(meta.elapsedSec * kept).toFixed(2),
    marks: meta.marks,
    liveNotes: meta.liveNotes,
  });
  await clearSession(sid);
  return interviewId;
}

export async function discardSession(sid: string): Promise<void> {
  await clearSession(sid);
}

/* ------------------------------------------------------------- singleton */

let instance: Recorder | null = null;
export function getRecorder(): Recorder {
  if (!instance) instance = new Recorder();
  return instance;
}

const recorder = getRecorder();
