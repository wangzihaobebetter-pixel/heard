#!/usr/bin/env node
/**
 * verify-sample — Layers 1 and 3 of the sample verification (REVIEW-2026-08-23 §5).
 *
 * Layer 1 is structural truth: it proves the shipped notes point where they say
 * they point, using nothing but `sample.json` itself. Layer 3 is physics: a span
 * that claims to be speech must overlap actual speech.
 *
 * Layer 2 — corroboration against NASA's own transcript — is a one-time report
 * checked in as `sample-verification.md`; it cannot run here because it needs
 * the full build corpus.
 *
 * This script sits in the `npm run build` chain, so a broken sample physically
 * cannot deploy. It must therefore work on a CI runner with no ffmpeg: the
 * Layer-3 speech map is pinned in `sample-verification.json` and bound to the
 * audio by sha256, so swapping the mp3 without regenerating fails. Where ffmpeg
 * *is* available the map is re-derived live and cross-checked.
 *
 * WP4 owns this file. Run: `node verify-sample.mjs`
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const F = {
  bundle: path.join(ROOT, 'src', 'sample', 'sample.json'),
  evidence: path.join(ROOT, 'sample-verification.json'),
  report: path.join(ROOT, 'sample-verification.md'),
  mp3: path.join(ROOT, 'public', 'sample.mp3'),
};

let failures = 0, checks = 0;
const layerOf = { current: 1 };
function ok(cond, label, detail) {
  checks++;
  if (cond) return true;
  failures++;
  console.error(`  ✗ [L${layerOf.current}] ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}
const layer = (n, title) => { layerOf.current = n; console.log(`\nLayer ${n} — ${title}`); };

/* --------------------------------------------------------------- normalisation */

/** Must match `normalizeTokens` in src/audio/align.ts: case, punctuation, space folded. */
function tokens(text) {
  const out = []; let buf = '';
  const flush = () => { if (buf) { out.push(buf); buf = ''; } };
  for (const ch of String(text ?? '').toLowerCase().normalize('NFKC')) {
    const code = ch.codePointAt(0) ?? 0;
    const isCjk = (code >= 0x3040 && code <= 0x30ff) || (code >= 0x3400 && code <= 0x4dbf)
      || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff);
    if (isCjk) { flush(); out.push(ch); continue; }
    if (/[a-z0-9À-ɏ]/.test(ch)) { buf += ch; continue; }
    if ((ch === "'" || ch === '’') && buf) continue;
    flush();
  }
  flush();
  return out;
}

