# Backend

The Node.js service that is Lifelog. Internals, layer by layer.

For how the layers relate, read [`architecture.md`](architecture.md) first. For
where a given piece of code belongs, read
[`coding-structure.md`](coding-structure.md).

---

## Purpose

One job: accept a message, understand it, store both the message and the
understanding, return the understanding.

Everything else in the backend exists to make that job reliable — configuration
that fails fast, providers that fail over, errors that do not leak, logs that do
not contain someone's private life.

## Runtime

| | |
| --- | --- |
| Node | ≥ 20.11, ES modules |
| Framework | Fastify 5 |
| Language | TypeScript, strict |
| Dev runner | `tsx watch` |
| Build | `tsc` → `dist/` |
| Port | 4319 |

Native `fetch`, `AbortSignal.timeout` and `node:crypto` are used directly. No
HTTP client library, no polyfills.

---

## Startup

`src/index.ts` is the entry point and does four things in order:

1. **Load configuration.** `loadConfig()` reads the environment, layers `.env`
   underneath it, layers `secrets/API-KEYS.md` under that, and validates the
   result with Zod. **If the process starts, the configuration is known-good** —
   no module re-reads `process.env` or invents a default.
2. **Log a startup summary.** Which provider, whether credentials were found,
   whether a database is configured. Key *names* only, never values.
3. **Build and listen.** `buildServer()` assembles the app; the server binds to
   `HOST:PORT`.
4. **Install shutdown handlers.** `SIGTERM` and `SIGINT` close the HTTP server
   and drain the connection pool. Unhandled rejections are logged and exit
   non-zero rather than leaving the process in an unknown state.

`src/server.ts` is the **composition root** — the one place that knows how every
module fits together. Dependencies are constructed there and injected downward,
which is what lets a test build the same application with a mock provider, a
pinned clock and no database.

Plugin order matters and is fixed: helmet, then CORS, then rate limit, then the
error handler, then routes.

---

## Configuration

| Source | Precedence | Contains |
| --- | --- | --- |
| Process environment | Highest | Anything, injected by the container or CI |
| `.env` at the repo root | Middle | Non-secret configuration |
| `secrets/API-KEYS.md` | Lowest | **Secrets only** |

The keys file never overrides something already present in the environment, so a
deployment can inject a key without editing files, and a developer's local file
cannot silently shadow it.

Notable settings — full list in `.env.example`:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | 4319 | |
| `DATABASE_URL` | — | Required for the analyze endpoint to be enabled |
| `TEST_DATABASE_URL` | — | Used when `NODE_ENV=test` |
| `AI_PROVIDER` | `auto` | `auto` / `openrouter` / `local` / `mock` |
| `AI_MODEL` | `google/gemma-4-26b-a4b-it:free` | |
| `AI_TIMEOUT_MS` | 5000 | Hard cap; then local fallback |
| `AI_MAX_RETRIES` | 0 | Timeouts are not retried |
| `MAX_INPUT_CHARS` | 20000 | |
| `RATE_LIMIT_MAX` | 60 | Per window, per IP |
| `CORS_ORIGINS` | local console | Explicit allowlist |

---

## Request flow

```
POST /api/v1/conversations/analyze
  → route          declares the path
  → controller     validates the body, calls the service, shapes the response
  → service        orders: store text → understand → store analysis
  → repositories   the only SQL in the project
  → response       200 with analysis + meta, or the error envelope
```

### Routes — `src/routes/`

Declare paths and hand off. A route file containing a domain `if` is a bug.

Two routes exist: `POST /api/v1/conversations/analyze` and `GET /health`.

When no `DATABASE_URL` is configured, the analyze route is replaced by a stub
returning 503. Without a database Lifelog cannot honour its guarantee that the
conversation is preserved, so it refuses rather than pretending.

### Controllers — `src/controllers/`

Validate with the Zod request schema, call the service, map the result onto the
response shape. Two validation cases get their own error codes — empty input and
oversized input — because a client can give the user a much better message than
"validation failed".

The controller cannot tell a memory from a task and does not need to.

### Services — `src/services/`

Orchestration only: the *order* of operations and how partial failures combine.

