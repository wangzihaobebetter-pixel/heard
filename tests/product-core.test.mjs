import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const TMP = '.tmp-product-tests';
await rm(TMP, { recursive: true, force: true });
await mkdir(TMP, { recursive: true });
after(async () => { await rm(TMP, { recursive: true, force: true }); });

const localValues = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => localValues.get(String(key)) ?? null,
    setItem: (key, value) => localValues.set(String(key), String(value)),
    removeItem: (key) => localValues.delete(String(key)),
    clear: () => localValues.clear(),
  },
});

async function bundle(name, contents) {
  const outfile = `${TMP}/${name}.mjs`;
  await build({
    stdin: { contents, resolveDir: process.cwd(), sourcefile: `${name}.ts` },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    logLevel: 'silent',
  });
  return import(`${pathToFileURL(`${process.cwd()}/${outfile}`).href}?v=${Date.now()}-${Math.random()}`);
}

const formats = await bundle('formats', `
  export { renderMarkdown } from './src/export/formats.ts';
`);
const transcription = await bundle('transcription', `
  export { transcribeChunks, transcribeOnce } from './src/audio/transcribe.ts';
`);
const artifactsModule = await bundle('artifacts', `
  export { generateArtifacts } from './src/ai/artifacts.ts';
  export { useStore } from './src/store/index.ts';
`);
const intakePolicyModule = await bundle('intake-policy', `
  import * as intake from './src/audio/intake.ts';
  export { intake };
`);

function interview(overrides = {}) {
  return {
    id: 'iv_test',
    title: 'Trustworthy notes',
    createdAt: 1_700_000_000_000,
    recordedAt: 1_700_000_000_000,
    durationSec: 180,
    file: { name: 'talk.wav', size: 100, type: 'audio/wav', kept: true },
    lang: 'en',
    status: 'ready',
    ...overrides,
  };
}

function citation(s, quote) {
  return { quote, wi: Math.round(s), wj: Math.round(s) + 1, s, e: s + 0.5, corrob: 1 };
}

test('markdown preserves citation marker identity when a middle citation cannot be verified', () => {
  const markdown = formats.renderMarkdown({
    interview: interview(),
    notes: [],
    artifacts: {
      summary: {
        text: 'First claim[1]. Unsupported claim[2]. Third claim[3].',
        citations: [citation(1, 'first'), null, citation(3, 'third')],
      },
      chapters: [], concepts: [], flags: [],
    },
  });

  assert.match(markdown, /^\[1\]: 0:01 "first"$/m);
  assert.doesNotMatch(markdown, /^\[2\]:/m);
  assert.match(markdown, /^\[3\]: 0:03 "third"$/m);
});

test('an unpinned note export never presents an exact timecode as proven', () => {
  const markdown = formats.renderMarkdown({
    interview: interview(),
    notes: [{
      id: 'n_unpinned', kind: 'point', text: 'A model claim that could not be aligned',
      anchor: { s: 123, e: 124, quality: 'unpinned' },
      heard: false, createdAt: 1, updatedAt: 1,
    }],
    artifacts: null,
  });

  assert.match(markdown, /\[unlocated\]/);
  assert.doesNotMatch(markdown, /\[2:03\]/);
});

