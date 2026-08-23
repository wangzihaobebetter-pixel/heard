/**
 * The worked example from DESIGN §4.5, as data. WP3 owns this file.
 *
 * It lives on its own — not inside the Library screen — for one reason:
 * `verify-export.mjs` bundles it with `quotesheet.ts` and runs the real
 * generator in Node to compare the result byte-for-byte with the format block
 * lifted out of DESIGN.md. A fixture that the verifier and the screen do not
 * literally share is a fixture that can drift, and then the golden test proves
 * nothing about what ships.
 *
 * The four notes are the four in §4.5 and they are there to exercise all four
 * shapes the format has: a checked point with a quote, an unchecked point
 * without one, a quotable line, and a line the user saved themselves.
 */
import type { Interview, Note } from '../types';

/** Local noon, so the calendar date is the same in every time zone. */
const RECORDED_AT = new Date(2026, 7, 14, 12).getTime();

export const EXPORT_FIXTURE_INTERVIEW: Interview = {
  id: 'fixture-export',
  title: 'Callsign White Flight',
  createdAt: RECORDED_AT,
  recordedAt: RECORDED_AT,
  durationSec: 5527, // 1:32:07
  file: { name: 'white-flight.m4a', size: 44 * 1024 * 1024, type: 'audio/mp4', kept: true },
  lang: 'en',
  status: 'ready',
};

export const EXPORT_FIXTURE_NOTES: Note[] = [
  {
    id: 'f1', kind: 'point', heard: true,
    text: 'Kranz says he was 32 when he first sat at the flight director console.',
    quote: 'I was thirty-two years old the first time I sat down at that console',
    anchor: { s: 872, e: 877, quality: 'word' },   // 14:32
    createdAt: RECORDED_AT, updatedAt: RECORDED_AT,
  },
  {
    id: 'f2', kind: 'point', heard: false,
    text: 'The Apollo 13 return was planned in four-hour blocks.',
    anchor: { s: 1625, e: 1630, quality: 'word' }, // 27:05
    createdAt: RECORDED_AT, updatedAt: RECORDED_AT,
  },
  {
    id: 'f3', kind: 'quote', heard: true,
    text: 'Tough and competent — those words are the price of admission.',
    anchor: { s: 2478, e: 2482, quality: 'word' }, // 41:18
    createdAt: RECORDED_AT, updatedAt: RECORDED_AT,
  },
  {
    id: 'f4', kind: 'yours', heard: true,
    text: "We didn't have a plan B. We had a plan A that we kept fixing.",
    anchor: { s: 3520, e: 3525, quality: 'word' }, // 58:40
    createdAt: RECORDED_AT, updatedAt: RECORDED_AT,
  },
];

/** The placeholders §4.5's block uses, and what this fixture fills them with. */
export const EXPORT_FIXTURE_PLACEHOLDERS: Record<string, string> = {
  '<Title>': EXPORT_FIXTURE_INTERVIEW.title,
  '<date>': '2026-08-14',
  '<duration>': '1:32:07',
  '<filename>': EXPORT_FIXTURE_INTERVIEW.file.name,
};
