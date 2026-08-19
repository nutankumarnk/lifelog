# Architecture

How the layers fit together, and what each one is responsible for.

The shape of this system follows from one constraint: **the AI model must be
replaceable without redesigning anything.** Every boundary below exists to keep
model-specific behaviour contained in one directory.

---

## The path a request takes

```
  Test console (React)
        │  HTTP, JSON only. No key, no model, no database.
        ▼
  Route            routes/conversations.route.ts
        │  Declares the path. Nothing else.
        ▼
  Controller       controllers/conversation.controller.ts
        │  Validates the body, calls the service, shapes the response.
        ▼
  Conversation Service    services/conversation.service.ts
        │  Orders the operations. Owns no rules.
        │
        ├──► Conversation Repository ──► PostgreSQL   (1. store raw text FIRST)
        │
        ├──► Intelligence Layer      intelligence/pipeline.ts
        │         │
        │         │  segment
        │         │  build instructions
        │         ▼
        │    AI Provider             ai/registry.ts → ai/*.provider.ts
        │         │     retry, failover, degrade
        │         ▼
        │    ┌─────────────────┐
        │    │ external model  │  ← the only replaceable-by-design part
        │    └─────────────────┘
        │         │  loose JSON
        │         ▼
        │    Normalisation   →  Grounding  →  Deduplication
        │         │
        │         ▼
        │    Classification (Lifelog's product rules)
        │         │
        │         ▼
        │    Follow-up decision  →  Confidence calibration
        │         │
        │         ▼
        │    Schema validation   (strict Zod — nothing invalid escapes)
        │
        └──► Analysis Repository ──► PostgreSQL       (3. store interpretation)
```

Two things about this diagram are worth stating explicitly:

**The model sits in the middle, not at the top.** It is asked one question, and
everything it returns is checked. It does not decide what an item is, what a
reminder means, what date "next Friday" is, or whether to ask the user anything.

**Storage happens twice, deliberately.** The conversation is written before
analysis begins, so what the user said survives even if everything downstream
fails. The analysis is written after, and if *that* write fails the request still
succeeds with `persisted: false`. Losing a person's words is unacceptable; losing
a derived interpretation is annoying and recoverable.

---

## Layer responsibilities

### Frontend — `frontend/`

A temporary React console for exercising the Phase 1 API by hand.

**Owns:** rendering, input handling, loading and error states.
**Must never own:** an API key, model logic, database access, or any rule about
what a task or a reminder is. It mirrors the response types rather than importing
backend code, so it cannot accidentally depend on internals.

### Routes — `backend/src/routes/`

**Owns:** paths, HTTP methods, which controller handles what.
**Must never own:** validation logic, business rules, database calls. A route
file that contains an `if` about the domain is a bug.

### Controllers — `backend/src/controllers/`

**Owns:** parsing and validating the request body against the Zod schema, calling
the service, mapping the result onto the response shape, safe request logging.
**Must never own:** decisions about what the analysis means. The controller
cannot tell a memory from a task and should not need to.

### Service — `backend/src/services/`

**Owns:** orchestration. The *order* of operations, and how partial failures
combine into a result.
**Must never own:** what an item is (intelligence), how to talk to a model
(provider), how to write a row (repository).

This layer is short on purpose. When a service starts growing conditionals about
domain concepts, those conditionals belong in the intelligence layer.

### Intelligence layer — `backend/src/intelligence/`

**This is the product.** Everything Lifelog knows about reading a life is here,
in code, testable without a network call.

| Module | Responsibility |
| --- | --- |
| `segment.ts` | Split text into sentences and clauses, preserving offsets |
| `prompt.ts` | Build the model-facing instructions |
| `normalize.ts` | Repair loose model output into the strict shape |
| `grounding.ts` | Reject anything the user did not actually write; deduplicate |
| `temporal.ts` | Resolve time phrases; infer and reconcile tense |
| `classify.ts` | Enforce Lifelog's typing rules over the model's labels |
| `follow-up.ts` | Decide what is missing and whether to ask |
| `confidence.ts` | Replace model confidence with evidence-based confidence |
| `lexicon.ts` | The linguistic signal lists the rules read from |
| `pipeline.ts` | Order all of the above; validate the result |

