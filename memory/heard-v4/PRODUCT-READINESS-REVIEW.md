# Heard — Product Readiness Review

**Date:** 2026-08-27
**Reviewed branch:** `feat/heard-product-completion`
**Baseline:** `origin/main@b962a7a`
**Purpose:** Decide whether Heard is a finished consumer product, whether its differentiation is real, and what must be true for the first public release to be effective rather than merely online.

## 1. Executive verdict

**Heard is not ready for a public consumer launch.**

It is a strong, unusually trust-aware product candidate with a real signature interaction and substantially more consumer craft than a normal first coding project. Today, however, it is best described as a **high-fidelity, BYOK technical alpha / vertical slice**:

- bundled recordings demonstrate a polished end state;
- mock providers prove much of the orchestration;
- the browser-side recording, storage, transcript-following, export, recovery and evidence mechanics are real;
- but a normal user cannot take their own recording through the promised loop without understanding and supplying third-party STT and LLM credentials;
- no production-managed service, public deployment, operational controls or real-provider acceptance currently closes that gap.

A public URL now would launch the **demonstration before the product**. That would spend the first-release moment teaching users that Heard works beautifully on its own examples and stalls on theirs.

**Readiness score: 46/100.** This is an explicit weighted product rubric, not an objective market statistic.

## 2. What was actually verified

### Facts established from the live branch