`ConversationService.analyze()` is the whole of Phase 1's control flow, and the
ordering is the interesting part:

1. **Store the conversation.** A failure here fails the request.
2. **Understand it** via the intelligence pipeline.
3. **Store the analysis.** A failure here does *not* fail the request — the
   response returns with `persisted: false` and a warning.

Dependencies arrive through the constructor, including an injectable clock, so
tests never depend on the wall clock.

### Repositories — `src/repositories/`

Every SQL statement in the project lives here, and nothing else does.

`ConversationRepository` writes the raw text and later backfills the detected
language. `AnalysisRepository.persist()` writes the analysis, segments, entities,
items, item-entity links and follow-up **in one transaction** — a half-stored
interpretation looks complete and is worse than none.

Services receive plain objects. A Drizzle type never crosses this boundary; that
is what keeps the database swappable and the service testable with a stub.

---

## Database

PostgreSQL 16 via `postgres.js` and Drizzle ORM.

The connection pool is created **lazily**, on first use, so importing a module
does not open a socket — that is what lets unit tests run with no database at
all. `pingDatabase()` backs the health check.

Schema and migrations: [`data-model.md`](data-model.md).

---

## AI integration

The backend never talks to a model directly. It builds an `AiRuntimeOptions`
(primary provider, fallback, retry budget) at startup and hands it to the
pipeline. Selection, retries, failover and degradation reporting all live in
`ai/registry.ts`.

Nothing outside `src/ai/` imports an SDK or names a model. Full detail:
[`ai-engine.md`](ai-engine.md).

---

## Error handling

One boundary, in `src/errors/handler.ts`. Every error that escapes a route passes
through it and leaves as the same envelope.

`AppError` carries `message` (for the log) and `publicMessage` (for the wire) as
separate fields, so an internal detail cannot leak into a response by accident.
Postgres SQLSTATE prefixes and socket error codes are recognised so a connection
failure is reported as `DATABASE_ERROR` rather than a generic 500.

Full taxonomy: [`error-handling.md`](error-handling.md).

---

## Logging

Fastify's Pino logger, configured so that user content cannot reach a log line:

- `req.body.text`, `authorization` and `cookie` are redacted at the logger level.
- The request serializer emits only method, URL and request id — never headers or
  body.
- Conversation text is logged as `summarizeText()`: character count, word count
  and a 12-character hash. Enough to correlate two log lines, not enough to
  reconstruct anything.
- Internal error messages pass through `redactSecrets()` before being logged,
  because an upstream message can contain a key.

See [`privacy-security.md`](privacy-security.md).

---

## Security middleware

| Plugin | Configuration |
| --- | --- |
| `@fastify/helmet` | Default headers; CSP disabled — the API serves JSON only |
| `@fastify/cors` | Explicit origin allowlist, `GET`/`POST`/`OPTIONS`, no credentials |
| `@fastify/rate-limit` | 60/minute per IP, in-memory |
| `bodyLimit` | Oversized bodies rejected at the transport layer, before parsing |

There is **no authentication in Phase 1.** Do not expose this on a public
network. See [`security-checklist.md`](security-checklist.md).

---

## Local development

```bash
npm run db:up          # PostgreSQL on 5434
npm run db:migrate     # apply migrations
npm run dev:backend    # tsx watch, port 4319
npm test               # 158 tests
npm run typecheck      # tsc --noEmit
```

Lifelog runs with no API key — the offline rule engine answers, and `/health`
reports `ai_provider: degraded`. That is the intended experience for a first
clone: everything works before any credential exists.

To use a hosted model, put the key in `secrets/API-KEYS.md` (`npm run keys:init`
creates it from the template with the right permissions).

### Adding a feature

Work outward from the middle:

1. Change the schema in `src/schemas/` if the contract moves.
2. Add or change a rule in `src/intelligence/`, with unit tests.
3. Extend the service only if the *order* of operations changes.
4. Add a repository method if new SQL is needed.
5. Touch the controller and route last, and only for shaping.
6. Update the documents your change made inaccurate.

If a change to how Lifelog understands something requires editing a route, the
logic is in the wrong layer.
