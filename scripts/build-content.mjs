#!/usr/bin/env node
/**
 * Builds the v3 starter library (PRODUCT-SPEC §5, engineering plan B1).
 *
 * Inputs, per entry in content/registry.mjs:
 *   heard-build/content/<id>/whisper.json   — whisper.cpp large-v3-turbo, DTW timestamps
 *   heard-build/content/<id>/full-16k.wav   — the 16 kHz mono decode whisper ran on
 *   heard-build/content/<id>/source.mp3     — the verified original download
 *   heard-build/content/<id>/official.html|official.xml
 *                                           — the publisher's own transcript
 *                                             (see research/material-audit.md for
 *                                             why three of these were re-fetched)
 *   content/artifacts/<id>.json             — the authored AI layer: summary,
 *                                             chapters, concepts, flags and the
 *                                             curated example notes. Quotes in it
 *                                             are requests, not truth — every one
 *                                             is aligned to the word timeline and
 *                                             corroborated against the official
 *                                             transcript here, and the build FAILS
 *                                             on any quote that does not survive.
 *
 * Outputs:
 *   public/starter/<id>.mp3        — 48 kbps mono re-encode (lazy-fetched, A3 door)
 *   public/starter/<id>.json       — StarterBundle (src/content/schema.ts)
 *   src/content/manifest.json      — bundled card data + mini peaks
 *   content-verification.md        — the per-quote evidence, checked in
 *
 * Words and segments come from the same code the v2 sample shipped with
 * (scripts/make-sample.mjs buildWords/buildSegments — DTW + onset snap; the
 * measurements behind that choice are in sample-verification.md). Quote
 * alignment is scripts/lib/align-quote.mjs, the reference aligner.
 *
 * Run:  node scripts/build-content.mjs [--only <id>] [--force]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildWords, buildSegments } from './make-sample.mjs';
import { alignQuote, tokenize, similarity } from './lib/align-quote.mjs';
import { ENTRIES, CONTENT_DATE, CONTENT_V } from '../content/registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = process.env.HEARD_BUILD_DIR || path.resolve(ROOT, '..', 'heard-build');
const SRC = (id, f) => path.join(BUILD, 'content', id, f);
const OUT_DIR = path.join(ROOT, 'public', 'starter');
const MANIFEST = path.join(ROOT, 'src', 'content', 'manifest.json');
const REPORT = path.join(ROOT, 'content-verification.md');

const MIN_ALIGN = 0.85;          // DESIGN §4.6 aligner floor
const MIN_CORROBORATION = 0.9;   // Layer-2 default; registry may lower per entry
const PEAKS_BUCKETS = 180;       // matches src/audio/peaks.ts

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

const log = (...m) => console.log('[build-content]', ...m);
const sh = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const exists = (p) => fs.existsSync(p) && fs.statSync(p).size > 0;

/* -------------------------------------------------- official transcript text */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…',
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Publisher text → normalised token stream. Tag-stripping the whole document
 * keeps navigation chrome in the stream, which is harmless: corroboration is a
 * best *local* match, so junk tokens can only fail to match, never help.
 * Works for both the HTML pages and the LOC TEI XML (speaker labels and stage
 * notes survive as plain text, which is exactly what we want to match against).
 */
