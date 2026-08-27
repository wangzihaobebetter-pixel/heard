/**
 * Decoding — the front door of the > 25 MB path (DESIGN §4.6 step 1).
 *
 * WP1 owns this file.
 *
 * The job: turn whatever the user brought into **mono 16 kHz float PCM**, which
 * is the only representation the chunker and both providers actually want.
 * Groq's docs say the models downsample to 16 kHz mono anyway, so doing it here
 * costs nothing in accuracy and buys a 6× smaller upload.
 *
 * Two things in here are load-bearing and easy to get wrong:
 *
 *  1. **We decode once and resample once.** `decodeAudioData` gives us the
 *     file's own rate; a second `OfflineAudioContext` render at 16 kHz does the
 *     downmix and the resample together, with the browser's own (good) resampler.
 *     Hand-rolling a resampler here would be a worse resampler and more code.
 *
 *  2. **If the source is already mono 16 kHz we skip the render entirely.** That
 *     is not a micro-optimisation: the render allocates a second full-length
 *     Float32Array, and at 65 minutes that is 250 MB. Skipping it is the
 *     difference between "works on this laptop" and "tab dies".
 *
 * Memory is the real ceiling here, not CPU. 16 kHz mono float32 is 64 KB/s:
 * 90 min ≈ 173 MB, 3 h ≈ 345 MB, and the decoder holds its own copy at the
 * source rate while it works. DESIGN §4.6 caps us at 3 hours / 400 MB and
 * refuses the decode path on mobile browsers; `canDecodeLarge()` is that gate.
 */
import {
  CHUNK_SAMPLE_RATE,
  DIRECT_UPLOAD_MAX_BYTES,
  MAX_DURATION_SEC,
  MAX_FILE_BYTES,
} from '../store/presets';

export const TARGET_SAMPLE_RATE = CHUNK_SAMPLE_RATE;

/** Mono, 16 kHz, float. The only audio representation that leaves this module. */
export interface DecodedAudio {
  pcm: Float32Array;
  sampleRate: number;
  durationSec: number;
}

/**
 * Why a file was refused. These are *codes*, not sentences — the copy lives in
 * `src/i18n/screens.ts` under `bring.*` and belongs to WP3. An engine that
 * returns English strings is an engine that has opinions about the UI.
 */
export type EngineErrorCode =
  | 'unsupported'   // the browser could not decode it at all
  | 'tooLong'       // over MAX_DURATION_SEC
  | 'tooBigMobile'  // over the direct-upload limit on a device we won't decode on
  | 'tooBig'        // over MAX_FILE_BYTES even on desktop
  | 'keyRefused'    // 401/403 from the provider
  | 'offline'       // no network
  | 'providerFailed' // non-auth provider HTTP failure; settings may be corrected
  | 'decodeFailed'; // decoded, but the result was empty or absurd

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  /** Filled for `keyRefused` so the copy can say *which* provider refused. */
  readonly provider?: string;
  constructor(code: EngineErrorCode, message?: string, provider?: string) {
    super(message ?? code);
    this.name = 'EngineError';
    this.code = code;
    this.provider = provider;
  }
}

/* ------------------------------------------------------------ capability */

function hasOfflineAudioContext(): boolean {
  return typeof OfflineAudioContext !== 'undefined' || typeof (globalThis as Record<string, unknown>).webkitOfflineAudioContext !== 'undefined';
}

/**
 * Mobile detection, used only to *refuse* the decode path (DESIGN §4.6:
 * "on mobile browsers we do not attempt the decode path"). Getting this wrong
 * in the permissive direction crashes a phone; getting it wrong in the strict
 * direction shows honest copy on a laptop that could have coped. So it errs
 * strict, and the copy in `bring.tooBigMobile` tells the truth either way.
 *
 * `navigator.deviceMemory` is the real signal where it exists (Chrome/Android);
 * iOS Safari reports nothing, so the UA check carries it there.
 */
export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
  // iPadOS 13+ lies and says "Macintosh"; touch points give it away.
  if (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) return true;
  return false;
}

/** True when this device may attempt decode-and-chunk for a > 25 MB file. */
export function canDecodeLarge(): boolean {
  if (!hasOfflineAudioContext()) return false;
  if (isMobileBrowser()) return false;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  // deviceMemory is capped at 8 by the spec, and 4 GB is enough for a 3 h file.
  if (typeof mem === 'number' && mem > 0 && mem < 4) return false;
  return true;
}

/**
 * The decision DESIGN §4.3 has to render as copy, made once, here, so Bring and
 * the engine can never disagree about whether a file is going to work.
 */
export type PlanKind = 'direct' | 'chunked';

