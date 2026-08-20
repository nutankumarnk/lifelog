# Current Project Context

Short and current by design. If something here is stale, fix it in the same
change that made it stale.

**Last updated:** 2026-08-19 · **Version:** 1.0.0

---

## Where the project is

| | |
| --- | --- |
| Phase | **Phase 1 — Conversation Understanding** |
| State | Complete. Every item in the Phase 1 definition of done is met. |
| Active work | None. The next work is Phase 2 (see [`../docs/roadmap.md`](../docs/roadmap.md)). |

Phase 1 delivers one capability: read a message, return structured life data,
store both. Nothing recalls, searches or links memories yet — that is Phase 4
and Phase 5.

## Completed modules

- **Configuration** — `backend/src/config/`. Zod-validated, loaded once, with the
  `secrets/API-KEYS.md` loader layered underneath the environment.
- **AI provider abstraction** — `backend/src/ai/`. Interface, OpenRouter adapter,
  offline rule engine, scriptable mock, and the retry/failover registry.
- **Intelligence layer** — `backend/src/intelligence/`. Segmentation, prompt,
  normalisation, grounding, temporal resolution, classification, follow-up,
  confidence, and the pipeline that orders them.
- **Persistence** — `backend/src/db/` and `backend/src/repositories/`. Eight
  tables, one migration, all SQL confined to the two repositories.
- **HTTP surface** — `POST /api/v1/conversations/analyze` and `GET /health`, with
  a single error envelope.
- **Secrets subsystem** — gitignored keys file, loader, scanner, pre-commit hook.
- **Test console** — `frontend/`. React + Vite, API-only, no keys, no logic.
- **Documentation** — `README.md`, `agents/`, `docs/`.

## Runtime facts

| | |
| --- | --- |
| Node | ≥ 20.11 |
| Backend | Fastify 5 on port **4319** |
| Frontend | Vite on port **5319**, proxying `/api` and `/health` |
| Database | PostgreSQL 16, Docker service on port **5434**, databases `lifelog` and `lifelog_test` |
| ORM | Drizzle 0.45, migrations in `backend/drizzle/` |
| Default AI provider | `auto` — OpenRouter when a key exists, otherwise the local rule engine |
| Default model | `google/gemma-3-27b-it` |
| Tests | 158, `npm test`, Vitest |
| Auth | **None.** Single implicit local user. |

## Known limitations

These are accepted for Phase 1, not bugs to be fixed opportunistically. Read
[`../docs/functionality.md`](../docs/functionality.md) before assuming something
is broken.

- **No authentication, no authorization, no encryption at rest.** Do not run this
  on a public network. See [`../docs/security-checklist.md`](../docs/security-checklist.md).
- **`conversations.user_id` is always null.** The column exists so Phase 8 can
  add users without a destructive migration.
- **No cross-conversation entity resolution.** "Arun" in two conversations is two
  entity rows. Identity resolution is Phase 5.
- **The local rule engine is weaker than a hosted model.** It handles direct,
  well-formed sentences. Paraphrase, irony and unusual phrasing degrade it. It
  exists so Lifelog always works, not to compete with a model.
- **Temporal resolution is English and Hinglish only,** and covers relative
  phrases, weekdays, and a small set of absolute forms. Anything else is kept as
  a raw phrase with `resolved: null` — deliberately, rather than guessed.
- **Timezone is recorded but not applied.** Resolution is done in UTC; the IANA
  zone is stored for a later phase to reinterpret.
- **`ASK` intent is detected but never answered.** Recall is Phase 4.
- **One follow-up question maximum, ever.** This is a product rule, not a
  limitation. See [`../docs/algorithm.md`](../docs/algorithm.md).

## Known bugs

None open.

If you find one, add it here with a reproduction, and add a failing test before
you fix it.

## Current priorities

In order, for whoever picks this up next:

1. **Do not regress Phase 1.** The 20 scenarios in
   [`../docs/testing.md`](../docs/testing.md) are the contract.
2. **Keep the model replaceable.** Any change that makes a file outside
   `backend/src/ai/` care which model is running is a defect.
3. **Phase 2 — Memory Storage.** Cross-conversation identity for entities, and a
   read API for stored memories. Nothing in Phase 1 needs to be torn down for it;
   the schema was designed with it in mind.
