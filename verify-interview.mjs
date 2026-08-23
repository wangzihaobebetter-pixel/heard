/**
 * WP2 acceptance — the Interview screen's five executable claims (REVIEW §6).
 *
 * Every one of these is a promise DESIGN §5 makes to the user in prose, turned
 * into something a machine can fail on:
 *
 *   1. pressing a chip seeks to `anchor.s − 1.0 ± 0.1`
 *   2. paused at three sampled times inside a span, the DOM-highlighted word is
 *      the word whose `[s, e)` contains `t`
 *   3. playback pauses at `span.e + 0.8 ± 0.2` — the receipt stops by itself
 *   4. the `≈` fixture renders dotted; the missing-tape fixture renders dashed
 *   5. selecting transcript words raises the Save-as-quote pill
 *
 * Drives a real Chrome against the dev server; no jsdom, because three of the
 * five are claims about an actual media element's clock.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.HEARD_URL ?? 'http://localhost:5178';
const CHROME = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
const ok = (name, detail = '') => results.push({ pass: true, name, detail });
const bad = (name, detail = '') => results.push({ pass: false, name, detail });

function near(actual, expected, tol) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The repo's screenshot set lives in shots/ (WP3 filed theirs there); the
// directory is gitignored, so the set is force-added deliberately.
const SHOT_DIR = resolve(process.env.HEARD_SHOTS ?? 'shots');
const shots = [];

/**
 * The screenshot set (REVIEW §7 item 9). Judged on the images, so each one is
 * put into the exact state its name claims — no posed DOM, no CSS overrides:
 * the chip shot is taken while audio is genuinely playing, which is the only
 * time the chip is filled and a word is washed.
 */
async function capture(page, name, width, theme, lang = 'en') {
  const suffix = lang === 'en' ? '' : `-${lang}`;
  const file = `${SHOT_DIR}/${name}-${theme}-${width}${suffix}.png`;
  void lang;
  await page.screenshot({ path: file });
  shots.push(file);
  return file;
}

async function setSkin(page, theme, lang) {
  await page.evaluate((t, l) => {
    window.__heardDev.store.getState().setSettings({ ui: { theme: t, lang: l } });
  }, theme, lang);
  await sleep(160);
}

/**
 * Open an interview on a genuinely fresh app.
 *
 * `page.goto` to a hash that is already current fires no navigation at all, so
 * without the reload every screenshot inherits the previous one's playback
 * state — which is how the first-run shot first came back showing a finished
 * receipt and a nudge cluster.
 */
async function open(page, id) {
  await page.goto(`${BASE}/#/i/${id}`, { waitUntil: 'networkidle0' });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="context-strip"]');
  // The listening fixture legitimately has no notes yet (§4.2), so a missing
  // row is a valid state here, not a timeout worth waiting out.
  await page.waitForSelector('[data-testid="note-row"]', { timeout: 3000 }).catch(() => {});
  await sleep(300);
}

