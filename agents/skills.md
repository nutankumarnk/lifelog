# Skills

What an agent working on Lifelog needs to be able to do, and where each skill is
actually exercised in this repository.

The rule that matters most: **do not install a package because a skill exists.**
Lifelog has eight runtime dependencies in the backend. Keep it that way. If you
are about to add one, read the "adding a dependency" section at the bottom.

---

## Core

| Skill | Where it is used | What to know specifically |
| --- | --- | --- |
| **TypeScript** | Everywhere | Strict mode, ES modules, `.js` extensions in relative imports (NodeNext resolution). `any` is not used anywhere in `src/`; keep it that way. |
| **Node.js** | Backend runtime | ≥ 20.11. Native `fetch`, `AbortSignal.timeout`, `node:crypto`. No polyfills. |
| **Fastify** | `src/server.ts`, `src/routes/` | v5. Plugin registration order matters: helmet, CORS, rate limit, then routes. The error handler is set once in `src/errors/handler.ts`. |
| **REST API design** | `src/routes/`, `docs/api.md` | Versioned path prefix, one error envelope, no verbs in paths. The contract is consumed by a future mobile client — treat changes as breaking. |

## Database

| Skill | Where it is used | What to know specifically |
| --- | --- | --- |
| **PostgreSQL** | Docker service, port 5434 | Two databases: `lifelog`, `lifelog_test`. Version 16. |
| **SQL** | `src/repositories/` only | If you are writing SQL outside a repository, you are in the wrong file. |
| **Drizzle ORM** | `src/db/schema.ts` | Schema-first. Generate migrations with `npm run db:generate`; never hand-edit a generated migration that has already been applied. |
| **Migrations** | `backend/drizzle/` | Additive by default. A destructive migration needs a decision record. |
| **Indexing** | `src/db/schema.ts` | Every index there answers a query Phase 2–5 will actually make; see `docs/data-model.md`. Do not add speculative indexes. |

## Validation

| Skill | Where it is used | What to know specifically |
| --- | --- | --- |
| **Zod** | `src/schemas/`, `src/config/env.ts` | Two strictness levels: `RawModelAnalysisSchema` is forgiving (model output), `AnalysisSchema` is strict (everything after normalisation). Never relax the strict one to make a model pass. |
| **JSON Schema thinking** | `src/intelligence/prompt.ts` | The prompt describes a shape; Zod enforces it. The prompt is documentation for the model, not a guarantee. |
| **Structured LLM output** | `src/ai/json.ts`, `src/intelligence/normalize.ts` | Assume the model returns almost-JSON. Fences, trailing commas and token-limit truncation are all recovered from. Assume every field may be missing, misnamed or the wrong type. |

## AI

| Skill | Where it is used | What to know specifically |
| --- | --- | --- |
| **LLM API integration** | `src/ai/openrouter.provider.ts` | Plain `fetch`. No vendor SDK — an SDK would make the model harder to replace, which is the one thing this architecture protects. |
| **OpenRouter** | Same file | OpenAI-compatible `/chat/completions`. Errors are mapped to `AiProviderError` kinds so the registry can decide what is retryable. |
| **Prompt engineering** | `src/intelligence/prompt.ts` | Ask only for what a model is better at than code. Never ask for date arithmetic, ids, offsets or calibrated confidence. Every instruction must be verifiable downstream. |
| **Structured extraction** | `src/intelligence/` | The model proposes; Lifelog disposes. Read `docs/algorithm.md` before changing any of it. |
| **Hallucination prevention** | `src/intelligence/grounding.ts` | Character-span grounding with a fuzzy fallback. This is the single most important safety property in the system. |
| **Model-independent architecture** | The whole design | Test: if swapping the model requires touching a file outside `src/ai/`, the change is wrong. |

## Infrastructure

| Skill | Where it is used | What to know specifically |
| --- | --- | --- |
| **Docker / Compose** | `docker-compose.yml` | One service, Postgres. Non-default port 5434 so it cannot collide with a local install. |
| **Environment variables** | `.env.example`, `src/config/env.ts` | Configuration in `.env`, **secrets in `secrets/API-KEYS.md`**. Never mix them. |

## Frontend

| Skill | Where it is used | What to know specifically |
| --- | --- | --- |
| **React** | `frontend/src/` | Function components, hooks, no state library. The console is deliberately small. |
| **Vite** | `frontend/vite.config.ts` | Port 5319, proxies `/api` and `/health` to the backend so the browser makes same-origin requests. |
| **TypeScript in the browser** | `frontend/src/types.ts` | Types are *mirrored* from the backend, not imported. The frontend must not depend on backend internals. |

## Testing

| Skill | Where it is used | What to know specifically |
| --- | --- | --- |
| **Vitest** | `backend/tests/` | `npm test`. Database-backed tests are serialised because they truncate shared tables. |
| **API testing** | `tests/integration/api.test.ts` | Uses `app.inject()` — no network, no port binding. |
| **Integration testing** | Same | Requires Postgres. These tests assert what actually landed in the tables, not just the response. |
| **Mock AI providers** | `src/ai/mock.provider.ts` | Script a response, an error kind, a delay, or raw text. Use it for every failure-path test. Never call a real model from a test. |

## Engineering

| Skill | Why it matters here |
| --- | --- |
| **Modular architecture** | Each intelligence stage is a separate module with one job, so a rule can be changed without reading the whole pipeline. |
| **Clean code** | Someone will read this at 2am during an incident. Prefer the boring version. |
| **Dependency inversion** | The service depends on the `AiProvider` interface and the repository interfaces, never on concrete implementations. That is what makes both the model and the database swappable, and the tests fast. |
| **SOLID, where it earns its place** | Interfaces exist where there is a real second implementation (three AI providers). Do not add an interface with one implementation and no planned second. |
| **Git** | Small commits, one logical change each. `npm run keys:check` before every commit — the pre-commit hook runs it, do not bypass with `--no-verify`. |
| **Debugging** | Start with the `warnings` array in the response. Every override, drop, merge and demotion the pipeline performed is recorded there with a code. |

---

## Before using an unfamiliar technology

Read its documentation before writing code with it. A plausible-looking API call
that does not exist costs more time than five minutes of reading. If the version
in `package.json` differs from what you remember, believe `package.json`.

## Adding a dependency

Do all four, in this order:

1. Try writing it yourself first. Forty lines you own beat a package you do not.
2. Check it is maintained, and check its transitive dependency count.
3. Record the reason in [`../docs/technology.md`](../docs/technology.md) and the
   decision in [`../docs/decision.md`](../docs/decision.md).
4. Run `npm audit` and resolve anything it reports before committing.

A dependency added without a recorded reason will be removed by the next agent
who reads the file and cannot tell why it is there.
