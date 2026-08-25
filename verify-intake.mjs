#!/usr/bin/env node
/**
 * Reusable browser-level verifier for Heard intake closure.
 *
 * Defaults:
 *   HEARD_APP_URL=http://127.0.0.1:5180
 *   HEARD_REPO=<repository root>
 *   HEARD_INTAKE_JSON=/tmp/heard-intake-e2e.json
 *   HEARD_INTAKE_WAV=/tmp/heard-intake-e2e.wav
 *
 * Exit codes:
 *   0 = both desired closure assertions are green
 *   1 = the tracer ran to completion and at least one closure assertion failed
 *   2 = setup/execution/cleanup failed
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import {
  existsSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { findChrome } from './scripts/find-chrome.mjs';

const REPO = process.env.HEARD_REPO || process.cwd();
const APP_URL = (process.env.HEARD_APP_URL || process.env.HEARD_URL || 'http://127.0.0.1:5180').replace(/\/+$/, '');
const JSON_PATH = process.env.HEARD_INTAKE_JSON || '/tmp/heard-intake-e2e.json';
const WAV_PATH = process.env.HEARD_INTAKE_WAV || '/tmp/heard-intake-e2e.wav';
const QUIET_MS = Number(process.env.HEARD_INTAKE_QUIET_MS || 2000);
const NAV_TIMEOUT = Number(process.env.HEARD_INTAKE_TIMEOUT_MS || 30000);
const PROFILE_PREFIX = join(tmpdir(), 'heard-intake-profile-');

const requireFromRepo = createRequire(join(REPO, 'package.json'));
const puppeteerModule = requireFromRepo('puppeteer-core');
const puppeteer = puppeteerModule.default ?? puppeteerModule;

const CHROME = findChrome();

const FAKE = Object.freeze({
  aStt: 'fake-stt-a',
  bStt: 'fake-stt-b',
  bLlm: 'fake-llm-b',
  cStt: 'fake-stt-c',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorInfo(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error && error.stack
      ? error.stack.split('\n').slice(0, 12)
      : [],
  };
}

function generateWav(filePath, { seconds = 2, sampleRate = 16000, frequency = 440 } = {}) {
  const samples = Math.round(seconds * sampleRate);
  const dataBytes = samples * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i += 1) {
    const envelope = Math.min(1, i / 400, (samples - i) / 400);
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.12 * envelope * 32767);
    wav.writeInt16LE(sample, 44 + i * 2);
  }
  writeFileSync(filePath, wav);
  return { path: filePath, filename: basename(filePath), bytes: wav.length, seconds, sampleRate };
}

function multipartField(text, name) {
  const marker = `name="${name}"`;
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const valueAt = text.indexOf('\r\n\r\n', at);
  if (valueAt < 0) return null;
  const end = text.indexOf('\r\n', valueAt + 4);
  if (end < 0) return null;
  return text.slice(valueAt + 4, end);
}

function scenarioFromPath(pathname) {
  if (pathname.startsWith('/case-a/')) return 'A';
  if (pathname.startsWith('/case-b/')) return 'B';
  if (pathname.startsWith('/case-c/')) return 'C';
  return 'unknown';
}

function expectedBearer(scenario, endpoint) {
  if (scenario === 'A' && endpoint === 'stt') return `Bearer ${FAKE.aStt}`;
  if (scenario === 'B' && endpoint === 'stt') return `Bearer ${FAKE.bStt}`;
  if (scenario === 'B' && endpoint === 'chat') return `Bearer ${FAKE.bLlm}`;
  if (scenario === 'C' && endpoint === 'stt') return `Bearer ${FAKE.cStt}`;
  return null;
}

function sttPayload(kind) {
  if (kind === 'key-probe') {
    return {
      language: 'en',
      duration: 1,
      text: 'probe',
      words: [{ word: 'probe', start: 0.1, end: 0.35 }],
      segments: [{ start: 0, end: 1 }],
    };
  }

  const seed = (
    'Heard intake closure tracer proves browser transcription and notes generation ' +
    'from the real uploaded recording with deterministic fake provider words for ' +
    'this reusable end to end regression test'
  ).split(/\s+/);
  const tokens = Array.from({ length: 60 }, (_, index) => seed[index % seed.length]);
  const words = tokens.map((word, index) => ({
    word,
    start: +(0.02 + index * 0.032).toFixed(3),
    end: +(0.045 + index * 0.032).toFixed(3),
  }));
  return {
    language: 'en',
    duration: 2,
    text: tokens.join(' '),
    words,
    segments: [{ start: 0, end: 2 }],
  };
}

function chatPayload() {
  const quote = 'Heard intake closure tracer proves browser transcription and notes generation';
  const content = JSON.stringify({
    points: [{ text: 'The real browser intake reached the notes provider.', quote }],
    quotable: [{ quote }],
    summary: { text: 'The intake closure completed.[1]', citations: [quote] },
    chapters: [{ title: 'Intake closure', quote }],
    concepts: [{ term: 'closure', definition: 'The end-to-end intake path.', quote }],
    flags: [],
  });
  return {
    id: 'chatcmpl-heard-red-tracer',
    object: 'chat.completion',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  };
}

async function startMockProvider() {
  const posts = [];
  const preflights = [];
  let sequence = 0;
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const scenario = scenarioFromPath(url.pathname);

    if (request.method === 'OPTIONS') {
      preflights.push({ scenario, path: url.pathname });
      response.writeHead(204, cors);
      response.end();
      return;
    }

    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const auth = request.headers.authorization || '';

    if (request.method === 'POST' && url.pathname.endsWith('/audio/transcriptions')) {
      const bodyText = body.toString('latin1');
      const filename = /filename="([^"]+)"/.exec(bodyText)?.[1] ?? null;
      const kind = filename === 'test.wav' ? 'key-probe' : 'audio-upload';
      const acceptedFakeCredential = auth === expectedBearer(scenario, 'stt');
      posts.push({
        sequence: ++sequence,
        scenario,
        endpoint: 'audio/transcriptions',
        kind,
        filename,
        model: multipartField(bodyText, 'model'),
        acceptedFakeCredential,
      });
      if (!acceptedFakeCredential) {
        response.writeHead(401, { ...cors, 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Tracer accepts fake credentials only.' } }));
        return;
      }
      if (scenario === 'C' && kind === 'audio-upload') {
        response.writeHead(503, {
          ...cors,
          'content-type': 'application/json',
          'retry-after': '0.001',
        });
        response.end(JSON.stringify({ error: { message: 'Temporary mock outage.' } }));
        return;
      }
      response.writeHead(200, { ...cors, 'content-type': 'application/json' });
      response.end(JSON.stringify(sttPayload(kind)));
      return;
    }

    if (request.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
      let parsed = {};
      try { parsed = JSON.parse(body.toString('utf8')); } catch { /* retained as empty */ }
      const acceptedFakeCredential = auth === expectedBearer(scenario, 'chat');
      posts.push({
        sequence: ++sequence,
        scenario,
        endpoint: 'chat/completions',
        kind: parsed?.max_tokens === 1 ? 'key-probe' : 'notes-generation',
        filename: null,
        model: typeof parsed?.model === 'string' ? parsed.model : null,
        acceptedFakeCredential,
      });
      if (!acceptedFakeCredential) {
        response.writeHead(401, { ...cors, 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Tracer accepts fake credentials only.' } }));
        return;
      }
      response.writeHead(200, { ...cors, 'content-type': 'application/json' });
      response.end(JSON.stringify(chatPayload()));
      return;
    }

    response.writeHead(404, { ...cors, 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `No mock route for ${request.method} ${url.pathname}` } }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock provider did not bind a TCP port');
  return { server, origin: `http://127.0.0.1:${address.port}`, posts, preflights };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

async function idbValue(page, key) {
  return page.evaluate(async (wantedKey) => {
    const fromIdb = await new Promise((resolve, reject) => {
      const open = indexedDB.open('keyval-store');
      open.onerror = () => reject(open.error || new Error('IndexedDB open failed'));
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('keyval')) {
          db.close();
          resolve(null);
          return;
        }
        const tx = db.transaction('keyval', 'readonly');
        const get = tx.objectStore('keyval').get(wantedKey);
        get.onerror = () => reject(get.error || new Error('IndexedDB get failed'));
        get.onsuccess = () => {
          const value = get.result ?? null;
          tx.oncomplete = () => { db.close(); resolve(value); };
        };
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      };
    }).catch(() => null);
    if (fromIdb !== null) return fromIdb;
    try { return localStorage.getItem(wantedKey); } catch { return null; }
  }, key);
}

