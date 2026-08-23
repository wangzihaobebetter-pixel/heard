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
import { getAudio } from '../lib/storage';
import { STT_PRESETS } from '../store/presets';
import { decodeBlob, planIntake, EngineError } from './decode';
import { chunkAudio } from './chunk';
import { transcribeChunks, transcribeDirect, type SttConfig } from './transcribe';

const inflight = new Map<string, Promise<void>>();

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

/** Does this interview need the pipeline at all? */
function needsIntake(interviewId: string): boolean {
  const s = useStore.getState();
  const iv = s.interviews[interviewId];
  if (!iv || iv.sample || iv.starter) return false;
  return iv.status === 'listening' || iv.status === 'waiting';
}

export function maybeRunIntake(interviewId: string): void {
  if (!needsIntake(interviewId) || inflight.has(interviewId)) return;
  const job = run(interviewId).finally(() => inflight.delete(interviewId));
  inflight.set(interviewId, job);
}

async function run(interviewId: string): Promise<void> {
  const store = useStore.getState();
  const iv = store.interviews[interviewId];
  if (!iv) return;

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
      return;
    }

    const transcript = plan.kind === 'direct'
      ? await transcribeDirect(blob, iv.file.name, cfg, hooks)
      : await transcribeChunks(chunkAudio(await decodeBlob(blob)), cfg, hooks);

    const s = useStore.getState();
    s.setTranscript(interviewId, transcript);
    const anyFailed = transcript.chunks.some((c) => c.state === 'failed');
    s.updateInterview(interviewId, {
      status: transcript.words.length === 0 ? 'failed' : anyFailed ? 'partial' : 'ready',
      // The provider heard the whole tape; trust its clock over a probe that
      // returned 0/Infinity (Chrome's un-remuxed WebM does exactly that).
      ...(transcript.durationSec > 0 ? { durationSec: transcript.durationSec } : {}),
    });
  } catch (err) {
    const code = err instanceof EngineError ? err.code : null;
    // Decode failures are properties of the file; everything else (refused
    // key, offline, provider hiccup) is a circumstance — park at `waiting`
    // with the tape intact and let the next visit retry.
    const terminal = code === 'decodeFailed' || code === 'unsupported';
    useStore.getState().updateInterview(interviewId, { status: terminal ? 'failed' : 'waiting' });
  }
}
