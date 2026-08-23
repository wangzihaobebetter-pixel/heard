/**
 * Chunking and WAV encoding (DESIGN §4.6 steps 2 and 3).
 *
 * WP1 owns this file.
 *
 * The whole point of this module is one number: `startSec`. Every word that
 * comes back from a chunk is timed from the chunk's own zero, and the only
 * thing standing between that and a note pointing at the wrong minute is this
 * file's arithmetic. So `startSec` is derived from the **exact sample index**
 * (`startSample / sampleRate`) and never from "chunk index × 10 minutes" — the
 * cut points move by up to 30 s each, and after seven chunks a nominal-length
 * assumption is three and a half minutes wrong.
 *
 * Cut points, per DESIGN §4.6 step 2: nominal length 10 minutes, cut at the
 * quietest 20 ms window inside the **last 30 s** of the nominal window, no
 * overlap. Two refinements the design implies but does not spell out:
 *
 *  - We cut at the **centre** of the quietest window, not its edge, so both
 *    sides of the boundary get half the silence. Cutting at the edge reliably
 *    clips the leading consonant of the next word onto the previous chunk.
 *  - A trailing remainder shorter than `MIN_TAIL_SEC` is absorbed into the
 *    previous chunk rather than shipped as its own request. A 4-second chunk
 *    costs a whole round trip to transcribe "…thank you."
 *
 * Sizing check: 16 kHz mono PCM16 is 32 KB/s, so a 10-minute chunk is 19.2 MB
 * of PCM plus a 44-byte header — under the 25 MB per-request ceiling both
 * OpenAI and Groq document, with room for the cut point drifting late.
 */
import { CHUNK_SAMPLE_RATE, CHUNK_SEC, DIRECT_UPLOAD_MAX_BYTES } from '../store/presets';
import type { DecodedAudio } from './decode';

/** Width of the RMS probe window. 20 ms is one DESIGN §4.6 "quietest window". */
export const QUIET_WINDOW_SEC = 0.02;
/** How far back from the nominal end we are allowed to cut. */
export const QUIET_SEARCH_SEC = 30;
/** A remainder shorter than this is merged into the previous chunk. */
export const MIN_TAIL_SEC = 20;

