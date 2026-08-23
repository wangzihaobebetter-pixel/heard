/**
 * WP3 acceptance — Library · Bring · Settings · Export.
 *
 * REVIEW §6 WP3 asks for three things and this script is all three:
 *
 *   1. a golden-file byte comparison of the generated quote sheet against
 *      DESIGN §4.5's format block — which is *lifted out of DESIGN.md at run
 *      time*, not copied into a fixture here, so the design of record is
 *      literally the oracle;
 *   2. headless assertions that the size / duration / key-refused / offline
 *      states render the exact i18n strings, in **both** languages — compared
 *      against the string table itself (bundled out of `src/i18n` with esbuild),
 *      so a typo in a screen cannot agree with a typo in a test;
 *   3. the screenshot set at 390 px and 1280 px in both themes.
 *
 * Everything it can make real, it makes real. The oversize and over-three-hours
 * refusals are driven by actual media files rendered with ffmpeg and pushed
 * through the actual `<input type=file>`; the refused key is a real 401 from a
 * stub OpenAI-compatible server; offline is Chrome's real offline mode. The
 * only fixtures are the three Library states that cannot exist on a clean
 * machine (empty, storage-degraded, mid-transcription) and the export sheet's
 * interview, which is §4.5's own worked example.
 *
 *   node verify-export.mjs                # everything
 *   node verify-export.mjs --golden       # just the byte comparison, no browser
 *   node verify-export.mjs --keep         # leave the servers/browser open
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const DESIGN = resolve(ROOT, '../memory/traceable-notes/DESIGN.md');
const DIST = resolve(ROOT, 'dist');
const SHOTS = resolve(ROOT, 'shots');
const MEDIA = join(tmpdir(), 'heard-wp3');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ONLY_GOLDEN = process.argv.includes('--golden');
const KEEP = process.argv.includes('--keep');

const problems = [];
const notes = [];
let checks = 0;

function ok(label) { checks++; notes.push(`  ✓ ${label}`); }
function bad(label, detail) { problems.push(detail ? `${label}\n      ${detail}` : label); }

function eq(label, actual, expected) {
  checks++;
  if (actual === expected) { notes.push(`  ✓ ${label}`); return true; }
  bad(label, `expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================ bundling

   The screens, the string table and the sheet generator are TypeScript. Rather
   than re-implement any of them in the verifier (which is how a verifier ends
   up agreeing with itself), esbuild bundles the real modules and Node imports
   the result. CSS imports are dropped; nothing in this subtree needs them.   */

async function bundle(entrySource, outName) {
  const esbuild = await import('esbuild');
  const cacheDir = join(ROOT, 'node_modules', '.cache');
  mkdirSync(cacheDir, { recursive: true });
  const entry = join(cacheDir, `${outName}.entry.ts`);
  const out = join(cacheDir, `${outName}.mjs`);
  writeFileSync(entry, entrySource);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: out,
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  return import(`file://${out}?v=${Date.now()}`);
}

/* ============================================================ the oracle */

/** DESIGN §4.5's fenced block, verbatim. This is the golden file. */
function designQuoteSheetBlock() {
  const md = readFileSync(DESIGN, 'utf8');
  const from = md.indexOf('### 4.5 Export');
  const to = md.indexOf('### 4.6');
  if (from < 0 || to < 0) throw new Error('DESIGN.md §4.5 not found — has the design moved?');
  const m = /```\n([\s\S]*?)```/.exec(md.slice(from, to));
  if (!m) throw new Error('DESIGN.md §4.5 has no fenced format block');
  return m[1];
}

/* ================================================================ servers */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

