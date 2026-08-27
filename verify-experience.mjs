/**
 * Product-experience contract for Heard v4.
 *
 * Runs against the real app with an isolated browser profile. These checks pin
 * user-visible composition and interaction; source tokens are not evidence.
 */
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome } from './scripts/find-chrome.mjs';

const BASE = process.env.HEARD_URL ?? 'http://localhost:5178';
const CHROME = findChrome();
const profile = mkdtempSync(join(tmpdir(), 'heard-experience-'));
const results = [];
const ok = (name, detail = '') => results.push({ pass: true, name, detail });
const bad = (name, detail = '') => results.push({ pass: false, name, detail });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: profile,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();

try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/#/add`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-screen="bring"]', { timeout: 20000 });

  const emptyBring = await page.evaluate(() => {
    const block = document.querySelector('[data-testid="bring-key"]');
    const box = block?.getBoundingClientRect();
    const visible = !!box && box.width > 0 && box.height > 0
      && getComputedStyle(block).visibility !== 'hidden'
      && getComputedStyle(block).display !== 'none';
    return {
      keyVisible: visible,
      hasFile: !!document.querySelector('[data-testid="bring-file"]'),
      heading: document.querySelector('[data-screen="bring"] h1')?.textContent?.trim() ?? '',
      chooseVisible: !!document.querySelector('.dropzone__button'),
    };
  });

  if (!emptyBring.hasFile && !emptyBring.keyVisible && emptyBring.chooseVisible) {
    ok('1. empty Bring asks for a recording before technical connection', emptyBring.heading);
  } else {
    bad('1. empty Bring asks for a recording before technical connection',
      `file=${emptyBring.hasFile} · keyVisible=${emptyBring.keyVisible} · chooseVisible=${emptyBring.chooseVisible}`);
  }

  const bringPromise = await page.evaluate(() => {
    const value = document.querySelector('[data-testid="bring-value"]');
    const receipt = value?.querySelector('[data-testid="bring-proof-receipt"]');
    const choose = document.querySelector('.dropzone__button')?.getBoundingClientRect();
    const dock = document.querySelector('[data-testid="app-nav"]')?.getBoundingClientRect();
    const valueBox = value?.getBoundingClientRect();
    const proofBox = value?.querySelector('.bringproof')?.getBoundingClientRect();
    return {
      visible: !!value && value.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      text: value?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      receipt: receipt?.textContent?.trim() ?? '',
      chooseBeforeDock: !!choose && !!dock && choose.bottom <= dock.top - 8,
      proofBottomSpace: valueBox && proofBox ? valueBox.bottom - proofBox.bottom : -1,
    };
  });
  if (bringPromise.visible && bringPromise.text.length >= 60 && bringPromise.receipt
    && bringPromise.chooseBeforeDock && bringPromise.proofBottomSpace >= 10) {
    ok('Bring demonstrates the verifiable result before configuration', JSON.stringify(bringPromise));
  } else {
    bad('Bring demonstrates the verifiable result before configuration', JSON.stringify(bringPromise));
  }

  await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-screen="settings"]', { timeout: 20000 });
  const privacy = await page.evaluate(() => ({
    boundary: document.querySelector('[data-testid="privacy-boundary"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    visible: document.querySelector('[data-screen="settings"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  }));
  const namesAudioDestination = /audio.+transcription provider/i.test(privacy.boundary);
  const namesTranscriptDestination = /transcript.+notes provider/i.test(privacy.boundary);
  const namesLocalMaterial = /stored in this browser/i.test(privacy.boundary);
  const makesFalseBlanketClaim = /everything stays in your browser/i.test(privacy.visible);
  if (namesAudioDestination && namesTranscriptDestination && namesLocalMaterial && !makesFalseBlanketClaim) {
    ok('2. Settings names the real provider and local-storage boundaries', privacy.boundary);
  } else {
    bad('2. Settings names the real provider and local-storage boundaries',
      `boundary="${privacy.boundary}" · falseBlanketClaim=${makesFalseBlanketClaim}`);
  }

  const disclosure = await page.evaluate(() => {
    const panels = ['stt-connection', 'llm-connection'].map((id) => {
      const panel = document.querySelector(`[data-testid="${id}"]`);
      const field = panel?.querySelector('input[type="password"]');
      return {
        exists: !!panel,
        collapsed: panel instanceof HTMLDetailsElement && !panel.open,
        keyVisible: field?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ?? false,
        summary: panel?.querySelector('summary')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    });
    return panels;
  });
  if (disclosure.every((p) => p.exists && p.collapsed && !p.keyVisible && p.summary)) {
    ok('3. Settings progressively discloses provider mechanics', disclosure.map((p) => p.summary).join(' · '));
  } else {
    bad('3. Settings progressively discloses provider mechanics', JSON.stringify(disclosure));
  }

  const settingsComposition = await page.evaluate(() => {
    const privacy = document.querySelector('[data-testid="settings-privacy"]');
    const local = document.querySelector('[data-testid="settings-local"]');
    const sources = document.querySelector('[data-testid="settings-sources"]');
    const credits = sources?.querySelector('[data-testid="starter-credits"]');
    return {
      privacyVisible: !!privacy && privacy.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      localVisible: !!local && local.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      sourcesCollapsed: sources instanceof HTMLDetailsElement && !sources.open,
      creditsVisible: credits?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ?? false,
      importedLabel: local?.querySelector('#settings-keep .toggle__label')?.textContent?.trim() ?? '',
    };
  });
  if (settingsComposition.privacyVisible && settingsComposition.localVisible
    && settingsComposition.sourcesCollapsed && !settingsComposition.creditsVisible
    && /imported/i.test(settingsComposition.importedLabel)) {
    ok('Settings keeps the privacy boundary visible and provenance quiet', JSON.stringify(settingsComposition));
  } else {
    bad('Settings keeps the privacy boundary visible and provenance quiet', JSON.stringify(settingsComposition));
  }

  await page.goto(`${BASE}/#/add`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-screen="bring"]', { timeout: 20000 });
  const mobileNav = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="app-nav"]');
    const box = nav?.getBoundingClientRect();
    return box ? { exists: true, left: box.left, top: box.top, width: box.width, height: box.height, bottom: box.bottom } : { exists: false };
  });
  const mobileDock = mobileNav.exists && mobileNav.bottom <= 844 && mobileNav.bottom >= 836
    && mobileNav.top >= 760 && mobileNav.width >= 360;

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle0' });
  const desktopNav = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="app-nav"]');
    const box = nav?.getBoundingClientRect();
    return box ? { exists: true, left: box.left, top: box.top, width: box.width, height: box.height, bottom: box.bottom } : { exists: false };
  });
  const desktopRail = desktopNav.exists && desktopNav.left === 0 && desktopNav.top === 0
    && desktopNav.width >= 64 && desktopNav.width <= 104 && desktopNav.height >= 880;

  await page.goto(`${BASE}/#/i/yale-psych110`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-screen="interview"]', { timeout: 20000 });
  const navInsideInterview = await page.$('[data-testid="app-nav"]');
  if (mobileDock && desktopRail && !navInsideInterview) {
    ok('4. navigation becomes a rail, a dock, and yields to the listening room',
      `mobile=${JSON.stringify(mobileNav)} · desktop=${JSON.stringify(desktopNav)}`);
  } else {
    bad('4. navigation becomes a rail, a dock, and yields to the listening room',
      `mobileDock=${mobileDock} ${JSON.stringify(mobileNav)} · desktopRail=${desktopRail} ${JSON.stringify(desktopNav)} · interviewNav=${!!navInsideInterview}`);
  }

  await page.evaluate(() => {
    window.__heardDev?.store?.getState?.().setUi({ firstRunSeen: true });
    location.hash = '#/';
  });
  await page.waitForSelector('[data-screen="library"]');
  const library = await page.evaluate(() => {
    const hero = document.querySelector('[data-testid="library-proof-card"]');
    const proof = hero?.querySelector('[data-testid="library-proof-link"]');
    const starters = [...document.querySelectorAll('[data-testid="starter-card"]')];
    return {
      hero: !!hero,
      heroText: hero?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      proofHref: proof?.getAttribute('href') ?? '',
      ownSection: !!document.querySelector('[data-testid="library-own-section"]'),
      starterShelf: !!document.querySelector('[data-testid="library-starter-shelf"]'),
      starterCards: starters.length,
    };
  });
  const realProofLink = /#\/i\/.+\?t=\d/.test(library.proofHref);
  if (library.hero && library.heroText.length > 40 && realProofLink && library.starterShelf && library.starterCards >= 3) {
    ok('5. Library leads with one real proof object before its collections', `${library.proofHref} · ${library.starterCards} starters`);
  } else {
    bad('5. Library leads with one real proof object before its collections', JSON.stringify(library));
  }

  const proofContrast = await page.evaluate(() => {
    const panel = document.querySelector('.proofcard__source');
    const title = document.querySelector('.proofcard__source-title');
    const rgb = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = ([r = 0, g = 0, b = 0]) => {
      const channel = (v) => {
        const n = v / 255;
        return n <= .03928 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
      };
      return .2126 * channel(r) + .7152 * channel(g) + .0722 * channel(b);
    };
    const foreground = getComputedStyle(title).color;
    const background = getComputedStyle(panel).backgroundColor;
    const a = luminance(rgb(foreground));
    const b = luminance(rgb(background));
    return { foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  });
  if (proofContrast.ratio >= 4.5) {
    ok('6. the inverse source panel keeps its recording identity readable', `contrast ${proofContrast.ratio.toFixed(2)}:1`);
  } else {
    bad('6. the inverse source panel keeps its recording identity readable', JSON.stringify(proofContrast));
  }

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const mobileProof = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="library-proof-card"]')?.getBoundingClientRect();
    const receipt = document.querySelector('[data-testid="library-proof-link"]')?.getBoundingClientRect();
    const source = document.querySelector('.proofcard__source')?.getBoundingClientRect();
    const dock = document.querySelector('[data-testid="app-nav"]')?.getBoundingClientRect();
    return card && receipt && source && dock ? {
      cardHeight: card.height,
      receiptBottom: receipt.bottom,
      sourceTop: source.top,
      sourceBeforeDock: dock.top - source.top,
      dockTop: dock.top,
    } : null;
  });
  if (mobileProof && mobileProof.cardHeight <= 600
    && mobileProof.receiptBottom <= mobileProof.dockTop - 8
    && mobileProof.sourceBeforeDock >= 100) {
    ok('7. the mobile proof object proves itself before the navigation dock', JSON.stringify(mobileProof));
  } else {
    bad('7. the mobile proof object proves itself before the navigation dock', JSON.stringify(mobileProof));
  }

  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-screen="library"]');

  if (realProofLink) {
    const expected = Number(new URLSearchParams(library.proofHref.split('?')[1] ?? '').get('t'));
    await page.goto(`${BASE}/${library.proofHref}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-screen="interview"]');
    await page.waitForSelector('[data-testid="player-time"]');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const landed = await page.evaluate(() => {
      const readout = document.querySelector('[data-testid="player-time"]')?.textContent ?? '';
      const [minutes = '0', seconds = '0'] = readout.split('/')[0].trim().split(':');
      return {
        readout,
        second: Number(minutes) * 60 + Number(seconds),
        playing: window.__heardDev?.store?.getState?.().playback?.playing ?? false,
      };
    });
    if (Number.isFinite(expected) && Math.abs(landed.second - expected) <= 1.1 && !landed.playing) {
      ok('8. a proof URL survives reload and lands silently on its source', `${library.proofHref} → ${landed.readout}`);
    } else {
      bad('8. a proof URL survives reload and lands silently on its source', JSON.stringify({ expected, landed }));
    }
  } else {
    bad('8. a proof URL survives reload and lands silently on its source', 'no proof URL to follow');
  }

  await page.click('[data-testid="export"]');
  await page.waitForSelector('[data-testid="export-sheet"]');
  const liveExport = await page.evaluate(() => ({
    title: document.querySelector('.iv__title')?.textContent?.trim() ?? '',
    preview: document.querySelector('[data-testid="export-preview"]')?.textContent ?? '',
  }));
  if (liveExport.title && liveExport.preview.includes(`# ${liveExport.title}`) && liveExport.preview.includes('## ')) {
    ok('Interview export opens with the live interview rather than a fixture', liveExport.title);
  } else {
    bad('Interview export opens with the live interview rather than a fixture', JSON.stringify(liveExport));
  }
  await page.click('[data-testid="export-close"]');

  const noAudioId = await page.evaluate(() => {
    const store = window.__heardDev.store.getState();
    const sourceId = document.querySelector('main[data-interview-id]')?.getAttribute('data-interview-id');
    const source = sourceId ? store.interviews[sourceId] : null;
    const transcript = sourceId ? store.transcripts[sourceId] : null;
    if (!source || !transcript) throw new Error('source interview missing for no-audio deep-link check');
    const copy = store.createInterview({
      title: 'Transcript without local audio',
      durationSec: source.durationSec,
      lang: source.lang,
      status: 'ready',
      file: { name: 'not-kept.m4a', size: 1000, type: 'audio/mp4', kept: false },
    });
    store.setTranscript(copy.id, transcript);
    return copy.id;
  });
  await page.goto(`${BASE}/#/i/${noAudioId}?t=100`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="audio-missing"]');
  await page.waitForSelector('.w[data-now="true"]');
  await page.waitForFunction(() => {
    const pane = document.querySelector('.iv__transcript-scroll')?.getBoundingClientRect();
    const word = document.querySelector('.w[data-now="true"]')?.getBoundingClientRect();
    return !!pane && !!word && word.top >= pane.top && word.bottom <= pane.bottom;
  }, { timeout: 3000 });
  const noAudioProof = await page.evaluate(() => {
    const pane = document.querySelector('.iv__transcript-scroll')?.getBoundingClientRect();
    const word = document.querySelector('.w[data-now="true"]')?.getBoundingClientRect();
    return {
      selected: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-testid') ?? '',
      wordInView: !!pane && !!word && word.top >= pane.top && word.bottom <= pane.bottom,
    };
  });
  if (noAudioProof.wordInView && noAudioProof.selected === 'tab-transcript') {
    ok('a receipt keeps its target second when the local tape is absent', JSON.stringify(noAudioProof));
  } else {
    bad('a receipt keeps its target second when the local tape is absent', JSON.stringify(noAudioProof));
  }

  const waitingId = await page.evaluate(() => {
    const store = window.__heardDev.store.getState();
    store.setSettings({ stt: { key: '' } });
    return store.createInterview({
      title: 'Waiting for transcription',
      durationSec: 90,
      lang: 'en',
      status: 'waiting',
      file: { name: 'waiting.m4a', size: 1000, type: 'audio/mp4', kept: true },
    }).id;
  });
  await page.goto(`${BASE}/#/i/${waitingId}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="not-heard-cta"]');
  await page.waitForSelector('[data-testid="notes-waiting"] a');
  const waitingConnectHref = await page.$eval(
    '[data-testid="notes-waiting"] a',
    (node) => node.getAttribute('href'),
  );
  if (waitingConnectHref === '#/settings') {
    ok('the waiting card connects the missing transcription provider', waitingConnectHref);
  } else {
    bad('the waiting card connects the missing transcription provider', waitingConnectHref ?? 'missing href');
  }
  await page.click('[data-testid="not-heard-cta"]');
  await page.waitForFunction(() => location.hash !== `#/i/${location.hash.split('/').pop()}`);
  const waitingDestination = await page.evaluate(() => location.hash);
  if (waitingDestination === '#/settings') {
    ok('a keyless waiting interview leads to its missing connection', waitingDestination);
  } else {
    bad('a keyless waiting interview leads to its missing connection', waitingDestination);
  }

  const failedId = await page.evaluate(() => {
    const store = window.__heardDev.store.getState();
    store.setSettings({ stt: { key: 'test' } });
    return store.createInterview({
      title: 'Unreadable recording',
      durationSec: 90,
      lang: 'en',
      status: 'failed',
      file: { name: 'broken.m4a', size: 1000, type: 'audio/mp4', kept: false },
    }).id;
  });
  await page.goto(`${BASE}/#/i/${failedId}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="not-heard-cta"]');
  await page.click('[data-testid="not-heard-cta"]');
  await page.waitForFunction(() => location.hash === '#/add');
  const failedDestination = await page.evaluate(() => location.hash);
  if (failedDestination === '#/add') {
    ok('an irrecoverable recording asks for another source instead of fake Retry', failedDestination);
  } else {
    bad('an irrecoverable recording asks for another source instead of fake Retry', failedDestination);
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
