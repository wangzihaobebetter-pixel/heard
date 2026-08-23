/**
 * Waveform peaks — the shape of sound (DESIGN-SYSTEM v2 §4 signature element 1).
 *
 * One decode per recording, ever: peaks are computed from the stored blob the
 * first time a recording is opened, then cached in IndexedDB (`peaks:<id>`)
 * and served from there for the player track and the Library mini waveforms.
 *
 * The buckets are max-abs amplitude, normalised to [0, 1] against the loudest
 * bucket, so quiet interviews still draw a legible shape. 180 buckets is
 * enough for a full-width track; the Library minis just stride over them.
 */
import { get, set } from 'idb-keyval';

export const PEAKS_BUCKETS = 180;
const peaksKey = (interviewId: string) => `peaks:${interviewId}`;

const memory = new Map<string, Float32Array>();
const inflight = new Map<string, Promise<Float32Array | null>>();

function computeBuckets(channel: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const per = Math.max(1, Math.floor(channel.length / buckets));
  for (let b = 0; b < buckets; b++) {
    const start = b * per;
    const end = Math.min(channel.length, start + per);
    // RMS, not max: speech clips every bucket's max near full scale and the
    // shape flattens into a comb. RMS keeps the loudness contour visible.
    // Stride 16 is indistinguishable at this bucket count and keeps a
    // 92-minute decode's scan under a few ms.
    let sum = 0;
    let n = 0;
    for (let i = start; i < end; i += 16) {
      sum += channel[i] * channel[i];
      n++;
    }
    out[b] = n ? Math.sqrt(sum / n) : 0;
  }
  let peak = 0;
  for (let b = 0; b < buckets; b++) if (out[b] > peak) peak = out[b];
  if (peak > 0) for (let b = 0; b < buckets; b++) out[b] /= peak;
  return out;
}

/** Cached peaks only — never decodes. For surfaces (Library) that must not
    pay for a decode just to render a card. */
export async function getCachedPeaks(interviewId: string): Promise<Float32Array | null> {
  const m = memory.get(interviewId);
  if (m) return m;
  try {
    const stored = await get<number[]>(peaksKey(interviewId));
    if (!stored) return null;
    const arr = Float32Array.from(stored);
    memory.set(interviewId, arr);
    return arr;
  } catch {
    return null;
  }
}

/** Peaks for a recording, decoding the blob once if no cache exists.
    Resolves null when decoding fails (unsupported codec, broken file) —
    the track then simply draws its plain line, which is not an error. */
export async function ensurePeaks(interviewId: string, blob: Blob): Promise<Float32Array | null> {
  const cached = await getCachedPeaks(interviewId);
  if (cached) return cached;
  const running = inflight.get(interviewId);
  if (running) return running;

  const job = (async () => {
    try {
      const Ctx: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      try {
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        const peaks = computeBuckets(buf.getChannelData(0), PEAKS_BUCKETS);
        memory.set(interviewId, peaks);
        try { await set(peaksKey(interviewId), Array.from(peaks)); } catch { /* cache miss is fine */ }
        return peaks;
      } finally {
        void ctx.close();
      }
    } catch {
      return null;
    } finally {
      inflight.delete(interviewId);
    }
  })();
  inflight.set(interviewId, job);
  return job;
}

export async function removePeaks(interviewId: string): Promise<void> {
  memory.delete(interviewId);
  try { const { del } = await import('idb-keyval'); await del(peaksKey(interviewId)); } catch { /* gone is fine */ }
}
