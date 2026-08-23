#!/usr/bin/env node
/**
 * verify-a4 — proves amendment A4 (REVIEW-2026-08-23 §3) actually behaves.
 *
 * `ensureSample()` is the only thing that decides what a returning browser sees
 * after we reship the sample. The claim it has to earn is narrow, and easy to
 * get wrong in a way nobody notices for months:
 *
 *   the model's notes are OURS to replace; the user's notes are not.
 *
 * This runs the REAL `src/sample/load.ts` — not a paraphrase of it — against a
 * stubbed store and storage layer. `src/audio/align.ts` and `src/sample/schema.ts`
 * are the real ones too. Only the store, IndexedDB and the id clock are stubbed,
 * because those are the browser, not the logic under test. `./sample.json` is
 * aliased to a module whose default export is mutated in place, which is what
 * lets the harness move the bundle under a `load.ts` that has no test hook in it.
 *
 * The numbers this prints are the numbers that belong in the A4 table of
 * `sample-verification.md`. Before this file existed, that table was prose.
 *
 * WP4 owns this file. Run: `node scripts/verify-a4.mjs`
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, 'node_modules', '.cache');
const OUT = path.join(CACHE, 'a4-harness.mjs');
fs.mkdirSync(CACHE, { recursive: true });

let failures = 0, checks = 0;
const rows = [];
function ok(cond, label, detail) {
  checks++;
  if (!cond) { failures++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
  else console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  return cond;
}
const row = (behaviour, result) => rows.push({ behaviour, result });

/* ---------------------------------------------------------------- the stubs */

/** Faithful to the parts of `src/store/index.ts` that `load.ts` touches. */
const STORE_STUB = `
let state = { interviews: {}, transcripts: {}, notes: {}, ui: { sampleDismissed: false } };
export const __state = () => state;
export const useStore = {
  getState: () => ({
    ...state,
    upsertInterview: (i) => { state.interviews = { ...state.interviews, [i.id]: i }; },
    setTranscript: (id, t) => { state.transcripts = { ...state.transcripts, [id]: t }; },
    setNotes: (id, n) => { state.notes = { ...state.notes, [id]: n }; },
    setUi: (patch) => { state.ui = { ...state.ui, ...patch }; },
  }),
};
`;
const STORAGE_STUB = `
export const __removed = [];
export async function removeAudio(id) { __removed.push(id); }
`;
const IDS_STUB = `let t = 1000; export const now = () => ++t; export const id = (p='x') => p+'_'+(++t);`;
/** default export is mutated in place, so `load.ts`'s static import sees the move. */
const BUNDLE_STUB = `
import fs from 'node:fs';
const b = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, 'src', 'sample', 'sample.json'))}, 'utf8'));
export const __setBundle = (next) => { for (const k of Object.keys(b)) delete b[k]; Object.assign(b, next); };
export default b;
`;

const ENTRY = `
export * from './load';
export { __state } from '../store';
export { __removed } from '../lib/storage';
export { __setBundle } from './sample.json';
`;

const ALIGN_SRC = path.join(ROOT, 'src', 'audio', 'align.ts');

/**
 * `load.ts` re-anchors a user's note by calling WP1's `alignQuote`. If that
 * aligner is broken, this harness cannot tell "load.ts is wrong" from "load.ts
 * is fine and its dependency is blind" — so it builds the scenario twice: once
 * against `src/audio/align.ts` as it stands, and once against the same file with
 * the two-line space-join fix applied in memory. The difference between the two
 * runs is the diagnosis.
 */
