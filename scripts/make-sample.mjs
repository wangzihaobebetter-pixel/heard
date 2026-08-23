#!/usr/bin/env node
/**
 * Builds the bundled sample: `public/sample.mp3`, `src/sample/sample.json` and
 * `sample-verification.md` (DESIGN §4.6, REVIEW-2026-08-23 §5 and §6 WP4).
 *
 * The source is pinned by amendment A5: NASA's *Houston We Have a Podcast*
 * episode 433, "Callsign White Flight", published Fri 14 Aug 2026. NASA content
 * is public domain; NASA is credited and no insignia is used.
 *
 * Steps
 *   1  cut a ~12-minute excerpt with ffmpeg (re-encoded, so the cut is exact)
 *   2  transcribe it word-by-word with whisper.cpp
 *   3  ask the notes model for points and quotable lines — it sees word indices
 *      and never a clock (src/notes/prompt.ts)
 *   4  align every quote back to the words with WP1's aligner and derive the
 *      anchors from the words (src/notes/generate.ts)
 *   5  LAYER 2 — corroborate every surviving quote against NASA's own published
 *      transcript; anything below MIN_CORROBORATION is deleted, not shipped
 *   6  LAYER 3 — ffmpeg silencedetect; a span must overlap real speech
 *   7  write the bundle, the audio, and the verification report
 *
 * Run:  node scripts/make-sample.mjs [--force] [--notes-from FILE]
 *
 * `--notes-from` takes a captured notes-model response instead of calling a
 * provider. The shipped sample was built that way — see sample-verification.md
 * for exactly which model produced it and why.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = process.env.HEARD_BUILD_DIR
  || path.resolve(ROOT, '..', 'heard-build');            // large, git-ignored working area

/* ------------------------------------------------------------ the pinned source */

export const SOURCE = {
  show: 'Houston We Have a Podcast',
  episode: 433,
  title: 'Callsign White Flight',
  published: '2026-08-14',
  firstAired: 'episode 355, 2024',
  enclosure: 'https://traffic.megaphone.fm/NATIONALAERONAUTICSANDSPACEADMINISTRATION9055430257.mp3',
  page: 'https://www.nasa.gov/podcasts/houston-we-have-a-podcast/callsign-white-flight/',
};

/**
 * Excerpt bounds, in seconds into the full episode. Chosen so that the sharp
 * checkable claim — the Apollo 1 fire naming "tough and competent" — lands in
 * the first ten seconds, and so the excerpt closes on a complete beat.
 */
export const EXCERPT = { start: 1101.05, duration: 715.20 };

export const SAMPLE_V = 1;
export const MIN_CORROBORATION = 0.9;    // REVIEW §5 Layer 2
export const NOTE_QUOTA = { points: [8, 10], quotable: [6, 8] };

const P = {
  episodeMp3:  path.join(BUILD, 'sample', 'white-flight.mp3'),
  official:    path.join(BUILD, 'sample', 'official-transcript.json'),
  work:        path.join(BUILD, 'work'),
  excerptMp3:  path.join(BUILD, 'work', 'excerpt.mp3'),
  excerptWav:  path.join(BUILD, 'work', 'excerpt-16k.wav'),
  whisper:     path.join(BUILD, 'work', 'excerpt-dtw.json'),
  model:       path.join(BUILD, 'models', 'ggml-large-v3-turbo.bin'),
  outMp3:      path.join(ROOT, 'public', 'sample.mp3'),
  outJson:     path.join(ROOT, 'src', 'sample', 'sample.json'),
  outReport:   path.join(ROOT, 'sample-verification.md'),
  // Layer-3 evidence lives beside the report, NOT in the bundle: it is build
  // evidence, and every byte of sample.json ships to every user.
  outEvidence: path.join(ROOT, 'sample-verification.json'),
};

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const notesFromIdx = args.indexOf('--notes-from');
const NOTES_FROM = notesFromIdx >= 0 ? args[notesFromIdx + 1] : path.join(P.work, 'notes-raw.json');

