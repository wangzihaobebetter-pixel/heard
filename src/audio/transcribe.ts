/**
 * The transcription client (DESIGN §4.6 steps 4, 5, 6).
 *
 * WP1 owns this file.
 *
 * OpenAI-compatible by construction: multipart POST to
 * `{baseUrl}/audio/transcriptions`, `response_format=verbose_json`, and both
 * timestamp granularities requested every time. Word-level is the product —
 * "exact second" is not exact if the anchor can only land on a 5–15 s segment —
 * but we ask for segments too, because a custom endpoint that only knows
 * segments should degrade to an `≈` chip rather than to nothing (DESIGN §4.6,
 * `Anchor.quality`).
 *
 * Three behaviours in here are the difference between a demo and a product:
 *
 *  1. **Offset correction is applied to every timestamp, from the chunk's exact
 *     sample offset.** `chunk.ts` earns that number; this file spends it.
 *  2. **The edge-word guard.** Whisper reliably hallucinates a word or two past
 *     the end of a chunk's real audio. Any word starting at or after the
 *     chunk's own duration is dropped — otherwise every boundary in a
 *     seven-chunk file gets a phantom word timed into the next chunk's opening
 *     seconds, and the karaoke lights the wrong line.
 *  3. **Chunks persist as they land.** `onProgress` fires with a complete,
 *     valid `Transcript` after every chunk, so §4.2's "listening…" state shows
 *     a transcript that fills in from the top and is readable while the rest is
 *     still in flight. A failed chunk leaves a marked gap and the interview
 *     goes `partial` — it does not fail the whole recording.
 *
 * Deliberately absent: `prompt` continuity between chunks. Threading the tail
 * of chunk N into chunk N+1 would serialise a pipeline we just made concurrent,
 * to buy consistent punctuation at seven cut points (DESIGN §4.6 step 6).
 */
import type { Segment, Transcript, TranscriptChunk, Word } from '../types';
import { CHUNK_CONCURRENCY, CHUNK_RETRIES } from '../store/presets';
import { EngineError } from './decode';
import type { AudioChunk } from './chunk';

export interface SttConfig {
  baseUrl: string;
  key: string;
  model: string;
  /** 'auto' means: send no language hint and take what the provider reports. */
  lang: 'auto' | string;
  /** Label for error copy — `bring.keyRefused` interpolates `{provider}`. */
  provider?: string;
  /**
   * Vocabulary bias (v3 B4): course terms and names the model should prefer.
   * A STATIC prompt, identical for every chunk — distinct from the chunk-tail
   * threading this file's header deliberately rejects, and concurrency-safe
   * for exactly that reason.
   */
  prompt?: string;
}

/** What a provider gives back, before any offset correction. */
export interface RawTranscription {
  language: string;
  durationSec: number;
  words: { t: string; s: number; e: number }[];
  segments: { s: number; e: number }[];
}

/* --------------------------------------------------------------- wire */

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
}

/**
 * Providers disagree about the envelope even when they agree about the schema:
 * OpenAI puts words at the top level, some compatible servers nest them under
 * `segments[].words`. Both are read here so a "custom" base URL has a fair
 * chance of working without a code change.
 */
export function parseVerboseJson(body: unknown): RawTranscription {
  const j = (body ?? {}) as Record<string, unknown>;
  const words: RawTranscription['words'] = [];
  const segments: RawTranscription['segments'] = [];

  const pushWord = (w: unknown) => {
    const o = (w ?? {}) as Record<string, unknown>;
    const t = typeof o.word === 'string' ? o.word : typeof o.text === 'string' ? o.text : '';
    const s = Number(o.start);
    const e = Number(o.end);
    if (!t.trim() || !Number.isFinite(s) || !Number.isFinite(e)) return;
    words.push({ t, s, e: Math.max(e, s) });
  };

  if (Array.isArray(j.words)) for (const w of j.words) pushWord(w);

  if (Array.isArray(j.segments)) {
    for (const raw of j.segments) {
      const seg = (raw ?? {}) as Record<string, unknown>;
      const s = Number(seg.start);
      const e = Number(seg.end);
      if (Number.isFinite(s) && Number.isFinite(e)) segments.push({ s, e: Math.max(e, s) });
      if (!Array.isArray(j.words) && Array.isArray(seg.words)) for (const w of seg.words) pushWord(w);
    }
  }

  words.sort((a, b) => a.s - b.s);
  segments.sort((a, b) => a.s - b.s);

  const duration = Number(j.duration);
  return {
    language: typeof j.language === 'string' ? j.language : 'auto',
    durationSec: Number.isFinite(duration) ? duration : (words.length ? words[words.length - 1].e : 0),
    words,
    segments,
  };
}

