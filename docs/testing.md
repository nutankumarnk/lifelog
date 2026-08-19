# Testing

153 tests. What they cover, why they are written the way they are, and what to
add when you change something.

```bash
npm test                       # everything
npm test -- extraction         # one file
npm run test:watch --workspace backend
```

---

## Philosophy

**Test Lifelog's guarantees, not a model's wording.**

This is the rule that makes the suite useful. A test asserting that a particular
sentence came back from a particular model is a test that breaks when the model
is upgraded, teaches nothing when it fails, and gets deleted. A test asserting
that *an explicit request to be reminded produces a `REMINDER`* is a statement
about the product, and it should break only when the product changes.

Four consequences:

**No test calls a real model.** Behaviour tests run against the local rule
engine, which is deterministic. Failure paths use the scriptable mock. The whole
suite runs offline.

**Assert properties, not payloads.** "Exactly one follow-up question", "every
item's `source_text` appears in the input", "confidence is never 1.0". These hold
for any provider.

**Failure paths are first-class.** Roughly a third of the suite is about what
happens when things break: timeouts, malformed JSON, database failures, invented
content. A system that stores someone's life has to be predictable when it is
having a bad day.

**Time is injected, never observed.** Every test that involves a date pins the
reference time. A test that passes on Tuesday and fails on Wednesday is worse
than no test.

---

## Layout

| Directory | What it covers | Needs a database |
| --- | --- | --- |
| `tests/unit/` | Individual intelligence modules and security utilities | No |
| `tests/behaviour/` | The 20 required scenarios, end to end through the pipeline | No |
| `tests/integration/` | HTTP contract and what actually landed in the tables | **Yes** |

### Unit tests — `tests/unit/`

`intelligence.test.ts` covers temporal resolution, segmentation, normalisation,
grounding, follow-up restraint, confidence calibration, JSON recovery and the
prompt's invariants. These are pure functions, so the tests are direct: give it
input, check the decision.

`security.test.ts` covers the keys-file parser and loader, log redaction, the
public-message safety rule, and the secret scanner itself.

### Behaviour tests — `tests/behaviour/`

The 20 scenarios, run through the full pipeline with the local provider. They are
the closest thing to a specification of what Lifelog does.

### Integration tests — `tests/integration/`

Through `app.inject()` — no port binding, no network. They assert the response
shape *and* the database contents, because "returned it correctly" and "stored it
correctly" are different claims.

Tables are truncated between tests, so these run serially.

---

## The 20 required scenarios

Each is a `describe` block, named by number, in `tests/behaviour/` or
`tests/integration/`.

| # | Scenario | Expected interpretation | Key assertion |
| --- | --- | --- | --- |
| 1 | Simple memory | A lived experience becomes both a dated event and a memory | Both types present for one sentence |
| 2 | Past event | "yesterday" resolves against the conversation time | Correct ISO date; raw phrase preserved; a vague count stays unresolved |
| 3 | Future event | A forward date classifies the item as future | `FUTURE_EVENT` with a resolved date |
| 4 | Explicit task | An obligation is a task, not a reminder | `TASK`, `status: OPEN`, no reminder emitted |
| 5 | Explicit reminder | A request to be prompted is a reminder | `REMINDER`, `explicit: true`, **not duplicated as a task** |
| 6 | Mixed conversation | One message yields several items of different types | Event + memory + task from one input |
| 7 | Unknown entity | An uncategorisable entity survives | `kind: OTHER` with `raw_kind` preserved |
| 8 | Feeling | An expressed emotion carries sentiment and intensity | `FEELING` with details; **no feeling invented from neutral text** |
| 9 | Missing information | A reminder with no time produces one question | Exactly one follow-up, `blocking: true` |
| 10 | Diary-only experience | Reflection is recorded, not interrogated | Items extracted, `follow_up` is null |
| 11 | No hallucination | Unsupported content is removed | Invented entities, items and time phrases dropped with warnings; empty input yields no items |
| 12 | Multiple temporal references | Each date resolves independently | Distinct correct dates; ambiguous phrases refused |
| 13 | AI failure | Failure degrades instead of propagating | Falls back, retries retryable errors only, records every attempt |
| 14 | Invalid AI JSON | Broken output is recovered | Fences, trailing commas, truncation, wrong types; falls back when unrecoverable |
| 15 | Database failure | Asymmetric handling | Conversation write fails → request fails. Analysis write fails → 200 with `persisted: false` |
| 16 | Empty input | Rejected cleanly | 400, and **nothing stored** |
| 17 | Very long input | Handled or refused at a stated boundary | Long-but-permitted works; over the ceiling → 413; no items fabricated from repetition |
| 18 | Multiple entities | Every distinct person and place is extracted | All present, correctly kinded |
| 19 | Duplicate entity | Repeated mentions merge | One entity with aliases; duplicate items on the same span merged |
| 20 | Multilingual input | Code-switched text is understood, not translated | Labelled `mixed`; original script preserved byte-for-byte |

