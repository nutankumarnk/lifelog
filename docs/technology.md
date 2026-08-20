# Technology

Every technology in Lifelog, why it is here, and what would replace it.

**Do not add a technology without a reason recorded here.** A dependency whose
purpose nobody can explain will be removed by the next person who reads the file.

The backend has **eight runtime dependencies**. That is a deliberate number.

---

## Runtime

### Node.js — ≥ 20.11

**Purpose:** Backend runtime.

**Why:** The workload is I/O-bound — one model call, a few database writes — which
is exactly what an event loop is good at. It shares a language with the frontend
and with a future React Native client, so the analysis types are written once.
Node 20 provides native `fetch`, `AbortSignal.timeout` and stable ES modules,
which removed three dependencies that would otherwise be here.

**Status:** Stable, no plans to change.

**Replacement:** Would only make sense if Lifelog became CPU-bound — heavy local
inference, for instance. Go or Rust would be the candidates, and the intelligence
layer would have to be ported, which is a real cost. Not on the horizon.

### TypeScript — 5.7

**Purpose:** The language.

**Why:** The analysis shape is elaborate and passes through twelve pipeline
stages. Types catch a whole class of "the model returned something unexpected"
bugs at compile time. `z.infer` means the schema and the type cannot drift.

**Status:** Stable. Strict mode, no `any` in `src/`.

**Replacement:** None contemplated.

---

## Backend framework

### Fastify — 5.x

**Purpose:** HTTP server.

**Why:** Fast, small, first-class TypeScript types, and a plugin ecosystem that
covers exactly what is needed (helmet, CORS, rate limit) without pulling in a
framework's worth of opinions. `app.inject()` lets integration tests run without
binding a port, which makes the whole suite quick.

**Status:** Stable.

**Alternatives considered:** Express — larger ecosystem, weaker types, slower,
and its middleware model encourages putting logic in the wrong layer. Hono —
attractive and lighter, but the Node ecosystem around it was thinner at the time.

**Replacement:** Contained. Routes, controllers and the error handler are the
only Fastify-aware files; services, intelligence and repositories know nothing
about HTTP.

### @fastify/helmet, @fastify/cors, @fastify/rate-limit

**Purpose:** Security headers, origin allowlist, request throttling.

**Why:** Official plugins, tiny, and each replaces code that is easy to get
subtly wrong.

**Status:** Stable. Rate limiting is in-memory, which is correct for a
single-process Phase 1 and will need a shared store when there is more than one
instance.

---

## Data

### PostgreSQL — 16

**Purpose:** Primary relational database.

**Why:** Life information is inherently relational — people attend events,
events happen in places, items reference entities. Postgres also covers the next
several phases without adding another datastore: `jsonb` for open payloads,
full-text search for Phase 4 recall, and `pgvector` for embeddings later. It is
mature, it is not going anywhere, and its constraints catch data bugs that
application code would not.

**Status:** Stable. The commitment of the project.

**Alternatives considered:** SQLite — simpler, and genuinely tempting for a
single-user Phase 1, but it would have to be replaced the moment sync or
concurrent access appears, and migrating a life record is not a task worth
scheduling. MongoDB — the data is relational; storing it as documents would mean
rebuilding joins in application code. See [`decision.md`](decision.md).

### Drizzle ORM — 0.45

**Purpose:** Schema definition, typed queries, migrations.

**Why:** The schema is defined in TypeScript and the query types are derived from
it, so a renamed column is a compile error rather than a runtime surprise. It
generates plain SQL migrations that can be read and reviewed. It is a thin layer:
queries look like SQL, so nobody has to learn a query DSL to read a repository.

**Status:** Stable.

**Alternatives considered:** Prisma — heavier, generates a client, owns the
migration story more completely, and its engine is an extra moving part. Raw SQL
— viable, but loses compile-time safety on a schema this size.

**Replacement:** Contained in `db/` and `repositories/`. A Drizzle type never
crosses into a service.

### postgres.js — 3.4

**Purpose:** The Postgres driver Drizzle sits on.

**Why:** Fast, small, good connection pooling, and Drizzle's recommended driver.

---

## Validation

### Zod — 3.24

**Purpose:** Every contract in the system: the API request and response, the
analysis schema, configuration.

**Why:** Lifelog's central problem is that model output cannot be trusted. Zod
gives runtime validation *and* the TypeScript type from one definition, so the
contract and the type cannot diverge. The two-tier design — a forgiving schema
for model output, a strict one for everything after normalisation — is the
backbone of the pipeline's safety.

**Status:** Stable. Deeply embedded, and appropriately so.

**Alternatives considered:** Valibot (smaller, less mature at the time), io-ts
(harder to read), hand-written guards (unmaintainable at this size).

---

## AI

### OpenRouter

**Purpose:** Hosted model access.

**Why:** One OpenAI-compatible endpoint in front of dozens of models. Changing
model is a config value rather than a new adapter, which directly serves the
requirement that the model be replaceable. No SDK — a plain `fetch` call keeps
the dependency count at zero and the adapter honest.

