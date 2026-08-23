/**
 * Dev fixtures for the Interview states that cannot be reached from the
 * bundled sample (WP2).
 *
 * REVIEW §5/A5 is explicit that the shipped sample must contain no `≈` chips —
 * Moment 1 has to be flawless — and that the `shot-approx-and-dashed`
 * screenshot is therefore produced from a dev fixture rather than the sample.
 * The same reasoning applies to the listening state: a 92-minute recording that
 * is 23 minutes heard is a normal state of the product (§4.2) and it has to be
 * designed and shown, but it is not something the sample can ever be in.
 *
 * These are dev-only: `Interview.devkit.ts` is the sole importer and it is
 * behind `import.meta.env.DEV`, so none of this reaches a production bundle.
 */
import type { Interview, Note, Transcript, Word } from '../types';

/**
 * Build a word list from plain prose. Each paragraph is given its own start
 * time so a fixture's timecode column spans the whole recording — a column of
 * chips all reading `0:0x` would hide the one thing §7 asks to be judged here,
 * which is that `8:32` and `1:08:22` line up to the pixel.
 */
function words(prose: string[], starts: number[]): Word[] {
  const out: Word[] = [];
  let i = 0;
  for (let p = 0; p < prose.length; p++) {
    let t = starts[p];
    const para = prose[p];
    for (const token of para.split(/\s+/).filter(Boolean)) {
      // 0.34 s a word is close to unhurried interview speech and keeps the
      // karaoke visibly stepping rather than blurring.
      const dur = 0.28 + Math.min(0.22, token.length * 0.02);
      out.push({ i: i++, t: token, s: Number(t.toFixed(2)), e: Number((t + dur).toFixed(2)) });
      t += dur + 0.04;
    }
  }
  return out;
}

/**
 * Half-open word range of each paragraph. Anchors are declared by paragraph
 * rather than by literal word index: hand-counted indices drift the moment a
 * word changes, and the first screenshot run caught exactly that — a note
 * about four-hour blocks whose chip pointed at the last word of the paragraph
 * before it.
 */
function paraRanges(prose: string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let at = 0;
  for (const para of prose) {
    const n = para.split(/\s+/).filter(Boolean).length;
    out.push([at, at + n]);
    at += n;
  }
  return out;
}

function segmentsFor(ws: Word[], per = 12) {
  const segs = [];
  for (let k = 0; k < ws.length; k += per) {
    const slice = ws.slice(k, k + per);
    segs.push({ s: slice[0].s, e: slice[slice.length - 1].e, wi: slice[0].i, wj: slice[slice.length - 1].i + 1 });
  }
  return segs;
}

export interface Fixture {
  interview: Interview;
  transcript: Transcript;
  notes: Note[];
  /** seconds of audio to synthesise into IndexedDB, or 0 for "not on this device" */
  audioSec: number;
}

/* ------------------------------------------------------ the listening state */

const LISTENING_PROSE = [
  'We started the archive project in the second week of March, which is later than anyone remembers it.',
  'The first box we opened had no labels on it at all. Just a date, and the date was wrong.',
  'I spent about four months on that one box before I understood what I was actually looking at.',
  'People assume the hard part is finding the material. It is not. The hard part is proving what it is.',
  'By the end we had verified eleven hundred items and thrown out about a third of what we started with.',
];

export function listeningFixture(): Fixture {
  const ws = words(LISTENING_PROSE, [14, 190, 470, 860, 1240]);
  const heardSec = 23 * 60;
  const durationSec = 92 * 60;
  return {
    interview: {
      id: 'fx-listening',
      title: 'Archive project — second interview',
      createdAt: 1787040000000,
      recordedAt: 1787040000000,
      durationSec,
      file: { name: 'archive-02.m4a', size: 44 * 1024 * 1024, type: 'audio/mp4', kept: true },
      lang: 'en',
      status: 'listening',
    },
    transcript: {
      lang: 'en',
      words: ws,
      segments: segmentsFor(ws),
      heardSec,
      durationSec,
      chunks: [
        { i: 0, s: 0, e: 600, state: 'done' },
        { i: 1, s: 600, e: 1200, state: 'done' },
        { i: 2, s: 1200, e: 1380, state: 'done' },
        { i: 3, s: 1380, e: 1980, state: 'pending' },
      ],
    },
    // §4.2: notes come once the whole recording has been heard. None yet.
    notes: [],
    // The tape is local from second zero — that is precisely why a user can
    // read and press minute 5 while minute 60 is still being heard.
    audioSec: durationSec,
  };
}

/* --------------------------------------------- ≈ anchors and a missing tape */

const APPROX_PROSE = [
  'The board was told in March, not in May, and that distinction is the whole story as far as I am concerned.',
  'I asked him twice. The second time he said it more carefully, which is usually how you know.',
  'There is a version of this where nobody did anything wrong and it still ends the same way.',
  'We kept the minutes. That is the only reason any of this is checkable at all.',
];

