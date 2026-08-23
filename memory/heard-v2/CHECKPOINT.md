# Heard / 听证 — v2 rebuild checkpoint

**Opened:** 2026-08-23 12:2x EDT, after Wang corrected a misattribution.
**Owner:** Fable 5, main Slack session `agent:main:slack:direct:u0bgwfd3ppv:thread:1786400987.803299` (session model override = Fable 5).

## 0. The misattribution (do not repeat)

Wang's 11:51:56 rebuild demand was recorded by Opus as being about **IReallyKnow** — wrong.
Wang, 12:21:39 EDT verbatim:
> 你在回答什么，我说的要求和改变效果说的是Heard这个task，Ireally know我已经让另一个Hermes给我改完过了

Consequences, all verified:
- **IReallyKnow is HANDS-OFF.** Another agent ("Hermes") already redid it for Wang. Do not touch the repo, do not resume any irk queue item.
- resume-queue item `ireallyknow-v5-fable-rebuild-2026-08-23` closed 12:24 (status done, cancel note).
- Relay cron `irk-v5-p1` errored at dispatch (modelPolicy rejected `claude-cli/claude-fable-5`; allowlist has `anthropic/claude-fable-5`) — **no wrong-target build ever ran**.
- `memory/ireallyknow-v5/` CHECKPOINT + V5-PLAN carry a misattribution banner now; their §1 verbatim quote and §Hard constraints actually belong to **this** task.

## 1. What Wang said, verbatim (2026-08-23 11:51:56 EDT — about HEARD)

> 你认为你这个app搭建的和我最初设置这个任务要你达成的效果和水平差多少。我认为你这个简直是小学生版本，
> 实在是没有意义的产品。我现在希望你这个任务重新搭建，水准要对标市场上的成熟竞品水准。而不是要你给我做一个
> 小学生水平的东西出来。我现在要求你给我重新做，整个这个任务指定用fable 5完成，不允许你再派子代理了。
> 我再重复一遍我要的效果，如截图所示。

Screenshot (his standing acceptance bar):
> 好用 + 有质感。要能和市面上成熟的个人学习/自我成长类 app 摆在一起截图对比而不露怯。
> 足够吸睛，不要死板千篇一律的 UI。要让 2010 年后出生的学生真心愿意用，不是市场随大流的默认款。
> 成熟、可使用、好用的成品。不是 demo，不是骨架，不是"跑通了"。

## 2. Hard constraints

- **Fable 5 executes the entire task** (session model override already active; check `Current model identity` every turn — if not claude-fable-5, stop and tell Wang).
- **No subagents** (`sessions_spawn`/`Agent` forbidden).
- Claim-before-verify. No verifier/gate counts as quality evidence — the repo has 9 verify-*.mjs scripts and it still got called 小学生版本.
- Relay crons into this session: **omit the model override param** (session override carries Fable; `claude-cli/claude-fable-5` is rejected by modelPolicy).

## 3. What Heard is + where things are

Traceable-notes app（听证）: recorded audio → transcript → timestamped note cards; press a line, hear the source second. Built overnight 08-23 00:47–03:34 as WP0–WP4.

| Thing | Path |
|---|---|
| Workspace build repo | `/Users/zihaowang/.openclaw/workspace/heard/` (HEAD 3732382) |
| Desktop delivery repo | `~/Desktop/Open claw/Heard/` (same HEAD 3732382) |
| Remote | github wangzihaobebetter-pixel/heard |
| Design doc (pre-build) | `memory/traceable-notes/DESIGN.md` (373 lines) |
| Screenshots of current state | `heard/shots/` (ink/paper themes, 390+1280) |
| Sample data | NASA Gene Kranz interview, `sample-verification.md` |

## 4. Honest assessment of current state (looked at 12:23 EDT)

`shot-desktop-interview-paper-1280.png`: two flat columns — left timestamped note cards, right an
undifferentiated transcript wall. One thin accent rule. No visual identity, no depth, no motion,
no density management, reads as an unstyled document viewer. The same three structural failures as
IReallyKnow v1–v4: no competitor ever opened, measurability substituted for desirability, nobody
used it as a user.

## 5. Competitor bar to beat (open these for real, screenshot to memory/heard-v2/refs/)

Otter.ai, Granola, Voicenotes/Notta, Apple Voice Memos + Notes — the mature transcription/notes class.
