/**
 * The WP1 dev harness.
 *
 * It exists so the engine can be driven and measured without WP2's screen, and
 * so `verify-engine.mjs` has a stable surface to call. Everything here is a
 * thin driver over `src/audio/*` — no logic that the product depends on lives
 * in this file, because a harness that reimplements the thing it is testing
 * tests nothing.
 *
 * Not shipped: it is under `dev/`, has its own HTML entry, and is not reachable
 * from the app's router or from `index.html`.
 */
import { decodeToMono16k, planIntake, probeDuration } from '../src/audio/decode';
import { chunkAudio, oversizedChunks, planChunks } from '../src/audio/chunk';
import { transcribeChunks, transcribeDirect, type SttConfig } from '../src/audio/transcribe';
import { alignQuote, buildTokenIndex, normalizeTokens } from '../src/audio/align';
import { getPlayer } from '../src/audio/player';
import { putAudio, removeAudio } from '../src/lib/storage';
import { useStore } from '../src/store';
import { SAMPLE_ID } from '../src/sample/schema';
import type { Anchor, Transcript, Word } from '../src/types';

/** The most recent transcript's words, so the align case can use real speech. */
let lastWords: Word[] = [];

const statusEl = document.getElementById('status') as HTMLElement;
const outEl = document.getElementById('out') as HTMLElement;
const audioEl = document.getElementById('audio') as HTMLAudioElement;

function status(text: string) {
  statusEl.textContent = text;
}

function show(value: unknown) {
  outEl.textContent = JSON.stringify(value, null, 2);
}

/* ------------------------------------------------------------- helpers */

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.blob();
}

export interface CaseConfig {
  url: string;
  baseUrl: string;
  key: string;
  model: string;
  lang?: string;
}

function sttOf(cfg: CaseConfig): SttConfig {
  return {
    baseUrl: cfg.baseUrl,
    key: cfg.key,
    model: cfg.model,
    lang: cfg.lang ?? 'auto',
    provider: 'harness',
  };
}

/**
 * Everything `verify-engine.mjs` asserts on, derived from the transcript and
 * the chunk plan. Computed here rather than in the verifier so the assertions
 * run against the same objects the app would hold.
 */
function analyse(transcript: Transcript, bounds: { i: number; startSec: number; endSec: number }[]) {
  const w = transcript.words;

  // Strict monotonicity of the whole word array, and where it first breaks.
  const monotonicBreaks: { i: number; prev: number; next: number; t: string }[] = [];
  for (let i = 1; i < w.length; i++) {
    if (!(w[i].s >= w[i - 1].s)) {
      monotonicBreaks.push({ i, prev: w[i - 1].s, next: w[i].s, t: w[i].t });
    }
  }
  const badSpans = w.filter((x) => !(x.e >= x.s)).map((x) => ({ i: x.i, s: x.s, e: x.e }));

  // Attribute each word to the chunk whose time range contains it, then check
  // the two things offset correction can get wrong: a word outside every
  // chunk, or a word inside the wrong one.
  const outOfRange: { i: number; s: number; e: number }[] = [];
  const perChunk = bounds.map(() => 0);
  for (const x of w) {
    const k = bounds.findIndex((b) => x.s >= b.startSec - 1e-6 && x.s < b.endSec + 1e-6);
    if (k < 0 || x.e > bounds[k].endSec + 1e-6) {
      // A word may legitimately end a hair past its chunk only if it is the
      // last chunk; anything else is a correction bug.
      if (k < 0 || k !== bounds.length - 1) outOfRange.push({ i: x.i, s: x.s, e: x.e });
      else perChunk[k] += 1;
    } else perChunk[k] += 1;
  }

  // The boundary gaps — the number that says whether a cut lost speech.
  const boundaries: { at: number; before: number; after: number; gap: number; beforeText: string; afterText: string }[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const cut = bounds[k].endSec;
    let last: Word | null = null;
    let first: Word | null = null;
    for (const x of w) {
      if (x.s < cut) last = x;
      else { first = x; break; }
    }
    if (last && first) {
      boundaries.push({
        at: cut,
        before: last.e,
        after: first.s,
        gap: first.s - last.e,
        beforeText: last.t.trim(),
        afterText: first.t.trim(),
      });
    }
  }

  return {
    words: w.length,
    segments: transcript.segments.length,
    firstWordSec: w.length ? w[0].s : null,
    lastWordSec: w.length ? w[w.length - 1].e : null,
    durationSec: transcript.durationSec,
    heardSec: transcript.heardSec,
    chunkStates: transcript.chunks.map((c) => c.state),
    monotonicBreaks,
    badSpans,
    outOfRange,
    perChunk,
    // Every word's start, so the verifier can diff the result against the
    // ground-truth transcription and count anything a cut swallowed.
    wordStarts: w.map((x) => Number(x.s.toFixed(3))),
    boundaries,
    maxBoundaryGap: boundaries.reduce((m, b) => Math.max(m, b.gap), 0),
  };
}

