#!/usr/bin/env node
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { findChrome } from './scripts/find-chrome.mjs';

const require = createRequire(import.meta.url);
const puppeteerModule = require('puppeteer-core');
const puppeteer = puppeteerModule.default ?? puppeteerModule;
const APP = (process.env.HEARD_URL || 'http://127.0.0.1:5180').replace(/\/+$/, '');
const CHROME = findChrome();
const profile = mkdtempSync(join(tmpdir(), 'heard-notes-retry-'));
let chats = 0;

const server = createServer(async (req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors); res.end(); return;
  }
  const body = [];
  for await (const chunk of req) body.push(Buffer.from(chunk));
  if (req.url?.endsWith('/chat/completions')) {
    chats += 1;
    const content = JSON.stringify({
      points: [{
        text: 'The room knew nobody had done this before.',
        quote: 'Nobody in that room had done it before, and everybody in that room knew it.',
      }],
      quotable: [],
    });
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    return;
  }
  res.writeHead(404, cors); res.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const provider = `http://127.0.0.1:${address.port}/v1`;
let browser;
let passed = false;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    userDataDir: profile,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${APP}/#/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__heardDev?.store?.persist?.hasHydrated?.(), { timeout: 15000 });
  const id = await page.evaluate(async (baseUrl) => {
    const dev = window.__heardDev;
    const interviewId = await dev.seed('fx-demo');
    const store = dev.store.getState();
    store.updateInterview(interviewId, { sample: false, starter: false });
    store.setNotes(interviewId, []);
    store.setSettings({
      llm: { preset: 'custom', baseUrl, key: '[REDACTED]', model: 'mock-notes' },
    });
    return interviewId;
  }, provider);
  await page.evaluate((interviewId) => { location.hash = `#/i/${interviewId}`; }, id);
  await page.waitForSelector(`[data-screen="interview"][data-interview-id="${id}"]`, { timeout: 15000 });

  const button = await page.$('[data-testid="retry-notes"]');
  if (button) {
    await button.click();
    await page.waitForFunction(
      (interviewId) => (window.__heardDev.store.getState().notes[interviewId] ?? []).length > 0,
      { timeout: 15000 },
      id,
    );
    const result = await page.evaluate((interviewId) => ({
      status: window.__heardDev.store.getState().interviews[interviewId]?.status,
      notes: (window.__heardDev.store.getState().notes[interviewId] ?? []).length,
      buttonGone: !document.querySelector('[data-testid="retry-notes"]'),
    }), id);
    passed = chats === 1 && result.status === 'ready' && result.notes > 0 && result.buttonGone;
    console.log(`${passed ? '✓' : '✗'} retry empty generated notes — chats=${chats} · ${JSON.stringify(result)}`);
  } else {
    console.log('✗ retry empty generated notes — retry action is missing');
  }
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(profile, { recursive: true, force: true });
}
process.exitCode = passed ? 0 : 1;
