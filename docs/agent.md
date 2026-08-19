# Project Guide for Developers and AI Agents

The orientation document. If you are new here — human or model — read this after
the README and before touching code.

[`../agents/instructions.md`](../agents/instructions.md) is the rules.
[`../agents/workflow.md`](../agents/workflow.md) is the procedure.
This file is the understanding those two assume you already have.

---

## What Lifelog is

A system that reads ordinary human text and understands it as structured life
information, while keeping the original text intact forever.

Someone writes "I met Arun yesterday in Ahmedabad and I need to send him the
project files by Friday." Lifelog records a past event, a memory, a person, a
place, a task and a deadline — and stores the sentence exactly as typed, because
the extraction is an opinion and the sentence is a fact.

## What Lifelog is not

**It is not an AI model, and it is not a wrapper around one.**

This is the sentence that explains most of the codebase. A model reads meaning
well; that is one step. Everything that makes Lifelog a product — what counts as
a memory, when a task becomes a reminder, whether to ask the user a question,
what "next Friday" resolves to, how much to trust an extraction — is Lifelog's,
lives in code, and is tested without a network call.

The practical consequence, and the test to apply to any change you make:

> If replacing the model would require editing a file outside
> `backend/src/ai/`, the change is wrong.

---

## How the project is organised

```
lifelog/
├── backend/          The engine
│   ├── src/
│   │   ├── ai/            Provider adapters — the replaceable part
│   │   ├── intelligence/  Lifelog's rules — the part that is the product
│   │   ├── schemas/       Zod contracts (API + analysis)
│   │   ├── config/        Startup configuration and the keys loader
│   │   ├── controllers/   HTTP shaping
│   │   ├── routes/        Path declarations
│   │   ├── services/      Orchestration
│   │   ├── repositories/  All SQL
│   │   ├── db/            Drizzle schema, client, migrations
│   │   ├── errors/        Error taxonomy and the one error boundary
│   │   └── utils/         Redaction. Keep this directory nearly empty.
│   └── tests/        unit · behaviour · integration
├── frontend/         Temporary test console
├── docs/             This documentation system
├── agents/           Instructions for AI coding agents
├── secrets/          Gitignored key storage
└── scripts/          Secret scanner, key setup, hook installer
```

The two directories that matter most are `ai/` and `intelligence/`, and the
boundary between them is the architecture. Read
[`architecture.md`](architecture.md) for how the layers relate, and
[`coding-structure.md`](coding-structure.md) for where a given piece of code
belongs.

---

## The five principles

**1. The original conversation is sacred.**
`conversations.raw_text` is written first, never edited, never normalised, never
truncated. If every other table were dropped, no user data would be lost.
Everything else is an interpretation that can be recomputed. See
[`memory.md`](memory.md).

**2. Grounding is not optional.**
Every extraction must trace back to characters the user actually typed. A
fabricated memory is worse than a missing one, because in ten years the user
cannot tell it is false. Weakening grounding to make an extraction pass is never
the right fix. See [`algorithm.md`](algorithm.md).

**3. Ask rarely.**
A system that can always find something missing will always ask, and a
life-logging tool that interrogates you after every sentence stops being used.
Missing information is *recorded* freely; a *question* is asked only when the
gap blocks something the user clearly wants. One question, maximum.

**4. Degrade, do not fail.**
A model timeout falls back to the offline engine. A failed analysis write still
returns the analysis. Broken JSON gets repaired. The user gets a worse answer
with a warning, not an error. What is never silent is the degradation itself —
`meta.degraded` and the `warnings` array say exactly what happened.

**5. Documentation is part of the architecture.**
Not commentary on it. A change that makes a document wrong is an incomplete
change.

---

## What you can change freely

- Adding a new intelligence rule module, and wiring it into the pipeline.
- Improving the local rule engine's coverage.
- Adding tests. Always.
- Adding warnings to explain something the pipeline already does silently.
- Improving the test console.
- Fixing a documented limitation, if you also update the document.
- Adding an index that a real query needs.

## What needs a decision record first

Each of these goes in [`decision.md`](decision.md) with the options you
considered and the trade-off you accepted:

- Changing `AnalysisSchema` in a non-additive way
- Changing the API contract
- Changing the database schema
- Adding, removing or replacing a dependency
- Adding an AI provider or changing the default model
- Changing how grounding, follow-up, or the task/reminder distinction works
- Anything that makes the system depend on one model's behaviour

## What must never be changed casually

- **The append-only nature of `raw_text`.** No code may rewrite it.
- **The grounding stage.** It is the hallucination defence.
- **The task/reminder distinction.** Lifelog will send notifications one day.
  Notifying someone who never asked is worse than missing a reminder.
- **Log redaction.** Never add a log line that bypasses it.
- **The secrets boundary.** Keys live in `secrets/API-KEYS.md`, nowhere else,
  and never in a log, a test fixture, a doc example or a commit.

---

## Reading the system when something looks wrong

The response tells you almost everything. Start with `analysis.warnings` — every
override, drop, merge, demotion and repair the pipeline performed is recorded
there with a code:

| Warning code | What happened |
| --- | --- |
| `PROVIDER_DEGRADED` | The primary provider failed; a fallback answered |
| `INTENT_COERCED` | The model's intent label was mapped onto a Lifelog intent |
| `ENTITY_UNGROUNDED` | An entity was dropped — its name is not in the text |
| `ITEM_UNGROUNDED` | An item was dropped — not supported by the text |
| `ITEM_PARAPHRASED` | Kept, but the model paraphrased instead of quoting |
| `TEMPORAL_UNGROUNDED` | A time phrase was discarded — the user never wrote it |
| `TEMPORAL_UNRESOLVED` | A phrase was kept raw because it is ambiguous |
| `ITEM_DUPLICATE` | Two items covered the same span and type; they were merged |
| `REMINDER_DEMOTED` | Became a task — the user did not ask to be reminded |
| `TASK_PROMOTED` | Became a reminder — the user did ask |
| `TYPE_RECLASSIFIED` | Type changed to agree with the resolved date |
| `ITEM_PRUNED` | An empty or redundant `PRESENT_FACT` was removed |
| `INTENT_OVERRIDDEN` | Intent forced to `SET_REMINDER` by an explicit reminder |
| `ANALYSIS_NOT_PERSISTED` | The analysis was produced but could not be saved |

Then check `meta.provider`. If it says `local`, you are looking at the offline
rule engine, which is deliberately simpler than a hosted model — see
[`ai-engine.md`](ai-engine.md) before concluding the pipeline is at fault.

---

## Where to read next

| Question | Document |
| --- | --- |
| What do these words mean? | [`glossary.md`](glossary.md) |
| How do the layers fit together? | [`architecture.md`](architecture.md) |
| What actually works today? | [`functionality.md`](functionality.md) |
| **What are Lifelog's rules?** | [`algorithm.md`](algorithm.md) |
| How is the model used, and how do I replace it? | [`ai-engine.md`](ai-engine.md) |
| What is in the database? | [`data-model.md`](data-model.md) |
| What is the HTTP contract? | [`api.md`](api.md) |
| Why is it built this way? | [`decision.md`](decision.md) |
| How do I test a change? | [`testing.md`](testing.md) |
| What is left to build? | [`implementation.md`](implementation.md), [`roadmap.md`](roadmap.md) |