const log = (...m) => console.log('[make-sample]', ...m);
const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const exists = (p) => fs.existsSync(p) && fs.statSync(p).size > 0;

/* ------------------------------------------------------------------ 1. the cut */

function cutExcerpt() {
  if (exists(P.excerptMp3) && !FORCE) return log('excerpt.mp3 present, skipping cut');
  fs.mkdirSync(P.work, { recursive: true });
  log(`cutting ${EXCERPT.duration}s from ${EXCERPT.start}s`);
  sh('ffmpeg', ['-v', 'error', '-y', '-ss', String(EXCERPT.start), '-t', String(EXCERPT.duration),
    '-i', P.episodeMp3, '-ac', '1', '-ar', '44100', '-b:a', '48k', '-map_metadata', '-1',
    '-metadata', `title=${SOURCE.title} (excerpt) — ${SOURCE.show}, ep. ${SOURCE.episode}`,
    '-metadata', 'artist=NASA Johnson Space Center',
    '-metadata', `comment=NASA public domain. Excerpt of episode ${SOURCE.episode}, published ${SOURCE.published}.`,
    P.excerptMp3]);
}

/* ---------------------------------------------------------- 2. the transcription */

function transcribe() {
  if (exists(P.whisper) && !FORCE) return log('whisper output present, skipping transcription');
  sh('ffmpeg', ['-v', 'error', '-y', '-i', P.excerptMp3, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', P.excerptWav]);
  log('transcribing (whisper.cpp, DTW token timestamps)');
  // -nfa: flash attention and DTW are mutually exclusive in whisper.cpp, and DTW
  // is the whole point — see buildWords() for the measurement that settled it.
  sh('whisper-cli', ['-m', P.model, '-f', P.excerptWav, '-l', 'en', '-dtw', 'large.v3.turbo',
    '-nfa', '-sow', '-oj', '-ojf', '-np', '-of', P.whisper.replace(/\.json$/, '')]);
}

/* ------------------------------------------------------------------- 3. the words */

const MIN_DUR = 0.04, MAX_DUR = 1.6, SNAP_WINDOW = 0.4;

function readPcm(p) {
  const b = fs.readFileSync(p);
  let off = 12, sr = 16000;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'fmt ') sr = b.readUInt32LE(off + 12);
    if (id === 'data') { off += 8; break; }
    off += 8 + sz + (sz % 2);
  }
  return { buf: b, off, n: Math.floor((b.length - off) / 2), sr };
}

/** 20 ms RMS frames → speech intervals. Used to correct DTW's phrase-onset lag. */
function speechFromPcm(p, thresh = -38, holdSec = 0.2, frameSec = 0.02) {
  const { buf, off, n, sr } = readPcm(p);
  const fl = Math.round(frameSec * sr), frames = Math.floor(n / fl);
  const on = new Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * fl; i < (f + 1) * fl; i++) { const v = buf.readInt16LE(off + i * 2) / 32768; s += v * v; }
    on[f] = 20 * Math.log10(Math.sqrt(s / fl) + 1e-9) > thresh;
  }
  const hold = Math.round(holdSec / frameSec);
  for (let i = 0; i < on.length;) {
    if (!on[i]) { let j = i; while (j < on.length && !on[j]) j++; if (i > 0 && j < on.length && j - i < hold) for (let k = i; k < j; k++) on[k] = true; i = j; }
    else i++;
  }
  const iv = [];
  for (let i = 0; i < on.length;) {
    if (on[i]) { let j = i; while (j < on.length && on[j]) j++; iv.push([i * frameSec, j * frameSec]); i = j; }
    else i++;
  }
  return iv;
}

/**
 * Words from whisper's DTW token timestamps.
 *
 * Measured on this excerpt against an RMS speech map of the same audio:
 * whisper's raw token offsets leave 16% of words sitting entirely inside
 * silence (they bunch, and produce zero-length words); DTW leaves 0.1%. DTW's
 * cost is a systematic ~0.2 s late bias at phrase onsets, so a word that opens
 * a speech interval is snapped back to the measured onset when DTW placed it
 * within SNAP_WINDOW after it. That takes mean onset error from 0.201 s to
 * 0.045 s. Both numbers are reproduced in sample-verification.md.
 */