async function persistedSnapshot(page, interviewId = null) {
  const raw = await idbValue(page, 'heard-v1');
  return page.evaluate((stored, wantedId) => {
    let envelope = stored;
    if (typeof envelope === 'string') {
      try { envelope = JSON.parse(envelope); } catch { return { present: true, parseError: true }; }
    }
    const state = envelope?.state ?? envelope;
    if (!state || typeof state !== 'object') return { present: false };
    const interview = wantedId ? state.interviews?.[wantedId] ?? null : null;
    const transcript = wantedId ? state.transcripts?.[wantedId] ?? null : null;
    const notes = wantedId ? state.notes?.[wantedId] ?? [] : [];
    return {
      present: true,
      settings: state.settings ? {
        stt: {
          preset: state.settings.stt?.preset,
          baseUrl: state.settings.stt?.baseUrl,
          key: state.settings.stt?.key,
          model: state.settings.stt?.model,
        },
        llm: {
          preset: state.settings.llm?.preset,
          baseUrl: state.settings.llm?.baseUrl,
          key: state.settings.llm?.key,
          model: state.settings.llm?.model,
        },
        ui: {
          theme: state.settings.ui?.theme,
          lang: state.settings.ui?.lang,
          keepAudio: state.settings.ui?.keepAudio,
        },
      } : null,
      interview: interview ? {
        id: interview.id,
        title: interview.title,
        status: interview.status,
        file: interview.file,
        durationSec: interview.durationSec,
      } : null,
      transcript: transcript ? {
        lang: transcript.lang,
        words: Array.isArray(transcript.words) ? transcript.words.length : 0,
        chunks: Array.isArray(transcript.chunks) ? transcript.chunks.map((chunk) => chunk.state) : [],
        heardSec: transcript.heardSec,
        durationSec: transcript.durationSec,
      } : null,
      notes: Array.isArray(notes) ? notes.length : 0,
    };
  }, raw, interviewId);
}