function startStatic(dir) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = join(dir, decodeURIComponent(url.pathname));
    try {
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

/**
 * A stub OpenAI-compatible transcription endpoint.
 *   Bearer good → 200 verbose_json after ~380 ms (so "OK, 0.4 s" is a real
 *                 measurement of a real round trip, not a hardcoded string)
 *   anything else → 401 with a provider-shaped error body
 */
function startProvider() {
  const server = createServer(async (req, res) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

    const auth = req.headers.authorization ?? '';
    if (auth !== 'Bearer good') {
      res.writeHead(401, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided.', code: 'invalid_api_key' } }));
      return;
    }
    await sleep(380);
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({
      language: 'en', duration: 1.0, text: '',
      words: [{ word: 'ok', start: 0.1, end: 0.4 }],
      segments: [{ start: 0, end: 1.0 }],
    }));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

/* ================================================================== media */

function ensureMedia() {
  mkdirSync(MEDIA, { recursive: true });
  const files = {
    small: join(MEDIA, 'small.wav'),   // 4 s — the happy path
    big: join(MEDIA, 'big.wav'),       // 900 s / ~27 MB — over the 25 MB direct limit
    long: join(MEDIA, 'long.mp3'),     // 10 860 s — over the three-hour ceiling
  };
  const jobs = [
    [files.small, ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=4', '-ac', '1', '-c:a', 'pcm_s16le']],
    [files.big, ['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '900', '-c:a', 'pcm_s16le']],
    [files.long, ['-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '10860', '-c:a', 'libmp3lame', '-b:a', '8k']],
  ];
  for (const [out, args] of jobs) {
    if (existsSync(out)) continue;
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, out], { stdio: 'inherit' });
  }
  return files;
}

/* ============================================================ page driving */

async function waitForApp(page) {
  await page.waitForSelector('[data-screen]', { timeout: 10000 });
  await sleep(150);
}

async function openScreen(page, base, hash, query = '') {
  await page.goto(`${base}/${query}${hash}`, { waitUntil: 'load' });
  await waitForApp(page);
  if (hash === '#/') {
    // First run lands *inside* the sample (DESIGN §4, §6 moment 1). Coming back
    // out to the Library is the user path §4.1 describes, so take it.
    await page.evaluate(() => { window.location.hash = '#/'; });
    await page.waitForSelector('[data-screen="library"]', { timeout: 10000 });
    await sleep(200);
  }
}

const textOf = (page, sel) => page.$eval(sel, (el) => el.textContent ?? '');

async function clickWhenReady(page, selector, timeout = 15000) {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector);
  await sleep(200);
}

async function setLanguage(page, base, lang) {
  await openScreen(page, base, '#/settings');
  await clickWhenReady(page, `[data-section="language"] [data-value="${lang}"]`);
}

async function chooseFile(page, path) {
  const input = await page.waitForSelector('[data-testid="file-input"]');
  await input.uploadFile(path);
}

/* ==================================================================== main */

async function main() {
  /* ---------------------------------------------------- 1 · the golden file */

  const golden = designQuoteSheetBlock();

  const mod = await bundle(
    [
      "import './src/i18n/strings';",
      "export { translate, setLang } from './src/i18n/index';",
      "export { buildQuoteSheet, quoteSheetFilename } from './src/export/quotesheet';",
      "export { EXPORT_FIXTURE_INTERVIEW, EXPORT_FIXTURE_NOTES, EXPORT_FIXTURE_PLACEHOLDERS } from './src/export/fixture';",
    ].join('\n').replaceAll("'./src/", `'${ROOT}/src/`),
    'wp3-export',
  );

  let expected = golden;
  for (const [placeholder, value] of Object.entries(mod.EXPORT_FIXTURE_PLACEHOLDERS)) {
    if (!expected.includes(placeholder)) bad(`DESIGN §4.5 no longer contains the placeholder ${placeholder}`);
    expected = expected.replaceAll(placeholder, value);
  }

  mod.setLang('en');
  const produced = mod.buildQuoteSheet({
    interview: mod.EXPORT_FIXTURE_INTERVIEW,
    notes: mod.EXPORT_FIXTURE_NOTES,
  });

  if (produced === expected) {
    ok(`quote sheet matches DESIGN §4.5 byte-for-byte (${Buffer.byteLength(produced)} bytes)`);
  } else {
    const a = produced.split('\n');
    const b = expected.split('\n');
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) diff.push(`line ${i + 1}\n        design: ${JSON.stringify(b[i])}\n        built : ${JSON.stringify(a[i])}`);
    }
    bad('quote sheet does NOT match DESIGN §4.5', diff.join('\n      '));
  }

  // The zh-CN sheet is not in DESIGN as a block, but the two things §7 of the
  // review names explicitly — the section headings and "（尚未核听）" — are.
  mod.setLang('zh-CN');
  const zh = mod.buildQuoteSheet({
    interview: mod.EXPORT_FIXTURE_INTERVIEW,
    notes: mod.EXPORT_FIXTURE_NOTES,
  });
  // Read the zh string while zh is still the current language — asking for it
  // after switching back is how you end up asserting the English one.
  const zhNotChecked = mod.translate('exportSheet.notChecked');
  mod.setLang('en');
  for (const needle of ['## 要点', '## 可引用', '## 你的', zhNotChecked]) {
    checks++;
    if (zh.includes(needle)) notes.push(`  ✓ zh-CN sheet carries ${JSON.stringify(needle)}`);
    else bad(`zh-CN quote sheet is missing ${JSON.stringify(needle)}`);
  }
  // Structure must survive translation: same line count, same ✓ column.
  eq('zh-CN sheet has the same line count as EN', zh.split('\n').length, produced.split('\n').length);
  eq('filename is slugged from the title', mod.quoteSheetFilename(mod.EXPORT_FIXTURE_INTERVIEW), 'callsign-white-flight.md');

  /* ------------------------------------------------------- 2 · version drift */

  const pkgVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const settingsSrc = readFileSync(join(ROOT, 'src/screens/Settings.tsx'), 'utf8');
  const declared = /const APP_VERSION = '([^']+)'/.exec(settingsSrc)?.[1];
  eq('Settings → About version matches package.json', declared, pkgVersion);

  if (ONLY_GOLDEN) return;

  /* ------------------------------------------------------------ 3 · headless */

  if (!existsSync(DIST)) throw new Error('dist/ is missing — run `npm run build` first');
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`);

  const media = ensureMedia();
  const puppeteer = (await import('puppeteer-core')).default;
  const site = await startStatic(DIST);
  const provider = await startProvider();
  const base = `http://127.0.0.1:${site.port}`;
  const providerUrl = `http://127.0.0.1:${provider.port}/v1`;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  /** Each scenario gets its own storage so a saved key cannot leak into the
      "no key yet" screenshot, and so first-run really is first run. */
  async function scenario(fn, { width = 390, height = 844, mobile = false } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await context.overridePermissions(base, ['clipboard-read', 'clipboard-write']);
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
    if (mobile) {
      await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    }
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try { await fn(page, errors); } finally { if (!KEEP) await context.close(); }
  }

  const t = (key, vars) => mod.translate(key, vars);
  const withLang = async (lang, fn) => { mod.setLang(lang === 'zh' ? 'zh-CN' : 'en'); await fn(); mod.setLang('en'); };

  /* --- 3a · the sheet as rendered, and what Copy actually puts on the clipboard */

  await scenario(async (page, errors) => {
    await openScreen(page, base, '#/', '?fixture=export');
    await page.waitForSelector('[data-testid="export-preview"]');
    const rendered = await textOf(page, '[data-testid="export-preview"]');
    eq('rendered export preview equals the design golden', rendered, expected);

    // Headless Chrome has no system clipboard to read back, so the assertion
    // wraps `writeText` and inspects what the component actually hands it —
    // which is the part we own anyway. The real call still goes through.
    await page.evaluate(() => {
      window.__copied = null;
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async (text) => { window.__copied = text; return orig(text); },
      });
    });
    await page.click('[data-testid="export-copy"]');
    await page.waitForFunction(() => window.__copied !== null, { timeout: 5000 });
    const clipboard = await page.evaluate(() => window.__copied);
    eq('Copy hands exactly the same bytes to the clipboard', clipboard, expected);

    checks++;
    if (errors.length) bad('console errors on the export sheet', errors.join('\n      '));
    else notes.push('  ✓ no console errors on the export sheet');
  }, { width: 1280, height: 900 });

  /* --- 3b · Bring refusals, both languages, real files and a real 401 --- */

  for (const lang of ['en', 'zh']) {
    // oversize — a real 27 MB wav on a browser that reports itself as a phone
    await scenario(async (page) => {
      if (lang === 'zh') await setLanguage(page, base, 'zh');
      await openScreen(page, base, '#/add');
      await chooseFile(page, media.big);
      await page.waitForSelector('[data-refusal="tooBigMobile"]', { timeout: 15000 });
      const text = await textOf(page, '[data-testid="bring-refusal"] .notice__text');
      await withLang(lang, () => eq(`[${lang}] oversize refusal is bring.tooBigMobile verbatim`,
        text, t('bring.tooBigMobile', { size: '27 MB' })));
    }, { mobile: true });

    // over three hours — a real 3h01m mp3
    await scenario(async (page) => {
      if (lang === 'zh') await setLanguage(page, base, 'zh');
      await openScreen(page, base, '#/add');
      await chooseFile(page, media.long);
      await page.waitForSelector('[data-refusal="tooLong"]', { timeout: 30000 });
      const text = await textOf(page, '[data-testid="bring-refusal"] .notice__text');
      await withLang(lang, () => eq(`[${lang}] over-three-hours refusal is bring.tooLong verbatim`,
        text, t('bring.tooLong')));
    });

    // refused key — a real 401 from the stub, with the preset left on OpenAI so
    // the sentence names the provider the way §4.3 shows it
    await scenario(async (page) => {
      if (lang === 'zh') await setLanguage(page, base, 'zh');
      await openScreen(page, base, '#/settings');
      await clickWhenReady(page, '[data-section="transcription"] .keyfield__disclosure');
      await page.$eval('[data-testid="stt-base"]', (el) => { el.value = ''; });
      await page.type('[data-testid="stt-base"]', providerUrl);
      await page.type('[data-testid="stt-key"]', 'bad');
      await sleep(200);

      await openScreen(page, base, '#/add');
      await chooseFile(page, media.small);
      await page.waitForSelector('[data-testid="bring-file"]', { timeout: 15000 });
      await page.click('[data-testid="bring-listen"]');
      await page.waitForSelector('[data-refusal="keyRefused"]', { timeout: 15000 });
      const text = await textOf(page, '[data-testid="bring-refusal"] .notice__text');
      await withLang(lang, () => eq(`[${lang}] refused key is bring.keyRefused verbatim`,
        text, t('bring.keyRefused', { provider: 'OpenAI' })));

      // §4.3: "field focused, nothing else changes"
      const stillOnBring = await page.$('[data-screen="bring"]');
      checks++;
      if (stillOnBring) notes.push(`  ✓ [${lang}] a refused key leaves you on Bring`);
      else bad(`[${lang}] a refused key navigated away from Bring`);
    });

    // offline — Chrome's real offline mode
    await scenario(async (page) => {
      if (lang === 'zh') await setLanguage(page, base, 'zh');
      await openScreen(page, base, '#/settings');
      await page.type('[data-testid="stt-key"]', 'good');
      await sleep(200);
      await openScreen(page, base, '#/add');
      await chooseFile(page, media.small);
      await page.waitForSelector('[data-testid="bring-file"]', { timeout: 15000 });
      await page.setOfflineMode(true);
      await page.click('[data-testid="bring-listen"]');
      await page.waitForSelector('[data-refusal="offline"]', { timeout: 15000 });
      const text = await textOf(page, '[data-testid="bring-refusal"] .notice__text');
      await withLang(lang, () => eq(`[${lang}] offline refusal is bring.offline verbatim`,
        text, t('bring.offline')));
      await page.setOfflineMode(false);
    });
  }

  /* --- 3c · the Settings Test button, against a real round trip --- */

  await scenario(async (page) => {
    await openScreen(page, base, '#/settings');
    await clickWhenReady(page, '[data-section="transcription"] .keyfield__disclosure');
    await page.$eval('[data-testid="stt-base"]', (el) => { el.value = ''; });
    await page.type('[data-testid="stt-base"]', providerUrl);
    await page.type('[data-testid="stt-key"]', 'good');
    await page.click('[data-testid="stt-test"]');
    await page.waitForFunction(
      () => /\S/.test(document.querySelector('[data-testid="stt-test-result"]')?.textContent ?? ''),
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => !(document.querySelector('[data-testid="stt-test-result"]')?.textContent ?? '').includes('…'),
      { timeout: 15000 },
    );
    const text = await textOf(page, '[data-testid="stt-test-result"]');
    const seconds = /(\d+\.\d)/.exec(text)?.[1];
    checks++;
    if (seconds && text === t('settings.testOk', { seconds })) {
      notes.push(`  ✓ Test reports settings.testOk verbatim — "${text}" (real round trip)`);
    } else {
      bad('Settings Test did not report settings.testOk', `actual ${JSON.stringify(text)}`);
    }

    // The refused case, same button.
    await page.$eval('[data-testid="stt-key"]', (el) => { el.value = ''; });
    await page.type('[data-testid="stt-key"]', 'bad');
    await page.click('[data-testid="stt-test"]');
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="stt-test-result"]')?.textContent ?? '').includes('401'),
      { timeout: 15000 },
    );
    const refused = await textOf(page, '[data-testid="stt-test-result"]');
    eq('Test reports a refused key as status · the §4.3 sentence',
      refused, t('settings.testFail', { status: '401', message: t('bring.keyRefused', { provider: 'OpenAI' }) }));

    const why = await textOf(page, '[data-testid="notes-why"]');
    eq('the "it never hears the audio" line is present verbatim', why, t('settings.notesWhy'));
  }, { width: 1280, height: 900 });

  /* --- 3d · Library: the sample card, its NASA tag, and no provider names --- */

  await scenario(async (page, errors) => {
    await openScreen(page, base, '#/');
    await page.waitForSelector('[data-testid="library-list"]');
    const tag = await textOf(page, '.librarycard__tag');
    eq('the sample card carries the NASA tag verbatim', tag, t('unit.sample'));
    const lede = await textOf(page, '.librarycard__lede');
    eq('the first-run lede is on the sample card', lede, t('library.lede'));

    // DoD 11 — no provider or model name may appear outside Settings.
    const body = await page.$eval('[data-screen="library"]', (el) => el.textContent ?? '');
    const banned = ['OpenAI', 'Groq', 'DeepSeek', 'OpenRouter', 'Moonshot', 'SiliconFlow', 'whisper', 'gpt-'];
    const hits = banned.filter((n) => body.toLowerCase().includes(n.toLowerCase()));
    checks++;
    if (hits.length) bad(`provider/model names on the Library surface: ${hits.join(', ')}`);
    else notes.push('  ✓ no provider or model names on the Library surface');

    // §7 — "No green for success." (Red is not screened: the accent IS a
    // red-orange, by design; green has no role in this product at all.)
    const greens = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor']) {
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(cs[prop]);
          if (!m) continue;
          const [r, g, b, a] = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
          if (a < 0.05) continue;
          if (g > r + 30 && g > b + 30) out.push(`${el.tagName}.${el.className} ${prop}=${cs[prop]}`);
        }
      }
      return out;
    });
    checks++;
    if (greens.length) bad('green found on the Library surface (§7 forbids it)', greens.slice(0, 5).join('\n      '));
    else notes.push('  ✓ no green anywhere on the Library surface');

    checks++;
    if (errors.length) bad('console errors on the Library', errors.join('\n      '));
    else notes.push('  ✓ no console errors on the Library');
  }, { width: 1280, height: 900 });

  /* --- 3e · the states that cannot exist on a clean machine --- */

  await scenario(async (page) => {
    await openScreen(page, base, '#/', '?fixture=empty');
    await page.waitForSelector('[data-testid="library-empty"]');
    eq('empty state title is verbatim', await textOf(page, '.library__empty-title'), t('library.emptyTitle'));
    eq('empty state body is verbatim', await textOf(page, '.library__empty-body'), t('library.emptyBody'));
  });

  await scenario(async (page) => {
    await openScreen(page, base, '#/', '?fixture=storage');
    await page.waitForSelector('[data-testid="library-read-failed"]');
    eq('storage read failure is verbatim', await textOf(page, '[data-testid="library-read-failed"] .notice__text'), t('library.readFailed'));
  });

  await scenario(async (page) => {
    await openScreen(page, base, '#/', '?fixture=listening');
    await page.waitForSelector('[data-testid="card-listening"]');
    eq('a recording still being heard says "Heard n of m min"',
      await textOf(page, '[data-testid="card-listening"]'), t('library.cardListening', { done: 0, total: 92 }));
  });

  /* ------------------------------------------------------- 4 · screenshots */

  mkdirSync(SHOTS, { recursive: true });
  const shot = async (name, theme, width, prepare) => {
    await scenario(async (page) => {
      // Set the theme the way a person does — through Settings. Writing the
      // localStorage slice directly only fools the pre-paint script; the store
      // still holds `system`, React re-applies it, and every "paper" shot comes
      // out in whatever the host machine prefers. (It did. That is why this
      // goes through the UI.)
      await openScreen(page, base, '#/settings');
      await clickWhenReady(page, `[data-section="theme"] [data-value="${theme}"]`);
      await prepare(page);
      // Clicking the theme control scrolls it into view; a screenshot of a
      // half-scrolled screen tells you nothing about how the screen opens.
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(400);
      const file = join(SHOTS, `${name}-${theme}-${width}.png`);
      await page.screenshot({ path: file, fullPage: false });
      ok(`screenshot ${name} · ${theme} · ${width}px`);
    }, { width, height: width === 390 ? 844 : 900 });
  };

  for (const theme of ['paper', 'ink']) {
    for (const width of [390, 1280]) {
      await shot('shot-library', theme, width, async (page) => {
        await openScreen(page, base, '#/');
        await page.waitForSelector('.librarycard__tag');
      });
      await shot('shot-bring-with-key-inline', theme, width, async (page) => {
        await openScreen(page, base, '#/add');
        await chooseFile(page, media.small);
        await page.waitForSelector('[data-testid="bring-file"]', { timeout: 15000 });
        await page.waitForSelector('[data-testid="bring-key"]');
      });
      await shot('shot-export-sheet', theme, width, async (page) => {
        await openScreen(page, base, '#/', '?fixture=export');
        await page.waitForSelector('[data-testid="export-preview"]');
      });
      await shot('shot-settings', theme, width, async (page) => {
        await openScreen(page, base, '#/settings');
        await page.waitForSelector('[data-section="about"]');
      });
    }
  }

  // zh-CN spot check at 390 px (DoD 10) — no clipped CJK, no raw keys on screen.
  for (const name of ['shot-library', 'shot-bring-with-key-inline', 'shot-export-sheet']) {
    await scenario(async (page) => {
      await setLanguage(page, base, 'zh');
      await clickWhenReady(page, '[data-section="theme"] [data-value="paper"]');
      if (name === 'shot-library') { await openScreen(page, base, '#/'); await page.waitForSelector('.librarycard__tag'); }
      if (name === 'shot-bring-with-key-inline') {
        await openScreen(page, base, '#/add');
        await chooseFile(page, media.small);
        await page.waitForSelector('[data-testid="bring-file"]', { timeout: 15000 });
      }
      if (name === 'shot-export-sheet') { await openScreen(page, base, '#/', '?fixture=export'); await page.waitForSelector('[data-testid="export-preview"]'); }
      await sleep(300);
      await page.screenshot({ path: join(SHOTS, `${name}-zh-390.png`) });
      const body = await page.$eval('body', (el) => el.textContent ?? '');
      checks++;
      if (/\b(library|bring|settings|exportSheet|action|unit)\.[a-zA-Z]+\b/.test(body)) {
        bad(`raw i18n key rendered in zh-CN on ${name}`);
      } else {
        notes.push(`  ✓ ${name} zh-CN at 390 px — no raw i18n keys`);
      }
    });
  }

  if (!KEEP) {
    await browser.close();
    site.server.close();
    provider.server.close();
  }
}

main().then(() => {
  console.log(notes.join('\n'));
  if (problems.length) {
    console.error(`\nverify-export: ${problems.length} problem(s) of ${checks} checks`);
    problems.forEach((p) => console.error('  ✗ ' + p));
    process.exit(1);
  }
  console.log(`\nverify-export: ${checks} checks passed — quote sheet matches DESIGN §4.5 byte-for-byte, refusal copy verbatim in both languages, screenshot set filed in shots/ ✓`);
}).catch((err) => {
  console.log(notes.join('\n'));
  console.error('\nverify-export: crashed');
  console.error(err);
  process.exit(1);
});