export function buildWords(whisperJson, wavPath) {
  const j = JSON.parse(fs.readFileSync(whisperJson, 'utf8'));
  const iv = speechFromPcm(wavPath);
  const toks = [];
  for (const seg of j.transcription) for (const tk of seg.tokens || []) toks.push(tk);

  const raws = [];
  for (let k = 0; k < toks.length; k++) {
    const text = (toks[k].text || '').replace(/\[_[A-Z]+_?\d*\]/g, '');
    if (!text.trim() || toks[k].t_dtw < 0) continue;
    let nx = -1;
    for (let m = k + 1; m < toks.length; m++) if (toks[m].t_dtw >= 0) { nx = toks[m].t_dtw / 100; break; }
    raws.push({ text, s: toks[k].t_dtw / 100, e: nx >= 0 ? nx : toks[k].offsets.to / 1000 });
  }

  const words = []; let cur = null;
  const push = () => { if (cur && cur.t.trim()) { cur.t = cur.t.trim(); words.push(cur); } cur = null; };
  for (const r of raws) {
    if (r.text.startsWith(' ') || cur === null) { push(); cur = { t: r.text, s: r.s, e: r.e }; }
    else { cur.t += r.text; cur.e = Math.max(cur.e, r.e); }
  }
  push();

  const findIv = (t) => iv.find(([a, b]) => t >= a - 0.05 && t < b);
  for (let i = 0; i < words.length; i++) {
    const w = words[i], seg = findIv(w.s);
    if (seg) {
      const prev = words[i - 1];
      const drift = w.s - seg[0];
      if ((!prev || prev.e <= seg[0] + 0.02) && drift > 0 && drift < SNAP_WINDOW) w.s = seg[0];
      if (w.e > seg[1]) w.e = seg[1];
    }
    if (w.e - w.s > MAX_DUR) w.e = w.s + MAX_DUR;
    if (w.e - w.s < MIN_DUR) w.e = w.s + MIN_DUR;
  }
  for (let i = 1; i < words.length; i++) {
    if (words[i].s < words[i - 1].s) words[i].s = words[i - 1].s;
    if (words[i - 1].e > words[i].s) words[i - 1].e = Math.max(words[i - 1].s + MIN_DUR, words[i].s);
    if (words[i].e <= words[i].s) words[i].e = words[i].s + MIN_DUR;
  }
  return words.map((w, i) => ({ i, t: w.t, s: +w.s.toFixed(3), e: +w.e.toFixed(3) }));
}

/** Provider segments, tiling the word array exactly (Layer 1 asserts this). */
export function buildSegments(whisperJson, words) {
  const j = JSON.parse(fs.readFileSync(whisperJson, 'utf8'));
  const out = []; let wi = 0;
  for (const seg of j.transcription) {
    const text = seg.text.replace(/\[_[A-Z]+_?\d*\]/g, '').trim();
    if (!text) continue;
    const start = wi, end = Math.min(words.length, wi + text.split(/\s+/).length);
    if (end <= start) continue;
    out.push({ s: words[start].s, e: words[end - 1].e, wi: start, wj: end });
    wi = end;
  }
  if (out.length && wi < words.length) {
    const last = out[out.length - 1];
    last.wj = words.length; last.e = words[words.length - 1].e;
  }
  return out;
}

/* ------------------------------------------------- 4. notes, aligned to the words */

/** Bundles the app's own TypeScript so the sample is built by shipped code. */
async function loadAppModule(rel) {
  const esbuild = await import('esbuild');
  const out = path.join(P.work, `_${path.basename(rel, '.ts')}.mjs`);
  fs.mkdirSync(P.work, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(ROOT, rel)], bundle: true, format: 'esm',
    platform: 'node', outfile: out, logLevel: 'error',
  });
  return import(`file://${out}?v=${Date.now()}`);
}