The stage order in `pipeline.ts` is a contract, not an implementation detail.
Grounding must run before classification, because classifying a fabricated item
wastes work and risks keeping it. Calibration must run last, because it scores
evidence that earlier stages produce.

Full rules: [`algorithm.md`](algorithm.md).

### AI provider layer — `backend/src/ai/`

**Owns:** speaking one model's dialect. HTTP shape, auth header, error mapping,
tolerant JSON extraction.
**Must never own:** a product rule. If a provider file contains the word
"reminder", something has gone wrong.

| File | Role |
| --- | --- |
| `provider.ts` | The `AiProvider` interface and `AiProviderError` taxonomy |
| `openrouter.provider.ts` | Hosted models via OpenRouter's OpenAI-compatible API |
| `local.provider.ts` | Offline rule engine, so Lifelog works with no key and no network |
| `mock.provider.ts` | Scriptable provider for deterministic tests |
| `registry.ts` | Selection, retries with backoff, failover, degradation reporting |
| `json.ts` | Recovering JSON from fenced, truncated or prose-wrapped output |

The registry is where resilience lives, not the adapters. That keeps every
adapter thin and gives every provider identical retry behaviour.

Full detail: [`ai-engine.md`](ai-engine.md).

### Validation — `backend/src/schemas/`

Two levels of strictness, and the difference between them is the whole point:

- **`RawModelAnalysisSchema`** — forgiving. Applied to model output. Fields may
  be missing, misnamed or the wrong type.
- **`AnalysisSchema`** — strict. Applied at the end of the pipeline. If it fails,
  that is a Lifelog bug, not a model failure, and it throws loudly.

Nothing reaches the API or the database without passing the strict schema.

### Repositories — `backend/src/repositories/`

**Owns:** every SQL statement in the project, and transaction boundaries.
**Must never own:** business rules. A repository does not decide *whether* to
save something.

`analysis.repository.ts` writes the analysis, its segments, entities, items,
item-entity links and follow-up inside one transaction — a half-stored
interpretation is worse than none.

### Database — PostgreSQL

Eight tables, one migration. `conversations` is append-only and authoritative;
everything else is derived and versioned by analysis. Full schema:
[`data-model.md`](data-model.md).

---

## Cross-cutting concerns

**Configuration** (`config/`) is read once at startup and validated with Zod. If
the process is running, the config is known-good. No module re-reads
`process.env` or invents a default.

**Errors** (`errors/`) pass through one boundary. Clients get a code, a safe
message and a request id; operators get the full detail in a redacted log line.
[`error-handling.md`](error-handling.md).

**Redaction** (`utils/redact.ts`) is applied to anything that could reach a log.
Conversation text never appears in a log line — only length, word count and a
hash. [`privacy-security.md`](privacy-security.md).

---

## Dependency direction

Dependencies point inward and downward. Nothing in an inner layer imports from
an outer one.

```
routes → controllers → services → { intelligence, repositories }
                                        │              │
                                    ai/*           db/*
                                        │
                                 external model
```

- `intelligence/` imports from `ai/` (the interface and the registry) and
  `schemas/`. It never imports a repository or a Fastify type.
- `ai/` imports from `config/` and `schemas/`. It never imports `intelligence/`.
- `repositories/` import from `db/` and `schemas/`. They never import a service.
- The leaf modules — `lexicon.ts`, `temporal.ts`, `segment.ts` — import nothing
  from the project at all. That is what makes them trivially testable.

There are no circular dependencies. Adding one is not a style problem; it is the
signal that a responsibility has been put in the wrong place.

---

## Why it is built this way

Three decisions shape everything else. Each has a full entry in
[`decision.md`](decision.md).

**The intelligence layer is separate from the AI provider.** Models change every
few months. The rules for what a reminder is do not. Putting the rules in code
means they can be tested, versioned and reasoned about; putting them in a prompt
means they change silently whenever the model does.

**The raw conversation is stored before anything else happens.** Extraction is
fallible. The user's own words are not. Ordering the writes this way means the
worst case is a conversation with no analysis, which can be fixed later, rather
than an analysis with no conversation, which cannot be verified at all.

**Failure degrades rather than propagates.** A timeout falls back to the offline
engine. A failed analysis write still returns the analysis. A model that returns
broken JSON gets repaired, and if it cannot be repaired the fallback answers.
The user gets a worse answer, with a warning saying so, instead of an error.
