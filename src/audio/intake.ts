/**
 * The intake driver (v3 B2) — the missing link between "an interview exists
 * with status `listening`" and WP1's transcription machinery actually running.
 *
 * v2 shipped the whole pipeline (decode → chunk → transcribe → merge) and the
 * intake UI, but nothing in the app ever CALLED the pipeline: a brought file
 * sat at "Listening…" forever. This module is that caller, for both doors —
 * Bring's imports and the recorder's captures.
 *
 * Contract:
 *  - `maybeRunIntake(id)` is safe to call from anywhere, any number of times
 *    (screen mounts, recorder stop, key saved). It is single-flight per
 *    interview and a no-op unless the interview actually needs transcribing.
 *  - `waiting` is the honest no-key state (§4.1 record-now-transcribe-after):
 *    the tape is safe, nothing is in flight, and connecting a provider is the
 *    next step. A refused key or a network failure RETURNS the interview to
 *    `waiting` — those are retryable circumstances, not properties of the
 *    recording. `failed` is reserved for audio nothing can be done with.
 *  - Progress is published through the store on every chunk, so the §4.2
 *    listening state ("Heard 41 of 92 min") is real data, not an animation.
 */
import { useStore } from '../store';
import { getAudio, removeTransientAudio } from '../lib/storage';
import { STT_PRESETS } from '../store/presets';
import { decodeBlob, planIntake, EngineError } from './decode';
import { chunkAudio } from './chunk';
import { transcribeChunks, transcribeDirect, type SttConfig } from './transcribe';
import { generateNotes } from '../notes/generate';
import type { Interview } from '../types';

const inflight = new Map<string, Promise<void>>();
const notesInflight = new Map<string, Promise<boolean>>();

async function runNotes(interviewId: string): Promise<boolean> {
  const state = useStore.getState();
  const interview = state.interviews[interviewId];
  const transcript = state.transcripts[interviewId];
  const llm = state.settings.llm;
  if (!interview || !transcript?.words.length || !llm.key.trim()) return false;

  state.updateInterview(interviewId, { status: 'reading' });
  try {
    const generated = await generateNotes(
      transcript,
      { baseUrl: llm.baseUrl, key: llm.key, model: llm.model },
      {},
      { title: interview.title },
    );
    if (!generated.length) return false;
    // Marks and live notes are the user's work. A model refresh may replace
    // model output, but it must never erase those notes.
    const yours = (useStore.getState().notes[interviewId] ?? [])
      .filter((note) => note.kind === 'yours');
    useStore.getState().setNotes(
      interviewId,
      [...generated, ...yours].sort((a, b) => a.anchor.s - b.anchor.s),
    );
    return true;
  } catch {
    return false;
  } finally {
    if (useStore.getState().interviews[interviewId]) {
      useStore.getState().updateInterview(interviewId, { status: 'ready' });
    }
  }
}

/** One globally single-flight notes job, shared by automatic intake and Retry. */
export function generateInterviewNotes(interviewId: string): Promise<boolean> {
  const current = notesInflight.get(interviewId);
  if (current) return current;
  const job = runNotes(interviewId).finally(() => notesInflight.delete(interviewId));
  notesInflight.set(interviewId, job);
  return job;
}

function sttConfig(lang: 'auto' | string): SttConfig | null {
  const { stt } = useStore.getState().settings;
  if (!stt.key.trim()) return null;
  const preset = STT_PRESETS.find((p) => p.id === stt.preset);
  // The vocabulary is line-per-term in Settings; providers take a sentence.
  const vocabulary = (stt.vocabulary ?? '').split('\n').map((s) => s.trim()).filter(Boolean).join(', ');
  return {
    baseUrl: stt.baseUrl, key: stt.key, model: stt.model, lang,
    provider: preset?.label,
    ...(vocabulary ? { prompt: vocabulary } : {}),
  };
}

export type IntakeRunMode = 'auto' | 'explicit';

/** Auto-resume safe states; only a partial transcript admits deliberate Retry. */
export function shouldRunIntake(status: Interview['status'], mode: IntakeRunMode): boolean {
  if (status === 'listening' || status === 'waiting') return true;
  return mode === 'explicit' && status === 'partial';
}

function needsIntake(interviewId: string, mode: IntakeRunMode): boolean {
  const s = useStore.getState();
  const iv = s.interviews[interviewId];
  if (!iv || iv.sample || iv.starter) return false;
  return shouldRunIntake(iv.status, mode);
}

function startIntake(interviewId: string, mode: IntakeRunMode): void {
  if (!needsIntake(interviewId, mode) || inflight.has(interviewId)) return;
  const job = run(interviewId, mode).finally(() => inflight.delete(interviewId));
  inflight.set(interviewId, job);
}

export function maybeRunIntake(interviewId: string): void {
  startIntake(interviewId, 'auto');
}

export function retryIntake(interviewId: string): void {
  startIntake(interviewId, 'explicit');
}

async function run(interviewId: string, mode: IntakeRunMode): Promise<void> {
  const store = useStore.getState();
  const iv = store.interviews[interviewId];
  if (!iv || iv.sample || iv.starter || !shouldRunIntake(iv.status, mode)) return;

  const cfg = sttConfig(iv.lang);
  if (!cfg) {
    if (iv.status !== 'waiting') store.updateInterview(interviewId, { status: 'waiting' });
    return;
  }

  const blob = await getAudio(interviewId);
  if (!blob) {
    // No audio on this device — a transcript can never be made from nothing.
    store.updateInterview(interviewId, { status: 'failed' });
    return;
  }

  if (iv.status !== 'listening') store.updateInterview(interviewId, { status: 'listening' });

  const hooks = {
    previous: store.transcripts[interviewId],
    onProgress: (t: Parameters<typeof store.setTranscript>[1]) => {
      useStore.getState().setTranscript(interviewId, t);
    },
  };

  try {
    let plan;
    try {
      plan = planIntake(blob.size, iv.durationSec);
    } catch {
      // Over the engine's hard ceilings — Bring refuses these up front, so
      // only a recording could land here, and it cannot be transcribed.
      store.updateInterview(interviewId, { status: 'failed' });
      removeTransientAudio(interviewId);
      return;
    }

    const transcript = plan.kind === 'direct'
      ? await transcribeDirect(blob, iv.file.name, cfg, hooks)
      : await transcribeChunks(chunkAudio(await decodeBlob(blob)), cfg, hooks);

    const s = useStore.getState();
    s.setTranscript(interviewId, transcript);
    const anyFailed = transcript.chunks.some((c) => c.state === 'failed');
    const status = transcript.words.length === 0 ? 'failed' : anyFailed ? 'partial' : 'ready';
    s.updateInterview(interviewId, {
      status,
      // The provider heard the whole tape; trust its clock over a probe that
      // returned 0/Infinity (Chrome's un-remuxed WebM does exactly that).
      ...(transcript.durationSec > 0 ? { durationSec: transcript.durationSec } : {}),
    });
    if (status !== 'partial') removeTransientAudio(interviewId);

    if (status === 'ready' && s.settings.llm.key.trim()) {
      await generateInterviewNotes(interviewId);
    }
  } catch (err) {
    const code = err instanceof EngineError ? err.code : null;
    // Decode failures are properties of the file; everything else (refused
    // key, offline, provider hiccup) is a circumstance — park at `waiting`
    // with the tape intact and let the next visit retry.
    const terminal = code === 'decodeFailed' || code === 'unsupported';
    useStore.getState().updateInterview(interviewId, { status: terminal ? 'failed' : 'waiting' });
    if (terminal) removeTransientAudio(interviewId);
  }
}
