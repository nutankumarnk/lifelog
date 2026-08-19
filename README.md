# Lifelog

Lifelog turns ordinary human text into structured life information.

You write the way you would to a friend — "I met Arun yesterday in Ahmedabad and
I need to send him the project files by Friday" — and Lifelog understands it as a
past event, a memory, a person, a place, a task and a deadline, while keeping
what you actually wrote exactly as you wrote it.

**Lifelog is not an AI model.** The model is a replaceable reasoning component.
Lifelog owns the rules, the schema, the decisions and the memory architecture.
See [`docs/algorithm.md`](docs/algorithm.md).

---

## Status

| | |
| --- | --- |
| Version | 1.0.0 |
| Phase | **Phase 1 — Conversation Understanding** |
| State | Complete and working end to end |
| Not production | No authentication, no encryption at rest, single local user |

Phase 1 builds one thing: the engine that reads a conversation and returns
structured life data. Storage of memories over time, recall, and relationships
are later phases — see [`docs/roadmap.md`](docs/roadmap.md).

---

## Quick start

Requires **Node.js ≥ 20.11** and **PostgreSQL 16** (via Docker or installed locally).

```bash
git clone <repository-url> lifelog && cd lifelog
npm install

cp .env.example .env        # configuration (no secrets)
npm run keys:init           # creates secrets/API-KEYS.md for your API key
npm run hooks:install       # pre-commit secret scanner

npm run db:up               # starts PostgreSQL on port 5434
npm run db:migrate          # creates the schema

npm run dev                 # backend on :4319, test console on :5319
```

Open <http://localhost:5319>.

**Lifelog runs with no API key.** Without one it uses its own offline rule
engine, which is weaker at paraphrase and unusual phrasing but fully functional.
To use a hosted model, put your key in `secrets/API-KEYS.md` — see
[`secrets/API-KEYS.example.md`](secrets/API-KEYS.example.md).

### Running the pieces separately

```bash
npm run dev:backend         # Fastify API on http://localhost:4319
npm run dev:frontend        # Vite test console on http://localhost:5319
npm test                    # 153 tests
npm run keys:check          # scan the repository for exposed credentials
```

### Without Docker

Point `DATABASE_URL` at any PostgreSQL 16 instance and create two databases:

```bash
createdb lifelog && createdb lifelog_test
npm run db:migrate
```

---

## Try it

```bash
curl -X POST http://localhost:4319/api/v1/conversations/analyze \
  -H 'Content-Type: application/json' \
  -d '{"text":"Remind me to call the dentist next Monday."}'
```

Lifelog recognises this as a reminder (not a task — you asked to be prompted),
resolves "next Monday" to a date, and asks one follow-up question, because a
reminder with a date but no time of day cannot be scheduled precisely.

Full contract: [`docs/api.md`](docs/api.md).

---

## Environment variables

Copy `.env.example` to `.env`. **Secrets do not belong in `.env`** — they go in
`secrets/API-KEYS.md`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4319` | Backend HTTP port |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `TEST_DATABASE_URL` | — | Separate database for the test suite |
| `AI_PROVIDER` | `auto` | `auto`, `openrouter`, `local` or `mock` |
| `AI_MODEL` | `google/gemma-3-27b-it` | Model identifier passed to OpenRouter |
| `CORS_ORIGINS` | `http://localhost:5319` | Browser origins allowed to call the API |
| `MAX_INPUT_CHARS` | `20000` | Longest message accepted |
| `LOG_LEVEL` | `info` | Log verbosity |
| `OPENROUTER_API_KEY` | — | **Put this in `secrets/API-KEYS.md`, not here** |

Full list with descriptions: [`.env.example`](.env.example).

---

## Project structure

```
lifelog/
├── backend/              Fastify API — the conversation understanding engine
│   ├── src/
│   │   ├── ai/           Provider adapters. The replaceable part.
│   │   ├── intelligence/ Lifelog's own rules. The part that is not replaceable.
│   │   ├── schemas/      Zod contracts for the API and the analysis
│   │   ├── services/     Orchestration
│   │   ├── repositories/ All SQL lives here
│   │   ├── controllers/  HTTP shaping
│   │   ├── routes/       Path declarations
│   │   └── db/           Drizzle schema, client, migrations
│   └── tests/            153 tests: unit, behaviour, integration
├── frontend/             Temporary React test console
├── docs/                 The documentation system (read this)
├── agents/               Instructions for AI coding agents
├── secrets/              Gitignored key storage
└── scripts/              Secret scanner, key and hook setup
```

---

## Documentation

Documentation is part of the architecture here, not an afterthought. Start with
whichever question you have.

**Getting oriented**
- [`docs/glossary.md`](docs/glossary.md) — what the words mean
- [`docs/architecture.md`](docs/architecture.md) — how the layers fit together
- [`docs/functionality.md`](docs/functionality.md) — what actually works today

**Understanding the design**
- [`docs/algorithm.md`](docs/algorithm.md) — **Lifelog's intelligence rules.** The most important document.
- [`docs/memory.md`](docs/memory.md) — the memory philosophy
- [`docs/ai-engine.md`](docs/ai-engine.md) — how the model is used, and how to replace it
- [`docs/decision.md`](docs/decision.md) — why things are the way they are

**Building on it**
- [`docs/api.md`](docs/api.md) — the HTTP contract
- [`docs/data-model.md`](docs/data-model.md) — the database schema
- [`docs/backend.md`](docs/backend.md) — backend internals
- [`docs/coding-structure.md`](docs/coding-structure.md) — conventions
- [`docs/error-handling.md`](docs/error-handling.md) — error taxonomy
- [`docs/testing.md`](docs/testing.md) — testing philosophy and the scenario table

**Operating it**
- [`docs/security-checklist.md`](docs/security-checklist.md) — **the security checklist**
- [`docs/privacy-security.md`](docs/privacy-security.md) — data handling and future plans
- [`docs/technology.md`](docs/technology.md) — every dependency and why it is here

**Project state**
- [`docs/implementation.md`](docs/implementation.md) — the live checklist
- [`docs/roadmap.md`](docs/roadmap.md) — phases 1 through 9
- [`docs/changelog.md`](docs/changelog.md) — meaningful changes

**If you are an AI coding agent**, read [`agents/instructions.md`](agents/instructions.md)
and [`agents/workflow.md`](agents/workflow.md) before writing any code.

---

## Security

- Keys live only in `secrets/API-KEYS.md`, which is gitignored, allowlisted,
  permission-checked and never logged.
- A pre-commit hook scans staged files for credential shapes.
- Conversation text is never written to a log line — only its length, word count
  and a hash.
- Phase 1 has **no authentication**. Do not run it on a public network.

The full policy, including what is deliberately not yet solved, is in
[`docs/security-checklist.md`](docs/security-checklist.md).

---

## License

Not yet licensed. All rights reserved by the project owner.