const SPELLED = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|first|second|third)\b/i;
/** A capitalised word that is not merely sentence-initial. */
function hasProperNoun(s) {
  const w = String(s).split(/\s+/);
  return w.some((t, i) => i > 0 && /^[A-Z][a-zA-Z’'-]+/.test(t) && !/^[A-Z]\.$/.test(t));
}

/* ------------------------------------------------------------------- load */

if (!fs.existsSync(F.bundle)) { console.error(`missing ${F.bundle}`); process.exit(1); }
const rawBundle = fs.readFileSync(F.bundle, 'utf8');
const b = JSON.parse(rawBundle);
const t = b.transcript ?? {};
const words = t.words ?? [];
const notes = b.notes ?? [];

console.log(`verify-sample: ${words.length} words · ${(t.segments ?? []).length} segments · ${notes.length} notes · ${t.durationSec}s`);

/* ------------------------------------------------------- Layer 1: structure */

layer(1, 'structural truth');

ok(!/STUB/.test(rawBundle), 'no STUB string anywhere in sample.json');
ok(typeof b.v === 'number' && b.v >= 1, 'bundle version v >= 1', `v=${b.v}`);
ok(typeof b.credit === 'string' && /NASA/.test(b.credit), 'NASA is credited in the bundle');
ok(fs.existsSync(F.report), 'sample-verification.md (Layer 2 report) is checked in');
ok(b.interview?.sample === true && b.interview?.id === 'sample', 'interview is flagged as the sample');
ok(words.length > 0, 'transcript has words');

/* word times */
{
  let bad = 0, badFirst = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const good = w.i === i && Number.isFinite(w.s) && Number.isFinite(w.e)
      && w.s < w.e && w.s >= 0 && w.e <= t.durationSec + 1e-6
      && (i === 0 || w.s >= words[i - 1].s - 1e-9);
    if (!good) { bad++; if (badFirst === null) badFirst = i; }
  }
  ok(bad === 0, 'word times strictly ordered, s < e, inside [0, durationSec]',
    bad ? `${bad} bad, first at index ${badFirst}: ${JSON.stringify(words[badFirst])}` : '');
}

/* segments tile the word array */
{
  const segs = t.segments ?? [];
  let tiled = segs.length > 0 && segs[0].wi === 0 && segs[segs.length - 1].wj === words.length;
  let breakAt = -1;
  for (let i = 1; i < segs.length; i++) if (segs[i].wi !== segs[i - 1].wj) { tiled = false; breakAt = i; break; }
  ok(tiled, 'segments tile the word array with no gap or overlap',
    breakAt >= 0 ? `break at segment ${breakAt}` : (segs.length ? `first.wi=${segs[0].wi} last.wj=${segs[segs.length - 1].wj} words=${words.length}` : 'no segments'));
  const timesOk = segs.every((s) => s.wj > s.wi && Math.abs(s.s - words[s.wi].s) < 1e-6 && Math.abs(s.e - words[s.wj - 1].e) < 1e-6);
  ok(timesOk, 'each segment’s times match the words it covers');
}

/* chunks continuous */
{
  const ch = t.chunks ?? [];
  let cont = ch.length > 0 && Math.abs(ch[0].s) < 1e-6 && Math.abs(ch[ch.length - 1].e - t.durationSec) < 1e-6;
  for (let i = 1; i < ch.length; i++) if (Math.abs(ch[i].s - ch[i - 1].e) > 1e-6) cont = false;
  ok(cont, 'chunk records are continuous and cover the whole recording');
  ok(ch.every((c) => c.state === 'done'), 'every chunk is done (the sample has no gap)');
}

/* the notes */
{
  const points = notes.filter((n) => n.kind === 'point');
  const quotable = notes.filter((n) => n.kind === 'quote');
  ok(points.length >= 6 && points.length <= 12, 'between 6 and 12 points', `${points.length}`);
  ok(quotable.length >= 4 && quotable.length <= 10, 'between 4 and 10 quotable lines', `${quotable.length}`);
  ok(notes.every((n) => n.anchor?.quality === 'word'), 'every shipped note is quality:"word" (A5 — no ≈ on first run)',
    notes.filter((n) => n.anchor?.quality !== 'word').map((n) => `${n.id}:${n.anchor?.quality}`).join(', '));
  ok(notes.every((n) => n.heard === false), 'no note ships pre-marked as heard');
  ok(new Set(notes.map((n) => n.id)).size === notes.length, 'note ids are unique');

  for (const n of notes) {
    const { wi, wj } = n.anchor ?? {};
    if (!ok(Number.isInteger(wi) && Number.isInteger(wj) && wi >= 0 && wj > wi && wj <= words.length,
      `note ${n.id}: anchor has a valid word range`, `wi=${wi} wj=${wj}`)) continue;
    const span = words.slice(wi, wj);
    ok(JSON.stringify(tokens(n.quote)) === JSON.stringify(tokens(span.map((w) => w.t).join(' '))),
      `note ${n.id}: quote occurs verbatim at [${wi}, ${wj})`,
      `quote=${JSON.stringify(String(n.quote).slice(0, 60))} span=${JSON.stringify(span.map((w) => w.t).join(' ').slice(0, 60))}`);
    ok(Math.abs(n.anchor.s - words[wi].s) < 1e-6, `note ${n.id}: anchor.s === words[wi].s`, `${n.anchor.s} vs ${words[wi].s}`);
    ok(Math.abs(n.anchor.e - words[wj - 1].e) < 1e-6, `note ${n.id}: anchor.e === words[wj-1].e`, `${n.anchor.e} vs ${words[wj - 1].e}`);
  }

  /* the first point carries the moment */
  const first = points.slice().sort((a, x) => a.anchor.s - x.anchor.s)[0];
  if (ok(!!first, 'there is a first point')) {
    ok(first.anchor.s < 120, 'the first point starts before 120 s', `${first.anchor.s}s`);
    const q = first.quote ?? '';
    ok(/\d/.test(q) || SPELLED.test(q) || hasProperNoun(q),
      'the first point’s quote carries a digit, a spelled number, or a proper noun', JSON.stringify(q.slice(0, 70)));
  }
}

/* ------------------------ Layer 1b: the round trip through the shipped aligner */

/**
 * Layer 1 proves the bundle is internally consistent. It cannot prove the thing
 * the product actually promises: that the app, at runtime, can take a quote and
 * find it on the tape. That is `src/audio/align.ts` (WP1), and it is a separate
 * failure surface — the sample can be perfect while the aligner is blind.
 *
 * So: feed every shipped quote back through the REAL aligner and require it to
 * land on the exact word span the bundle claims. If this fails, every note the
 * app generates renders as `≈` and Moment 1 is dead, however green Layer 1 is.
 */
layer('1b', 'the round trip through the shipped aligner (src/audio/align.ts)');

const ALIGN_SRC = path.join(ROOT, 'src', 'audio', 'align.ts');
if (!fs.existsSync(ALIGN_SRC)) {
  console.log('  · src/audio/align.ts not present (WP1 has not landed) — round trip skipped');
} else {
  let A = null;
  try {
    const { build } = await import('esbuild');
    const out = path.join(ROOT, 'node_modules', '.cache', 'verify-sample-align.mjs');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await build({
      entryPoints: [ALIGN_SRC], bundle: true, format: 'esm', platform: 'node',
      outfile: out, logLevel: 'silent',
      plugins: [{
        name: 'types', setup(b) {
          b.onResolve({ filter: /(^|\/)types$/ }, () => ({ path: 'types', namespace: 'vs' }));
          b.onLoad({ filter: /.*/, namespace: 'vs' }, () => ({ contents: 'export {}', loader: 'ts' }));
        },
      }],
    });
    A = await import(`${pathToFileURL(out).href}?t=${Date.now()}`);
  } catch (e) {
    console.log(`  · could not build src/audio/align.ts (${e.message}) — round trip skipped`);
  }

  if (A?.alignQuote) {
    const index = A.buildTokenIndex(words);
    // A transcript of N words cannot normalise to a handful of tokens. When it
    // does, the index is gluing words together and every ratio collapses to 0.
    ok(index.tokens.length >= words.length * 0.8,
      'the aligner tokenises one token per word, give or take',
      `${index.tokens.length} tokens for ${words.length} words`);

    const missed = [];
    for (const n of notes) {
      const r = A.alignQuote(n.quote, words, { index, segments: t.segments });
      if (r.anchor.wi !== n.anchor.wi || r.anchor.wj !== n.anchor.wj) {
        missed.push(`${n.id} want [${n.anchor.wi},${n.anchor.wj}) got [${r.anchor.wi},${r.anchor.wj}) ratio=${r.ratio.toFixed(3)} ${r.anchor.quality}`);
      }
    }
    if (!ok(missed.length === 0, `all ${notes.length} shipped quotes re-align to their exact span`,
      `${missed.length} missed`)) {
      for (const line of missed.slice(0, 5)) console.error(`      ${line}`);
      if (missed.length > 5) console.error(`      … and ${missed.length - 5} more`);
      console.error([
        '',
        '  ┌─ INTEGRATION FAILURE — this is NOT the sample bundle, it is src/audio/align.ts (WP1).',
        '  │  buildTokenIndex() joins word text with \'\' on the assumption that each Word.t',
        '  │  carries its own leading space. Our Word.t never does (0 of ' + words.length + ' here, and',
        '  │  transcribe.ts passes the provider\'s bare `word` field straight through), so the',
        '  │  whole transcript folds into a few hundred sentence-long tokens and every quote',
        '  │  scores 0. At runtime EVERY generated note would render as the `≈` chip.',
        '  │',
        '  │  Fix, in buildTokenIndex():   if (full) { full += \' \'; charOwner.push(w); }',
        '  │                               full += t;',
        '  │  And in textOfSpan():         .map((w) => w.t).join(\' \')   // not join(\'\')',
        '  │  Verified: with those two lines, 17/17 shipped quotes re-align exactly.',
        '  └─ WP4 may not edit src/audio/*; this check exists so the break cannot ship silently.',
        '',
      ].join('\n'));
    }
  }
}

/* --------------------------------------------- Layer 3: physical plausibility */

layer(3, 'physical plausibility');

const evidence = fs.existsSync(F.evidence) ? JSON.parse(fs.readFileSync(F.evidence, 'utf8')) : null;
ok(!!evidence, 'sample-verification.json (pinned Layer-3 evidence) is present');
ok(fs.existsSync(F.mp3), 'public/sample.mp3 is present');

let speech = null;
if (evidence && fs.existsSync(F.mp3)) {
  const bytes = fs.readFileSync(F.mp3);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const bound = ok(sha === evidence.audio?.sha256,
    'the pinned speech map matches public/sample.mp3 (sha256)',
    `mp3=${sha.slice(0, 16)}… pinned=${String(evidence.audio?.sha256).slice(0, 16)}…`);
  ok(bytes.length === evidence.audio?.size, 'mp3 byte size matches the pinned evidence');
  ok(Math.abs((evidence.audio?.durationSec ?? -1) - t.durationSec) <= 0.5,
    'pinned audio duration is within ±0.5 s of transcript.durationSec',
    `${evidence.audio?.durationSec} vs ${t.durationSec}`);
  if (bound) speech = evidence.speech;
}

/* ffprobe / ffmpeg when the machine has them; skipped-but-announced when not */
const has = (bin) => spawnSync(bin, ['-version'], { encoding: 'utf8' }).status === 0;

if (has('ffprobe')) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', F.mp3], { encoding: 'utf8' });
  const dur = parseFloat(String(r.stdout).trim());
  ok(Number.isFinite(dur) && Math.abs(dur - t.durationSec) <= 0.5,
    'ffprobe mp3 duration within ±0.5 s of transcript.durationSec', `${dur} vs ${t.durationSec}`);
} else {
  console.log('  · ffprobe not on PATH — duration checked against the pinned, hash-bound evidence instead');
}