/* --------------------------------------------------------------- cases */

async function runChunked(cfg: CaseConfig) {
  status('fetching audio…');
  const blob = await fetchBlob(cfg.url);
  const durationSec = await probeDuration(blob);
  const plan = planIntake(blob.size, durationSec);

  status('decoding…');
  const t0 = performance.now();
  const decoded = await decodeToMono16k(await blob.arrayBuffer());
  const decodeMs = performance.now() - t0;

  status('chunking…');
  const t1 = performance.now();
  const chunks = chunkAudio(decoded);
  const chunkMs = performance.now() - t1;

  // Progressive transcript: every publication is recorded so the verifier can
  // prove the transcript was readable while later chunks were still in flight.
  const progressive: { words: number; done: number; heardSec: number }[] = [];

  status(`transcribing ${chunks.length} chunks…`);
  const t2 = performance.now();
  const transcript = await transcribeChunks(chunks, sttOf(cfg), {
    onProgress: (t) => progressive.push({
      words: t.words.length,
      done: t.chunks.filter((c) => c.state === 'done').length,
      heardSec: t.heardSec,
    }),
  });
  const transcribeMs = performance.now() - t2;

  lastWords = transcript.words;

  const report = {
    file: { url: cfg.url, bytes: blob.size, durationSec, plan: plan.kind },
    decode: {
      ms: Math.round(decodeMs),
      sampleRate: decoded.sampleRate,
      samples: decoded.pcm.length,
      durationSec: decoded.durationSec,
    },
    chunking: {
      ms: Math.round(chunkMs),
      count: chunks.length,
      oversized: oversizedChunks(chunks).length,
      bounds: chunks.map((c) => ({
        i: c.i,
        startSample: c.startSample,
        endSample: c.endSample,
        startSec: c.startSec,
        endSec: c.endSec,
        durationSec: c.durationSec,
        bytes: c.bytes,
      })),
      // The plan must tile the audio exactly: no gap, no overlap, no loss.
      tiles: (() => {
        const b = planChunks(decoded.pcm, decoded.sampleRate);
        let ok = b.length > 0 && b[0].startSample === 0 && b[b.length - 1].endSample === decoded.pcm.length;
        for (let i = 1; i < b.length; i++) if (b[i].startSample !== b[i - 1].endSample) ok = false;
        return ok;
      })(),
    },
    transcribe: { ms: Math.round(transcribeMs), progressive },
    analysis: analyse(transcript, chunks),
  };

  status('done');
  show(report);
  return report;
}

async function runDirect(cfg: CaseConfig) {
  status('fetching audio…');
  const blob = await fetchBlob(cfg.url);
  const durationSec = await probeDuration(blob);
  const plan = planIntake(blob.size, durationSec);

  status('transcribing (direct)…');
  const transcript = await transcribeDirect(blob, 'direct.mp3', sttOf(cfg));
  lastWords = transcript.words;
  const bounds = [{ i: 0, startSec: 0, endSec: transcript.durationSec }];

  const report = {
    file: { url: cfg.url, bytes: blob.size, durationSec, plan: plan.kind },
    analysis: analyse(transcript, bounds),
  };
  status('done');
  show(report);
  return report;
}

