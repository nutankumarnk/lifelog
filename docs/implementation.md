# Implementation Checklist

**The live state of the work.** Keep this file current — it is the first thing
the next agent reads, and the only thing that tells them where to start.

**Last updated:** 2026-08-19 · **Current phase:** Phase 1 · **Status:** Complete

---

## Phase 1 — Conversation Engine

### Project setup

- [x] Initialise the Node workspace (backend + frontend)
- [x] Configure TypeScript, strict, ES modules
- [x] Configure Fastify with helmet, CORS and rate limiting
- [x] Configure PostgreSQL via Docker Compose (port 5434)
- [x] Configure Drizzle ORM and generate the initial migration
- [x] Configuration loading with Zod validation and layered precedence
- [x] Documentation structure: `README.md`, `agents/`, `docs/`

### Contracts

- [x] `AnalysisSchema` — the analysis contract, model-independent
- [x] `RawModelAnalysisSchema` — the forgiving shape accepted from a provider
- [x] API request/response schemas
- [x] Error envelope schema
- [x] Database schema: 8 tables, indexes, cascades

### AI provider layer

- [x] `AiProvider` interface and `AiProviderError` taxonomy
- [x] OpenRouter provider (Gemma by default)
- [x] Local rule-engine provider — works with no key and no network
- [x] Mock provider for deterministic tests
- [x] Registry: selection, retries with backoff, failover, degradation reporting
- [x] Tolerant JSON recovery (fences, trailing commas, truncation)

### Intelligence layer

- [x] Segmentation with preserved character offsets
- [x] Model-facing prompt construction
- [x] Normalisation: aliases, defaults, coercion, id reassignment, entity merging
- [x] Grounding: entity, item, temporal, reference hygiene
- [x] Deduplication (before and after classification)
- [x] Temporal resolution and tense reconciliation
- [x] Task/reminder distinction enforced in code
- [x] Type/tense reconciliation
- [x] Feeling enrichment
- [x] Pruning of empty and redundant facts
- [x] Missing-information detection and the follow-up restraint rule
- [x] Confidence calibration, capped at 0.95
- [x] Pipeline orchestration and final strict validation

### Persistence

- [x] Conversation repository — raw text written first, immutably
- [x] Analysis repository — analysis, segments, entities, items, links,
      follow-up, all in one transaction
- [x] Graceful handling when the analysis write fails (`persisted: false`)

### HTTP surface

- [x] `POST /api/v1/conversations/analyze`
- [x] `GET /health`
- [x] Single error boundary with the client/operator message split
- [x] Log redaction: no conversation content, no credentials

### Security

- [x] `secrets/API-KEYS.md` with loader, name allowlist and permission check
- [x] Secret scanner (`npm run keys:check`)
- [x] Pre-commit hook installer
- [x] `docs/security-checklist.md`

### Tests — 158 passing

- [x] Unit: intelligence modules
- [x] Unit: security utilities and the scanner itself
- [x] Behaviour: all 20 required scenarios
- [x] Integration: API contract and database contents
- [x] Cross-cutting guarantees (grounding, no certainty, injected time, one question)

### Test frontend

- [x] React + Vite console on port 5319
- [x] Input, loading, error and empty states
- [x] Entities, all item types, follow-up, missing information, warnings, raw JSON
- [x] API-only: no key, no model logic, no database access

### Documentation

- [x] `README.md`
- [x] `agents/`: instructions, workflow, context, skills
- [x] `docs/`: agent, backend, functionality, architecture, technology, memory,
      ai-engine, algorithm, data-model, privacy-security, decision, testing,
      coding-structure, roadmap, implementation, api, error-handling, glossary,
      changelog, security-checklist

---

## Definition of done — verified

| Condition | Status | Verified by |
| --- | --- | --- |
| Project initialises successfully | ✅ | `npm install && npm run dev` |
| Documentation structure exists | ✅ | `README.md`, `agents/` (4), `docs/` (20) |
| PostgreSQL works locally | ✅ | `npm run db:up && npm run db:migrate` |
| Fastify works | ✅ | Backend on :4319 |
| Health endpoint works | ✅ | `GET /health`, integration tests |
| AI provider abstraction works | ✅ | Three implementations behind one interface |
| OpenRouter provider works | ✅ | Adapter + error mapping; exercised via the mock in tests |
| Gemma can analyse a conversation | ✅ | Default model; the prompt is model-agnostic |
| Structured output is validated | ✅ | Strict `AnalysisSchema` at the end of the pipeline |
| Original conversation is stored | ✅ | Verbatim, before analysis; integration test asserts byte equality |
| Extracted information is stored | ✅ | Items, entities, segments, links, follow-ups |
| Unknown entities are preserved | ✅ | `kind: OTHER` + `raw_kind`; scenario 7 |
| Follow-up logic works | ✅ | Scenarios 9 and 10 |
| Task/reminder distinction works | ✅ | Scenarios 4 and 5, plus demotion/promotion unit tests |
| Automated tests pass | ✅ | 158 |
| Test frontend works | ✅ | Verified end to end in a browser |
| Frontend communicates through the API | ✅ | No key, no model, no database in `frontend/` |
| No secrets exposed | ✅ | `npm run keys:check` clean; keys file gitignored |
| Documentation describes the implementation | ✅ | This document set |
| `implementation.md` is up to date | ✅ | This file |

**Phase 1 is complete.**

---

## Next up — Phase 2 (not started)

Do not start this without reading [`roadmap.md`](roadmap.md) first.

- [ ] `GET /api/v1/conversations` — list
- [ ] `GET /api/v1/conversations/:id` — one conversation with its latest analysis
- [ ] `POST /api/v1/conversations/:id/follow-up` — answer a question, merge it in
- [ ] Re-analysis endpoint: new `analyses` row, old ones untouched
- [ ] `CORRECT` intent amends a previous record

No schema change is expected. `follow_ups.answered_at` and multiple analyses per
conversation already exist for this.

---

## Interruption protocol

If you run out of context, hit a token limit, or are stopped mid-task:

1. **Update this file before anything else.** It is the handover.
2. Mark completed items `[x]`.
3. Mark the current item `[~]` and label it `IN PROGRESS`.
4. Record **the exact next step** — the file and the change, not a theme.
5. Record any known issue or half-finished edit, including anything you left in a
   broken state.
6. Commit and push. An accurate half-finished state that is committed is far more
   useful than perfect work that only exists in a dead session.

When continuing someone else's work:

1. Read this file first.
2. Continue from the first incomplete item.
3. **Do not restart completed work** because you would have done it differently.
   If something is genuinely wrong, say so, and record a decision.
4. Run the tests before you change anything, so you know what you inherited.

### Handover notes

*(None. Phase 1 finished cleanly; nothing is left in a partial state.)*