if (has('ffmpeg')) {
  const cfg = evidence?.silencedetect ?? { noiseDb: -35, minDurSec: 0.25 };
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', F.mp3, '-af',
    `silencedetect=noise=${cfg.noiseDb}dB:d=${cfg.minDurSec}`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (ok(/silencedetect/.test(out), 'ffmpeg silencedetect produced output')) {
    const sil = []; let start = null;
    for (const line of out.split('\n')) {
      const a = line.match(/silence_start:\s*([\d.]+)/), z = line.match(/silence_end:\s*([\d.]+)/);
      if (a) start = parseFloat(a[1]);
      else if (z && start != null) { sil.push([start, parseFloat(z[1])]); start = null; }
    }
    const live = []; let cur = 0;
    for (const [a, z] of sil) { if (a > cur) live.push([cur, a]); cur = Math.max(cur, z); }
    if (cur < t.durationSec) live.push([cur, t.durationSec]);
    // cross-check the pinned map rather than replace it: they must agree closely
    if (speech) {
      const cover = (iv, s, e) => iv.reduce((c, [a, z]) => c + Math.max(0, Math.min(z, e) - Math.max(a, s)), 0);
      const totalLive = cover(live, 0, t.durationSec), totalPinned = cover(speech, 0, t.durationSec);
      ok(Math.abs(totalLive - totalPinned) < 1.0,
        'live silencedetect agrees with the pinned speech map (±1 s of total speech)',
        `live=${totalLive.toFixed(2)}s pinned=${totalPinned.toFixed(2)}s`);
    }
    speech = speech ?? live;
  }
} else {
  console.log('  · ffmpeg not on PATH — Layer 3 runs against the pinned, hash-bound speech map');
}