**Status:** Stable, and deliberately easy to leave.

**Replacement:** Implement `AiProvider` and register it. Any OpenAI-compatible
endpoint — including a self-hosted one — works by changing
`OPENROUTER_BASE_URL`.

### Gemma 3 27B (`google/gemma-3-27b-it`)

**Purpose:** The default reasoning model.

**Why:** Follows a JSON schema reliably, handles code-switched Indian-English
input, and is cheap enough to run on every message someone writes about their
day. Open weights, so it can be self-hosted if hosting economics change. It is
not the strongest model available and does not need to be — Lifelog verifies
everything it says.

**Status:** Current default. Expected to change; that is the design.

**Replacement:** Set `AI_MODEL`. Nothing else. Then run the behaviour suite,
which tests Lifelog's guarantees rather than any model's wording.

### The local rule engine

**Purpose:** Fallback provider, and the default when no key is configured.

**Why:** Lifelog must work with no credentials and no network — a fresh clone
runs end to end in one command, and a provider outage degrades quality instead of
losing a user's message. It also makes the entire test suite deterministic and
offline.

**Status:** Stable. Deliberately simpler than a hosted model. It is a floor, not
a competitor.

---

## Infrastructure

### Docker & Docker Compose

**Purpose:** Local PostgreSQL.

**Why:** One command to a working database, identical on every machine. Port 5434
rather than 5432 so it cannot collide with a locally installed Postgres.

**Status:** Development only. Nothing is containerised for production yet;
that is Phase 9.

### dotenv — 16.4

**Purpose:** Load `.env` in development.

**Why:** Node's native `--env-file` exists but does not layer the way Lifelog's
precedence rules need (environment > `.env` > keys file). Small and stable.

**Status:** Could be dropped once the native loader covers the layering.

---

## Frontend

### React — 18.3

**Purpose:** The test console.

**Why:** Shared language with the backend, and the eventual mobile client will
likely be React Native, so the component idioms carry over. The console itself is
throwaway.

**Status:** Temporary. This UI will be replaced entirely.

### Vite — 7.x

**Purpose:** Frontend dev server and build.

**Why:** Instant start, and its proxy makes the browser see the API as
same-origin, which removes CORS from the development loop. Port 5319.

**Status:** Stable for the console's life.

**No component library.** shadcn/ui or similar would be right for the real
product UI. For a temporary debugging console it would be more dependency than
value, so the console is hand-written CSS in one file.

---

## Testing

### Vitest — 4.x

**Purpose:** The test runner.

**Why:** Native ES modules and TypeScript with no transform configuration,
fast, and its API is familiar to anyone who has used Jest. Shares Vite's
config model, so there is one build story in the repository.

**Status:** Stable. 158 tests.

**Note:** Database-backed tests are serialised because they truncate shared
tables. Unit and behaviour tests run in parallel.

### tsx — 4.19

**Purpose:** Running TypeScript directly in development and for the migrate
script.

**Why:** No build step in the development loop.

---

## Tooling written in-house rather than installed

Worth listing, because each is a dependency that is *not* here:

| Instead of | Lifelog has | Why |
| --- | --- | --- |
| A secret-scanning package | `scripts/check-secrets.mjs` | ~200 lines, no dependencies, rules tuned to exactly the credential shapes this project handles |
| Husky | `scripts/install-hooks.mjs` | Writing one git hook does not justify a package and a lifecycle script |
| A date library | `intelligence/temporal.ts` | Lifelog resolves *natural language* phrases, which no date library does. `date-fns` would have handled the arithmetic — the smallest part of the job. |
| An HTTP client | Native `fetch` | Node 20 has it |
| A logger | Fastify's built-in Pino | Already there, already configured for redaction |
| A DI container | Constructor injection in `server.ts` | The composition root is 100 lines and readable |

---

## Not used, on purpose

| Technology | Why not |
| --- | --- |
| **Redis** | No requirement in Phase 1. Rate limiting is in-memory and single-process, caching has no established need, and there are no background jobs. Adding it "for later" would mean an extra service to run, secure and back up for zero present benefit. Revisit when there is a second instance or a job queue. |
| **A vendor AI SDK** | Would tie the codebase to one provider — the opposite of the architecture. |
| **GraphQL** | Two endpoints. |
| **A message queue** | Analysis is synchronous and fast enough. |
| **Kubernetes** | Phase 9, if ever. |
| **An auth library** | Phase 8. Adding one now, unused, would be dead code with a security surface. |

---

## Keeping it this way

Before adding anything:

1. Try writing it. Forty lines you own beat a package you do not.
2. Check maintenance and transitive dependency count.
3. Record the reason here and the decision in [`decision.md`](decision.md).
4. Run `npm audit` and resolve findings before committing.

The repository currently pins `esbuild` through an npm override, because
`drizzle-kit` pulls an outdated copy transitively (GHSA-67mh-4wv8-2f99). The
rationale is recorded in the root `package.json` next to the override itself,
where whoever hits it will actually see it.
