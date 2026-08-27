#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { findChrome } from './scripts/find-chrome.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const BASE = process.env.HEARD_URL || 'http://127.0.0.1:5180';
const executablePath = findChrome();
const profile = mkdtempSync(join(tmpdir(), 'heard-touch-'));
const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  userDataDir: profile,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const failures = [];

function undersizedTargets(targetPage) {
  return targetPage.evaluate(() => {
    const selector = 'a[href],button,input:not([type="hidden"]):not([type="file"]),select,textarea,summary,[role="tab"]';
    return [...document.querySelectorAll(selector)]
      .filter((node) => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          testid: node.getAttribute('data-testid') ?? '',
          name: node.getAttribute('aria-label') ?? node.textContent?.replace(/\s+/g, ' ').trim().slice(0, 48) ?? '',
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        };
      })
      .filter((item) => item.width < 43.5 || item.height < 43.5);
  });
}

try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  for (const [name, hash] of [
    ['Bring', '#/add'],
    ['Settings', '#/settings'],
    ['Library', '#/'],
    ['Interview', '#/i/yale-psych110'],
  ]) {
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-screen]', { timeout: 20000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const undersized = await undersizedTargets(page);
    if (undersized.length) failures.push({ screen: name, targets: undersized });
    else console.log(`✓ ${name}: every visible target is at least 44×44`);

    if (name === 'Settings') {
      await page.click('[data-testid="stt-connection"] > summary');
      await page.click('[data-testid="stt-connection"] .keyfield__disclosure');
      const expanded = await undersizedTargets(page);
      if (expanded.length) failures.push({ screen: 'Settings expanded', targets: expanded });
      else console.log('✓ Settings expanded: provider mechanics remain at least 44×44');
    }

    if (name === 'Library') {
      await page.evaluate(async () => {
        const { useRecorder } = await import('/src/audio/recorder.ts');
        useRecorder.getState().patch({ phase: 'recording', elapsedSec: 12 });
      });
      await page.waitForSelector('[data-testid="recbar"]');
      const recordingChrome = await page.evaluate(() => ({
        recbar: !!document.querySelector('[data-testid="recbar"]'),
        appNav: !!document.querySelector('[data-testid="app-nav"]'),
      }));
      if (!recordingChrome.recbar || recordingChrome.appNav) {
        failures.push({ screen: 'Library while recording', targets: [recordingChrome] });
      } else {
        console.log('✓ Recording: RecorderBar becomes the only mobile bottom navigation');
      }
      await page.evaluate(async () => {
        const { useRecorder } = await import('/src/audio/recorder.ts');
        useRecorder.getState().patch({ phase: 'idle', elapsedSec: 0 });
      });
    }

    if (name === 'Interview') {
      await page.waitForFunction(() => document.querySelector('[data-testid="audio"]')?.readyState >= 2, { timeout: 60000 });
      await page.evaluate(() => {
        const chip = [...document.querySelectorAll('[data-testid="timecode-chip"]')]
          .find((node) => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
        if (!chip) throw new Error('no visible timecode chip');
        chip.click();
      });
      await page.waitForFunction(() => document.querySelector('[data-testid="player"]')?.getAttribute('data-height') === 'mid');
      await page.evaluate(async () => {
        document.querySelector('[data-testid="audio"]')?.pause();
        const { usePlayer } = await import('/src/store/index.ts');
        const span = usePlayer.getState().span;
        if (span) usePlayer.getState().setPlayer({ playing: false, currentTime: span.e + 0.8, span });
      });
      await page.waitForFunction(() => document.querySelector('[data-testid="player-after"]')?.getAttribute('data-shown') === 'true');
      const afterMid = await undersizedTargets(page);
      if (afterMid.length) failures.push({ screen: 'Interview receipt actions (mid)', targets: afterMid });
      else console.log('✓ Interview receipt actions: mid-sheet targets are at least 44×44');

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('[data-testid="player"]')?.getAttribute('data-height') === 'collapsed');
      const afterCollapsed = await page.evaluate(() => ({
        viewport: innerHeight,
        items: [...document.querySelectorAll('[data-testid="player-after"] button')]
          .filter((node) => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return { name: node.textContent?.trim() ?? '', height: rect.height, top: rect.top, bottom: rect.bottom };
          }),
      }));
      const hidden = afterCollapsed.items.filter((item) => item.height < 43.5 || item.top < 0 || item.bottom > afterCollapsed.viewport);
      if (hidden.length) failures.push({ screen: 'Interview receipt actions (collapsed)', targets: hidden });
      else console.log('✓ Interview receipt actions: collapsed strip stays visible and touchable');
    }
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`verify-touch: ${failures.length} screen(s) have undersized targets`);
  for (const failure of failures) console.error(`  ✗ ${failure.screen}: ${JSON.stringify(failure.targets)}`);
  process.exit(1);
}
console.log('verify-touch: four mobile surfaces meet the 44×44 target contract ✓');
