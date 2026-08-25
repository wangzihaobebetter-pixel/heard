# Heard v4 — Product Contract

Status: branch acceptance contract for `feat/heard-product-completion`
Source: Shai’s original product statements, 2026-08-24, plus live review of baseline `b962a7a`.

## North star

**Every useful thought carries a one-press path back to the exact moment it was said.**

Heard is not a transcription dashboard and not an AI summary feed. It is a listening notebook whose notes can prove themselves.

## Person and emotional job

Primary person: a student, researcher, interviewer, journalist, podcaster, or curious listener who needs to stay present now and trust their notes later.

Fear on entry:

- “If I stop to write, I’ll miss what comes next.”
- “If AI summarizes this, I won’t know whether it invented or flattened the point.”
- “If I return next week, I won’t find the exact moment again.”

Desired exit feeling:

- “I was able to listen instead of transcribe.”
- “I know which claims I verified and can reach every source moment.”
- “This recording has become durable, usable memory.”

## Value ladder

1. **Immediate:** press one timecode and hear the claim in context while the matching words light up.
2. **Session:** record or import without losing the tape; mark moments while listening; read partial transcript as it arrives.
3. **Return:** resume at the last moment, search across recordings, revisit only marked moments, and export cited notes.
4. **Accumulated:** build a personal, source-grounded library whose AI output remains auditable rather than replacing judgement.
5. **Identity:** become somebody whose understanding is both fast and solid — not merely somebody with more generated text.

## Emotional arc of the core loop

1. **Curiosity:** a real recording opens with one simple invitation.
2. **Proof:** the first press joins note, sound, waveform, and highlighted words.
3. **Agency:** the listener marks, edits, verifies, or rejects; AI never impersonates the listener.
4. **Relief:** the tape is safe, progress is honest, and interruption is recoverable.
5. **Closure:** a compact cited result is ready to reuse; the product knows when to stop.

## Surface archetypes

| Surface | Archetype | One job |
|---|---|---|
| Library | Orient / Return | Continue something meaningful or begin one recording |
| Record | Operate | Capture sound and moments with absolute confidence |
| Bring | Commit | Choose a file, understand the data boundary, start once |
| Interview | Inspect | Move fluidly among notes, voice, transcript, and cited AI output |
| Settings | Configure | See connection health first; reveal technical controls only on request |
| Export | Deliver | Produce a portable cited artifact without losing provenance |

## Ownable product object: the Proof Thread

The Proof Thread is the visual and behavioral path joining:

`note or AI claim → proof chip → source words → waveform playhead → provenance`

Rules:

1. A proof chip displays a real timecode, not an abstract citation number.
2. Pressing it seeks with context, plays the bounded span, and brings the spoken words into view.
3. The active thread uses the single sound signal color. Decoration, success, settings, and AI do not borrow that color.
4. The source excerpt remains readable; it is not truncated into a decorative one-line teaser when space permits.
5. “Heard” records a human verification act. It is neither a score nor a generic completion check.
6. A generated artifact with any unresolved numbered claim is rejected as a whole; partial evidence never launders unsupported text into the product.

## Keep / rebuild / remove

### Keep

- Browser-local library, IndexedDB audio persistence, reload recovery, and no app-owned backend.
- Decode/chunk/transcribe engine and current single-flight intake driver.
- Word-level playback cursor, bounded span playback, transcript following that yields to manual scroll.
- Live recording, pause, mark, typed live note, silence warning, and crash recovery.
- Real starter recordings and source attribution.
- Search, transcript editing history, recoverable trash, export formats, and cited AI artifact schema.
- Warm paper / ink foundation, serif object titles, mono clocks, and one sound signal color.

### Rebuild

- Library composition: from a vertical fixture catalogue to a return surface with a clear next act, a featured continuation, and a scannable starter shelf.
- Note rows: from universal rounded cards and two-line truncation to a calmer proof-thread list that lets claims and source excerpts breathe.
- AI summary citations: from `[1]` bubbles to explicit timecoded proof chips.
- Bring: choose the recording before showing connection configuration; make the one-time connection step legible and honest.
- Settings: connection status and simple choices first; provider/model/base URL/vocabulary behind progressive disclosure.
- Mobile hit areas and bottom-player spacing: every visible control must have a 44×44 CSS-pixel hit target without covering content.
- Ink contrast and surface separation; paper remains canonical but dark mode must retain equal dignity.
- Verification: self-contained, path-safe, behavioral, and able to fail on broken producer→consumer seams.

### Remove

- Provider/key controls on the empty Bring screen.
- Raw Unicode gear/theme/share symbols where an intentional accessible icon belongs.
- Citation numbers that hide the source time.
- Origin-wide service-worker cache deletion.
- Tests that require files outside the repository or report an installed dependency missing because a path contains spaces.
- Fixture screenshots as evidence for production export or end-to-end intake.
- Visual card shells used only to make unfinished composition look complete.

## Product constraints

- No real credential appears in logs, fixtures, screenshots, export, URL, or persisted share payload.
- Copy must distinguish: local app storage; direct provider processing; optional local audio retention.
- A person may use transcription without AI notes. A missing LLM key cannot make the recording path fail.
- If one OpenAI-compatible connection can safely serve both tasks, the product may offer explicit reuse; it must not silently copy a key to a different provider.
- Errors that are circumstances (offline, refused key, provider interruption) retain the tape and offer a bounded retry. Irrecoverable audio errors say what was lost and why.
- System theme remains respected. Paper and ink both pass contrast and interaction checks.

## Acceptance gates

### Core closure

- Generated test audio imported through the real file input reaches `ready` or honest `partial` with persisted words; the blob is playable when retention is on and absent from IndexedDB when retention is off.
- A reload during or after intake resumes the correct incomplete stage without duplicate requests.
- A real note proof chip seeks, plays, highlights, follows, yields to hand scrolling, and returns to voice.
- AI generation with a mock provider produces only source-verified, timecoded claims.
- Interview export opens from the production button and downloads/copies production data, not fixture data.

### Consumer quality

- Cold start proves the product in one press before asking for configuration.
- Library has one dominant next act and does not read as eight identical demo cards.
- Bring has one dominant task per state; technical configuration is absent before a file is chosen.
- Settings opens as understandable connection health, not a developer console.
- Notes and excerpts are readable at 390×844 and 1280×900.
- Every visible mobile control has a minimum 44×44 hit target.
- Empty, waiting, listening, partial, failed, returning, and complete states look intentional.

### Trust and PWA

- Privacy copy names the selected external provider boundary.
- Service worker caches only successful same-origin GETs and deletes only `heard-` caches.
- Cold offline reload succeeds after one online visit; provider POSTs and authorization are never cached.

### Verification

- `npm run build` passes.
- Official verifiers are self-contained inside this repository and support a configurable Chrome path.
- At least one behavior gate imports generated audio through a real browser and mock provider.
- Visual acceptance uses production components and meaningful states at 1280×900 and 390×844.
- Final Git diff contains no credential, temporary browser profile, generated media, disposable prototype, or unrelated refactor.

## Human acceptance boundary

Automated checks can prove closure, persistence, accessibility, cache isolation, and source anchoring. They cannot prove that a real model’s notes are insightful, that the installed PWA feels native on Shai’s devices, or that the visual character is desirable. Those remain explicit branch-acceptance checks before merge into `main`.
