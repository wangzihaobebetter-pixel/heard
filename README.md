# Heard · 听证

**Notes that can prove themselves.** Press any line — hear the second it was said.

Drop in a recorded interview. It is heard once, in your browser, with your own
transcription key. You get a word-timed transcript and a short set of notes and
quotable lines — and every note carries a timecode that, when pressed, plays the
exact second it was said, with the words lighting up as they are spoken. Mark a
note ✓ heard once you have checked it against the tape, save your own quotes by
selecting the transcript, and export a quote sheet where every line has its
timecode. Everything stays on your device.

Design of record: `memory/traceable-notes/DESIGN.md`. Implementation follows it;
it is not re-litigated in code.

## State of the build

All five packages have landed. Every verifier below passes at this commit:

| Area | File | Landed in |
|---|---|---|
| Types, store, storage, tokens, i18n, router | `src/types.ts`, `src/store/*`, `src/lib/storage.ts`, `src/styles/tokens.css`, `src/i18n/*`, `src/router.ts` | WP0 (frozen) |
| Audio engine — decode, chunk, transcribe, align, player | `src/audio/*` | WP1 |
| Interview screen, note row, player UI, selection | `src/screens/Interview.tsx`, `src/components/*` | WP2 |
| Library, Bring, Settings, quote-sheet export | `src/screens/{Library,Bring,Settings}.tsx`, `src/export/*` | WP3 |
| Notes generation and the bundled NASA sample | `src/notes/*`, `src/sample/sample.json` | WP4 |

`src/sample/sample.json` is the **real** 11m55s NASA excerpt — 1740 words, 164
segments, 17 notes, word times from whisper.cpp `large-v3-turbo` with DTW token
timestamps. How it was produced and independently corroborated against NASA's
own published transcript is in `sample-verification.md`.

### Verifier results at this commit

| Suite | Result |
|---|---|
| `npm run build` (tsc, i18n, tokens, router, contracts, pwa, sample, a4, vite, sw) | green |
| `verify-sample` — structural truth, round trip through the shipped aligner, physical plausibility | 100/100 |
| `verify-a4` — seed, reboot, and version-bump merge | 20/20 |
| `verify-engine` — chunking, resample, direct path, player, alignment, IndexedDB sample door | 45/45 |
| `verify-interview` — the five executable claims of DESIGN §5, on a real Chrome | 20/20 |
| `verify-export` — quote sheet byte-for-byte against DESIGN §4.5, both languages | 52 checks |

`verify-engine` and `verify-interview` drive a real Chrome and are not part of
`npm run build`; run them with `npm run verify:engine` and
`node verify-interview.mjs` (the latter wants `npm run dev` on port 5178).

Transcription in the engine suite runs in **mock** mode on a machine with no
OpenAI/Groq key, backed by 9845 real word timings from whisper large-v3-turbo,
with each chunk located acoustically rather than told where it sits.

## Routes

    #/            Library
    #/i/:id       Interview
    #/add         Bring
    #/settings    Settings

Hash routing with `base: './'`, because this deploys to a GitHub Pages project
sub-path and deep links must survive a refresh with no server rewrite. An
unknown hash renders the Library — never a white screen.

## Run it

    npm install
    npm run dev       # http://localhost:4173
    npm run build     # typecheck + every verifier + vite build + service worker
    npm run preview

## What the build actually checks

`npm run build` fails on any of these, on purpose:

- `tsc --noEmit`
- **verify-i18n** — every `t('key')` resolves, and every key exists in **both**
  languages. `translate()` falls back to the raw key, so a key missing from
  English ships on screen as the literal string `bring.choose`.
- **verify-tokens** — every DESIGN §7 colour role exists in *both* themes, the
  type/spacing/motion scales are present, and no stylesheet outside the token
  file hard-codes a hex.
- **verify-router** — the four routes resolve and malformed hashes fail closed.
- **verify-contracts** — the frozen type shapes still have their exact field
  names, the unions still admit every member, and the store is still versioned
  with a migration.
- **verify-pwa** — every declared icon exists at its declared pixel size, the
  manifest is Pages-relative and standalone, and the service worker guards every
  cache write with `res.ok` (a cached 404 once locked users out of the
  precedent app).
- **verify-sample** — the bundled NASA sample is checked three ways: its word
  times are monotonic and inside the audio, every shipped note round-trips
  through the *shipped* aligner back to the span its anchor claims, and every
  note's span overlaps speech detected in the audio itself.
- **verify-a4** — first boot seeds the sample, a reboot leaves the user's own
  notes and ✓ marks alone, and a version bump replaces the authored notes while
  re-anchoring the user's against the new transcript.

## Storage

Notes, transcripts and settings persist through Zustand `persist` into
IndexedDB, with a localStorage fallback for private-mode Safari. Audio blobs
live separately under `audio:<interviewId>` in IndexedDB and never enter the
store — a 44 MB Blob has no business being JSON-serialised on every write.

`theme` and `lang` are additionally mirrored into `localStorage['heard-ui']` so
`index.html` can apply them synchronously before the first paint.

## Credits

The bundled sample is an excerpt from NASA's *Houston We Have a Podcast*, public
domain. NASA is acknowledged as the source; no NASA insignia is used.