async function audioSnapshot(page, interviewId) {
  const value = await idbValue(page, `audio:${interviewId}`);
  return page.evaluate((stored) => {
    if (!stored) return { present: false, bytes: 0, type: null };
    return {
      present: true,
      bytes: typeof stored.size === 'number' ? stored.size : 0,
      type: typeof stored.type === 'string' ? stored.type : null,
    };
  }, value);
}

async function pollSnapshot(page, predicate, label, { interviewId = null, timeout = NAV_TIMEOUT } = {}) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await persistedSnapshot(page, interviewId);
    if (predicate(last)) return last;
    await sleep(60);
  }
  throw new Error(`${label} timed out; last snapshot: ${JSON.stringify(last)}`);
}

async function gotoScreen(page, hash, screen) {
  await page.goto(`${APP_URL}/${hash}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.waitForSelector(`[data-screen="${screen}"]`, { timeout: NAV_TIMEOUT });
}

async function navigateHash(page, hash, screen) {
  await page.evaluate((nextHash) => { window.location.hash = nextHash; }, hash);
  await page.waitForSelector(`[data-screen="${screen}"]`, { timeout: NAV_TIMEOUT });
}

async function hydrationFence(page) {
  const ink = '[data-section="theme"] [data-value="ink"]';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.waitForSelector(ink, { timeout: NAV_TIMEOUT });
    const selected = await page.$eval(ink, (el) => el.getAttribute('aria-checked') === 'true');
    if (!selected) await page.click(ink);
    await pollSnapshot(
      page,
      (snapshot) => snapshot.settings?.ui?.theme === 'ink',
      `hydration fence write (attempt ${attempt})`,
    );

    await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForSelector('[data-screen="settings"]', { timeout: NAV_TIMEOUT });
    try {
      await page.waitForFunction(
        (selector) => document.querySelector(selector)?.getAttribute('aria-checked') === 'true',
        { timeout: 6000 },
        ink,
      );
      const stable = await persistedSnapshot(page);
      if (stable.settings?.ui?.theme === 'ink') return { attempts: attempt, persistedTheme: 'ink' };
    } catch {
      // A click that raced hydration does not survive the reload; retry after it.
    }
  }
  throw new Error('Could not establish a persisted UI round trip after hydration');
}

async function replaceInput(page, selector, value) {
  const input = await page.waitForSelector(selector, { timeout: NAV_TIMEOUT });
  // Use the browser's native value setter and the same bubbling input/change
  // events React receives from typing. This stays on the production form seam
  // while avoiding platform-specific Meta-vs-Control selection behavior.
  await input.evaluate((element, nextValue) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('HTMLInputElement value setter is unavailable');
    setter.call(element, nextValue);
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: nextValue,
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForFunction(
    (inputSelector, expected) => document.querySelector(inputSelector)?.value === expected,
    { timeout: 5000 },
    selector,
    value,
  );
}

async function configureProvider(page, { section, prefix, baseUrl, key, model }) {
  const root = `[data-section="${section}"]`;
  const open = await page.$eval(root, (el) => el instanceof HTMLDetailsElement && el.open);
  if (!open) await page.click(`${root} > summary`);
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.hasAttribute('open'),
    { timeout: 5000 },
    root,
  );
  const custom = `${root} [data-preset="custom"]`;
  await page.click(custom);
  await page.waitForFunction(
    (selector) => document.querySelector(selector)?.getAttribute('aria-checked') === 'true',
    { timeout: 5000 },
    custom,
  );
  const disclosure = `${root} .keyfield__disclosure`;
  const expanded = await page.$eval(disclosure, (el) => el.getAttribute('aria-expanded') === 'true');
  if (!expanded) await page.click(disclosure);
  await page.waitForSelector(`[data-testid="${prefix}-base"]`, { timeout: 5000 });
  await replaceInput(page, `[data-testid="${prefix}-base"]`, baseUrl);
  await replaceInput(page, `[data-testid="${prefix}-model"]`, model);
  await replaceInput(page, `[data-testid="${prefix}-key"]`, key);
}

async function chooseWav(page, title, keepAudio) {
  const fileInput = await page.waitForSelector('[data-testid="file-input"]', { timeout: NAV_TIMEOUT });
  await fileInput.uploadFile(WAV_PATH);
  await page.waitForSelector('[data-testid="bring-file"]', { timeout: NAV_TIMEOUT });
  await replaceInput(page, '[data-testid="bring-title"]', title);

  const toggle = '#bring-keep';
  const current = await page.$eval(toggle, (el) => el.getAttribute('aria-checked') === 'true');
  if (current !== keepAudio) await page.click(toggle);
  await page.waitForFunction(
    (selector, expected) => (document.querySelector(selector)?.getAttribute('aria-checked') === 'true') === expected,
    { timeout: 5000 },
    toggle,
    keepAudio,
  );
  await pollSnapshot(
    page,
    (snapshot) => snapshot.settings?.ui?.keepAudio === keepAudio,
    `keepAudio=${keepAudio} persistence`,
  );
}

async function submitAndObserve(page) {
  await page.waitForFunction(
    () => {
      const button = document.querySelector('[data-testid="bring-listen"]');
      return button && !button.disabled;
    },
    { timeout: NAV_TIMEOUT },
  );
  await page.click('[data-testid="bring-listen"]');
  const interviewSelector = 'main[data-screen="interview"][data-interview-id]';
  await page.waitForSelector(interviewSelector, { timeout: NAV_TIMEOUT });
  const interviewId = await page.$eval(interviewSelector, (el) => el.getAttribute('data-interview-id'));
  if (!interviewId) throw new Error('Interview route did not expose data-interview-id');

  const terminalStatuses = new Set(['ready', 'partial', 'failed', 'waiting']);
  await page.waitForFunction(
    (statuses, selector) => statuses.includes(document.querySelector(selector)?.getAttribute('data-status')),
    { timeout: NAV_TIMEOUT },
    [...terminalStatuses],
    interviewSelector,
  );
  const snapshot = await pollSnapshot(
    page,
    (candidate) => terminalStatuses.has(candidate.interview?.status),
    `terminal intake status for ${interviewId}`,
    { interviewId },
  );
  return { interviewId, snapshot };
}

function attachDiagnostics(page) {
  const diagnostics = { pageErrors: [], consoleErrors: [], failedRequests: [] };
  page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.startsWith(APP_URL)) diagnostics.failedRequests.push({ url, error: request.failure()?.errorText ?? null });
  });
  return diagnostics;
}

async function withScenario(browser, run) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.setCacheEnabled(false);
  try {
    const value = await run(page);
    return { ...value, diagnostics };
  } finally {
    await context.close();
  }
}

function postsFor(mock, scenario) {
  return mock.posts
    .filter((post) => post.scenario === scenario)
    .map((post) => ({ ...post }));
}

function allTrue(assertions) {
  return Object.values(assertions).every((value) => value === true);
}

async function runCaseA(browser, mock) {
  const sttBase = `${mock.origin}/case-a/v1`;
  const driven = await withScenario(browser, async (page) => {
    await gotoScreen(page, '#/settings', 'settings');
    const hydration = await hydrationFence(page);
    await configureProvider(page, {
      section: 'transcription', prefix: 'stt', baseUrl: sttBase, key: FAKE.aStt, model: 'mock-stt-a',
    });
    await pollSnapshot(
      page,
      (snapshot) => snapshot.settings?.stt?.baseUrl === sttBase
        && snapshot.settings?.stt?.key === FAKE.aStt
        && snapshot.settings?.stt?.model === 'mock-stt-a',
      'case A fake STT settings persistence',
    );
    await navigateHash(page, '#/add', 'bring');
    await chooseWav(page, 'RED A keepAudio false', false);
    const terminal = await submitAndObserve(page);
    await sleep(400);
    const snapshot = await persistedSnapshot(page, terminal.interviewId);
    const audio = await audioSnapshot(page, terminal.interviewId);
    const dom = await page.$eval('main[data-screen="interview"][data-interview-id]', (el) => ({
      status: el.getAttribute('data-status'),
      interviewId: el.getAttribute('data-interview-id'),
      hash: window.location.hash,
      notesTab: document.querySelector('[data-testid="tab-notes"]')?.textContent?.trim() ?? null,
    }));
    return { hydration, interviewId: terminal.interviewId, snapshot, audio, dom };
  });

  const providerPosts = postsFor(mock, 'A');
  const sttPosts = providerPosts.filter((post) => post.endpoint === 'audio/transcriptions');
  const probes = sttPosts.filter((post) => post.kind === 'key-probe');
  const uploads = sttPosts.filter((post) => post.kind === 'audio-upload');
  const chats = providerPosts.filter((post) => post.endpoint === 'chat/completions');
  const observed = {
    keepAudio: driven.snapshot.settings?.ui?.keepAudio ?? null,
    interviewStatus: driven.snapshot.interview?.status ?? null,
    transcriptWords: driven.snapshot.transcript?.words ?? 0,
    notes: driven.snapshot.notes ?? 0,
    audioBlobPresent: driven.audio.present,
    sttPosts: sttPosts.length,
    keyProbes: probes.length,
    audioUploads: uploads.length,
    chatPosts: chats.length,
  };
  const observedAssertions = {
    keepAudioFalse: observed.keepAudio === false,
    exactlyOneSttPost: observed.sttPosts === 1,
    onlyKeyProbeSent: observed.keyProbes === 1 && observed.audioUploads === 0,
    endedFailed: observed.interviewStatus === 'failed',
    noTranscriptWords: observed.transcriptWords === 0,
    noAudioBlobPersisted: observed.audioBlobPresent === false,
    fakeCredentialAccepted: sttPosts.length > 0 && sttPosts.every((post) => post.acceptedFakeCredential),
  };
  const desiredClosureAssertions = {
    realAudioSubmittedForTranscription: observed.audioUploads >= 1,
    interviewReady: observed.interviewStatus === 'ready',
    transcriptHasWords: observed.transcriptWords > 0,
  };
  return {
    name: 'A_keepAudio_false_must_still_transcribe',
    uiPath: '#/settings -> #/add -> real file input -> Listen once -> #/i/:id',
    interviewId: driven.interviewId,
    hydrationFence: driven.hydration,
    observed,
    providerPosts,
    preflightCount: mock.preflights.filter((item) => item.scenario === 'A').length,
    dom: driven.dom,
    diagnostics: driven.diagnostics,
    observedAssertions,
    bugReproduced: allTrue(observedAssertions),
    desiredClosureAssertions,
    closurePassed: allTrue(desiredClosureAssertions),
    failed: !allTrue(desiredClosureAssertions),
  };
}

async function runCaseB(browser, mock) {
  const baseUrl = `${mock.origin}/case-b/v1`;
  const driven = await withScenario(browser, async (page) => {
    await gotoScreen(page, '#/settings', 'settings');
    const hydration = await hydrationFence(page);
    await configureProvider(page, {
      section: 'transcription', prefix: 'stt', baseUrl, key: FAKE.bStt, model: 'mock-stt-b',
    });
    await configureProvider(page, {
      section: 'notes', prefix: 'llm', baseUrl, key: FAKE.bLlm, model: 'mock-llm-b',
    });
    await pollSnapshot(
      page,
      (snapshot) => snapshot.settings?.stt?.baseUrl === baseUrl
        && snapshot.settings?.stt?.key === FAKE.bStt
        && snapshot.settings?.stt?.model === 'mock-stt-b'
        && snapshot.settings?.llm?.baseUrl === baseUrl
        && snapshot.settings?.llm?.key === FAKE.bLlm
        && snapshot.settings?.llm?.model === 'mock-llm-b',
      'case B fake STT + LLM settings persistence',
    );
    await navigateHash(page, '#/add', 'bring');
    await chooseWav(page, 'RED B notes closure', true);
    const terminal = await submitAndObserve(page);
    await sleep(QUIET_MS);
    const snapshot = await persistedSnapshot(page, terminal.interviewId);
    const audio = await audioSnapshot(page, terminal.interviewId);
    const dom = await page.$eval('main[data-screen="interview"][data-interview-id]', (el) => ({
      status: el.getAttribute('data-status'),
      interviewId: el.getAttribute('data-interview-id'),
      hash: window.location.hash,
      notesTab: document.querySelector('[data-testid="tab-notes"]')?.textContent?.trim() ?? null,
    }));
    return { hydration, interviewId: terminal.interviewId, snapshot, audio, dom };
  });

  const providerPosts = postsFor(mock, 'B');
  const sttPosts = providerPosts.filter((post) => post.endpoint === 'audio/transcriptions');
  const probes = sttPosts.filter((post) => post.kind === 'key-probe');
  const uploads = sttPosts.filter((post) => post.kind === 'audio-upload');
  const chats = providerPosts.filter((post) => post.endpoint === 'chat/completions');
  const observed = {
    keepAudio: driven.snapshot.settings?.ui?.keepAudio ?? null,
    configuredSttBaseUrl: driven.snapshot.settings?.stt?.baseUrl ?? null,
    configuredSttModel: driven.snapshot.settings?.stt?.model ?? null,
    fakeSttKeyConfigured: driven.snapshot.settings?.stt?.key === FAKE.bStt,
    configuredLlmBaseUrl: driven.snapshot.settings?.llm?.baseUrl ?? null,
    configuredLlmModel: driven.snapshot.settings?.llm?.model ?? null,
    fakeLlmKeyConfigured: driven.snapshot.settings?.llm?.key === FAKE.bLlm,
    interviewStatus: driven.snapshot.interview?.status ?? null,
    transcriptWords: driven.snapshot.transcript?.words ?? 0,
    transcriptChunks: driven.snapshot.transcript?.chunks ?? [],
    notes: driven.snapshot.notes ?? 0,
    audioBlobPresent: driven.audio.present,
    sttPosts: sttPosts.length,
    keyProbes: probes.length,
    audioUploads: uploads.length,
    chatPosts: chats.length,
    postReadyQuietMs: QUIET_MS,
  };
  const observedAssertions = {
    bothFakeProvidersConfigured: observed.configuredSttBaseUrl === baseUrl
      && observed.configuredSttModel === 'mock-stt-b'
      && observed.fakeSttKeyConfigured
      && observed.configuredLlmBaseUrl === baseUrl
      && observed.configuredLlmModel === 'mock-llm-b'
      && observed.fakeLlmKeyConfigured,
    keepAudioTrue: observed.keepAudio === true,
    keyProbeSent: observed.keyProbes === 1,
    realAudioSubmitted: observed.audioUploads === 1,
    transcriptionReady: observed.interviewStatus === 'ready',
    transcriptHasWords: observed.transcriptWords > 0,
    notesRemainZero: observed.notes === 0,
    noChatCompletionSent: observed.chatPosts === 0,
    fakeSttCredentialAccepted: sttPosts.length > 0 && sttPosts.every((post) => post.acceptedFakeCredential),
  };
  const desiredClosureAssertions = {
    transcriptionReadyWithWords: observed.interviewStatus === 'ready' && observed.transcriptWords > 0,
    notesProviderCalledAutomatically: observed.chatPosts >= 1,
    notesGenerated: observed.notes > 0,
  };
  return {
    name: 'B_ready_transcript_must_close_into_generated_notes',
    uiPath: '#/settings -> configure fake STT + LLM -> #/add -> real file input -> Listen once -> #/i/:id',
    interviewId: driven.interviewId,
    hydrationFence: driven.hydration,
    observed,
    providerPosts,
    preflightCount: mock.preflights.filter((item) => item.scenario === 'B').length,
    dom: driven.dom,
    diagnostics: driven.diagnostics,
    observedAssertions,
    bugReproduced: allTrue(observedAssertions),
    desiredClosureAssertions,
    closurePassed: allTrue(desiredClosureAssertions),
    failed: !allTrue(desiredClosureAssertions),
  };
}

async function runCaseC(browser, mock) {
  const baseUrl = `${mock.origin}/case-c/v1`;
  const driven = await withScenario(browser, async (page) => {
    await gotoScreen(page, '#/settings', 'settings');
    const hydration = await hydrationFence(page);
    await configureProvider(page, {
      section: 'transcription', prefix: 'stt', baseUrl, key: FAKE.cStt, model: 'mock-stt-c',
    });
    await pollSnapshot(
      page,
      (snapshot) => snapshot.settings?.stt?.baseUrl === baseUrl
        && snapshot.settings?.stt?.key === FAKE.cStt,
      'case C fake STT settings persistence',
    );
    await navigateHash(page, '#/add', 'bring');
    await chooseWav(page, 'C bounded provider retry', true);
    const terminal = await submitAndObserve(page);
    // The old status-dependent effect started another batch immediately after
    // waiting. Leave enough time for that regression to exceed three uploads.
    await sleep(1200);
    const snapshot = await persistedSnapshot(page, terminal.interviewId);
    const audio = await audioSnapshot(page, terminal.interviewId);
    return { hydration, interviewId: terminal.interviewId, snapshot, audio };
  });

  const providerPosts = postsFor(mock, 'C');
  const sttPosts = providerPosts.filter((post) => post.endpoint === 'audio/transcriptions');
  const probes = sttPosts.filter((post) => post.kind === 'key-probe');
  const uploads = sttPosts.filter((post) => post.kind === 'audio-upload');
  const desiredClosureAssertions = {
    keyProbeSucceededOnce: probes.length === 1,
    oneBoundedUploadBatch: uploads.length === 3,
    providerFailureWaits: driven.snapshot.interview?.status === 'waiting',
    audioRetainedForRetry: driven.audio.present === true,
    noTranscriptInvented: (driven.snapshot.transcript?.words ?? 0) === 0,
  };
  return {
    name: 'C_provider_outage_is_bounded_and_retryable',
    uiPath: '#/settings -> #/add -> real file input -> one bounded 503 retry batch',
    interviewId: driven.interviewId,
    hydrationFence: driven.hydration,
    observed: {
      status: driven.snapshot.interview?.status ?? null,
      keyProbes: probes.length,
      audioUploads: uploads.length,
      audioBlobPresent: driven.audio.present,
      transcriptWords: driven.snapshot.transcript?.words ?? 0,
      quietMs: 1200,
    },
    providerPosts,
    diagnostics: driven.diagnostics,
    desiredClosureAssertions,
    closurePassed: allTrue(desiredClosureAssertions),
    failed: !allTrue(desiredClosureAssertions),
  };
}

async function main() {
  const profileDir = mkdtempSync(PROFILE_PREFIX);
  const cleanup = {
    browserClosed: false,
    mockServerClosed: false,
    isolatedProfileRemoved: false,
    errors: [],
  };
  let browser = null;
  let mock = null;
  let result = null;
  let executionError = null;
  const generatedWav = generateWav(WAV_PATH);

  try {
    mock = await startMockProvider();
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      userDataDir: profileDir,
      protocolTimeout: NAV_TIMEOUT * 2,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--disable-default-apps',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });

    const caseA = await runCaseA(browser, mock);
    const caseB = await runCaseB(browser, mock);
    const caseC = await runCaseC(browser, mock);
    const observedFailuresProven = Number(caseA.bugReproduced) + Number(caseB.bugReproduced);
    const closureAssertionsPassed = caseA.closurePassed && caseB.closurePassed && caseC.closurePassed;
    result = {
      tracer: 'heard-intake-e2e',
      target: APP_URL,
      execution: {
        browser: CHROME,
        isolatedBrowserProfile: true,
        realUi: true,
        realFileInput: true,
        fixturesUsed: false,
        devkitUsed: false,
        mockProviderInProcess: true,
        realCredentialsUsed: false,
      },
      artifacts: {
        script: fileURLToPath(import.meta.url),
        result: JSON_PATH,
        wav: generatedWav,
      },
      caseA,
      caseB,
      caseC,
      summary: {
        observedFailuresProven,
        bothObservedFailuresProven: observedFailuresProven === 2,
        closureAssertionsPassed,
        outcome: closureAssertionsPassed ? 'PASSED' : 'FAILED',
      },
    };
  } catch (error) {
    executionError = error;
    result = {
      tracer: 'heard-intake-e2e',
      target: APP_URL,
      artifacts: {
        script: fileURLToPath(import.meta.url),
        result: JSON_PATH,
        wav: generatedWav,
      },
      executionError: errorInfo(error),
      summary: {
        observedFailuresProven: 0,
        bothObservedFailuresProven: false,
        closureAssertionsPassed: false,
        outcome: 'ERROR',
      },
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
        cleanup.browserClosed = true;
      } catch (error) {
        cleanup.errors.push({ resource: 'browser', ...errorInfo(error) });
      }
    }
    if (mock?.server) {
      try {
        await closeServer(mock.server);
        cleanup.mockServerClosed = true;
      } catch (error) {
        cleanup.errors.push({ resource: 'mockServer', ...errorInfo(error) });
      }
    }
    try {
      rmSync(profileDir, { recursive: true, force: true });
      cleanup.isolatedProfileRemoved = !existsSync(profileDir);
    } catch (error) {
      cleanup.errors.push({ resource: 'browserProfile', ...errorInfo(error) });
    }
  }

  result.cleanup = cleanup;
  const cleanupFailed = cleanup.errors.length > 0
    || !cleanup.browserClosed
    || !cleanup.mockServerClosed
    || !cleanup.isolatedProfileRemoved;
  const exitCode = executionError || cleanupFailed
    ? 2
    : result.summary.closureAssertionsPassed ? 0 : 1;
  result.summary.exitCode = exitCode;

  const json = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(JSON_PATH, json);
  if (process.env.HEARD_INTAKE_VERBOSE === '1') {
    process.stdout.write(json);
  } else {
    const mark = exitCode === 0 ? '✓' : '✗';
    console.log(`${mark} verify-intake: keep-off=${result.caseA?.closurePassed === true} · auto-notes=${result.caseB?.closurePassed === true} · bounded-retry=${result.caseC?.closurePassed === true} · cleanup=${!cleanupFailed} · evidence=${JSON_PATH}`);
  }
  process.exitCode = exitCode;
}

await main();