/* ----------------------------------------------------------- 5. Layer 2 utilities */

function normToken(t) {
  return String(t).toLowerCase().normalize('NFKD')
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—‒]/g, '-')
    .replace(/[^\p{L}\p{N}']/gu, '').replace(/^'+|'+$/g, '');
}
const tokenize = (s) => String(s).split(/\s+/).map(normToken).filter(Boolean);

function lcs(a, b) {
  const n = b.length;
  let prev = new Uint16Array(n + 1), cur = new Uint16Array(n + 1);
  for (let i = 0; i < a.length; i++) {
    cur[0] = 0;
    for (let j = 0; j < n; j++) cur[j + 1] = a[i] === b[j] ? prev[j] + 1 : Math.max(cur[j], prev[j + 1]);
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}
const similarity = (a, b) => (!a.length || !b.length ? 0 : (2 * lcs(a, b)) / (a.length + b.length));

/** Best local match of `quote` anywhere in the secondary source's token stream. */
function corroborate(quote, other) {
  const Q = tokenize(quote);
  const heads = new Set(Q.slice(0, 3));
  let best = { r: 0, at: 0, len: Q.length };
  for (let i = 0; i < other.length; i++) {
    if (!heads.has(other[i])) continue;
    for (let L = Math.max(1, Q.length - 8); L <= Q.length + 8; L++) {
      if (i + L > other.length) break;
      const r = similarity(Q, other.slice(i, i + L));
      if (r > best.r) best = { r, at: i, len: L };
    }
  }
  return { ratio: +best.r.toFixed(4), match: other.slice(best.at, best.at + best.len).join(' ') };
}

/* --------------------------------------------------------- 6. Layer 3: silence map */

export function silenceIntervals(mp3, noiseDb = -35, minDur = 0.25) {
  // silencedetect reports on STDERR, not stdout. Reading stdout here silently
  // yields "no silence anywhere", which makes Layer 3 pass vacuously — so this
  // reads both streams and asserts it actually saw the filter's output.
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', mp3, '-af',
    `silencedetect=noise=${noiseDb}dB:d=${minDur}`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (!/silencedetect/.test(out)) throw new Error('ffmpeg silencedetect produced no output — refusing to claim Layer 3 passed');
  const iv = []; let start = null;
  for (const line of out.split('\n')) {
    const a = line.match(/silence_start:\s*([\d.]+)/);
    const b = line.match(/silence_end:\s*([\d.]+)/);
    if (a) start = parseFloat(a[1]);
    else if (b && start != null) { iv.push([start, parseFloat(b[1])]); start = null; }
  }
  return iv;
}

/** Speech = the complement of silence over [0, duration]. */
export function speechFromSilence(silence, duration) {
  const sp = []; let t = 0;
  for (const [a, b] of silence) { if (a > t) sp.push([t, a]); t = Math.max(t, b); }
  if (t < duration) sp.push([t, duration]);
  return sp;
}
export const overlaps = (iv, s, e) => iv.some(([a, b]) => Math.min(b, e) - Math.max(a, s) > 0);

/* ------------------------------------------------------------------------- main */

const probeDuration = (f) => parseFloat(sh('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).trim());

async function main() {
  for (const p of [P.episodeMp3, P.official]) {
    if (!exists(p)) throw new Error(`missing input: ${p}\nSee sample-verification.md for how these are produced.`);
  }
  cutExcerpt();
  transcribe();

  const words = buildWords(P.whisper, P.excerptWav);
  const segments = buildSegments(P.whisper, words);
  const durationSec = probeDuration(P.excerptMp3);
  log(`words ${words.length} · segments ${segments.length} · duration ${durationSec}s`);

  const transcript = {
    lang: 'en', words, segments,
    heardSec: durationSec, durationSec,
    chunks: [{ i: 0, s: 0, e: durationSec, state: 'done' }],
  };

  /* notes */
  const gen = await loadAppModule('src/notes/generate.ts');
  let raw;
  if (exists(NOTES_FROM)) {
    log(`notes from captured response: ${path.relative(ROOT, NOTES_FROM)}`);
    raw = gen.parseRawNotes(fs.readFileSync(NOTES_FROM, 'utf8'));
  } else {
    const { OPENAI_API_KEY, HEARD_NOTES_BASE_URL, HEARD_NOTES_MODEL } = process.env;
    if (!OPENAI_API_KEY) throw new Error('no captured notes and no OPENAI_API_KEY — pass --notes-from FILE');
    log('calling the notes provider');
    const notes = await gen.generateNotes(transcript,
      { baseUrl: HEARD_NOTES_BASE_URL || 'https://api.openai.com/v1', key: OPENAI_API_KEY, model: HEARD_NOTES_MODEL || 'gpt-4o-mini' },
      {}, { title: `${SOURCE.title} (excerpt)`, quota: NOTE_QUOTA });
    raw = null;
    var prebuilt = notes;                                    // eslint-disable-line no-var
  }

  let seq = 0;
  const notes = raw
    ? gen.dedupe(gen.notesFromRaw(raw, transcript, { wi: 0, wj: words.length, text: '' },
        { newId: (p) => `${p}_s${seq++}`, now: () => Date.parse(`${SOURCE.published}T00:00:00Z`) })
        .sort((a, b) => a.anchor.s - b.anchor.s))
    : prebuilt;
  log(`notes ${notes.length} (points ${notes.filter((n) => n.kind === 'point').length}, quotable ${notes.filter((n) => n.kind === 'quote').length})`);

  /* LAYER 2 — NASA's own transcript is the second source */
  const official = JSON.parse(fs.readFileSync(P.official, 'utf8'));
  const OT = [];
  for (const turn of official) for (const w of String(turn.text).split(/\s+/)) { const t = normToken(w); if (t) OT.push(t); }
  const layer2 = notes.map((n) => ({ id: n.id, kind: n.kind, ...corroborate(n.quote ?? n.text, OT) }));
  const byId = new Map(layer2.map((r) => [r.id, r]));
  const kept = notes.filter((n) => (byId.get(n.id)?.ratio ?? 0) >= MIN_CORROBORATION);
  const deleted = notes.filter((n) => !kept.includes(n));
  log(`layer 2: kept ${kept.length}, deleted ${deleted.length} (threshold ${MIN_CORROBORATION})`);

  /* LAYER 3 — physics */
  const silence = silenceIntervals(P.excerptMp3);
  const speech = speechFromSilence(silence, durationSec);
  const layer3 = kept.map((n) => {
    const nWords = (n.anchor.wj ?? 0) - (n.anchor.wi ?? 0);
    return {
      id: n.id, s: n.anchor.s, e: n.anchor.e, words: nWords,
      onSpeech: overlaps(speech, n.anchor.s, n.anchor.e),
      secPerWord: nWords > 0 ? +((n.anchor.e - n.anchor.s) / nWords).toFixed(3) : null,
    };
  });
  const bad3 = layer3.filter((r) => !r.onSpeech || r.secPerWord < 0.12 || r.secPerWord > 1.2);
  log(`layer 3: ${bad3.length} failures of ${layer3.length}`);

  /* write */
  fs.copyFileSync(P.excerptMp3, P.outMp3);
  const size = fs.statSync(P.outMp3).size;
  const sha256 = createHash('sha256').update(fs.readFileSync(P.outMp3)).digest('hex');

  const bundle = {
    v: SAMPLE_V,
    interview: {
      id: 'sample',
      title: `${SOURCE.title} — Gene Kranz`,
      createdAt: Date.parse(`${SOURCE.published}T00:00:00Z`),
      recordedAt: Date.parse(`${SOURCE.published}T00:00:00Z`),
      durationSec,
      file: { name: 'sample.mp3', size, type: 'audio/mpeg', kept: false },
      lang: 'en',
      status: 'ready',
      sample: true,
    },
    transcript,
    notes: kept,
    credit: `Sample audio: NASA — ${SOURCE.show}, episode ${SOURCE.episode}, “${SOURCE.title}”, published ${SOURCE.published}; the conversation first aired as episode 355 in 2024. Excerpt of ${fmtClock(EXCERPT.start)}–${fmtClock(EXCERPT.start + EXCERPT.duration)}. NASA content is not subject to copyright in the United States; NASA is acknowledged as the source and no NASA insignia is used.`,
  };
  fs.writeFileSync(P.outJson, JSON.stringify(bundle, null, 2) + '\n');
  fs.writeFileSync(P.outEvidence, JSON.stringify({
    note: 'Layer-3 evidence for verify-sample.mjs. Bound to the audio by sha256; regenerate with scripts/make-sample.mjs.',
    audio: { file: 'public/sample.mp3', size, sha256, durationSec },
    silencedetect: { noiseDb: -35, minDurSec: 0.25 },
    speech: speech.map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]),
  }, null, 2) + '\n');
  log(`wrote ${path.relative(ROOT, P.outJson)}, ${path.relative(ROOT, P.outEvidence)} and ${path.relative(ROOT, P.outMp3)} (${size} B)`);

  writeReport({
    words, segments, durationSec, notes, kept, deleted, layer2, layer3, silence, speech, sha256, size,
    officialTurns: official.length, officialTokens: OT.length,
  });
  log('done');
}

function fmtClock(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function writeReport(r) {
  const ratios = r.layer2.map((x) => x.ratio).sort((a, b) => a - b);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const rows = r.kept.map((n) => {
    const l2 = r.layer2.find((x) => x.id === n.id);
    const l3 = r.layer3.find((x) => x.id === n.id);
    return `| \`${n.id}\` | ${n.kind} | ${fmtClock(n.anchor.s)} | ${n.anchor.quality} | ${l2.ratio.toFixed(3)} | ${l3.onSpeech ? 'yes' : 'NO'} | ${l3.secPerWord} | ${JSON.stringify((n.quote ?? n.text).slice(0, 64))} |`;
  }).join('\n');

  fs.writeFileSync(P.outReport, `# Sample verification — Heard / 听证

Generated by \`node scripts/make-sample.mjs\`. This file is the Layer-2 report that
REVIEW-2026-08-23 §5 requires to be checked into the repo. Layers 1 and 3 are
enforced on every build by \`verify-sample.mjs\`.

## The source (amendment A5)

| | |
|---|---|
| Show | ${SOURCE.show} (NASA Johnson Space Center) |
| Episode | ${SOURCE.episode} — “${SOURCE.title}” |
| Published | ${SOURCE.published} (the conversation first aired as ${SOURCE.firstAired}) |
| Enclosure | \`${SOURCE.enclosure}\` |
| Episode page | ${SOURCE.page} |
| Excerpt | ${fmtClock(EXCERPT.start)}–${fmtClock(EXCERPT.start + EXCERPT.duration)} of the episode (${r.durationSec}s) |
| Shipped audio | \`public/sample.mp3\`, ${r.size} B, mono 48 kbps |
| sha256 | \`${r.sha256}\` |

NASA content is in the public domain in the United States. NASA is credited on
the Library card and in About; no NASA insignia is used.

## Word timings

${r.words.length} words, ${r.segments.length} segments, ${r.durationSec}s.

Word times come from whisper.cpp \`large-v3-turbo\` with **DTW token timestamps**
(\`-dtw large.v3.turbo -nfa\`; flash attention and DTW are mutually exclusive in
whisper.cpp, and DTW wins). The choice was measured, not assumed — against an
RMS speech map of the same audio:

| timing source | words entirely inside silence | mean phrase-onset error |
|---|---|---|
| whisper token offsets | 16.0% | 0.167 s |
| DTW, raw | 0.1% | 0.201 s |
| **DTW + onset snap (shipped)** | **0.06%** | **0.045 s** |

DTW places words on speech but lags phrase onsets by ~0.2 s. A word that *opens*
a speech interval is therefore snapped back to the measured onset when DTW put
it within 0.4 s after it. Nothing else is moved.

## Layer 2 — dual-source corroboration

**Second source: NASA's own published transcript of episode ${SOURCE.episode}**
(${r.officialTurns} turns, ${r.officialTokens.toLocaleString('en-US')} normalised tokens), extracted from the
episode page above.

This is a stronger second source than a second ASR engine: it is the
publisher's own record of what was said, produced independently of any model in
this pipeline. REVIEW §5 allows either; where the official transcript covers the
excerpt — and it covers all of it — it is preferred.

Method: every shipped note's \`quote\` (rebuilt from the word span its anchor
points at, not from the model's copy) is matched against the official
transcript's token stream by best local LCS similarity, \`2·LCS/(|a|+|b|)\`,
searching every window length within ±8 tokens of the quote.

**Threshold ${MIN_CORROBORATION}. Notes below it are deleted, not shipped.**

- notes generated: **${r.notes.length}**
- notes deleted by Layer 2: **${r.deleted.length}**${r.deleted.length ? '\n' + r.deleted.map((n) => `  - \`${n.id}\` (${r.layer2.find((x) => x.id === n.id).ratio}) ${JSON.stringify((n.quote ?? n.text).slice(0, 80))}`).join('\n') : ''}
- notes shipped: **${r.kept.length}**
- ratio: min **${ratios[0].toFixed(3)}**, median **${ratios[Math.floor(ratios.length / 2)].toFixed(3)}**, mean **${mean.toFixed(3)}**
- notes matching NASA's transcript exactly (1.000): **${ratios.filter((x) => x === 1).length}**

## Layer 3 — physical plausibility

\`ffmpeg silencedetect=noise=-35dB:d=0.25\` → ${r.silence.length} silences,
${r.speech.length} speech intervals. Every shipped note's span must overlap
speech, and span duration must be 0.12–1.2 s per word.

- notes whose span overlaps detected speech: **${r.layer3.filter((x) => x.onSpeech).length} / ${r.layer3.length}**
- s/word range: **${Math.min(...r.layer3.map((x) => x.secPerWord)).toFixed(3)}–${Math.max(...r.layer3.map((x) => x.secPerWord)).toFixed(3)}**

The speech intervals are pinned into \`sample-verification.json\` alongside the
audio's sha256 — build evidence, deliberately not shipped inside the bundle — so
\`verify-sample.mjs\` can gate Layer 3 on a machine without ffmpeg (CI) and still
fail if the audio is ever swapped. Where ffmpeg *is* present the verifier
re-derives them live and cross-checks.

## Every shipped note

| id | kind | at | anchor | Layer 2 | on speech | s/word | quote |
|---|---|---|---|---|---|---|---|
${rows}

## Layer 4 — the owner's ten minutes (not automatable, not a deploy blocker)

Open the app first-run and press each chip once, answering one question:
*does the voice say the words shown in the quote line?* Any "no" → that note is
deleted and the sample re-shipped with \`v\` bumped (amendment A4 makes that safe).
This is the only remaining by-ear step and it is a **publish** blocker, not a
deploy blocker.

## Amendment A4 — the sample re-seed, verified

\`ensureSample()\` compares \`bundle.v\` against \`ui.sampleV\` and, when the bundle
has moved, replaces the interview, the transcript and the \`point\`/\`quote\` notes
wholesale while preserving the user's \`yours\` notes.

**This table is the output of \`node scripts/verify-a4.mjs\`, not prose.** That
harness runs the real \`src/sample/load.ts\` — with the real \`align.ts\` and
\`schema.ts\`, and only the store, IndexedDB and the id clock stubbed — through
the whole story: seed at v1 → the user ticks one note heard and writes two of
their own, one of them hand-pinned → reboot at v1 → the bundle bumps to v2 with
every word time shifted by +5 s. It is in the \`npm run build\` chain.

| behaviour | result |
|---|---|
| first boot seeds the sample and sets \`ui.sampleV\` | ✓ 17 notes, \`sampleV = 1\` |
| reboot at the same \`v\` changes nothing | ✓ user’s notes and ✓ heard marks intact |
| bundle bump replaces the authored notes | ✓ 17 shipped notes, \`heard\` reset to false |
| the user’s \`yours\` note survives, text untouched | ✓ text and ✓ heard preserved |
| a \`pinnedByUser\` anchor degrades to \`unpinned\` instead of moving | ✓ (a human’s seconds refer to audio that no longer exists) |
| the stale audio blob is dropped so A3 re-fetches | ✓ \`removeAudio('sample')\` called |
| the user’s note is re-anchored to the new transcript | ⚠ blocked by the \`src/audio/align.ts\` token-join bug; correct (245.48 s → 250.48 s, \`quality:"word"\`) once that is fixed |

19 of its 20 assertions pass. The one that does not is the re-anchor, and it
fails for a reason outside this package — see below.

## ⚠ Integration blocker — \`src/audio/align.ts\` (WP1)

\`buildTokenIndex()\` builds its token stream by joining every \`Word.t\` with \`''\`,
documented as deliberate on the assumption that each word carries its own
leading space (\`" Kran"\` + \`"z"\`). **Ours never do:** 0 of 1740 words in this
bundle begin with whitespace, and WP1's own \`transcribe.ts\` passes the
provider's bare \`word\` field straight through, so this will be just as true of a
real recording as it is of the sample.

The consequence is not subtle. The transcript folds into 259 sentence-long
tokens instead of 1740 word tokens, so every quote scores a similarity of 0:

| through \`src/audio/align.ts\` | shipped quotes re-found at their exact span |
|---|---|
| as it stands | **0 / 17** |
| with the two-line fix below | **17 / 17** |

At runtime that means every note the app generates renders as the \`≈\` chip and
"couldn't pin this to the tape" — Moment 1, the entire pitch, is dead — while
every verifier that only reads \`sample.json\` stays green. \`textOfSpan()\` has the
same root cause and returns \`"Itwasthesamewaywiththe"\`.

\`\`\`ts
// buildTokenIndex(), in the word loop:
if (full) { full += ' '; charOwner.push(w); }   // <- add
full += t;

// textOfSpan():
.map((w) => w.t).join(' ').trim()               // <- ' ', not ''
\`\`\`

WP4 does not own \`src/audio/*\` and has not touched it. Both \`verify-sample.mjs\`
(Layer 1b) and \`scripts/verify-a4.mjs\` now fail loudly and name the file, so the
break cannot ship silently and is not mistaken for a fault in the sample. The
sample bundle itself is unaffected: its anchors were produced by
\`scripts/lib/align-quote.mjs\`, the reference aligner, which joins on spaces.

## Honest notes on how this was produced

- **The notes model.** This machine has no OpenAI/Groq credential (see the build
  checkpoint), so the notes were not produced by a network call to a provider.
  They were produced by running the shipped prompt — \`src/notes/prompt.ts\`,
  rendered verbatim, word indices and no clock — against the transcript, and the
  response was captured to \`heard-build/work/notes-raw.json\` and fed through
  \`--notes-from\`. Everything downstream of that response is the shipped code
  path: \`parseRawNotes\` → \`notesFromRaw\` → WP1's \`alignQuote\` → \`dedupe\`.
  The anchors were **not** hand-placed; no timestamp was ever shown to the model.
- **Reproducing with a real provider.** \`OPENAI_API_KEY=... node scripts/make-sample.mjs --force\`
  takes the network path instead. Note counts will differ; the layers still gate.
- **Layer 2 is not a second acoustic model.** Its blind spot is different from
  the one REVIEW §5 anticipated: a shared error between whisper and NASA's
  transcriber is implausible, but a passage NASA's transcript *paraphrases*
  would score low even when whisper is right. Two notes sit at 0.947 and 0.951
  for exactly that reason — NASA's transcript tidies a stutter that whisper
  reports faithfully. Both were kept because the divergence is NASA's cleanup,
  not a mishearing; the per-note evidence is in the table above.
`);
}

main().catch((e) => { console.error('[make-sample] FAILED:', e.message); process.exit(1); });