function officialText(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return decodeEntities(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

/**
 * Dashes and hyphens are orthography, not speech, and publishers disagree with
 * the ASR in both directions: FDR's transcript sets em-dashes tight ("1941—a
 * date"), the JFK typescript writes "forward--and", Yale writes
 * "state-of-the-art" where whisper split four words — and Reagan's transcript
 * writes "fainthearted" as one word where whisper hyphenated. So Layer 2 is
 * scored under BOTH conventions — every dash a separator, and every dash
 * removed — with the same treatment on both sides each time, and the better
 * score wins. Symmetric normalisation can only align styles, never blur a
 * genuine word mismatch.
 */
const splitDashes = (s) => tokenize(String(s).replace(/[–—‒-]+/g, ' '));
// lib normToken already folds a dash-joined token into one word ("faint-hearted"
// → "fainthearted"), so plain tokenize IS the fused convention.
const fuseDashes = (s) => tokenize(String(s).replace(/--+/g, '-'));

/** Best local match of `Q` in the token stream `other` (make-sample §5). */
function bestLocal(Q, other) {
  const heads = new Set(Q.slice(0, 3));
  let best = 0;
  for (let i = 0; i < other.length; i++) {
    if (!heads.has(other[i])) continue;
    for (let L = Math.max(1, Q.length - 8); L <= Q.length + 8; L++) {
      if (i + L > other.length) break;
      const r = similarity(Q, other.slice(i, i + L));
      if (r > best) best = r;
    }
  }
  return best;
}

/** Layer 2: `quote` against the official document, under both dash conventions. */
function corroborate(quote, official) {
  const r = Math.max(
    bestLocal(splitDashes(quote), official.split),
    bestLocal(fuseDashes(quote), official.fused),
  );
  return { ratio: +r.toFixed(4) };
}

/* --------------------------------------------------------------------- peaks */

function readPcm(p) {
  const b = fs.readFileSync(p);
  let off = 12;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'data') { off += 8; break; }
    off += 8 + sz + (sz % 2);
  }
  return { buf: b, off, n: Math.floor((b.length - off) / 2) };
}

/** RMS buckets normalised to the loudest — same shape src/audio/peaks.ts draws. */
function computePeaks(wav, buckets = PEAKS_BUCKETS) {
  const { buf, off, n } = readPcm(wav);
  const per = Math.max(1, Math.floor(n / buckets));
  const out = new Array(buckets).fill(0);
  for (let b = 0; b < buckets; b++) {
    let sum = 0, cnt = 0;
    for (let i = b * per; i < Math.min(n, (b + 1) * per); i += 16) {
      const v = buf.readInt16LE(off + i * 2) / 32768;
      sum += v * v; cnt++;
    }
    out[b] = cnt ? Math.sqrt(sum / cnt) : 0;
  }
  const peak = Math.max(...out);
  return out.map((v) => +(peak > 0 ? v / peak : 0).toFixed(3));
}

/* --------------------------------------------------------------------- audio */

function encodeAudio(entry) {
  const dst = path.join(OUT_DIR, `${entry.id}.mp3`);
  if (exists(dst) && !FORCE) { log(`${entry.id}: mp3 present, skipping encode`); return dst; }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  sh('ffmpeg', ['-v', 'error', '-y', '-i', SRC(entry.id, 'source.mp3'),
    '-ac', '1', '-ar', '44100', '-b:a', '48k', '-map_metadata', '-1',
    '-metadata', `title=${entry.title} — ${entry.speaker}`,
    '-metadata', `artist=${entry.speaker}`,
    '-metadata', `comment=${entry.credit}`,
    dst]);
  return dst;
}