export interface ChunkBounds {
  i: number;
  startSample: number;
  /** exclusive */
  endSample: number;
  /** exact — `startSample / sampleRate`, the number every timestamp leans on */
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface AudioChunk extends ChunkBounds {
  wav: Blob;
  bytes: number;
}

/* ------------------------------------------------------------ cut points */

/**
 * Index of the first sample of the quietest `QUIET_WINDOW_SEC` window in
 * `[from, to)`. Mean-square is enough — we compare windows against each other
 * and never report the value, so the square root would only cost time.
 *
 * Implemented as a rolling sum: the naive version is O(range × window) and this
 * is called on a 30 s range of 16 kHz audio (480 000 samples) once per chunk.
 */
export function quietestWindowStart(
  pcm: Float32Array,
  from: number,
  to: number,
  windowSamples: number,
): number {
  const lo = Math.max(0, from);
  const hi = Math.min(pcm.length, to);
  if (hi - lo <= windowSamples) return lo;

  let sum = 0;
  for (let i = lo; i < lo + windowSamples; i++) sum += pcm[i] * pcm[i];

  let best = sum;
  let bestAt = lo;
  for (let i = lo + windowSamples; i < hi; i++) {
    sum += pcm[i] * pcm[i] - pcm[i - windowSamples] * pcm[i - windowSamples];
    if (sum < best) {
      best = sum;
      bestAt = i - windowSamples + 1;
    }
  }
  return bestAt;
}

export interface PlanOptions {
  chunkSec?: number;
  searchSec?: number;
  minTailSec?: number;
}

/**
 * Boundaries only — no encoding, no allocation of consequence. Split out from
 * `chunkAudio` because it is the part worth testing on its own: given a PCM
 * buffer you can assert the chunks tile it exactly, with no gap and no overlap,
 * without waiting for 120 MB of WAVs to be built.
 */
export function planChunks(
  pcm: Float32Array,
  sampleRate: number,
  opts: PlanOptions = {},
): ChunkBounds[] {
  const chunkSec = opts.chunkSec ?? CHUNK_SEC;
  const searchSec = opts.searchSec ?? QUIET_SEARCH_SEC;
  const minTailSec = opts.minTailSec ?? MIN_TAIL_SEC;

  const total = pcm.length;
  const chunkSamples = Math.round(chunkSec * sampleRate);
  const searchSamples = Math.round(searchSec * sampleRate);
  const windowSamples = Math.max(1, Math.round(QUIET_WINDOW_SEC * sampleRate));
  const minTailSamples = Math.round(minTailSec * sampleRate);

  const bounds: ChunkBounds[] = [];
  let start = 0;
  let i = 0;

  while (start < total) {
    const nominalEnd = start + chunkSamples;

    // Everything that is left fits in one chunk (or is short enough that
    // splitting it would strand a stub) — take it all and stop.
    if (nominalEnd + minTailSamples >= total) {
      bounds.push(makeBounds(i, start, total, sampleRate));
      break;
    }

    const quiet = quietestWindowStart(
      pcm,
      nominalEnd - searchSamples,
      nominalEnd,
      windowSamples,
    );
    // Centre of the quiet window — see the header note about clipped consonants.
    let end = quiet + Math.floor(windowSamples / 2);
    // Paranoia, not expected: never let a cut point run backwards.
    if (end <= start) end = nominalEnd;
    if (end > total) end = total;

    bounds.push(makeBounds(i, start, end, sampleRate));
    start = end;
    i += 1;
  }

  return bounds;
}

function makeBounds(i: number, startSample: number, endSample: number, sampleRate: number): ChunkBounds {
  const startSec = startSample / sampleRate;
  const endSec = endSample / sampleRate;
  return { i, startSample, endSample, startSec, endSec, durationSec: endSec - startSec };
}

/* ------------------------------------------------------------ WAV writer */

/**
 * 44-byte canonical header + PCM16 little-endian. No encoder library: this is
 * the entire format, and pulling in a dependency to write 44 bytes would be
 * worse than the eleven lines below.
 */
export function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  const frames = pcm.length;
  const bytes = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(bytes);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);        // PCM chunk size
  view.setUint16(20, 1, true);         // format = PCM
  view.setUint16(22, 1, true);         // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);         // block align
  view.setUint16(34, 16, true);        // bits per sample
  ascii(36, 'data');
  view.setUint32(40, frames * 2, true);

  let at = 44;
  for (let i = 0; i < frames; i++) {
    // Clamp before scaling: a float that drifted past ±1 wraps to the opposite
    // rail as int16, which is an audible click exactly at the cut point.
    const s = pcm[i] < -1 ? -1 : pcm[i] > 1 ? 1 : pcm[i];
    view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    at += 2;
  }

  return new Blob([bytes], { type: 'audio/wav' });
}

/* -------------------------------------------------------------- chunking */

export interface ChunkOptions extends PlanOptions {
  onProgress?: (done: number, total: number) => void;
}

/**
 * Plan, then encode. Each chunk's WAV is built from a **subarray view** of the
 * decoded PCM, so there is no second full-length copy of the audio; only the
 * chunk's own 19 MB of int16 is allocated at a time.
 */
export function chunkAudio(decoded: DecodedAudio, opts: ChunkOptions = {}): AudioChunk[] {
  const bounds = planChunks(decoded.pcm, decoded.sampleRate, opts);
  const chunks: AudioChunk[] = [];
  for (const b of bounds) {
    const wav = encodeWav(decoded.pcm.subarray(b.startSample, b.endSample), decoded.sampleRate);
    chunks.push({ ...b, wav, bytes: wav.size });
    opts.onProgress?.(chunks.length, bounds.length);
  }
  return chunks;
}

/**
 * Guard for the invariant that made us pick 10 minutes at 16 kHz in the first
 * place. If a future edit raises `CHUNK_SEC`, this is what says so out loud
 * instead of the provider returning 413 on the user's file.
 */
export function oversizedChunks(chunks: AudioChunk[]): AudioChunk[] {
  return chunks.filter((c) => c.bytes > DIRECT_UPLOAD_MAX_BYTES);
}

/** Bytes a chunk of `sec` seconds will occupy once encoded. Used by Bring's estimate. */
export function wavBytesFor(sec: number, sampleRate = CHUNK_SAMPLE_RATE): number {
  return 44 + Math.round(sec * sampleRate) * 2;
}