/**
 * The §5 precision commitments, measured rather than asserted: first audio
 * within 150 ms, the karaoke word matching `currentTime` at sampled instants,
 * and the span stopping at `e + 0.8`.
 */
async function runPlayer(cfg: CaseConfig & { words?: Word[] }) {
  const TEST_ID = 'iv_harness';
  status('seeding audio into IndexedDB…');
  const blob = await fetchBlob(cfg.url);
  await removeAudio(TEST_ID);
  await putAudio(TEST_ID, blob);

  const words: Word[] = cfg.words?.length ? cfg.words : (lastWords.length ? lastWords : synthWords());
  const player = getPlayer();
  player.attach(audioEl);

  status('loading…');
  const loaded = await player.load(TEST_ID, words);

  // A span a little way in, so the pre-roll has somewhere to go.
  const target = words[Math.min(40, words.length - 1)];
  const endWord = words[Math.min(48, words.length - 1)];
  const anchor: Anchor = { s: target.s, e: endWord.e, wi: target.i, wj: endWord.i + 1, quality: 'word' };

  status('playSpan…');
  // A media element that never starts must produce a diagnosis, not a hung
  // CDP call. Everything needed to tell "the browser refused to play" from
  // "the engine never asked it to" is in the timeout branch.
  const first = await Promise.race([
    player.playSpan(anchor),
    new Promise<{ latencyMs: number; startedAt: number; landedAt: number; stalled?: unknown }>((resolve) =>
      setTimeout(() => resolve({
        latencyMs: -1,
        startedAt: anchor.s - 1.0,
        landedAt: audioEl.currentTime,
        stalled: {
          readyState: audioEl.readyState,
          networkState: audioEl.networkState,
          paused: audioEl.paused,
          duration: audioEl.duration,
          error: audioEl.error ? { code: audioEl.error.code, message: audioEl.error.message } : null,
        },
      }), 15000)),
  ]);

  // Karaoke: sample the cursor against the clock at three instants **inside the
  // span**, where words are actually being spoken. Sampling during the pre-roll
  // would compare -1 against -1 and pass without ever lighting a word.
  const samples: { t: number; expected: number; got: number }[] = [];
  const spanDeadline = performance.now() + 4000;
  while (audioEl.currentTime < anchor.s + 0.05 && performance.now() < spanDeadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  for (let k = 1; k <= 3; k++) {
    const t = audioEl.currentTime;
    const expected = words.findIndex((x) => t >= x.s && t < x.e);
    samples.push({ t, expected, got: player.findWord(t) });
    await new Promise((r) => setTimeout(r, 130));
  }

  // Auto-stop at e + 0.8 (DESIGN §5.5). Wait past the stop, then look.
  status('waiting for the span to stop…');
  const stopBudgetMs = Math.max(0, (anchor.e + 0.8 - audioEl.currentTime) * 1000) + 900;
  await new Promise((r) => setTimeout(r, stopBudgetMs));
  const stopped = { paused: audioEl.paused, at: audioEl.currentTime, expected: anchor.e + 0.8 };

  // Nudge −3 then +1, checking the clock moved by what was asked.
  const beforeNudge = audioEl.currentTime;
  player.nudge(-3);
  await new Promise((r) => setTimeout(r, 200));
  const afterMinus3 = audioEl.currentTime;
  player.pause();

  const report = {
    loaded,
    bytes: blob.size,
    anchor,
    firstAudio: { latencyMs: Math.round(first.latencyMs), startedAt: first.startedAt, landedAt: first.landedAt },
    preRollOk: Math.abs(first.startedAt - (anchor.s - 1.0)) < 0.001,
    karaoke: samples,
    karaokeOk: samples.every((s) => s.expected === s.got),
    // A run where every sample landed in a gap proves nothing; at least two of
    // the three must have caught an actual spoken word.
    karaokeLitRealWords: samples.filter((s) => s.expected >= 0).length,
    stopped,
    stoppedOk: stopped.paused && Math.abs(stopped.at - stopped.expected) < 0.25,
    nudge: { before: beforeNudge, afterMinus3, delta: afterMinus3 - beforeNudge },
  };

  await removeAudio(TEST_ID);
  status('done');
  show(report);
  return report;
}

/** A word grid for the player case when no real transcript was produced. */
function synthWords(): Word[] {
  const words: Word[] = [];
  for (let i = 0; i < 400; i++) {
    const s = i * 0.42;
    words.push({ i, t: ` w${i}`, s, e: s + 0.36 });
  }
  return words;
}

async function runAlign(words?: Word[]) {
  // Prefer the real transcript the last case produced: aligning against actual
  // speech is the only version of this test that exercises what WP4 will do.
  const list = words?.length ? words : (lastWords.length ? lastWords : synthWords());
  return alignAgainst(list);
}

interface AlignCaseReport {
  quality: string;
  ratio: number;
  s: number;
  e: number;
  wi?: number;
  wj?: number;
  quote: string;
  qTokens: string[];
  matched: string[];
}

function alignAgainst(words: Word[]) {
  const index = buildTokenIndex(words);
  // Joined with a space, because that is how the transcript the notes model
  // reads is built (src/notes/prompt.ts) and how a span is read back
  // (align.textOfSpan). Whisper's Word.t carries no leading space, so joining
  // with '' welds neighbouring words into one token and the fixture — not the
  // aligner — is what fails.
  const exact = words.slice(60, 74).map((w) => w.t).join(' ').trim();
  const punctuated = `“${exact.replace(/,/g, '')}!”`;
  const dropped = words.slice(60, 74).filter((_, k) => k !== 5).map((w) => w.t).join(' ').trim();
  const absent = 'the quick brown fox jumps over a lazy dog in Houston';

  const cases = { exact, punctuated, dropped, absent };
  const results: Record<string, AlignCaseReport> = {};
  for (const [name, quote] of Object.entries(cases)) {
    const r = alignQuote(quote, words, { index });
    results[name] = {
      quality: r.anchor.quality,
      ratio: Number(r.ratio.toFixed(4)),
      s: r.anchor.s,
      e: r.anchor.e,
      wi: r.anchor.wi,
      wj: r.anchor.wj,
      quote,
      qTokens: normalizeTokens(quote),
      matched: r.anchor.wi !== undefined
        ? normalizeTokens(words.slice(r.anchor.wi, r.anchor.wj).map((w) => w.t).join(' '))
        : [],
    };
  }
  // What the target span actually normalises to — the thing the quote is
  // supposed to equal. If these disagree the fault is in the fixture, not align.
  const targetTokens = normalizeTokens(words.slice(60, 74).map((w) => w.t).join(' '));

  const report = {
    words: words.length,
    tokens: index.tokens.length,
    exactSpanCorrect: results.exact.wi === 60 && results.exact.wj === 74,
    // A word that normalises to nothing (a lone dash, a stray quote mark) can
    // shift the span's edge by one without the match being wrong.
    exactSpanWithinOne:
      Math.abs((results.exact.wi ?? -99) - 60) <= 1 && Math.abs((results.exact.wj ?? -99) - 74) <= 1,
    results,
    targetTokens,
    targetWordTexts: words.slice(60, 74).map((w) => w.t),
    normalizeSample: normalizeTokens("Don't — “Houston,” we 有 a podcast!"),
  };
  status('done');
  show(report);
  return report;
}

/**
 * Amendment A3: the sample's audio must arrive through `putAudio` and be served
 * from IndexedDB afterwards, exactly like a user recording.
 */
async function runSampleDoor(sampleUrl: string) {
  status('A3: clearing the sample blob…');
  await removeAudio(SAMPLE_ID);

  const store = useStore.getState();
  store.upsertInterview({
    id: SAMPLE_ID,
    title: 'harness sample',
    createdAt: Date.now(),
    durationSec: 0,
    file: { name: 'sample.mp3', size: 0, type: 'audio/mpeg', kept: false },
    lang: 'en',
    status: 'ready',
    sample: true,
  });

  const { getAudio } = await import('../src/lib/storage');
  const { resolveAudioBlob } = await import('../src/audio/player');

  const beforeWasEmpty = (await getAudio(SAMPLE_ID)) === null;

  // The app asks for a same-origin, relative `sample.mp3`, which WP4 will ship
  // in `public/`. It does not exist yet, so the one request the A3 path makes
  // is redirected to the harness asset server. Everything after that — the
  // `putAudio`, the `kept` flag, the blob that comes back — is the product's
  // own code path, untouched.
  const realFetch = window.fetch.bind(window);
  let fetched = 0;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href.endsWith('/sample.mp3')) {
      fetched += 1;
      return realFetch(sampleUrl, init);
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof window.fetch;

  let resolved: Blob | null = null;
  try {
    resolved = await resolveAudioBlob(SAMPLE_ID);
  } finally {
    window.fetch = realFetch;
  }

  const stored = await getAudio(SAMPLE_ID);
  const kept = useStore.getState().interviews[SAMPLE_ID]?.file.kept;

  // Second call must NOT hit the network: the blob is in IndexedDB now, which
  // is the whole point of A3 — "a week later, offline" reads from storage.
  const fetchesAfterFirst = fetched;
  const again = await resolveAudioBlob(SAMPLE_ID);

  const report = {
    beforeWasEmpty,
    fetchedOverNetwork: fetchesAfterFirst,
    resolvedBytes: resolved?.size ?? 0,
    storedBytes: stored?.size ?? 0,
    servedFromIdb: !!resolved && !!stored && resolved.size === stored.size,
    secondCallBytes: again?.size ?? 0,
    secondCallUsedNoNetwork: !!again && fetched === fetchesAfterFirst,
    keptFlag: kept,
  };
  await removeAudio(SAMPLE_ID);
  status('done');
  show(report);
  return report;
}

/* ---------------------------------------------------------------- wiring */

const engine = {
  runChunked,
  runDirect,
  runPlayer,
  runAlign,
  runSampleDoor,
  ready: true as const,
};

declare global {
  interface Window {
    engine: typeof engine;
    __lastError?: string;
  }
}

window.engine = engine;

window.addEventListener('error', (e) => { window.__lastError = String(e.message); });
window.addEventListener('unhandledrejection', (e) => { window.__lastError = String(e.reason); });

// The buttons exist so a human can drive this by hand; the verifier does not
// use them. Defaults point at the asset server `verify-engine.mjs` starts.
// `verify-engine.mjs` picks a free port, so a hand-driven run is told which one
// via `?assets=http://127.0.0.1:PORT` (it prints the URL when run with --keep).
const ASSETS = new URLSearchParams(location.search).get('assets') ?? 'http://127.0.0.1:4599';
const DEFAULTS: CaseConfig = {
  url: `${ASSETS}/asset/direct.mp3`,
  baseUrl: `${ASSETS}/v1`,
  key: 'harness',
  model: 'whisper-1',
  lang: 'en',
};

document.querySelectorAll<HTMLButtonElement>('button[data-run]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const which = btn.dataset.run!;
    try {
      if (which === 'direct') await runDirect(DEFAULTS);
      else if (which === 'chunkedA') await runChunked({ ...DEFAULTS, url: `${ASSETS}/asset/case-a.wav` });
      else if (which === 'chunkedB') await runChunked({ ...DEFAULTS, url: `${ASSETS}/asset/case-b.wav` });
      else if (which === 'player') await runPlayer(DEFAULTS);
      else if (which === 'align') await runAlign();
      else if (which === 'sample') await runSampleDoor(DEFAULTS.url);
    } catch (err) {
      status('failed');
      show({ error: String(err) });
    }
  });
});

status('ready');
