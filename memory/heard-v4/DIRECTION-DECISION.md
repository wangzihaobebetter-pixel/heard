# Heard v4 — Direction Decision

Date: 2026-08-24
Branch: `feat/heard-product-completion`
Decision owner: main product/design agent

## Compared directions

All three throwaway directions used the same real Heard content and were rendered at 1280×900 and 390×844 across Library, Interview, and Bring.

### 1. Proof Canvas — selected

**Stance:** warm editorial listening notebook whose visible product object is the Proof Thread.

Strongest evidence:

- The Library communicates the value before asking for setup: a claim, a real timecode, a waveform, and “hear the proof” live in one continuation object.
- The interview gives notes and transcript different material roles without turning either into a dashboard module.
- The warm paper / one signal colour foundation grows out of the current product rather than replacing it with a fashionable shell.
- Bring has one first action and can delay technical configuration until a file exists.

Risks to correct in production:

- The prototype’s mobile title clips.
- A global bottom nav and a player cannot occupy the thumb zone simultaneously.
- A proof press on mobile must reveal source words, not continue displaying only Notes.
- The desktop Proof Thread is a family of aligned signals, not yet a literal decorative line crossing columns; do not add a fragile SVG connector just to make the name visible.
- The serif measure needs a slightly smaller mobile scale and more compact transcript rhythm than the prototype.

### 2. Tape Desk — rejected as the whole system; two strengths borrowed

**Stance:** waveform-first instrument, dense and operational.

Borrow:

1. A clear waveform/playhead stage that behaves as the same source clock as transcript and proof chips.
2. Explicit bounded-play status (“playing one proof · stops at …”) and immediate source-word reveal on mobile.

Reject:

- Blue-gray tool chrome makes Heard resemble a transcription SaaS.
- Library rows and filters privilege inventory management over curiosity and return.
- The large waveform stage consumes too much mobile height before the words appear.
- Proof notes become a utility tray instead of the user’s durable understanding.

### 3. Study Zine — rejected as the whole system; tactile lesson borrowed

**Stance:** bold, colourful study magazine.

Borrow:

- Large, unmistakable mobile targets.
- Direct verbs and visible hierarchy at a glance.

Reject:

- Heavy outlines, multiple saturated panels, stamps, and hard shadows make a serious source-verification product feel toy-like.
- The visual system competes with archival and emotionally difficult recordings.
- Large decorative regions reduce information density without increasing calm.
- The same card language would age quickly and overpower Paper / Ink parity.

## Production direction

**Proof Canvas with an instrument-grade voice layer.**

The visual system remains warm and editorial, while every interaction involving time uses the rigor of a sound tool:

- one sound signal colour;
- one clock shared by proof chip, waveform, transcript highlight, and player;
- visible bounded-play status;
- mobile source reveal on proof press or scrub;
- user notes in full ink, AI reading one register quieter;
- technical configuration progressively disclosed after the user’s recording is known.

## Surface decisions

### Library

- One dominant continuation object when personal recordings exist.
- Personal work appears before the starter shelf.
- Starter recordings become a compact proof demonstration, not eight identical personal-looking cards.
- One primary “New recording” action.

### Interview

- Desktop: notes/AI on the left, source transcript on the right, one fixed voice control beneath.
- Mobile: one reading surface at a time, but a proof press or scrub enters a transient source-follow state immediately; the user can return to the note in one press.
- Timecoded proof chips show the actual time, not `[n]`.
- No second persistent bottom navigation while the player owns the thumb zone.

### Bring

- Empty state contains no provider/key/model/base URL form.
- File selection is the only dominant action.
- After selection, an honest connection step names the provider boundary and the temporary local working-copy lifecycle.

### Settings

- Opens on connection health and storage facts.
- Provider/model/key/base URL move behind named disclosures.
- Copy never claims material stays in-browser when a selected provider processes it.

## Rejected risks that must not reappear

- generic SaaS rows and filter chrome as the primary Library composition;
- bold colour blocks as a substitute for emotional warmth;
- universal rounded cards around every paragraph;
- a hidden transcript that follows correctly in state but is invisible to the person;
- player plus global navigation occupying the same mobile bottom edge;
- technical setup before value or file intent is established.