- The review used `/Users/zihaowang/Open claw/Heard`, not the older desktop copy.
- The pre-review feature commit changes 48 files relative to `origin/main` and contains recording, import, transcript, notes, playback, export, local persistence, PWA and Proof Canvas work; this review adds the trust/recovery fixes and report separately.
- No real provider key was read, printed or committed. Added-line scanning found no hard-coded credential; `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities.
- The production architecture remains browser-local/BYOK. STT and Notes requests leave the browser directly for user-configured providers.
- A fresh isolated Chrome profile recorded a generated five-second test tone through the real `MediaRecorder` path. With no STT key it landed in `recorded, not yet transcribed`, with zero transcript and zero Notes. This reproduces the structural blocker without using a starter fixture.
- That run exposed a contradictory recovery path: the waiting Notes card linked to Bring while the other CTA linked to Settings. This review added a failing browser assertion first, then corrected the Notes card to Settings.
- An independent adversarial probe found that generated Summary and saved-prompt text could mix unsupported prose with a valid receipt, or return `ok: true` with a citation that failed alignment. RED tests reproduced period, Chinese punctuation, semicolon, bullet/newline, blank-output and saved-prompt bypasses. The shared validator now rejects generated prose unless every claim unit has a canonical, aligned citation and every supplied citation is referenced. Generated artifact storage moved to a v2 key so unvalidated legacy cache is not read, and removal clears both key versions.

### Automated evidence and its boundary

At review time:

- product-core tests: **19/19** after the new trust regressions;
- focused waiting/recovery experience checks: **15/15**;
- transcript-following verifier: **10/10**;
- the stable post-fix `npm run verify:all` exited 0: build, 100/100 sample checks, 20/20 sample-migration checks, 19/19 product-core tests, 8/8 export checks, 45/45 audio-engine assertions, all browser experience/touch/Notes-retry/follow gates, and the intake E2E verifier passed;
- the audio-engine and intake evidence explicitly use mock providers. They exercise real browser, file, audio and orchestration paths but not a production STT or LLM account.

These are engineering gates. They do **not** prove a real production provider, a real consumer account, real deployment reliability or desirable retention.

### Still unverified

- a new human-voice recording through a production STT account;
- production Notes quality and citation yield on noisy, bilingual and multi-speaker audio;
- p50/p95 processing time and failure rate;
- mobile Safari installation, long recording and background/interruption behavior on real devices;
- production deletion, support, quota, abuse and incident paths;
- first-time-user activation and return behavior;
- legal review for third-party voice recording and 15–17-year-old users.

### Current merge blockers found by fail-closed code review

These are live-tree risks, not claims that every one was introduced by this feature commit:

- the GitHub Pages project-path deployment shares browser origin storage with sibling projects while BYOK credentials and private content are persisted;
- `Delete forever` does not yet await every storage deletion, remove generated artifacts and prevent an in-flight job from writing private data back;
- the service worker can read from origin-wide Cache Storage rather than only Heard's named cache;
- generating Notes for a partial transcript can promote the interview to `ready`, after which failed chunks no longer retry;
- a replacement file is accepted mainly by approximate duration, so a same-length wrong source can be combined with previously completed transcript chunks;
- provider requests have no universal deadline/cancellation policy, and automatic waiting jobs have no global concurrency or cost cap;
- HTML/share export can render an unpinned note as an exact timecode and omit Summary receipt provenance;
- repeated quotes generated from a later transcript window can align to an earlier occurrence because alignment searches the whole recording;
- no PR-triggered CI workflow runs the canonical suite; the existing workflow builds and deploys only after a push to `main`.

The unsupported-Summary, null saved-prompt citation, Chinese/semicolon/bullet/newline claim-boundary, blank-output, legacy-artifact-read and waiting-CTA defects discovered during this review were fixed with RED→GREEN regressions. The blockers above remain open and are why the pull request must stay Draft.

## 3. Weighted readiness rubric

| Dimension | Weight | Score | Evidence-based interpretation |
|---|---:|---:|---|
| Consumer craft | 15% | 7.2/10 | Deliberate typography, responsive composition, good tactile hierarchy and coherent product objects; some screens remain sparse and editorial rather than emotionally alive. |
| Core value expression | 15% | 7.5/10 | The note → receipt → quote → audio moment is immediately understandable in a finished example. |
| Production closure | 20% | 2.0/10 | Own recordings depend on BYOK STT/LLM; no managed service or real-provider acceptance. |
| Reliability and operations | 15% | 2.5/10 | Strong local recovery and tests, but no production observability, queue, quotas, support path or provider fallback. |
| Differentiation | 15% | 6.5/10 | A coherent proof-first interaction exists; it is not yet validated as a reason to switch or return. |
| Trust, privacy and legal | 10% | 3.5/10 | Local-first copy and fail-closed anchoring are thoughtful; production data policy, age strategy and recording consent are incomplete. |
| Go-to-market and retention | 10% | 3.0/10 | A plausible wedge exists, but no validated audience, activation funnel, price, distribution or retention evidence. |
| **Weighted total** | **100%** | **4.61/10 = 46/100** | **Promising product foundation; not a market release candidate.** |

## 4. Does it have finished-product character?

### What already feels product-grade

1. **There is a real product object, not just a feature list.** A Heard note is a claim wearing a receipt: timecode, verbatim source, audio span and a human `heard` state.
2. **The decisive interaction is satisfying.** Pressing a receipt raises the source words and plays the exact moment. The transcript follows the voice; the user can interrupt auto-follow and return.
3. **The design has a point of view.** Proof Canvas is recognizably editorial and evidence-first rather than another blue SaaS dashboard.
4. **Trust behavior is encoded, not only described.** Unaligned quotes lose exact status; invalid AI citations now fail closed; exports preserve evidence identity; destructive and retry states are differentiated.
5. **Mobile is treated as a primary surface.** The dock, player sheet, 44px targets, recording marks and live notes reflect actual mobile interaction decisions.

### What still feels like a polished prototype

1. **The starter is more complete than the user journey.** First-run value is powerful but creates a false expectation that an own recording will produce the same result automatically.
2. **The core dependency is hidden rather than removed.** Progressive disclosure makes provider settings less ugly; it does not make BYOK a consumer workflow.
3. **The Record idle state under-explains consequence.** “Audio never leaves this device unless you connect a provider” is privacy copy, not activation truth. It does not say plainly that no connection means no transcript or Notes.
4. **Settings remains a developer surface in disguise.** Provider, model, API key and Base URL are implementation concepts, even when folded into refined cards.
5. **The return loop is not yet proven.** Library shows accumulated recordings, but the product has no validated recurring job such as exam review, interview fact-checking or quote retrieval that users repeatedly complete.
6. **Several surfaces are visually calm but emotionally thin.** Record is credible and clean, yet sparse enough to feel like a state in a design system rather than a beloved tool a 15–22-year-old would recommend.
7. **There is no operational shell around failure.** No service status, job history, user-visible quota, support contact, remote deletion record or production incident posture exists.

**Conclusion:** Heard already has **prototype-to-product visual character**, but not **service-to-market completeness**. Consumer-grade appearance is present in key moments; consumer-grade reliability and onboarding are not.

## 5. Competitive reality

Heard cannot claim differentiation from transcription, synchronized playback or AI summaries alone:

- Apple Voice Memos already offers live/post-recording transcription, highlights the current word during playback, supports search, and moves the playhead to selected transcript text.[6]
- Granola offers AI meeting notes, AI chat, templates and multi-language support; its desktop/mobile apps capture microphone and system audio without a meeting bot and expose a live transcript.[1][2]
- Otter explicitly targets education with real-time captions, stored/searchable transcripts, highlights, slide capture and automated summaries; its public offer also includes real-time transcription and a free monthly-minute allowance.[3][4]
- Notion positions AI Meeting Notes inside a broader workspace and says it captures details and actionable summaries without a bot.[5]
- Plaud combines dedicated capture hardware, real-time highlights, speaker-labelled multilingual transcription and AI summaries, with a bundled free transcription allowance.[7]
- Descript turns time-synced transcripts into an editing surface and gives users a free transcription allowance.[8]

### Table stakes for a 2026 launch

- record and import without technical setup;
- accurate transcript, speaker handling and synchronized playback;
- summary/notes that arrive reliably;
- search, rename, delete and export;
- clear consent and privacy behavior;
- understandable limits and recovery;
- mobile capture and dependable return to previous work.

Heard currently meets some of these in its browser engine and examples, but not the ordinary-user activation and operational requirements.

## 6. Is the differentiation real?

### The ownable core

**Proof Receipt**

> claim → canonical citation → verbatim quote → exact audio span → synchronized words → human `heard` state

This is more specific than “AI notes with timestamps.” It changes the unit of output: Heard is not primarily selling a transcript or a summary; it is selling a **checkable note**.

Recommended category language:

- **Heard — notes with receipts.**
- **Don’t trust the summary. Press it.**
- Chinese working line: **每条笔记，都能按回原声。**

### Why it matters

The strongest user is not somebody who merely wants less typing. It is somebody who cares whether the output can survive a second look:

- a student checking what will actually be on an exam;
- an interviewer or young creator checking a quote before publishing;
- a researcher revisiting the source of a claim;
- a bilingual learner comparing what was said with what was understood.

### Why it is not yet a moat

- Competitors already own capture, transcript, summary, search and distribution.
- A timestamp chip is easy to copy.
- Heard has not yet shown that users press receipts often, catch mistakes, trust the result more, or return because of that behavior.
- No proprietary model or data advantage currently exists.

The defensible path is **interaction contract + trust reputation + evidence-quality data**, not a feature checklist. Every generated surface must obey the receipt law, and product analytics should measure evidence behavior without collecting raw content by default.

## 7. Recommended launch wedge

Do **not** launch as “another AI meeting notetaker.” That puts a one-person product against mature meeting, workspace, hardware and study platforms on their strongest ground.

### Initial audience

Start with **18–22-year-old college students, recent graduates and young creators who record lectures or interviews and already distrust generic AI summaries**.

Keep 15–17-year-olds out of the first external beta until age policy, consent, data retention and legal review are complete. The FTC's COPPA guidance is focused on children under 13, but it separately addresses teen services, mixed audiences and prominent disclosure; “not under 13” is not a complete youth-safety strategy.[9]

### Initial job

> “I recorded something important. Give me the few lines worth keeping, and let me verify each one without hunting through the whole recording.”

### Why this wedge is plausible

- It uses the exact capability Heard already expresses best.
- It does not require team administration, calendar bots or enterprise integrations.
- The pain is emotionally legible: fear of misquoting, misunderstanding or studying the wrong thing.
- Success can be observed in one session: a user presses a receipt and confirms or rejects the note.

## 8. Minimum meaningful launch

A meaningful first launch is **not** “the repository is public” or “a Pages URL works.” It is a small group of real users completing their own source-to-proof loop without the maker standing beside them.

### Launch candidate must include

1. **Managed processing:** no provider key, model or Base URL exposed to ordinary users.
2. **A production job path:** secure upload or request streaming, async status, idempotent retry and bounded failure.
3. **Real-provider acceptance:** new human recording → transcript → Notes/Summary → verified receipts → source playback in ordinary Chrome and mobile Safari.
4. **Clear identity and quota:** invite/account/session, minutes remaining, recording limits and abuse controls.
5. **Deletion and export:** delete interview, delete account/data, export useful artifacts, documented retention.
6. **Privacy and consent:** provider disclosure, retention, training policy, recording-consent language, youth policy and a real privacy notice/terms review.
7. **Operational visibility:** job state, sanitized errors, latency/cost monitoring, provider outage behavior and a support contact.
8. **A production domain:** HTTPS, CI/CD, rollback, error monitoring and smoke checks.
9. **Starter licensing decision:** the bundled Yale entry is marked `CC BY-NC-SA` and `commercialUse: false` in the manifest. It must be removed, replaced or legally cleared before a monetized bundle; the other starter attributions also need a release checklist.

### Private-beta exit criteria

Recommended thresholds for 25–50 invited, 18+ testers:

- at least 80% complete their first own recording/import without human setup help;
- at least 95% of processing jobs end in `ready` or a clear recoverable state;
- 100% of displayed exact AI receipts pass the canonical citation/anchor gate;
- at least 60% press a receipt during first use;
- at least 30% return within 14 days for a second own recording;
- at least five users can describe the value without using the words “transcription app”;
- cost per processed hour, retry rate and provider failure rate stay within pre-agreed limits.

These are proposed decision thresholds, not existing performance claims.

## 9. What not to build yet

Do not dilute the first release with:

- calendar bots and automatic meeting joining;
- team workspaces, comments and admin controls;
- flashcards, quizzes, tutors and generic study-generation suites;
- dozens of summary templates;
- native desktop and Android apps simultaneously;
- broad integrations or MCP;
- a general-purpose chatbot over every recording;
- social feeds, public profiles or creator marketplaces.

Those are competitor-parity expansions. Heard first needs to prove that **receipts change user behavior**.

## 10. Recommended release sequence

### Gate A — Engineering alpha

- canonical repository and branch discipline;
- managed STT/Notes gateway;
- server-side secrets and quotas;
- production-domain deployment;
- one real-provider path and one fallback;
- full real-recording acceptance on desktop Chrome and iPhone Safari.

### Gate B — Private proof beta

- 25–50 invited 18+ users;
- one lecture/interview job, one simple onboarding;
- minimal analytics that avoid raw transcript/audio collection;
- weekly review of failed jobs, pressed receipts, corrected notes and returns;
- direct support channel.

### Gate C — Public first release

Only after beta evidence clears the exit criteria:

- pricing/free-minute decision;
- privacy, terms, consent and content-licensing review;
- public support and status path;
- cost caps, incident rollback and provider fallback;
- App Store/native packaging only if PWA behavior demonstrably blocks adoption.

## 11. PR and merge recommendation

The branch is worth preserving and reviewing. It establishes the strongest current product direction, fixes several real trust/state problems and gives Heard a recognizable product object.

**Open the PR as Draft. Do not merge it as a “market-ready release.”**

The PR should be framed as:

> A proof-first consumer product foundation and verified browser vertical slice, pending managed production services and real-user launch gates.

That is honest, useful and compatible with a meaningful first release. It lets the existing work receive code review without confusing branch completion with product completion.

## Sources

[1] https://www.granola.ai/pricing
[2] https://docs.granola.ai/help-center/taking-notes/transcription
[3] https://otter.ai
[4] https://get.otter.ai/meeting-notes-5
[5] https://www.notion.com/product/ai
[6] https://support.apple.com/guide/iphone/view-a-transcription-iph00953a982/ios
[7] https://www.plaud.ai/products/plaud-note-pro
[8] https://www.descript.com/transcription
[9] https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