export function approxFixture(): Fixture {
  const ws = words(APPROX_PROSE, [512, 1687, 2934, 4102]);
  const durationSec = 5527;
  const P = paraRanges(APPROX_PROSE);
  const span = (p: number) => ({ s: ws[P[p][0]].s, e: ws[P[p][1] - 1].e, wi: P[p][0], wj: P[p][1] });
  return {
    interview: {
      id: 'fx-approx',
      title: 'Second source — on the record',
      createdAt: 1787040000000,
      recordedAt: 1787040000000,
      durationSec,
      // The recording is not on this device: every chip goes dashed (§4.2).
      file: { name: 'source-2.m4a', size: 41 * 1024 * 1024, type: 'audio/mp4', kept: false },
      lang: 'en',
      status: 'ready',
    },
    transcript: {
      lang: 'en', words: ws, segments: segmentsFor(ws),
      heardSec: durationSec, durationSec,
      chunks: [{ i: 0, s: 0, e: durationSec, state: 'done' }],
    },
    notes: [
      {
        id: 'fx-n1', kind: 'point',
        text: 'He says the board was told in March, not May — and treats the difference as the substance of the story.',
        quote: 'The board was told in March, not in May, and that distinction is the whole story',
        anchor: { ...span(0), quality: 'word' },
        heard: true, createdAt: 1787040000000, updatedAt: 1787040000000,
      },
      {
        id: 'fx-n2', kind: 'point',
        text: 'He was asked the same question twice; the second answer was the careful one.',
        quote: 'I asked him twice. The second time he said it more carefully',
        anchor: { ...span(1), quality: 'segment' },
        heard: false, createdAt: 1787040000000, updatedAt: 1787040000000,
      },
      {
        id: 'fx-n3', kind: 'quote',
        text: 'There is a version of this where nobody did anything wrong and it still ends the same way.',
        quote: 'There is a version of this where nobody did anything wrong and it still ends the same way.',
        anchor: { ...span(2), quality: 'word' },
        heard: false, createdAt: 1787040000000, updatedAt: 1787040000000,
      },
      {
        id: 'fx-n4', kind: 'point',
        text: 'He credits the minutes for the fact that any of the account can be checked at all.',
        anchor: { s: 3120, e: 3126, quality: 'unpinned' },
        heard: false, createdAt: 1787040000000, updatedAt: 1787040000000,
      },
    ],
    audioSec: 0,
  };
}

/* ------------------------------------------------ a ready interview, with tape */

const DEMO_PROSE = [
  'I was thirty-two years old the first time I sat down at that console.',
  'Nobody in that room had done it before, and everybody in that room knew it.',
  'Tough and competent — those words are the price of admission.',
  'The return was planned in four-hour blocks, and every block had an abort path written before we needed one.',
  'We did not have a plan B. We had a plan A that we kept fixing.',
];

/**
 * A ready interview with real playable audio — what `shot-press-chip-mobile`
 * and `shot-desktop-interview` are taken against while WP4's sample.json is
 * still the STUB bundle. Same shape, same code path; only the bytes differ.
 */
export function demoFixture(): Fixture {
  const ws = words(DEMO_PROSE, [12, 41, 96, 188, 372]);
  const durationSec = 724;
  const P = paraRanges(DEMO_PROSE);
  const span = (p: number) => ({ s: ws[P[p][0]].s, e: ws[P[p][1] - 1].e, wi: P[p][0], wj: P[p][1] });
  return {
    interview: {
      id: 'fx-demo',
      title: 'Callsign White Flight (excerpt)',
      createdAt: 1787040000000,
      recordedAt: 1787040000000,
      durationSec,
      file: { name: 'sample.mp3', size: 4_300_000, type: 'audio/mpeg', kept: true },
      lang: 'en', status: 'ready', sample: true,
    },
    transcript: {
      lang: 'en', words: ws, segments: segmentsFor(ws),
      heardSec: durationSec, durationSec,
      chunks: [{ i: 0, s: 0, e: durationSec, state: 'done' }],
    },
    notes: [
      {
        id: 'fx-d1', kind: 'point',
        text: 'He was 32 the first time he sat at the flight director console.',
        quote: 'I was thirty-two years old the first time I sat down at that console.',
        anchor: { ...span(0), quality: 'word' },
        heard: false, createdAt: 1787040000000, updatedAt: 1787040000000,
      },
      {
        id: 'fx-d2', kind: 'point',
        text: 'Nobody in the room had run a mission like it before, and the room knew that.',
        quote: 'Nobody in that room had done it before, and everybody in that room knew it.',
        anchor: { ...span(1), quality: 'word' },
        heard: true, createdAt: 1787040000000, updatedAt: 1787040000000,
      },
      {
        id: 'fx-d3', kind: 'point',
        text: 'The Apollo 13 return was planned in four-hour blocks, each with an abort path prepared in advance.',
        quote: 'The return was planned in four-hour blocks, and every block had an abort path written before we needed one.',
        anchor: { ...span(3), quality: 'word' },
        heard: false, createdAt: 1787040000000, updatedAt: 1787040000000,
      },
      {
        id: 'fx-d4', kind: 'quote',
        text: 'Tough and competent — those words are the price of admission.',
        quote: 'Tough and competent — those words are the price of admission.',
        anchor: { ...span(2), quality: 'word' },
        heard: false, createdAt: 1787040000000, updatedAt: 1787040000000,
      },
      {
        id: 'fx-d5', kind: 'yours',
        text: 'We did not have a plan B. We had a plan A that we kept fixing.',
        quote: 'We did not have a plan B. We had a plan A that we kept fixing.',
        anchor: { ...span(4), quality: 'word' },
        heard: true, createdAt: 1787040000000, updatedAt: 1787040000000,
      },
    ],
    audioSec: Math.ceil(ws[ws.length - 1].e + 6),
  };
}

export const FIXTURES: Record<string, () => Fixture> = {
  'fx-listening': listeningFixture,
  'fx-approx': approxFixture,
  'fx-demo': demoFixture,
};