### Cross-cutting guarantees

Asserted for every scenario, because they are properties of the system rather
than of any one case:

- **Everything is grounded.** Every surviving item's `source_text` appears in the
  conversation.
- **Nothing is certain.** No confidence reaches 1.0.
- **Time is what the caller said it is.** Dates resolve against the supplied
  reference time, never the wall clock.
- **At most one question.** Ever.

---

## Test data

Realistic messages, not lorem. Everything is either what someone would actually
type — "I met Arun yesterday in Ahmedabad and I need to send him the project
files by Friday" — or a deliberately hostile input for a failure path.

Fixed reference times, so "yesterday" means one specific date forever.

**No real credentials, ever**, including in fixtures. The secret scanner runs on
every commit and does not know a fixture from a leak — which is the correct
behaviour. Use obviously synthetic values.

## The mock provider

For anything a real model would make non-deterministic:

```ts
new MockProvider({ analysis: { intent: 'LOG', items: [...] } });  // fixed payload
new MockProvider({ raw: '```json\n{...}\n```' });                 // raw text to parse
new MockProvider({ error: { kind: 'TIMEOUT' } });                 // a specific failure
new MockProvider({ delayMs: 200 });                               // slow response
```

It is how "the model invented a person who was never mentioned" becomes a
repeatable test rather than a story.

## The test harness — `tests/helpers/test-app.ts`

Builds the real application with injected dependencies: a mock provider, a pinned
clock, an optional database. Provides `analyze()`, table helpers, and
`itemsOfType()` for readable assertions.

Because `server.ts` is a composition root, the test harness builds the *same*
application the production entry point does — only the injected dependencies
differ. Nothing is stubbed that ships.

---

## Adding tests

**A new intelligence rule** — unit tests for the decision, and a behaviour test
if it changes what a user sees.

**A new item type** — extend the enum, the normaliser aliases, the classifier,
and add a behaviour scenario. Add a row to the table above.

**A new failure mode** — script it with the mock provider. Assert both the client
response and that nothing leaked into it.

**A bug fix** — write the failing test first. A bug without a regression test
comes back.

**Any change to the 20 scenarios** — if you deliberately change behaviour, update
the table above in the same commit and say so in your summary. Those rows are the
Phase 1 contract; changing one silently is how a product loses its shape.

---

## Running with a database

Integration tests need Postgres:

```bash
npm run db:up
npm run db:migrate
npm test
```

`TEST_DATABASE_URL` points at `lifelog_test`, created by the Docker init script.
Without a database, integration tests fail; unit and behaviour tests still pass,
which is deliberate — the parts of Lifelog that define the product do not need
infrastructure to be verified.

## Before committing

```bash
npm test              # all 153
npm run typecheck --workspace backend
npm run keys:check    # the pre-commit hook runs this too
```

Never bypass the hook with `--no-verify`, and never weaken a scanner rule to make
a commit pass. Fix the finding.
