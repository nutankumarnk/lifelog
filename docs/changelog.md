# Changelog

Meaningful changes only — architecture, functionality, contracts, security.
Not every commit. If a change would not matter to someone returning to the
project in six months, it does not belong here.

Format: date, version, what changed, why.

---

## 2026-08-20 — 1.0.1

### Fixed

**Lexicon phrase matching now respects word boundaries.** Marker lists were
matched as plain substrings, so `"do i"` matched inside `"do it"` — which read
"might do it again tomorrow" as a question and set intent to `ASK` instead of
`PLAN`. Markers written with a deliberate trailing space (`"must "`, `"should "`)
are unaffected, because a boundary is only required where the marker itself ends
in a word character.

*Why:* intent gates the follow-up rule, so a misread intent changes whether
Lifelog speaks. Five regression tests added; test count 153 → 158.

---

## 2026-08-19 — 1.0.0 — Phase 1: Conversation Understanding

The first working version of Lifelog. Everything below is new.

### Added — the engine

**A model-independent intelligence layer.** Segmentation, normalisation,
grounding, temporal resolution, classification, follow-up logic and confidence
calibration, all in code and all testable without a network call.

*Why:* the product is the rules, not the model. Rules in code can be tested,
versioned and reasoned about; rules in a prompt change silently whenever the
vendor retrains. ([D-001](decision.md))

**An AI provider abstraction with three implementations** — OpenRouter (Gemma by
default), an offline rule engine, and a scriptable mock — behind one interface,
with retries, failover and degradation reporting in a registry rather than in the
adapters.

*Why:* Lifelog must keep working when a provider does not, a fresh clone must run
with no credentials, and the test suite must be deterministic and offline.
([D-005](decision.md), [D-006](decision.md))

**Grounding as a hard requirement.** Every extraction must trace back to
characters the user actually typed. Exact matches keep the real substring; close
paraphrases survive with reduced confidence; anything below 50% content-word
overlap is dropped with a warning.

*Why:* in a life record, an invented memory is indistinguishable from a real one
after enough time has passed. A missing item is a gap the user can fill; a
fabricated one is a corrupted memory. ([D-007](decision.md))

**The task/reminder distinction, enforced in code.** A `REMINDER` requires
explicit request wording; a model-labelled reminder without it is demoted to a
`TASK`, and a task with it is promoted.

*Why:* Lifelog will send notifications eventually, and notifying someone who
never asked is a worse failure than missing a reminder they did.
([D-008](decision.md))

**One follow-up question, rarely.** Missing information is always recorded; a
question is asked only when the gap blocks something the user clearly requested.
Diary entries and plain logs are never interrogated.

*Why:* a tool that asks after every sentence stops being used.
([D-009](decision.md))

**Calibrated confidence, capped at 0.95.** The model's self-report is treated as
one weak signal and adjusted with evidence Lifelog can verify.

*Why:* uncalibrated confidence is worse than none, and a 1.0 in a UI invites the
user to stop checking. ([D-010](decision.md))

### Added — data

**PostgreSQL schema: eight tables.** `conversations` is append-only and
authoritative; `analyses`, `segments`, `entities`, `items`, `item_entities`,
`follow_ups` and `ai_invocations` are derived and versioned by analysis.

*Why:* the original conversation is the source of truth and everything else is an
interpretation. Written in that order, so the worst case is a conversation with
no analysis rather than an analysis with no conversation. ([D-002](decision.md),
[D-003](decision.md))

**Analyses stored as both a JSON payload and normalised rows**, in one
transaction.

*Why:* the blob reconstructs one analysis in a single read; the rows answer
questions across conversations. ([D-013](decision.md))

### Added — API

`POST /api/v1/conversations/analyze` and `GET /health`, with a single error
envelope carrying a code, a client-safe message and a request id.

*Why:* the future mobile client consumes the same contract, so it is treated as
important from the start. Internal detail never crosses the boundary — `AppError`
keeps the log message and the public message as separate fields.

### Added — security

**A dedicated secrets subsystem:** `secrets/API-KEYS.md`, gitignored,
name-allowlisted, permission-checked and never logged, with a loader, a secret
scanner and a pre-commit hook.

*Why:* the real vulnerability is ambiguity about where a key belongs. One
designated, mechanically protected location closes the four places keys usually
end up. ([D-012](decision.md))

**Log redaction.** Conversation content never reaches a log line — only length,
word count and a hash. Credential shapes are redacted from any string that is
logged.

*Why:* Lifelog's input is the most private text a person writes, and logs are the
least protected place in a system.

### Added — verification and tooling

- **158 tests** covering the 20 required scenarios, failure paths, the API
  contract and the security controls. No test calls a real model.
- **A React + Vite test console** on port 5319 — API-only, no key, no model
  logic, no database access. Explicitly disposable.
- **This documentation system**: `README.md`, four `agents/` files and twenty
  `docs/` files, treated as part of the architecture rather than commentary on
  it. ([D-014](decision.md))

### Known limitations at 1.0.0

Not defects — the stated scope of Phase 1. Listed in full in
[`functionality.md`](functionality.md) and [`../agents/context.md`](../agents/context.md).

- No authentication, no encryption at rest, single implicit local user
- No cross-conversation entity identity
- No recall — `ASK` intent is detected but not answered
- Timezone recorded but not applied to date arithmetic
- The local rule engine is deliberately weaker than a hosted model

**Do not deploy Phase 1 publicly or with real personal data.**

---

## How to add an entry

Record architectural changes, new or removed functionality, contract changes,
security changes, and dependency changes. Do not record refactors that change
nothing observable, formatting, or test-only additions.

Every entry says **what changed and why**. Link the decision record when there is
one. If you are removing functionality, say so explicitly — silent removal is the
one thing this file exists to prevent.

```
## YYYY-MM-DD — X.Y.Z — Short title

### Added | Changed | Fixed | Removed | Security

**What changed.**

*Why:* the reasoning. ([D-0NN](decision.md))
```
