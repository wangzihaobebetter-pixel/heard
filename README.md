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

This is **WP0 — contracts and scaffold**. Frozen and ready for the parallel
packages to land on:

| Area | File | Owner after WP0 |
|---|---|---|
| Types | `src/types.ts` | frozen (integrator only) |
| Store | `src/store/index.ts`, `src/store/presets.ts` | frozen |
| Storage | `src/lib/storage.ts` | frozen |
| Tokens | `src/styles/tokens.css` (alias `src/tokens.css`) | frozen |
| i18n | `src/i18n/*` | frozen; new copy comes through the design doc |
| Router | `src/router.ts` | frozen |
| Sample schema | `src/sample/schema.ts`, `src/sample/load.ts` | frozen; `sample.json` is WP4's |
| Library / Bring / Settings | `src/screens/{Library,Bring,Settings}.tsx` | **WP3** (stubs today) |
| Interview | `src/screens/Interview.tsx` | **WP2** (stub today) |
| Audio engine | `src/audio/*` | **WP1** (not yet created) |
| Notes generation | `src/notes/*` | **WP4** (not yet created) |

`src/sample/sample.json` is a **stub** with four fake notes so UI work can start
before the real NASA excerpt lands. Every stub note's text begins `STUB —`.

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
