# Agent Workflow

How to actually do a piece of work on Lifelog. [`instructions.md`](instructions.md)
is the rules; this is the procedure.

---

## The loop

### 1. Orient

Read, in this order:

1. [`../README.md`](../README.md)
2. [`instructions.md`](instructions.md)
3. [`context.md`](context.md) — current phase, active module, known limitations
4. [`../docs/implementation.md`](../docs/implementation.md) — what is done and
   what is in progress
5. The `docs/` files relevant to your task

Do not skip step 4. If a previous agent was interrupted, the exact next step is
written there.

### 2. Understand what exists

Read the code you are about to change. Not a search result — the whole file, and
the modules it talks to. Lifelog's files are deliberately small so this is cheap.

Trace one request end to end at least once before your first change:

```
routes/conversations.route.ts
  → controllers/conversation.controller.ts
    → services/conversation.service.ts
      → repositories/conversation.repository.ts   (store the conversation first)
      → intelligence/pipeline.ts                  (the understanding)
          → ai/registry.ts → ai/*.provider.ts     (the replaceable part)
      → repositories/analysis.repository.ts       (store the interpretation)
```

### 3. Plan

Write the plan down before coding. It should name:

- the smallest change that solves the problem
- which files you will touch
- which tests you will add
- which documents will need updating

If the plan touches anything in the "requires an explicit decision" list in
[`instructions.md`](instructions.md), draft the decision record first.

### 4. Implement the smallest module

One concern at a time. Resist doing the adjacent refactor you noticed — note it
in `context.md` under known limitations instead.

Follow the existing shape of the code. Match its comment density, naming and
structure. New code should be indistinguishable from what is already there.

### 5. Run the tests

```bash
npm test                    # 153 tests
cd backend && npx tsc --noEmit
npm run keys:check
```

### 6. Fix what broke

A failing test is information. Before changing the test, work out whether the
test is wrong or the code is.

**If the test encodes a Lifelog guarantee** — grounding, the task/reminder
distinction, date resolution, no-hallucination — the code is wrong. Do not
loosen the test.

**If you changed behaviour deliberately**, update the test *and* say so
explicitly in your summary and in [`../docs/testing.md`](../docs/testing.md).

### 7. Update `implementation.md`

Mark what you completed. Mark what is in progress. Record the exact next step.
Do this before you write your summary, not after.

### 8. Update the rest of the documentation

Match the change to the document:

| You changed | Update |
| --- | --- |
| The analysis schema | `data-model.md`, `api.md`, `changelog.md` |
| The database schema | `data-model.md`, and add a migration |
| An extraction or classification rule | `algorithm.md` |
| The prompt | `ai-engine.md` |
| An endpoint | `api.md` |
| An error code | `error-handling.md` |
| A dependency | `technology.md` |
| An architectural choice | `decision.md`, `architecture.md` |
| Anything user-visible | `functionality.md`, `changelog.md` |
| A new term | `glossary.md` |
| Anything security-relevant | `security-checklist.md` |

### 9. Report

Say plainly:

- what changed and why
- what you deliberately did not do
- what you are unsure about
- what should happen next

Do not describe work you did not do. Do not claim a test passed if you did not
run it.

---

## Adding a new AI provider

The most common substantial task. It should not require touching anything
outside `src/ai/`.

1. Implement `AiProvider` in `src/ai/<name>.provider.ts`. Translate the prompt
   out and JSON back; translate every failure into an `AiProviderError` with the
   right `kind`. Nothing else.
2. Register it in `buildAiRuntime()` in `src/ai/registry.ts`.
3. Add its key name to `ALLOWED_SECRET_NAMES` in `src/config/keys-file.ts` and to
   the table in `secrets/API-KEYS.example.md`.
4. Add the provider value to the `AI_PROVIDER` enum in `src/config/env.ts`.
5. Add tests using the mock provider for its failure modes.
6. Update `ai-engine.md`, `technology.md` and `decision.md`.

If you find yourself editing `src/intelligence/` to make a provider work, stop.
Either the provider adapter is doing too little, or the pipeline has an
assumption about a specific model that needs removing.

## Adding a new item type

1. Add it to `ItemTypeEnum` in `src/schemas/analysis.schema.ts`.
2. Add type-specific fields to `ItemDetailsSchema`.
3. Add aliases to `ITEM_TYPE_ALIASES` in `src/intelligence/normalize.ts` — models
   will report it under several names.
4. Add it to the prompt's output shape and `details by type` section.
5. Decide whether any rule in `src/intelligence/classify.ts` applies to it.
6. Teach the offline provider to emit it, or the local path will silently never
   produce it.
7. Add a group to the test console's `GROUPS` array.
8. Add a scenario to `docs/testing.md` and a test for it.
9. Update `algorithm.md`, `data-model.md`, `api.md` and `glossary.md`.

Step 6 is the one people forget.

## Changing an extraction rule

1. Write the failing test first, as a realistic conversation.
2. Change the rule in `src/intelligence/`.
3. Run the whole suite — extraction rules interact, and a fix for one phrasing
   often breaks another.
4. Update `algorithm.md`, which is the document that describes these rules.

---

## Interruption protocol

If you hit a token limit, an unexpected failure, or run out of time:

1. Stop writing code.
2. Update `../docs/implementation.md`:
   - tick what is genuinely complete
   - mark the current item `IN PROGRESS`
   - write the **exact** next step, naming files and functions
   - record any known issue or dead end you hit
3. Update `context.md` if the project state changed.
4. Commit what works. A commit with a clear message beats an uncommitted
   working tree that the next agent cannot interpret.
5. Say clearly in your summary what is finished and what is not.

The next agent will start from `implementation.md`. Its accuracy is the whole
point.
