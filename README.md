# Heard · 听证

**Notes that can prove themselves.** Press any line — hear the second it was said.

Drop in a recorded interview. It is heard once, in your browser, with your own
transcription key. You get a word-timed transcript and a short set of notes and
quotable lines — and every note carries a timecode that, when pressed, plays the
exact second it was said, with the words lighting up as they are spoken. Mark a
note ✓ heard once you have checked it against the tape, save your own quotes by
selecting the transcript, and export a quote sheet where every line has its
timecode. Heard has no account or application server: your library and keys stay
in this browser, while audio and transcript text go directly to the model
providers you choose for transcription and notes.

Product contract and direction of record:
`memory/heard-v4/PRODUCT-CONTRACT.md` and
`memory/heard-v4/DIRECTION-DECISION.md`.

## State of the build

The production path is closed end to end:

- imported audio is staged, transcribed, persisted and turned into anchored
  notes automatically when a notes provider is connected;
- opting out of keeping an imported original still allows transcription without
  writing that audio to IndexedDB;
- failed chunks resume without retranscribing completed chunks, and notes can be
  retried without paying for transcription again;
- every exact, playable timecode is the same **Proof Receipt** across Library,
  Notes, Summary and the synchronized source drawer;
- quote-sheet exports preserve citation identity and never present an unpinned
  note as an exact verified second;
- Library, Bring and Settings use progressive disclosure; all visible mobile
  targets across the four primary surfaces are at least 44×44 px.

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
| `npm test` — trust mechanics, terminal/explicit retry policy, provider/offline classification, export truth, cache isolation | 11/11 |
| `verify-engine` — chunking, resample, direct path, player, alignment, IndexedDB sample door | 45/45 |
| `verify-browser` — product contract, 44px touch, notes retry, playback follow, real intake closure | all green |
| `verify-export` — committed golden, refusal states, two languages and screenshots | 51/51 |

Transcription in the engine suite runs in **mock** mode on a machine with no
OpenAI/Groq key, backed by 4408 real word timings from the shipped 29-minute Yale
lecture, with each chunk located acoustically rather than told where it sits.

## Routes

    #/            Library
    #/i/:id       Interview
    #/i/:id?t=…   Interview at a bounded proof second
    #/add         Bring
    #/rec         Record
    #/settings    Settings

Hash routing with `base: './'`, because this deploys to a GitHub Pages project
sub-path and deep links must survive a refresh with no server rewrite. An
unknown hash renders the Library — never a white screen.

## Run it

    npm install
    npm run dev       # Vite prints the selected local URL
    npm run build     # typecheck + static contracts + vite + service worker
    npm test          # fast trust-mechanics suite
    npm run verify:browser  # starts and closes its own isolated Vite server
    npm run verify:all      # build + core + golden + engine + browser
    npm run preview

`verify:all` requires `ffmpeg` and a system Chrome/Chromium. The verifier finds
common macOS, Linux and Windows installs; set `CHROME_PATH` for another location.

## What the build actually checks

`npm run build` fails on any of these, on purpose:

- `tsc --noEmit`
- **verify-i18n** — every `t('key')` resolves, and every key exists in **both**
  languages. `translate()` falls back to the raw key, so a key missing from
  English ships on screen as the literal string `bring.choose`.
- **verify-tokens** — every DESIGN §7 colour role exists in *both* themes, the
  type/spacing/motion scales are present, and no stylesheet outside the token
  file hard-codes a hex.
- **verify-router** — the five routes and bounded `?t=` receipts resolve;
  malformed hashes and unbounded times fail closed.
- **verify-contracts** — the frozen type shapes still have their exact field
  names, the unions still admit every member, and the store is still versioned
  with a migration.
- **verify-pwa** — every declared icon exists at its declared pixel size, the
  manifest is Pages-relative and standalone, and the service worker caches only
  successful same-origin GETs while deleting only the `heard-` cache prefix.
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
An imported file whose “keep original” switch is off uses a session-memory
handoff for transcription and is never written to IndexedDB; browser recordings
are always kept because they are the only original.

`theme` and `lang` are additionally mirrored into `localStorage['heard-ui']` so
`index.html` can apply them synchronously before the first paint.

## Credits

The bundled sample is an excerpt from NASA's *Houston We Have a Podcast*, public
domain. NASA is acknowledged as the source; no NASA insignia is used. Every
starter-library item carries its publisher-requested attribution in Settings.