async function harness(tag, fixAligner) {
  const out = path.join(CACHE, `a4-harness-${tag}.mjs`);
  await build({
    stdin: { contents: ENTRY, resolveDir: path.join(ROOT, 'src', 'sample'), loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'warning',
    plugins: [{
      name: 'a4-stubs',
      setup(b) {
        b.onResolve({ filter: /(^|\/)(store|lib\/storage|lib\/ids)$/ }, (a) => ({
          path: a.path.endsWith('storage') ? 'storage' : a.path.endsWith('ids') ? 'ids' : 'store',
          namespace: 'a4stub',
        }));
        b.onResolve({ filter: /sample\.json$/ }, () => ({ path: 'bundle', namespace: 'a4stub' }));
        b.onLoad({ filter: /.*/, namespace: 'a4stub' }, (a) => ({
          contents: { storage: STORAGE_STUB, ids: IDS_STUB, store: STORE_STUB, bundle: BUNDLE_STUB }[a.path],
          loader: 'ts',
        }));
        if (fixAligner) {
          b.onLoad({ filter: /src[\\/]audio[\\/]align\.ts$/ }, (a) => ({
            contents: fs.readFileSync(a.path, 'utf8')
              .replace('    full += t;', "    if (full) { full += ' '; charOwner.push(w); }\n    full += t;")
              .replace(".map((w) => w.t).join('').trim()", ".map((w) => w.t).join(' ').trim()"),
            loader: 'ts',
          }));
        }
      },
    }],
  });
  return import(`${pathToFileURL(out).href}?t=${Date.now()}${tag}`);
}


/* ------------------------------------------------------------- the scenario */

/**
 * The whole A4 story, start to finish, against one harness instance.
 * `record` is true only for the authoritative run, so the report table is not
 * written twice.
 */
async function scenario(m, { record }) {
  const REAL = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'sample', 'sample.json'), 'utf8'));
  const R = (behaviour, result) => { if (record) row(behaviour, result); };

  /* 1. the first boot */
  console.log('1. first boot on a browser that has never seen the sample');
  ok(m.ensureSample() === 'sample', 'ensureSample() seeds and returns the sample id');
  let s = m.__state();
  const seeded = (s.notes.sample ?? []).length;
  ok(seeded === REAL.notes.length, 'every bundled note is seeded', `${seeded} notes`);
  ok(s.ui.sampleV === REAL.v, 'ui.sampleV records the bundle version', `sampleV=${s.ui.sampleV}`);
  R('first boot seeds the sample and sets `ui.sampleV`', `✓ ${seeded} notes, \`sampleV = ${s.ui.sampleV}\``);

  /* 2. the user works, then reboots at the same v */
  console.log('\n2. the user ticks one note heard and writes two of their own, then reboots');
  const authoredId = s.notes.sample[0].id;
  s.notes.sample[0].heard = true;
  const MY_TEXT = 'Ask him about the boot camp.';
  const mine = {
    id: 'n_user', kind: 'yours', text: MY_TEXT, quote: REAL.notes[5].quote,
    anchor: { ...REAL.notes[5].anchor }, heard: true, createdAt: 1, updatedAt: 1,
  };
  const pinned = {
    id: 'n_pin', kind: 'yours', text: 'Come back to this.', quote: REAL.notes[9].quote,
    anchor: { ...REAL.notes[9].anchor, pinnedByUser: true }, heard: false, createdAt: 1, updatedAt: 1,
  };
  const mineBeforeS = mine.anchor.s, pinBeforeS = pinned.anchor.s;
  s.notes.sample = [...s.notes.sample, mine, pinned];

  m.ensureSample();
  s = m.__state();
  ok(s.notes.sample.some((n) => n.id === 'n_user'), 'a reboot at the same v leaves the user’s notes alone');
  ok(s.notes.sample.find((n) => n.id === authoredId)?.heard === true, 'a reboot at the same v keeps ✓ marks');
  ok(m.__removed.length === 0, 'a reboot at the same v does not drop the audio blob');
  R('reboot at the same `v` changes nothing', '✓ user’s notes and ✓ heard marks intact');

  /* 3. we reship at v+1 with every word time moved */
  console.log('\n3. we reship: every word time shifts by +5 s and the bundle version moves');
  const SHIFT = 5;
  const bump = (a) => ({ ...a, s: +(a.s + SHIFT).toFixed(2), e: +(a.e + SHIFT).toFixed(2) });
  m.__setBundle({
    ...REAL,
    v: REAL.v + 1,
    transcript: {
      ...REAL.transcript,
      durationSec: +(REAL.transcript.durationSec + SHIFT).toFixed(2),
      words: REAL.transcript.words.map(bump),
      segments: REAL.transcript.segments.map(bump),
      chunks: (REAL.transcript.chunks ?? []).map(bump),
    },
    notes: REAL.notes.map((n) => ({ ...n, anchor: bump(n.anchor) })),
  });

  ok(m.ensureSample() === 'sample', 'ensureSample() re-seeds on a version bump');
  s = m.__state();
  const after = s.notes.sample;
  const authoredAfter = after.filter((n) => n.kind !== 'yours');
  const yoursAfter = after.filter((n) => n.kind === 'yours');

  ok(authoredAfter.length === REAL.notes.length, 'the authored notes are replaced wholesale', `${authoredAfter.length} notes`);
  ok(authoredAfter.every((n) => n.heard === false), 'the replaced notes come back unheard');
  ok(Math.abs(authoredAfter[0].anchor.s - (REAL.notes[0].anchor.s + SHIFT)) < 1e-6,
    'the replaced notes carry the new timecodes', `${authoredAfter[0].anchor.s}s`);
  ok(s.ui.sampleV === REAL.v + 1, 'ui.sampleV moves with the bundle', `sampleV=${s.ui.sampleV}`);
  ok(s.transcripts.sample.durationSec === +(REAL.transcript.durationSec + SHIFT).toFixed(2), 'the transcript is replaced');
  R('bundle bump replaces the authored notes', `✓ ${authoredAfter.length} shipped notes, \`heard\` reset to false`);

  ok(yoursAfter.length === 2, 'both of the user’s notes survive the bump', `${yoursAfter.length} kept`);
  const myAfter = yoursAfter.find((n) => n.id === 'n_user');
  ok(myAfter?.text === MY_TEXT, 'the user’s text is untouched');
  ok(myAfter?.heard === true, 'the user’s ✓ survives');
  R('the user’s `yours` note survives, text untouched', '✓ text and ✓ heard preserved');

  const pinAfter = yoursAfter.find((n) => n.id === 'n_pin');
  ok(pinAfter?.anchor?.quality === 'unpinned', 'a `pinnedByUser` anchor degrades to `unpinned` rather than moving',
    `was ${pinBeforeS}s, quality:"${pinAfter?.anchor?.quality}"`);
  ok(pinAfter?.anchor?.s === pinBeforeS, 'and its seconds are left exactly where the human put them');
  R('a `pinnedByUser` anchor degrades to `unpinned` instead of moving',
    '✓ (a human’s seconds refer to audio that no longer exists)');

  ok(m.__removed.includes('sample'), 'the stale audio blob is dropped so A3 re-fetches',
    `removeAudio(${JSON.stringify(m.__removed)})`);
  R('the stale audio blob is dropped so A3 re-fetches', "✓ `removeAudio('sample')` called");

  ok(after.every((n, i) => i === 0 || after[i - 1].anchor.s <= n.anchor.s), 'the merged list stays sorted by time');

  // The one assertion that depends on WP1's aligner rather than on load.ts.
  const movedTo = myAfter?.anchor?.s;
  const reanchored = Math.abs(movedTo - (mineBeforeS + SHIFT)) < 0.05 && myAfter?.anchor?.quality === 'word';
  return { reanchored, mineBeforeS, movedTo, quality: myAfter?.anchor?.quality, R };
}

