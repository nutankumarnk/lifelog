# Coding Structure

Conventions, and where a given piece of code belongs.

The point of these rules is not tidiness. It is that someone — possibly an AI
agent with no memory of this conversation — can open one file and understand it
without reading five others.

---

## Principles

1. **Small modules.** One file, one job.
2. **Single responsibility.** If describing a file needs the word "and", consider
   splitting it.
3. **Clear folder boundaries.** The directory tells you what kind of code is
   inside.
4. **No giant files.** Nothing in `src/` exceeds a few hundred lines. That is a
   consequence of the rules above, not a target to game.
5. **No giant services.** A service that grows domain conditionals is holding
   logic that belongs in the intelligence layer.
6. **Business logic stays out of routes.**
7. **Database logic stays in repositories.**
8. **AI integration stays behind the provider interface.**
9. **Validation uses schemas**, not hand-rolled checks.
10. **Shared utilities stay minimal.** `utils/` contains one file. Keep it that
    way — "utils" is where unowned logic goes to hide.
11. **Prefer readable over clever.** Someone will read this at 2am.
12. **Avoid unnecessary abstraction.** No interface with one implementation and
    no planned second.
13. **Avoid circular dependencies.** A cycle is not a style problem; it is the
    signal that a responsibility is in the wrong place.

---

## The layer chain

```
routes → controllers → services → repositories → database
```

And for understanding:

```
service → intelligence → AI provider → external model
```

Dependencies point one way. Nothing in an inner layer imports from an outer one.

## Where does this code go?

| If it… | It belongs in |
| --- | --- |
| declares a URL path | `routes/` |
| parses or shapes an HTTP request or response | `controllers/` |
| decides the order of operations | `services/` |
| decides what something *means* | `intelligence/` |
| talks to a model | `ai/` |
| writes SQL | `repositories/` |
| defines a table | `db/schema.ts` |
| defines a contract | `schemas/` |
| reads configuration | `config/` |
| defines an error | `errors/` |
| is a pure helper used in three or more places | `utils/` — and think first |

Two questions settle most cases:

**"Would this change if we swapped the AI model?"** If yes, it goes in `ai/`. If
no, it must not.

**"Would this change if we swapped Postgres for something else?"** If yes, it
goes in `repositories/` or `db/`. If no, it must not.

---

## Directory layout

```
backend/src/
├── ai/              provider adapters, registry, JSON recovery
├── config/          env loading, keys file loading
├── controllers/     HTTP shaping
├── db/              Drizzle schema, client, migrate script
├── errors/          error taxonomy, the one error boundary
├── intelligence/    Lifelog's rules — the product
├── repositories/    all SQL
├── routes/          path declarations
├── schemas/         Zod contracts (API + analysis)
├── services/        orchestration
├── utils/           redaction. One file.
├── server.ts        composition root
└── index.ts         entry point
```

`intelligence/` is the largest directory, and that is the right shape: it holds
what Lifelog knows, while every other directory holds plumbing.

---

## File conventions

**Naming.** `kebab-case.ts`, with a role suffix where it disambiguates:
`conversation.service.ts`, `analysis.repository.ts`, `openrouter.provider.ts`.
Intelligence modules are named for the verb they perform: `segment.ts`,
`normalize.ts`, `classify.ts`, `ground`… (as `grounding.ts`).

**Imports.** ES modules with `.js` extensions on relative imports — required by
NodeNext resolution, easy to forget. `import type` for types.

**Exports.** Named exports. No default exports, no barrel files. A barrel hides
the dependency graph and makes circular imports easy to create by accident.

**Every module starts with a header comment** explaining *why it exists* and what
constraint it protects — not what it does, which the code shows. This is the
single most useful convention in the repository for an agent picking up cold.

**Functions are small and named for the decision they make.**
`enforceTaskReminderDistinction`, not `processItems`.

**Types before implementation.** Interfaces and schemas near the top of the file.

---

## Comments

Comment intent, constraints and trade-offs. Never mechanics.

```ts
// Auth failures are never retried — a bad key will still be bad in 250ms.
if (!aiError.retryable) return null;
```

```ts
// Increment the attempt counter
attempt += 1;
```

The first says something the code cannot. The second is noise, and worse, it
rots. Do not explain a change in a comment — that is a message to a reviewer, and
it becomes meaningless the moment the PR merges.

---

## TypeScript

- Strict mode. No `any` in `src/`. `unknown` at boundaries, narrowed immediately.
- Infer types from Zod schemas (`z.infer`) rather than declaring them twice.
- Discriminated unions over optional-field soup.
- `readonly` on configuration and other structures that must not be mutated.

Mutation is used inside intelligence stages — an item is refined as it passes
through the pipeline — and that is deliberate: copying the whole analysis at each
of twelve stages would obscure the flow for no benefit, since the pipeline owns
the object exclusively. Outside the pipeline, treat data as immutable.

---

## Error handling

- Throw `AppError` for anything a client should see.
- Throw `AiProviderError` inside `ai/`; the registry and the service map it.
- Never `catch` and swallow. Either handle it, or attach context and rethrow.
- Never put internal detail in `publicMessage`.

---

## Testing conventions

- Unit tests for intelligence modules, no database, no network.
- Behaviour tests for the 20 scenarios, run against the local rule engine so they
  are deterministic.
- Integration tests through `app.inject()`, asserting what landed in the tables.
- The mock provider for every failure path. **No test calls a real model.**

Tests assert Lifelog's guarantees, not a model's wording: that a reminder is
recognised as a reminder, not that a particular sentence came back. See
[`testing.md`](testing.md).

---

## When to split a file

Split when a file has two reasons to change, or when you cannot hold it in your
head while editing it.

Do **not** split to hit a line count. Three files that must be read together are
worse than one file that reads top to bottom. `pipeline.ts` is deliberately one
file: the stage order is the contract, and scattering it would hide the thing
most worth seeing.

## When to add a dependency

Almost never. The backend has eight runtime dependencies.

Before adding one: try writing it yourself; check it is maintained and its
transitive tree is small; record the reason in [`technology.md`](technology.md)
and the decision in [`decision.md`](decision.md); run `npm audit`.

A dependency added without a recorded reason will be removed by whoever reads
the file next and cannot tell why it is there.

---

## Frontend conventions

The test console is deliberately small and is not the final UI.

- Function components and hooks. No state library.
- Types are **mirrored** from the backend in `types.ts`, not imported. The
  frontend must not depend on backend internals.
- All API access goes through `api.ts`. No `fetch` in a component.
- Hand-written CSS in one file. No component library for a temporary tool.
- **No AI logic, no API key, no database access, ever.**