test('AI artifacts fail closed when the summary has claims but no verified citation', async () => {
  const { useStore, generateArtifacts } = artifactsModule;
  const words = Array.from({ length: 50 }, (_, i) => ({ i, t: `word${i}`, s: i, e: i + 0.5 }));
  useStore.setState({
    settings: {
      stt: { preset: 'openai', baseUrl: 'https://stt.invalid/v1', key: '', model: 'whisper-1', vocabulary: '' },
      llm: { preset: 'openai', baseUrl: 'https://llm.invalid/v1', key: '[REDACTED]', model: 'mock' },
      ui: { lang: 'en', theme: 'paper', keepAudio: true, speed: 1 },
    },
    interviews: { iv_test: interview() },
    transcripts: { iv_test: {
      lang: 'en', words,
      segments: [{ s: 0, e: 50, wi: 0, wj: 50 }],
      heardSec: 50, durationSec: 50,
      chunks: [{ i: 0, s: 0, e: 50, state: 'done' }],
    } },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      summary: { text: 'Unsupported claim with no citation.', citations: [] },
      chapters: [], concepts: [], flags: [],
    }) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await generateArtifacts('iv_test');
    assert.deepEqual(result, { ok: false, reason: 'failed' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI artifacts fail closed when any numbered summary citation cannot be verified', async () => {
  const { useStore, generateArtifacts } = artifactsModule;
  const words = Array.from({ length: 50 }, (_, i) => ({ i, t: `word${i}`, s: i, e: i + 0.5 }));
  useStore.setState({
    settings: {
      stt: { preset: 'openai', baseUrl: 'https://stt.invalid/v1', key: '', model: 'whisper-1', vocabulary: '' },
      llm: { preset: 'openai', baseUrl: 'https://llm.invalid/v1', key: '[REDACTED]', model: 'mock' },
      ui: { lang: 'en', theme: 'paper', keepAudio: true, speed: 1 },
    },
    interviews: { iv_test: interview() },
    transcripts: { iv_test: {
      lang: 'en', words,
      segments: [{ s: 0, e: 50, wi: 0, wj: 50 }],
      heardSec: 50, durationSec: 50,
      chunks: [{ i: 0, s: 0, e: 50, state: 'done' }],
    } },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      summary: {
        text: 'Supported claim[1]. Unsupported claim[2].',
        citations: ['word0 word1 word2 word3 word4 word5', 'words that never occur in the tape'],
      },
      chapters: [], concepts: [], flags: [],
    }) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await generateArtifacts('iv_test');
    assert.deepEqual(result, { ok: false, reason: 'failed' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI artifacts reject non-canonical citation marker identity', async () => {
  const { useStore, generateArtifacts } = artifactsModule;
  const words = Array.from({ length: 50 }, (_, i) => ({ i, t: `word${i}`, s: i, e: i + 0.5 }));
  useStore.setState({
    settings: {
      stt: { preset: 'openai', baseUrl: 'https://stt.invalid/v1', key: '', model: 'whisper-1', vocabulary: '' },
      llm: { preset: 'openai', baseUrl: 'https://llm.invalid/v1', key: '[REDACTED]', model: 'mock' },
      ui: { lang: 'en', theme: 'paper', keepAudio: true, speed: 1 },
    },
    interviews: { iv_test: interview() },
    transcripts: { iv_test: {
      lang: 'en', words,
      segments: [{ s: 0, e: 50, wi: 0, wj: 50 }],
      heardSec: 50, durationSec: 50,
      chunks: [{ i: 0, s: 0, e: 50, state: 'done' }],
    } },
  });
  const quote = 'word0 word1 word2 word3 word4 word5';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      summary: { text: 'A valid quote under a non-canonical marker[01].', citations: [quote] },
      chapters: [], concepts: [], flags: [],
    }) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await generateArtifacts('iv_test');
    assert.deepEqual(result, { ok: false, reason: 'failed' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chunk retry reuses completed transcript chunks and requests only failed chunks', async () => {
  const chunks = [0, 1].map((i) => ({
    i,
    startSample: i * 10,
    endSample: (i + 1) * 10,
    startSec: i * 10,
    endSec: (i + 1) * 10,
    durationSec: 10,
    wav: new Blob([new Uint8Array([i + 1])], { type: 'audio/wav' }),
  }));
  const previous = {
    lang: 'en',
    words: [{ i: 0, t: 'already', s: 1, e: 2 }],
    segments: [{ s: 0, e: 10, wi: 0, wj: 1 }],
    heardSec: 10,
    durationSec: 20,
    chunks: [
      { i: 0, s: 0, e: 10, state: 'done' },
      { i: 1, s: 10, e: 20, state: 'failed' },
    ],
  };

  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({
      language: 'en', duration: 10,
      words: [{ word: 'retried', start: 1, end: 2 }],
      segments: [{ start: 0, end: 10 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await transcription.transcribeChunks(
      chunks,
      { baseUrl: 'https://stt.invalid/v1', key: '[REDACTED]', model: 'mock', lang: 'en' },
      { previous },
    );
    assert.equal(requests, 1);
    assert.deepEqual(result.words.map((w) => w.t), ['already', 'retried']);
    assert.deepEqual(result.chunks.map((c) => c.state), ['done', 'done']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chunk transcription reports offline when no chunk can reach the provider', async () => {
  const chunks = [{
    i: 0,
    startSample: 0,
    endSample: 10,
    startSec: 0,
    endSec: 10,
    durationSec: 10,
    wav: new Blob([new Uint8Array([1])], { type: 'audio/wav' }),
  }];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('network unavailable'); };
  try {
    await assert.rejects(
      () => transcription.transcribeChunks(
        chunks,
        { baseUrl: 'https://stt.invalid/v1', key: '[REDACTED]', model: 'mock', lang: 'en' },
      ),
      (error) => error?.code === 'offline',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider throttling is retryable infrastructure failure, not broken audio', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('rate limited', {
    status: 429,
    headers: { 'retry-after': '0.001' },
  });
  try {
    await assert.rejects(
      () => transcription.transcribeOnce(
        new Blob([new Uint8Array([1])], { type: 'audio/wav' }),
        'recording.wav',
        { baseUrl: 'https://stt.invalid/v1', key: '[REDACTED]', model: 'mock', lang: 'en' },
      ),
      (error) => error?.code === 'providerFailed',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider HTTP rejection is not classified as broken audio', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('endpoint rejected this request', { status: 400 });
  try {
    await assert.rejects(
      () => transcription.transcribeOnce(
        new Blob([new Uint8Array([1])], { type: 'audio/wav' }),
        'recording.wav',
        { baseUrl: 'https://stt.invalid/v1', key: '[REDACTED]', model: 'mock', lang: 'en' },
      ),
      (error) => error?.code === 'providerFailed',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('intake retries partial work explicitly while failed audio stays terminal', () => {
  const policy = intakePolicyModule.intake.shouldRunIntake;
  assert.equal(typeof policy, 'function', 'intake must expose the policy used by both auto-run and Retry');
  assert.equal(policy('listening', 'auto'), true);
  assert.equal(policy('waiting', 'auto'), true);
  assert.equal(policy('partial', 'auto'), false);
  assert.equal(policy('failed', 'auto'), false);
  assert.equal(policy('partial', 'explicit'), true);
  assert.equal(policy('failed', 'explicit'), false);
  assert.equal(policy('ready', 'explicit'), false);
  assert.equal(policy('reading', 'explicit'), false);
});

test('service-worker activation deletes only Heard caches', async () => {
  const source = await readFile('public/sw.js', 'utf8');
  const handlers = {};
  const deleted = [];
  const context = {
    URL,
    fetch: async () => new Response(''),
    caches: {
      keys: async () => ['heard-old', 'other-product-cache', 'heard-__BUILD_ID__'],
      delete: async (key) => { deleted.push(key); return true; },
      open: async () => ({ addAll: async () => {}, match: async () => null, put: async () => {} }),
      match: async () => null,
    },
    self: {
      location: { origin: 'https://example.test' },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
      addEventListener: (type, fn) => { handlers[type] = fn; },
    },
  };
  vm.runInNewContext(source, context);
  let activation;
  handlers.activate({ waitUntil(promise) { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ['heard-old']);
});