/* ------------------------------------------------------------------- run it */

const m = await harness('real', false);
const first = await scenario(m, { record: true });

if (first.reanchored) {
  ok(true, 're-anchored against the new transcript',
    `${first.mineBeforeS}s → ${first.movedTo}s, quality:"${first.quality}"`);
  row('the user’s note is re-anchored to the new transcript',
    `✓ ${first.mineBeforeS} s → ${first.movedTo} s, still \`quality:"word"\``);
} else {
  console.log('\n4. the re-anchor failed — is that load.ts, or its aligner?');
  console.log(`   with src/audio/align.ts as it stands: ${first.mineBeforeS}s → ${first.movedTo}s, quality:"${first.quality}"`);
  const m2 = await harness('fixed', true);
  console.log('   replaying against the same file with the two-line space-join fix applied in memory:');
  const before = { checks, failures };
  const second = await scenario(m2, { record: false });
  // The replay's own assertions are diagnostic, not a second verdict.
  checks = before.checks; failures = before.failures;
  console.log(`   with the fix: ${second.mineBeforeS}s → ${second.movedTo}s, quality:"${second.quality}"`);

  ok(false, 're-anchored against the new transcript',
    `${first.mineBeforeS}s → ${first.movedTo}s, quality:"${first.quality}"`);
  console.error([
    '',
    second.reanchored
      ? '  ┌─ DIAGNOSIS: load.ts is correct. src/audio/align.ts (WP1) is the defect.'
      : '  ┌─ DIAGNOSIS: still broken with the aligner fix — the defect is in load.ts.',
    "  │  buildTokenIndex() joins Word.t with '' assuming each word carries a leading",
    '  │  space. Ours never do, so the transcript folds into sentence-long tokens and',
    '  │  every quote scores 0. A user note cannot be re-anchored across a reship, and',
    '  │  at runtime every generated note would render as the `≈` chip.',
    '  │',
    "  │  Fix, in buildTokenIndex():   if (full) { full += ' '; charOwner.push(w); }",
    '  │                               full += t;',
    "  │  And in textOfSpan():         .map((w) => w.t).join(' ')   // not join('')",
    '  └─ WP4 may not edit src/audio/*; this harness exists so the break is attributable.',
    '',
  ].join('\n'));
  row('the user’s note is re-anchored to the new transcript',
    second.reanchored
      ? `⚠ blocked by the \`src/audio/align.ts\` token-join bug; correct (${second.mineBeforeS} s → ${second.movedTo} s, \`quality:"word"\`) once that is fixed`
      : '✗ still failing with the aligner fix applied');
}

fs.writeFileSync(path.join(CACHE, 'a4-rows.json'), JSON.stringify(rows, null, 2));
console.log(`\n${failures === 0 ? '✓' : '✗'} verify-a4: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