export interface IntakePlan {
  kind: PlanKind;
  bytes: number;
  /** Only known after a metadata probe; -1 when we haven't looked yet. */
  durationSec: number;
}

export function planIntake(bytes: number, durationSec: number): IntakePlan {
  if (bytes <= DIRECT_UPLOAD_MAX_BYTES) return { kind: 'direct', bytes, durationSec };
  if (!canDecodeLarge()) throw new EngineError('tooBigMobile');
  if (bytes > MAX_FILE_BYTES) throw new EngineError('tooBig');
  if (durationSec > 0 && durationSec > MAX_DURATION_SEC) throw new EngineError('tooLong');
  return { kind: 'chunked', bytes, durationSec };
}

/* --------------------------------------------------------------- probing */

/**
 * Duration without decoding, via a throwaway `<audio>` element reading
 * metadata. Bring needs the number *before* it commits to the long decode (and
 * "Locate the file" in §4.2 verifies a re-picked file is the same recording by
 * duration), and decoding 119 MB to answer "how long is it?" would be absurd.
 */
export function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement('audio');
    el.preload = 'metadata';
    const done = (fn: () => void) => {
      el.removeAttribute('src');
      URL.revokeObjectURL(url);
      fn();
    };
    el.onloadedmetadata = () => {
      const d = el.duration;
      done(() => (Number.isFinite(d) && d > 0
        ? resolve(d)
        : reject(new EngineError('unsupported', 'no duration in metadata'))));
    };
    el.onerror = () => done(() => reject(new EngineError('unsupported', 'element could not read the file')));
    el.src = url;
  });
}

/* -------------------------------------------------------------- decoding */

/** One short-lived context purely to run `decodeAudioData`. */
function decoderContext(): BaseAudioContext {
  const Offline = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
    ?? (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Offline) throw new EngineError('unsupported', 'no OfflineAudioContext');
  // 1 frame at 44.1 k: we never render with this one, it only decodes. Safari
  // refuses a zero-length context, hence 1.
  return new Offline(1, 1, 44100);
}

/** Safari still hands `decodeAudioData` the callback signature only. */
function decodeAudioDataCompat(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

export interface DecodeOptions {
  /** 0..1, called as the resample render progresses (it is the slow half). */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * `ArrayBuffer` in, mono 16 kHz PCM out.
 *
 * Note the deliberate `slice(0)` absence: `decodeAudioData` *detaches* the
 * buffer it is given. Callers hand us a buffer they no longer own; the Blob
 * they read it from is still theirs and is what goes into IndexedDB.
 */
export async function decodeToMono16k(data: ArrayBuffer, opts: DecodeOptions = {}): Promise<DecodedAudio> {
  let buffer: AudioBuffer;
  try {
    buffer = await decodeAudioDataCompat(decoderContext(), data);
  } catch (err) {
    throw new EngineError('unsupported', `decodeAudioData refused the file: ${String(err)}`);
  }
  if (!buffer.length || !Number.isFinite(buffer.duration) || buffer.duration <= 0) {
    throw new EngineError('decodeFailed', 'decoded to zero frames');
  }
  if (buffer.duration > MAX_DURATION_SEC) throw new EngineError('tooLong');

  opts.signal?.throwIfAborted?.();

  // Fast path — already what we want. Saves a full-length allocation; see the
  // header note about 250 MB.
  if (buffer.sampleRate === TARGET_SAMPLE_RATE && buffer.numberOfChannels === 1) {
    opts.onProgress?.(1);
    return {
      pcm: buffer.getChannelData(0),
      sampleRate: TARGET_SAMPLE_RATE,
      durationSec: buffer.duration,
    };
  }

  const frames = Math.max(1, Math.ceil(buffer.duration * TARGET_SAMPLE_RATE));
  const Offline = (globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext;
  // 1 output channel: the graph downmixes N→1 for us with the standard
  // speaker layout, which is a better mixdown than averaging channels by hand.
  const off = new Offline(1, frames, TARGET_SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start(0);

  // `startRendering` gives no progress events, so the caller gets a coarse
  // heartbeat rather than a lie about percentage.
  opts.onProgress?.(0.05);
  const rendered = await off.startRendering();
  opts.onProgress?.(1);

  return {
    pcm: rendered.getChannelData(0),
    sampleRate: TARGET_SAMPLE_RATE,
    durationSec: rendered.length / TARGET_SAMPLE_RATE,
  };
}

/** Convenience for the common "I have the Blob from IndexedDB" case. */
export async function decodeBlob(blob: Blob, opts: DecodeOptions = {}): Promise<DecodedAudio> {
  return decodeToMono16k(await blob.arrayBuffer(), opts);
}