async function captureShots(page) {
  mkdirSync(SHOT_DIR, { recursive: true });

  for (const [width, height] of [[390, 844], [1280, 900]]) {
    await page.setViewport({ width, height, deviceScaleFactor: 2 });

    for (const theme of ['paper', 'ink']) {
      /* ---- first run, untouched: the sample, the one line, no key UI ------
         The dismissal flag is cleared BEFORE the reload, so what is
         photographed is the state a new user actually lands in. */
      await page.evaluate((t) => {
        localStorage.removeItem('heard-firstrun-line');
        window.__heardDev.store.getState().setSettings({ ui: { theme: t, lang: 'en' } });
      }, theme);
      await open(page, 'sample');
      await capture(page, 'shot-first-run-mobile', width, theme);

      /* ---- the moment: chip filled, sheet at mid, current word washed ------
         Taken against the shipped sample and the shipped mp3, not a fixture. */
      await open(page, 'sample');
      await setSkin(page, theme, 'en');
      await page.waitForFunction(
        () => document.querySelector('[data-testid="audio"]')?.readyState >= 2,
        { timeout: 30000 },
      );
      const span = await page.evaluate(() => {
        const n = window.__heardDev.store.getState().notes.sample[0];
        document.querySelector(`[data-note-id='${n.id}'] [data-testid='timecode-chip']`).click();
        return n.anchor;
      });
      // Wait until the voice is genuinely inside the claim, not in the pre-roll.
      await page.waitForFunction((s) => {
        const el = document.querySelector('[data-testid="audio"]');
        return !el.paused && el.currentTime > s + 0.6;
      }, { timeout: 15000 }, span.s);
      await capture(page, 'shot-press-chip-mobile', width, theme);
      await page.evaluate(() => document.querySelector('[data-testid="audio"]').pause());

      /* ---- the whole screen: two columns, player bar, span on the track --- */
      await open(page, 'sample');
      await setSkin(page, theme, 'en');
      const span2 = await page.evaluate(() => {
        const n = window.__heardDev.store.getState().notes.sample[2];
        document.querySelector(`[data-note-id='${n.id}'] [data-testid='timecode-chip']`).click();
        return n.anchor;
      });
      // Pause inside a WORD of the claim. Between two words nothing is being
      // spoken and nothing is lit — correct behaviour, but it would make this
      // screenshot evidence of nothing.
      await page.waitForFunction((s) => {
        const el = document.querySelector('[data-testid="audio"]');
        return !el.paused && el.currentTime > s + 0.8;
      }, { timeout: 15000 }, span2.s);
      await page.evaluate((a) => {
        const el = document.querySelector('[data-testid="audio"]');
        el.pause();
        const words = window.__heardDev.store.getState().transcripts.sample.words;
        const w = words.filter((x) => x.i >= a.wi && x.i < a.wj)[3];
        el.currentTime = w.s + (w.e - w.s) / 2;
      }, span2);
      await sleep(300);
      await capture(page, 'shot-desktop-interview', width, theme);

      /* ---- the receipt: stopped at e + 0.8, with the nudge cluster and Pin -- */
      await open(page, 'sample');
      await setSkin(page, theme, 'en');
      const span3 = await page.evaluate(() => {
        const n = window.__heardDev.store.getState().notes.sample[3];
        document.querySelector(`[data-note-id='${n.id}'] [data-testid='timecode-chip']`).click();
        return n.anchor;
      });
      await page.evaluate((a) => {
        // Jump to just before the post-roll so the receipt completes now
        // rather than in ten seconds; the stop itself is still the app's.
        document.querySelector('[data-testid="audio"]').currentTime = a.e + 0.3;
      }, span3);
      await page.waitForSelector('[data-testid="player-after"][data-shown="true"]', { timeout: 15000 });
      await page.click('[data-testid="nudge-1"]');
      await sleep(500);
      await page.evaluate(() => document.querySelector('[data-testid="audio"]').pause());
      await sleep(250);
      await capture(page, 'shot-after-receipt', width, theme);

      /* ---- listening: half-filled transcript + "Listening… 23 of 92 min" --- */
      await page.evaluate(() => window.__heardDev.seed('fx-listening'));
      await open(page, 'fx-listening');
      await setSkin(page, theme, 'en');
      if (width < 960) await page.click('[data-testid="tab-transcript"]');
      await sleep(300);
      await capture(page, 'shot-listening-state', width, theme);

      /* ---- ≈ dotted beside dashed, with the "couldn't pin" line ----------- */
      await page.evaluate(() => window.__heardDev.seed('fx-approx'));
      await open(page, 'fx-approx');
      await setSkin(page, theme, 'en');
      await sleep(200);
      await capture(page, 'shot-approx-and-dashed', width, theme);
    }
  }

  /* ---- zh-CN spot check at 390 (definition of done, item 10) ------------- */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  for (const theme of ['paper', 'ink']) {
    await open(page, 'sample');
    await setSkin(page, theme, 'zh');
    await sleep(250);
    await capture(page, 'shot-zh-notes-mobile', 390, theme, 'zh');
    await open(page, 'fx-approx');
    await setSkin(page, theme, 'zh');
    await sleep(250);
    await capture(page, 'shot-zh-approx-mobile', 390, theme, 'zh');
  }
  await setSkin(page, 'paper', 'en');
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  /* ---------------------------------------------------------- the demo tape */

  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__heardDev, { timeout: 15000 });
  await page.evaluate(() => window.__heardDev.seed('fx-demo'));
  await page.goto(`${BASE}/#/i/fx-demo`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="note-row"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="audio"]')?.readyState >= 1,
    { timeout: 15000 },
  );

  const anchors = await page.evaluate(() => {
    const notes = window.__heardDev.store.getState().notes['fx-demo'];
    const words = window.__heardDev.store.getState().transcripts['fx-demo'].words;
    return { notes: notes.map((n) => ({ id: n.id, ...n.anchor })), words };
  });
  const target = anchors.notes.find((n) => n.quality === 'word');

  /* ------------------------- 1. press a chip → seek to s − 1.0 (DESIGN §5.2) */

  await page.evaluate((id) => {
    document.querySelector(`[data-note-id='${id}'] [data-testid='timecode-chip']`).click();
  }, target.id);

  const seeked = await page.evaluate(async (expected) => {
    const el = document.querySelector('[data-testid="audio"]');
    // The first moment the element has committed to the requested position.
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      if (Math.abs(el.currentTime - expected) <= 0.1) return el.currentTime;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return el.currentTime;
  }, Math.max(0, target.s - 1.0));

  const expectedSeek = Math.max(0, target.s - 1.0);
  if (near(seeked, expectedSeek, 0.1)) {
    ok('press-chip seeks to s − 1.0 ± 0.1', `wanted ${expectedSeek.toFixed(2)}s, got ${seeked.toFixed(3)}s`);
  } else {
    bad('press-chip seeks to s − 1.0 ± 0.1', `wanted ${expectedSeek.toFixed(2)}s, got ${seeked.toFixed(3)}s`);
  }

  /* ------------------- 3. playback stops at e + 0.8 ± 0.2 (DESIGN §5.5) ---- */

  const stopped = await page.evaluate(async () => {
    const el = document.querySelector('[data-testid="audio"]');
    const t0 = performance.now();
    while (performance.now() - t0 < 30000) {
      if (el.paused && el.currentTime > 0.5) return el.currentTime;
      await new Promise((r) => setTimeout(r, 20));
    }
    return -1;
  });

  const expectedStop = target.e + 0.8;
  if (near(stopped, expectedStop, 0.2)) {
    ok('playback pauses at e + 0.8 ± 0.2', `wanted ${expectedStop.toFixed(2)}s, got ${stopped.toFixed(3)}s`);
  } else {
    bad('playback pauses at e + 0.8 ± 0.2', `wanted ${expectedStop.toFixed(2)}s, got ${stopped.toFixed(3)}s`);
  }

  /* ---- 2. paused inside the span, the lit word is the word containing t --- */

  const inSpan = anchors.words.filter((w) => w.i >= target.wi && w.i < target.wj);
  const samples = [0.2, 0.5, 0.8].map((f) => {
    const w = inSpan[Math.floor((inSpan.length - 1) * f)];
    // Strictly inside [s, e) — the criterion is about containment, and a
    // sample sitting in the gap between two words has no right answer.
    return { t: Number((w.s + (w.e - w.s) * 0.5).toFixed(3)), expect: w.i, word: w.t };
  });

  for (const s of samples) {
    const lit = await page.evaluate(async (t) => {
      const el = document.querySelector('[data-testid="audio"]');
      el.pause();
      el.currentTime = t;
      await new Promise((r) => setTimeout(r, 120));
      const now = document.querySelectorAll('[data-testid="word"][data-now="true"]');
      return [...now].map((n) => ({ i: Number(n.dataset.i), s: Number(n.dataset.s), e: Number(n.dataset.e) }));
    }, s.t);

    // The word may legitimately be lit in two places at once: the transcript
    // pane and the player sheet's copy of the current paragraph, which §5.3
    // requires so a mobile user never loses the note they pressed. What must
    // hold is that every lit span is the SAME word, and that it is the word
    // whose [s, e) contains t.
    const distinct = [...new Set(lit.map((l) => l.i))];
    const contains = lit.every((l) => s.t >= l.s && s.t < l.e);
    if (distinct.length === 1 && distinct[0] === s.expect && contains && lit.length) {
      ok(`karaoke word at t=${s.t}s`,
        `lit "${s.word}" (word ${s.expect})${lit.length > 1 ? ` in ${lit.length} panes, in agreement` : ''}`);
    } else {
      bad(`karaoke word at t=${s.t}s`,
        `expected word ${s.expect} ("${s.word}") and nothing else, DOM lit ${JSON.stringify(lit)}`);
    }
  }

  /* ------------------------- 5. selection raises the Save-as-quote pill ---- */

  await page.evaluate(() => {
    document.querySelector('[data-testid="tab-transcript"]').click();
  });
  await page.waitForSelector('[data-testid="transcript-paragraph"]');
  await page.evaluate(() => {
    const words = document.querySelectorAll('[data-testid="word"]');
    const range = document.createRange();
    range.setStartBefore(words[2]);
    range.setEndAfter(words[6]);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  const pill = await page.waitForSelector('[data-testid="save-as-quote"]', { timeout: 4000 })
    .then(() => true).catch(() => false);
  if (pill) ok('selecting words raises Save as quote'); else bad('selecting words raises Save as quote');

  // …and saving it actually produces a note under "Yours" with a real anchor.
  if (pill) {
    await page.click('[data-testid="save-as-quote"]');
    await sleep(200);
    const yours = await page.evaluate(() => {
      const notes = window.__heardDev.store.getState().notes['fx-demo'] ?? [];
      const mine = notes.filter((n) => n.kind === 'yours');
      return mine.map((n) => ({ text: n.text, ...n.anchor }));
    });
    const added = yours.find((n) => n.wi === 2 && n.wj === 7);
    if (added && added.quality === 'word' && added.e > added.s) {
      ok('Save as quote writes a Yours note', `words [2,7) → ${added.s}s–${added.e}s`);
    } else {
      bad('Save as quote writes a Yours note', JSON.stringify(yours));
    }
  }

  /* --------------------- 4. ≈ renders dotted, missing tape renders dashed -- */

  await page.evaluate(() => window.__heardDev.seed('fx-approx'));
  await page.goto(`${BASE}/#/i/fx-approx`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="note-row"]');

  const borders = await page.evaluate(() => {
    const out = [];
    for (const hit of document.querySelectorAll('[data-testid="timecode-chip"]')) {
      const chip = hit.querySelector('.tc');
      const cs = getComputedStyle(chip);
      out.push({
        quality: hit.dataset.quality,
        dashed: hit.dataset.dashed,
        style: cs.borderTopStyle,
        text: chip.textContent.trim(),
      });
    }
    return out;
  });

  const approxChips = borders.filter((b) => b.quality !== 'word');
  const alignedChips = borders.filter((b) => b.quality === 'word');

  if (approxChips.length && approxChips.every((c) => c.style === 'dotted' && c.text.startsWith('≈'))) {
    ok('≈ chips render dotted', approxChips.map((c) => `${c.quality}:${c.text}`).join(' · '));
  } else {
    bad('≈ chips render dotted', JSON.stringify(approxChips));
  }

  if (alignedChips.length && alignedChips.every((c) => c.style === 'dashed')) {
    ok('missing-tape chips render dashed', `${alignedChips.length} chips, border-style dashed`);
  } else {
    bad('missing-tape chips render dashed', JSON.stringify(alignedChips));
  }

  if (approxChips.length && alignedChips.length
      && approxChips.every((c) => c.style === 'dotted')
      && alignedChips.every((c) => c.style === 'dashed')) {
    ok('dotted and dashed are visually distinct in one view');
  } else {
    bad('dotted and dashed are visually distinct in one view');
  }

  /* ---------------------- pressing a dashed chip still scrolls + highlights */

  await page.evaluate(() => {
    document.querySelector('[data-testid="tab-transcript"]').click();
  });
  await page.evaluate(() => {
    document.querySelector('[data-testid="tab-notes"]').click();
    document.querySelector('[data-testid="timecode-chip"]').click();
  });
  await sleep(400);
  const staticWash = await page.evaluate(
    () => document.querySelectorAll('[data-testid="word"][data-said="true"]').length,
  );
  if (staticWash > 0) ok('dashed chip still highlights its span', `${staticWash} words washed, no audio`);
  else bad('dashed chip still highlights its span');

  /* ------------------------------------- no provider or model names on show */

  const surface = await page.evaluate(() => document.body.innerText);
  const leaked = ['OpenAI', 'Groq', 'whisper', 'gpt-', 'deepseek', 'DeepSeek', 'Moonshot', 'SiliconFlow', 'OpenRouter']
    .filter((n) => surface.includes(n));
  if (!leaked.length) ok('no provider/model names on the Interview surface');
  else bad('no provider/model names on the Interview surface', leaked.join(', '));

  /* --------------------------------------------------- console must be clean */

  if (!consoleErrors.length) ok('no console errors');
  else bad('no console errors', consoleErrors.slice(0, 3).join(' | '));

  /* ================= the real thing: WP4's sample, WP1's mp3 ==============
     The fixture assertions above are deterministic by construction — a WAV
     with word times this file invented. This block runs the same three §5
     claims against the shipped sample and the shipped 4 MB mp3, which is the
     path a first-run user actually takes. */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/#/i/sample`, { waitUntil: 'networkidle0' });
  const sampleReady = await page.waitForSelector('[data-testid="note-row"]', { timeout: 15000 })
    .then(() => true).catch(() => false);

  if (!sampleReady) {
    bad('real sample: interview renders', 'no note rows — is sample.json seeded?');
  } else {
    ok('real sample: interview renders');
    const gotAudio = await page.waitForFunction(
      () => document.querySelector('[data-testid="audio"]')?.readyState >= 2,
      { timeout: 30000 },
    ).then(() => true).catch(() => false);

    if (!gotAudio) {
      bad('real sample: the recording loads', 'audio never reached readyState 2');
    } else {
      ok('real sample: the recording loads', 'sample.mp3 via IndexedDB (A3 path)');

      const s0 = await page.evaluate(() => {
        const n = window.__heardDev.store.getState().notes.sample.find((x) => x.anchor.quality === 'word');
        document.querySelector(`[data-note-id='${n.id}'] [data-testid='timecode-chip']`).click();
        return n.anchor;
      });

      const landed = await page.evaluate(async (expected) => {
        const el = document.querySelector('[data-testid="audio"]');
        const t0 = performance.now();
        while (performance.now() - t0 < 6000) {
          if (Math.abs(el.currentTime - expected) <= 0.1) return el.currentTime;
          await new Promise((r) => requestAnimationFrame(r));
        }
        return el.currentTime;
      }, Math.max(0, s0.s - 1.0));

      if (near(landed, Math.max(0, s0.s - 1.0), 0.1)) {
        ok('real sample: chip seeks to s − 1.0 ± 0.1',
          `wanted ${(s0.s - 1).toFixed(2)}s, got ${landed.toFixed(3)}s`);
      } else {
        bad('real sample: chip seeks to s − 1.0 ± 0.1',
          `wanted ${(s0.s - 1).toFixed(2)}s, got ${landed.toFixed(3)}s`);
      }

      const realStop = await page.evaluate(async () => {
        const el = document.querySelector('[data-testid="audio"]');
        const t0 = performance.now();
        while (performance.now() - t0 < 40000) {
          if (el.paused && el.currentTime > 1) return el.currentTime;
          await new Promise((r) => setTimeout(r, 20));
        }
        return -1;
      });
      if (near(realStop, s0.e + 0.8, 0.2)) {
        ok('real sample: playback pauses at e + 0.8 ± 0.2',
          `wanted ${(s0.e + 0.8).toFixed(2)}s, got ${realStop.toFixed(3)}s`);
      } else {
        bad('real sample: playback pauses at e + 0.8 ± 0.2',
          `wanted ${(s0.e + 0.8).toFixed(2)}s, got ${realStop.toFixed(3)}s`);
      }

      const realWord = await page.evaluate(async (a) => {
        const words = window.__heardDev.store.getState().transcripts.sample.words;
        const inSpan = words.filter((w) => w.i >= a.wi && w.i < a.wj);
        const w = inSpan[Math.floor(inSpan.length / 2)];
        const t = w.s + (w.e - w.s) / 2;
        const el = document.querySelector('[data-testid="audio"]');
        el.pause();
        el.currentTime = t;
        await new Promise((r) => setTimeout(r, 150));
        const lit = [...document.querySelectorAll('[data-testid="word"][data-now="true"]')]
          .map((n) => Number(n.dataset.i));
        return { expect: w.i, text: w.t, lit: [...new Set(lit)] };
      }, s0);
      if (realWord.lit.length === 1 && realWord.lit[0] === realWord.expect) {
        ok('real sample: karaoke word at mid-span', `lit "${realWord.text}"`);
      } else {
        bad('real sample: karaoke word at mid-span', JSON.stringify(realWord));
      }

      const sampleLeak = await page.evaluate(() => document.body.innerText);
      const leaked2 = ['OpenAI', 'Groq', 'whisper', 'gpt-4o', 'DeepSeek'].filter((n) => sampleLeak.includes(n));
      if (!leaked2.length) ok('real sample: no provider/model names on the surface');
      else bad('real sample: no provider/model names on the surface', leaked2.join(', '));
    }
  }

  if (process.env.HEARD_NO_SHOTS !== '1') {
    try {
      await captureShots(page);
      ok(`screenshots captured`, `${shots.length} files in ${SHOT_DIR}`);
    } catch (e) {
      bad('screenshots captured', String(e && e.message ? e.message : e));
    }
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(
    failed.length
      ? `verify-interview: ${failed.length} of ${results.length} assertions FAILED`
      : `verify-interview: ${results.length} assertions pass ✓`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('verify-interview: harness error —', e); process.exit(2); });