function isRetriable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function backoffMs(attempt: number, retryAfter?: string | null): number {
  const header = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 20000);
  // 0.8 s, 1.6 s, plus jitter so three concurrent chunks do not retry in lockstep.
  return Math.round((800 * 2 ** attempt) * (1 + Math.random() * 0.25));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One request, with retries. Returns provider-relative times — the caller owns
 * the offset arithmetic, so that it lives in exactly one place.
 */
export async function transcribeOnce(
  audio: Blob,
  filename: string,
  cfg: SttConfig,
  opts: { retries?: number; signal?: AbortSignal } = {},
): Promise<RawTranscription> {
  const retries = opts.retries ?? CHUNK_RETRIES;

  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append('file', audio, filename);
    form.append('model', cfg.model);
    form.append('response_format', 'verbose_json');
    // Array syntax, not a comma list — this is what both providers document.
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (cfg.lang && cfg.lang !== 'auto') form.append('language', cfg.lang);
    if (cfg.prompt) form.append('prompt', cfg.prompt);

    let res: Response;
    try {
      res = await fetch(endpoint(cfg.baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.key}` },
        body: form,
        signal: opts.signal,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      // A network failure is indistinguishable from being offline here; retry,
      // and only call it `offline` once the retries are spent.
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new EngineError('offline', `network failed after ${retries + 1} attempts: ${String(err)}`);
    }

    if (res.ok) return parseVerboseJson(await res.json());

    // A refused key will be refused again in 1.6 seconds. Fail loudly, at once.
    if (res.status === 401 || res.status === 403) {
      throw new EngineError('keyRefused', `provider returned ${res.status}`, cfg.provider);
    }
    if (isRetriable(res.status)) {
      if (attempt < retries) {
        await sleep(backoffMs(attempt, res.headers.get('retry-after')));
        continue;
      }
      const detail = await res.text().catch(() => '');
      throw new EngineError('providerFailed', `provider returned ${res.status} ${detail.slice(0, 300)}`);
    }
    const detail = await res.text().catch(() => '');
    throw new EngineError('providerFailed', `provider returned ${res.status} ${detail.slice(0, 300)}`);
  }
}

/* --------------------------------------------- offset correction & merge */

/**
 * DESIGN §4.6 step 5, the two rules that make chunked audio safe to anchor
 * against: shift every timestamp by the chunk's exact start, and drop anything
 * that claims to begin at or after the chunk's own end.
 */
export function correctChunkTimes(
  raw: RawTranscription,
  startSec: number,
  chunkDurationSec: number,
): { words: { t: string; s: number; e: number }[]; segments: { s: number; e: number }[] } {
  const words = raw.words
    .filter((w) => w.s < chunkDurationSec)
    .map((w) => ({
      t: w.t,
      s: w.s + startSec,
      // A surviving word may still *end* past the boundary; clamp rather than
      // drop, so the karaoke highlight ends where the audio does.
      e: Math.min(w.e, chunkDurationSec) + startSec,
    }));
  const segments = raw.segments
    .filter((sg) => sg.s < chunkDurationSec)
    .map((sg) => ({ s: sg.s + startSec, e: Math.min(sg.e, chunkDurationSec) + startSec }));
  return { words, segments };
}

/** First index whose word start is >= `t`. Shared with the player's cursor. */
function lowerBound(starts: number[], t: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface ChunkResult {
  words: { t: string; s: number; e: number }[];
  segments: { s: number; e: number }[];
  language?: string;
}

/**
 * Assemble whatever has landed so far into a valid `Transcript`.
 *
 * Called after every chunk, so it must be cheap and it must never produce a
 * half-state: word indices are dense and 0-based over the words that exist,
 * segments carry the `[wi, wj)` range they cover, and a missing chunk is simply
 * absent from the word list while staying visible in `chunks` as `failed`.
 */
export function mergeChunks(
  bounds: { i: number; startSec: number; endSec: number; durationSec: number }[],
  results: (ChunkResult | null)[],
  states: TranscriptChunk['state'][],
  durationSec: number,
  lang: string,
): Transcript {
  const words: Word[] = [];
  const rawSegments: { s: number; e: number }[] = [];

  for (let c = 0; c < bounds.length; c++) {
    const r = results[c];
    if (!r) continue;
    for (const w of r.words) words.push({ i: words.length, t: w.t, s: w.s, e: w.e });
    for (const sg of r.segments) rawSegments.push(sg);
  }

  const starts = words.map((w) => w.s);
  const segments: Segment[] = rawSegments.map((sg) => {
    const wi = lowerBound(starts, sg.s - 1e-6);
    const wj = lowerBound(starts, sg.e - 1e-6);
    return { s: sg.s, e: sg.e, wi, wj: Math.max(wj, wi) };
  });

  const chunks: TranscriptChunk[] = bounds.map((b, c) => ({
    i: b.i,
    s: b.startSec,
    e: b.endSec,
    state: states[c],
  }));

  // "How many seconds have actually been heard" — the strip in §4.2 reads
  // `heardSec` against `durationSec` to say "Listening… 41 of 92 min", so it
  // counts landed audio, not elapsed wall-clock.
  const heardSec = bounds.reduce((acc, b, c) => (states[c] === 'done' ? acc + b.durationSec : acc), 0);

  return { lang, words, segments, heardSec, durationSec, chunks };
}

/* ------------------------------------------------------------- pipeline */

export interface TranscribeHooks {
  /** Reuse matching completed chunks when resuming a partial transcript. */
  previous?: Transcript;
  /** Fires after every chunk with a complete, readable transcript so far. */
  onProgress?: (transcript: Transcript) => void;
  /** Fires once per chunk with its final state, for the §4.2 chunk strip. */
  onChunk?: (index: number, state: TranscriptChunk['state']) => void;
  signal?: AbortSignal;
}

/**
 * The > 25 MB path: N chunks, `CHUNK_CONCURRENCY` in flight, each retried
 * `CHUNK_RETRIES` times, results merged and published as they arrive.
 *
 * A single chunk failing after its retries is survivable and *designed for* —
 * it becomes a gap, the interview is `partial`, and §4.2 says so honestly. A
 * refused key is not survivable and cancels the batch immediately.
 */
export async function transcribeChunks(
  chunks: AudioChunk[],
  cfg: SttConfig,
  hooks: TranscribeHooks = {},
): Promise<Transcript> {
  const previous = hooks.previous;
  const matchesPrevious = (chunk: AudioChunk) => previous?.chunks.some((prior) =>
    prior.state === 'done'
    && prior.i === chunk.i
    && Math.abs(prior.s - chunk.startSec) < 1e-6
    && Math.abs(prior.e - chunk.endSec) < 1e-6,
  ) ?? false;
  const results: (ChunkResult | null)[] = chunks.map((chunk) => matchesPrevious(chunk) ? {
    words: previous!.words
      .filter((word) => word.s >= chunk.startSec && word.s < chunk.endSec)
      .map(({ t, s, e }) => ({ t, s, e })),
    segments: previous!.segments
      .filter((segment) => segment.s >= chunk.startSec && segment.s < chunk.endSec)
      .map(({ s, e }) => ({ s, e })),
  } : null);
  const states: TranscriptChunk['state'][] = results.map((result) => result ? 'done' : 'pending');
  const durationSec = chunks.length ? chunks[chunks.length - 1].endSec : 0;
  let lang = cfg.lang === 'auto' ? (previous?.lang ?? 'auto') : cfg.lang;

  const abort = new AbortController();
  const onOuterAbort = () => abort.abort();
  hooks.signal?.addEventListener('abort', onOuterAbort);

  let fatal: unknown = null;
  let transientFailure: EngineError | null = null;
  let next = 0;

  const publish = () => hooks.onProgress?.(mergeChunks(chunks, results, states, durationSec, lang));

  const worker = async () => {
    for (;;) {
      const c = next++;
      if (c >= chunks.length || fatal || abort.signal.aborted) return;
      if (states[c] === 'done') continue;
      const chunk = chunks[c];
      try {
        const raw = await transcribeOnce(
          chunk.wav,
          `chunk-${String(chunk.i).padStart(3, '0')}.wav`,
          cfg,
          { signal: abort.signal },
        );
        if (lang === 'auto' && raw.language && raw.language !== 'auto') lang = raw.language;
        results[c] = correctChunkTimes(raw, chunk.startSec, chunk.durationSec);
        states[c] = 'done';
      } catch (err) {
        // A bad key poisons every remaining chunk; stop the batch rather than
        // spend the user's time proving it six more times.
        if (err instanceof EngineError && err.code === 'keyRefused') {
          fatal = err;
          abort.abort();
          return;
        }
        if (err instanceof EngineError
          && (err.code === 'offline' || err.code === 'providerFailed')
          && !transientFailure) transientFailure = err;
        states[c] = 'failed';
      }
      hooks.onChunk?.(c, states[c]);
      publish();
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker),
    );
  } finally {
    hooks.signal?.removeEventListener('abort', onOuterAbort);
  }

  if (fatal) throw fatal;
  if (!results.some(Boolean) && transientFailure) throw transientFailure;
  return mergeChunks(chunks, results, states, durationSec, lang);
}

/**
 * The ≤ 25 MB path: send the file exactly as the user brought it, no decode.
 * This is the path phones take, and the reason a 90-minute 32 kbps recording
 * needs no Web Audio support at all.
 */
export async function transcribeDirect(
  file: Blob,
  filename: string,
  cfg: SttConfig,
  hooks: TranscribeHooks = {},
): Promise<Transcript> {
  const raw = await transcribeOnce(file, filename, cfg, { signal: hooks.signal });
  const durationSec = raw.durationSec || (raw.words.length ? raw.words[raw.words.length - 1].e : 0);
  const bounds = [{ i: 0, startSec: 0, endSec: durationSec, durationSec }];
  // Offset 0, but run it through the same correction so the edge-word guard
  // applies here too — a single-shot response hallucinates past the end just
  // as happily as a chunk does.
  const corrected = correctChunkTimes(raw, 0, durationSec + 1e-3);
  const transcript = mergeChunks(bounds, [corrected], ['done'], durationSec, raw.language || cfg.lang);
  hooks.onChunk?.(0, 'done');
  hooks.onProgress?.(transcript);
  return transcript;
}

/**
 * The Settings/Bring **Test** button (WP3 consumes this). One-second of silence
 * is the cheapest thing that still proves the whole round trip: the base URL
 * resolves, CORS allows the browser origin, the key is accepted, and the model
 * name exists. Anything less tests less than it claims to.
 */
export async function testKey(cfg: SttConfig): Promise<{ ok: boolean; code?: string; detail?: string }> {
  const silence = new Float32Array(16000);
  const { encodeWav } = await import('./chunk');
  try {
    await transcribeOnce(encodeWav(silence, 16000), 'test.wav', cfg, { retries: 0 });
    return { ok: true };
  } catch (err) {
    if (err instanceof EngineError) return { ok: false, code: err.code, detail: err.message };
    return { ok: false, code: 'offline', detail: String(err) };
  }
}
