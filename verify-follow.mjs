/**
 * v3 B13 acceptance — the transcript follows the voice (Wang, 2026-08-24).
 *
 * The defect this pins down: `scrollToSpan` existed and was correct, but was
 * only ever called from four discrete acts. Nothing called it while audio
 * played, so on anything longer than one screen the karaoke highlight ran off
 * the bottom of the pane and the reader was left looking at the wrong text.
 *
 * Four executable claims, all against the real 29-minute Yale lecture and its
 * real mp3 — no fixture, no posed DOM:
 *   1. while playing, the lit word is inside the pane's visible box
 *   2. it is still inside it a few seconds later (it followed, it did not
 *      merely happen to start in view)
 *   3. after the reader scrolls away, following yields — no snap-back — and
 *      the way back is offered
 *   4. pressing that button puts the lit word back in view
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { findChrome } from './scripts/find-chrome.mjs';

const BASE = process.env.HEARD_URL ?? 'http://localhost:5178';
const CHROME = findChrome();
const ID = process.env.HEARD_ID ?? 'yale-psych110';
const SHOT_DIR = resolve(process.env.HEARD_SHOTS ?? 'shots');

const results = [];
const ok = (n, d = '') => results.push({ pass: true, name: n, detail: d });
const bad = (n, d = '') => results.push({ pass: false, name: n, detail: d });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where the lit word sits inside the scroll pane, in pane-relative pixels. */
const probe = () => {
  const pane = document.querySelector('.iv__transcript-scroll');
  const word = document.querySelector('.w[data-now="true"]');
  if (!pane) return { err: 'no pane' };
  if (!word) return { err: 'no lit word' };
  const p = pane.getBoundingClientRect();
  const w = word.getBoundingClientRect();
  return {
    rel: Math.round(w.top - p.top),
    h: pane.clientHeight,
    scrollTop: Math.round(pane.scrollTop),
    text: word.textContent.trim(),
    i: Number(word.dataset.i),
    inView: w.top >= p.top && w.bottom <= p.bottom,
    t: Number(document.querySelector('[data-testid="audio"]')?.currentTime.toFixed(1)),
    paused: document.querySelector('[data-testid="audio"]')?.paused,
    sh: document.querySelector('.iv__transcript-scroll').scrollHeight,
  };
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 240000,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
mkdirSync(SHOT_DIR, { recursive: true });

try {
  await page.goto(`${BASE}/#/i/${ID}`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.iv__transcript-scroll', { timeout: 20000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="audio"]')?.readyState >= 2,
    { timeout: 60000 },
  );

  // Ten minutes in: far past the first screen, so a transcript that does not
  // follow cannot accidentally pass.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="audio"]');
    el.currentTime = 600;
    return el.play();
  });
  await sleep(3500);

  const a = await page.evaluate(probe);
  if (a.err) bad('1. lit word exists while playing', a.err);
  else if (a.inView) ok('1. lit word is inside the pane', `rel=${a.rel}px of ${a.h}px · "${a.text}"`);
  else bad('1. lit word is inside the pane', `rel=${a.rel}px of ${a.h}px — off screen`);
  await page.screenshot({ path: `${SHOT_DIR}/shot-follow-playing-1.png` });

  // The voice walks ~5px of transcript per second, so rather than guess how
  // long it takes to leave the comfortable band, wait for the pane to move.
  // A transcript that does not follow simply never satisfies this.
  let moved = true;
  await page.waitForFunction(
    (prev) => document.querySelector('.iv__transcript-scroll').scrollTop > prev + 4,
    { timeout: 120000, polling: 400 },
    a.scrollTop,
  ).catch(() => { moved = false; });
  await sleep(900);
  const b = await page.evaluate(probe);
  if (b.err) bad('2. the pane moves to keep up with the voice', b.err);
  else if (!moved) bad('2. the pane moves to keep up with the voice', `scrollTop never moved from ${a.scrollTop} in 120s (t ${a.t}→${b.t}s)`);
  else if (!b.inView) bad('2. the pane moves to keep up with the voice', `it moved but the word is off screen: rel=${b.rel}px of ${b.h}px`);
  else ok('2. the pane moves to keep up with the voice',
    `word ${a.i}→${b.i}, t ${a.t}→${b.t}s, scrollTop ${a.scrollTop}→${b.scrollTop}px, rel=${b.rel}px of ${b.h}px`);
  await page.screenshot({ path: `${SHOT_DIR}/shot-follow-playing-2.png` });

  // 3. A hand on the transcript wins.
  const away = await page.evaluate(() => {
    const pane = document.querySelector('.iv__transcript-scroll');
    pane.dispatchEvent(new WheelEvent('wheel', { deltaY: -1200, bubbles: true }));
    pane.scrollTop = Math.max(0, pane.scrollTop - 2400);
    return Math.round(pane.scrollTop);
  });
  await sleep(1500);
  const held = await page.evaluate(() => Math.round(document.querySelector('.iv__transcript-scroll').scrollTop));
  const pill = await page.$('[data-testid="follow-back"]');
  if (Math.abs(held - away) <= 8 && pill) {
    ok('3. following yields to the reader, and offers the way back', `scrollTop held at ${held}`);
  } else if (Math.abs(held - away) > 8) {
    bad('3. following yields to the reader', `snapped back: ${away} → ${held}`);
  } else {
    bad('3. the way back is offered', 'no follow-back control while away');
  }
  await page.screenshot({ path: `${SHOT_DIR}/shot-follow-yielded.png` });

  // 4. And the way back works.
  if (pill) {
    await pill.click();
    await sleep(1200);
    const c = await page.evaluate(probe);
    if (!c.err && c.inView) ok('4. the way back returns to the voice', `rel=${c.rel}px of ${c.h}px`);
    else bad('4. the way back returns to the voice', c.err ?? `rel=${c.rel}px — still off screen`);
    await page.screenshot({ path: `${SHOT_DIR}/shot-follow-returned.png` });
  }

  await page.evaluate(() => document.querySelector('[data-testid="audio"]').pause());

  /* 5. The phone. The panes are exclusive there, so following must run when the
     transcript is the visible segment — and must not scroll a pane nobody is
     looking at. */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/#/i/${ID}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tab-transcript"]', { timeout: 20000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="audio"]')?.readyState >= 2,
    { timeout: 60000 },
  );
  const clippedClaims = await page.evaluate(() => [...document.querySelectorAll('[data-testid="note-text"]')]
    .filter((node) => node.scrollHeight > node.clientHeight + 1)
    .map((node) => ({ text: node.textContent?.trim() ?? '', visible: node.clientHeight, full: node.scrollHeight })));
  if (clippedClaims.length === 0) {
    ok('note claims stay readable on the phone', 'no claim is CSS-clamped');
  } else {
    bad('note claims stay readable on the phone', JSON.stringify(clippedClaims.slice(0, 3)));
  }
  const receiptStyle = await page.evaluate(() => {
    const chip = document.querySelector('[data-testid="timecode-chip"][data-quality="word"][data-dashed="false"] .tc');
    const probe = document.createElement('span');
    probe.style.color = 'var(--anchor)';
    document.body.appendChild(probe);
    const anchor = getComputedStyle(probe).color;
    probe.remove();
    return { color: chip ? getComputedStyle(chip).color : '', anchor };
  });
  if (receiptStyle.color && receiptStyle.color === receiptStyle.anchor) {
    ok('a playable exact timecode reads as the same receipt everywhere', receiptStyle.color);
  } else {
    bad('a playable exact timecode reads as the same receipt everywhere', JSON.stringify(receiptStyle));
  }
  await page.click('[data-testid="tab-transcript"]');
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="audio"]');
    el.currentTime = 600;
    return el.play();
  });
  await sleep(3000);
  const m0 = await page.evaluate(probe);
  let mMoved = true;
  await page.waitForFunction(
    (prev) => document.querySelector('.iv__transcript-scroll').scrollTop > prev + 4,
    { timeout: 120000, polling: 400 },
    m0.scrollTop ?? 0,
  ).catch(() => { mMoved = false; });
  await sleep(900);
  const m1 = await page.evaluate(probe);
  if (m1.err) bad('5. it follows on a phone too', m1.err);
  else if (mMoved && m1.inView) ok('5. it follows on a phone too', `scrollTop ${m0.scrollTop}→${m1.scrollTop}px, rel=${m1.rel}px of ${m1.h}px`);
  else bad('5. it follows on a phone too', mMoved ? `moved but off screen: rel=${m1.rel}px of ${m1.h}px` : `scrollTop never moved from ${m0.scrollTop}`);
  await page.screenshot({ path: `${SHOT_DIR}/shot-follow-mobile.png` });
  await page.evaluate(() => document.querySelector('[data-testid="audio"]').pause());

  /* 6. The written summary announces itself once, then stops. */
  await page.evaluate(() => localStorage.removeItem('heard-ai-tab-seen'));
  await page.goto(`${BASE}/#/i/${ID}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tab-ai"]', { timeout: 20000 });
  await page.waitForSelector('[data-testid="ai-waiting"]', { timeout: 15000 }).catch(() => {});
  const dot = await page.$('[data-testid="ai-waiting"]');
  await page.screenshot({ path: `${SHOT_DIR}/shot-ai-waiting.png` });
  if (!dot) bad('6. the written summary announces itself', 'no marker on the AI tab');
  else {
    await page.click('[data-testid="tab-ai"]');
    await sleep(400);
    const still = await page.$('[data-testid="ai-waiting"]');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="tab-ai"]', { timeout: 20000 });
    await sleep(600);
    const after = await page.$('[data-testid="ai-waiting"]');
    if (!still && !after) ok('6. the written summary announces itself, once', 'marker shown, cleared on open, still gone after reload');
    else bad('6. the written summary announces itself, once', still ? 'marker survived opening the tab' : 'marker came back after reload');
  }

  /* 7. A proof press is not allowed to update a hidden transcript. On a phone,
     pressing an AI citation must bring the source words into the visible player
     sheet immediately — hearing a claim without seeing its receipt is the exact
     failure this product exists to prevent. */
  await page.click('[data-testid="tab-ai"]');
  await page.waitForSelector('.ai__cite', { timeout: 15000 });
  await page.click('.ai__cite');
  await sleep(800);
  const proof = await page.evaluate(() => {
    const player = document.querySelector('[data-testid="player"]');
    const para = document.querySelector('[data-testid="player-paragraph"]');
    const box = para?.getBoundingClientRect();
    const visible = !!box && box.width > 0 && box.height > 0
      && box.top < window.innerHeight && box.bottom > 0;
    return {
      height: player?.getAttribute('data-height') ?? 'missing',
      visible,
      words: para?.textContent?.trim().length ?? 0,
      tab: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-testid') ?? 'unknown',
    };
  });
  if (proof.height === 'mid' && proof.visible && proof.words > 0) {
    ok('7. a proof press reveals its source words on a phone', `sheet=${proof.height} · ${proof.words} visible characters`);
  } else {
    bad('7. a proof press reveals its source words on a phone',
      `sheet=${proof.height} · visible=${proof.visible} · words=${proof.words} · tab=${proof.tab}`);
  }
  await page.screenshot({ path: `${SHOT_DIR}/shot-proof-reveal-mobile.png` });

  /* 8. The progress control is another path into the same clock. Scrubbing
     while reading Notes or Summary must reveal the source paragraph too; a
     hidden karaoke cursor is not user-visible synchronization. */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tab-ai"]', { timeout: 20000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="audio"]')?.readyState >= 2,
    { timeout: 60000 },
  );
  await page.click('[data-testid="tab-ai"]');
  await page.$eval('.player__range', (range) => {
    const input = range;
    input.value = String(Number(input.max) * 0.35);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(800);
  const scrub = await page.evaluate(() => {
    const player = document.querySelector('[data-testid="player"]');
    const para = document.querySelector('[data-testid="player-paragraph"]');
    const box = para?.getBoundingClientRect();
    return {
      height: player?.getAttribute('data-height') ?? 'missing',
      visible: !!box && box.width > 0 && box.height > 0
        && box.top < window.innerHeight && box.bottom > 0,
      words: para?.textContent?.trim().length ?? 0,
      time: document.querySelector('[data-testid="player-time"]')?.textContent?.trim() ?? 'missing',
    };
  });
  if (scrub.height === 'mid' && scrub.visible && scrub.words > 0) {
    ok('8. scrubbing reveals the synchronized source words on a phone',
      `sheet=${scrub.height} · time=${scrub.time} · ${scrub.words} visible characters`);
  } else {
    bad('8. scrubbing reveals the synchronized source words on a phone',
      `sheet=${scrub.height} · visible=${scrub.visible} · words=${scrub.words} · time=${scrub.time}`);
  }
  await page.screenshot({ path: `${SHOT_DIR}/shot-scrub-reveal-mobile.png` });
} finally {
  await browser.close();
}

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