const probeDuration = (f) => parseFloat(sh('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).trim());

/* ----------------------------------------------------------------- citations */

const textOfSpan = (words, wi, wj) => words.slice(wi, wj).map((w) => w.t).join(' ');

/**
 * Authored quote → shipped Citation. The shipped quote is rebuilt from the
 * span the aligner found, never the author's copy; corroboration then judges
 * that span against the publisher's transcript.
 */
function resolveQuote(entry, where, quote, words, OT, minCorrob, problems, rows) {
  const hit = alignQuote(quote, words);
  if (!hit || hit.score < MIN_ALIGN) {
    problems.push(`${entry.id} · ${where}: quote did not align (score ${hit ? hit.score.toFixed(3) : 'none'}): ${JSON.stringify(quote.slice(0, 80))}`);
    return null;
  }
  const spanText = textOfSpan(words, hit.wi, hit.wj);
  const { ratio } = corroborate(spanText, OT);
  if (ratio < minCorrob) {
    problems.push(`${entry.id} · ${where}: corroboration ${ratio} < ${minCorrob}: ${JSON.stringify(spanText.slice(0, 80))}`);
    return null;
  }
  const cite = {
    quote: spanText,
    wi: hit.wi, wj: hit.wj,
    s: words[hit.wi].s, e: words[hit.wj - 1].e,
    corrob: ratio,
  };
  rows.push({ where, align: hit.score, corrob: ratio, s: cite.s, quote: spanText });
  return cite;
}

/* ---------------------------------------------------------------------- main */

function buildEntry(entry) {
  log(`— ${entry.id}`);
  for (const f of ['whisper.json', 'full-16k.wav', 'source.mp3', `official.${entry.official}`]) {
    if (!exists(SRC(entry.id, f))) throw new Error(`${entry.id}: missing input ${SRC(entry.id, f)}`);
  }
  const artifactsPath = path.join(ROOT, 'content', 'artifacts', `${entry.id}.json`);
  if (!exists(artifactsPath)) throw new Error(`${entry.id}: missing authored artifacts ${artifactsPath}`);
  const authored = JSON.parse(fs.readFileSync(artifactsPath, 'utf8'));

  const mp3 = encodeAudio(entry);
  const durationSec = +probeDuration(mp3).toFixed(2);
  const words = buildWords(SRC(entry.id, 'whisper.json'), SRC(entry.id, 'full-16k.wav'));
  const segments = buildSegments(SRC(entry.id, 'whisper.json'), words);
  const peaks = computePeaks(SRC(entry.id, 'full-16k.wav'));
  const docText = officialText(SRC(entry.id, `official.${entry.official}`));
  const OT = { split: splitDashes(docText), fused: fuseDashes(docText) };
  const minCorrob = entry.minCorroboration ?? MIN_CORROBORATION;

  // Whole-transcript coverage — the "is this even the right document" check
  // that caught the three bad official files (material-audit.md).
  const asrText = words.map((w) => w.t).join(' ');
  const coverage = +Math.max(
    similarity(splitDashes(asrText), OT.split),
    similarity(fuseDashes(asrText), OT.fused),
  ).toFixed(3);

  const problems = [];
  const rows = [];
  const resolve = (where, q) => resolveQuote(entry, where, q, words, OT, minCorrob, problems, rows);

  const citations = (authored.summary.citations ?? []).map((q, i) => resolve(`summary[${i + 1}]`, q));
  const chapters = (authored.chapters ?? []).map((c, i) => ({ title: c.title, at: resolve(`chapter[${i}] ${c.title}`, c.quote) }));
  const concepts = (authored.concepts ?? []).map((c) => ({ term: c.term, definition: c.definition, cite: resolve(`concept ${c.term}`, c.quote) }));
  const flags = (authored.flags ?? []).map((f, i) => ({ text: f.text, cite: resolve(`flag[${i}]`, f.quote) }));

  const createdAt = Date.parse(`${CONTENT_DATE}T00:00:00Z`);
  let seq = 0;
  const notes = (authored.notes ?? []).map((n) => {
    const cite = resolve(`note[${seq}] (${n.kind})`, n.quote);
    if (!cite) return null;
    return {
      id: `${entry.id}_c${seq++}`,
      kind: n.kind,
      text: n.kind === 'quote' ? cite.quote : n.text,
      quote: cite.quote,
      anchor: { s: cite.s, e: cite.e, wi: cite.wi, wj: cite.wj, quality: 'word' },
      heard: false,
      createdAt, updatedAt: createdAt,
    };
  });

  if (problems.length) {
    throw new Error(`${entry.id}: ${problems.length} quote(s) failed verification:\n  ${problems.join('\n  ')}`);
  }

  const size = fs.statSync(mp3).size;
  const sha256 = createHash('sha256').update(fs.readFileSync(mp3)).digest('hex');
  const meta = {
    id: entry.id, title: entry.title, speaker: entry.speaker, occasion: entry.occasion,
    // Noon UTC, not midnight: these dates are calendar days, and midnight UTC
    // renders as the previous day everywhere west of Greenwich.
    recordedAt: Date.parse(`${entry.recordedAt}T12:00:00Z`),
    category: entry.category, lang: entry.lang, license: entry.license,
    commercialUse: entry.commercialUse, blurb: entry.blurb, credit: entry.credit,
    ...(entry.contextNote ? { contextNote: entry.contextNote } : {}),
  };

  const bundle = {
    v: CONTENT_V,
    meta,
    audio: { file: `${entry.id}.mp3`, size, sha256, durationSec },
    transcript: {
      lang: entry.lang, words, segments,
      heardSec: durationSec, durationSec,
      chunks: [{ i: 0, s: 0, e: durationSec, state: 'done' }],
    },
    artifacts: { summary: { text: authored.summary.text, citations }, chapters, concepts, flags },
    notes: notes.sort((a, b) => a.anchor.s - b.anchor.s),
    peaks,
  };
  fs.writeFileSync(path.join(OUT_DIR, `${entry.id}.json`), JSON.stringify(bundle) + '\n');

  const manifestEntry = {
    id: entry.id, title: entry.title, speaker: entry.speaker, category: entry.category,
    durationSec, recordedAt: meta.recordedAt,
    wordCount: words.length, noteCount: notes.length,
    license: entry.license, commercialUse: entry.commercialUse,
    blurb: entry.blurb, credit: entry.credit, audioSize: size,
    peaks: peaks.filter((_, i) => i % 3 === 0),   // 60 buckets is plenty for a mini
  };

  log(`${entry.id}: ${words.length} words · ${segments.length} segments · ${durationSec}s · coverage ${coverage} · ${rows.length} quotes verified`);
  return { entry, bundle, manifestEntry, rows, coverage, minCorrob };
}

function writeReport(results) {
  const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  const perEntry = results.map(({ entry, bundle, rows, coverage, minCorrob }) => {
    const quoteRows = rows.map((r) =>
      `| ${r.where} | ${fmtClock(r.s)} | ${r.align.toFixed(3)} | ${r.corrob.toFixed(3)} | ${JSON.stringify(r.quote.length > 72 ? r.quote.slice(0, 72) + '…' : r.quote)} |`).join('\n');
    return `### ${entry.title} (\`${entry.id}\`)

| | |
|---|---|
| Words / segments | ${bundle.transcript.words.length} / ${bundle.transcript.segments.length} |
| Duration | ${fmtClock(bundle.audio.durationSec)} (${bundle.audio.durationSec}s) |
| Shipped audio | \`public/starter/${bundle.audio.file}\`, ${bundle.audio.size} B, mono 48 kbps |
| sha256 | \`${bundle.audio.sha256}\` |
| Official transcript | \`official.${entry.official}\` — whole-transcript coverage **${coverage}** |
| Corroboration gate | ≥ ${minCorrob}${minCorrob !== MIN_CORROBORATION ? ' (registry override — see content/registry.mjs for why)' : ''} |
| Quotes shipped | ${rows.length} (summary citations + chapters + concepts + flags + notes) |

| quote | at | align | corrob | text |
|---|---|---|---|---|
${quoteRows}
`;
  }).join('\n');

  fs.writeFileSync(REPORT, `# Starter library verification — Heard v3

Generated by \`node scripts/build-content.mjs\` on ${CONTENT_DATE}. Method notes:

- **Words**: whisper.cpp \`large-v3-turbo\` DTW token timestamps + measured onset
  snap — the same \`buildWords\` the v2 sample shipped with; the measurements are
  in \`sample-verification.md\`.
- **align** — every authored quote is re-found on the word timeline by the
  reference aligner (\`scripts/lib/align-quote.mjs\`, LCS similarity, floor ${MIN_ALIGN}).
  The shipped quote text is rebuilt from the aligned word span, never from the
  author's copy.
- **corrob** — Layer 2: the aligned span is matched against the publisher's own
  transcript (best local LCS window). Default floor ${MIN_CORROBORATION}; a build with any
  quote under its entry's floor **fails** — nothing unverified can ship.
- **coverage** — whole-transcript similarity between ASR output and the official
  document; the "is this even the right document" check from
  \`memory/heard-v3/research/material-audit.md\`.

${perEntry}`);
  log(`wrote ${path.relative(ROOT, REPORT)}`);
}

function main() {
  const targets = ENTRIES.filter((e) => !ONLY || e.id === ONLY);
  if (!targets.length) throw new Error(`--only ${ONLY} matches nothing`);
  const results = targets.map(buildEntry);

  if (!ONLY) {
    fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
    const manifest = { v: CONTENT_V, base: 'starter/', entries: results.map((r) => r.manifestEntry) };
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    log(`wrote ${path.relative(ROOT, MANIFEST)} (${results.length} entries)`);
    writeReport(results);
  } else {
    log('partial build (--only): manifest and report NOT rewritten');
  }
  log('done');
}

try { main(); } catch (e) { console.error('[build-content] FAILED:', e.message); process.exit(1); }