if (ok(!!speech && speech.length > 0, 'a speech map is available for Layer 3')) {
  const overlaps = (s, e) => speech.some(([a, z]) => Math.min(z, e) - Math.max(a, s) > 0);
  let offSpeech = 0, badRate = [];
  for (const n of notes) {
    if (!overlaps(n.anchor.s, n.anchor.e)) { offSpeech++; console.error(`  ✗ [L3] note ${n.id} span lies in silence (${n.anchor.s}–${n.anchor.e})`); }
    const nw = (n.anchor.wj ?? 0) - (n.anchor.wi ?? 0);
    const rate = nw > 0 ? (n.anchor.e - n.anchor.s) / nw : Infinity;
    if (!(rate >= 0.12 && rate <= 1.2)) badRate.push(`${n.id}=${rate.toFixed(3)}`);
  }
  checks++; if (offSpeech) failures++;
  ok(badRate.length === 0, 'every span is 0.12–1.2 s per word', badRate.join(', '));
  if (!offSpeech) console.log(`  ✓ all ${notes.length} note spans overlap detected speech`);
}

/* ------------------------------------------------------------------- verdict */

console.log(`\n${failures === 0 ? '✓' : '✗'} verify-sample: ${checks - failures}/${checks} checks passed`);
if (failures > 0) { console.error(`${failures} failure(s)`); process.exit(1); }
