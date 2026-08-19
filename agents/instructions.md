# Instructions for AI Coding Agents

These are the permanent rules for any AI agent working on Lifelog. They do not
change per task. Read them before writing code, and follow them even when the
task description does not mention them.

If a rule here conflicts with a task instruction, say so rather than silently
picking one.

---

## Before you write anything

1. **Read [`../README.md`](../README.md)** — what Lifelog is and how to run it.
2. **Read [`context.md`](context.md)** — the current state of the project.
3. **Read [`workflow.md`](workflow.md)** — how to actually do the work.
4. **Read the docs relevant to your task.** If you are touching extraction, read
   [`../docs/algorithm.md`](../docs/algorithm.md). If you are touching storage,
   read [`../docs/data-model.md`](../docs/data-model.md). Do not guess.
5. **Read the existing code you are about to change.** Not a grep hit — the file.

## The one principle everything else follows from

**Lifelog is not an AI model. The model is a replaceable component.**

Lifelog owns the intelligence rules, the context, the algorithm, the data model,
the decision system, the validation, the memory architecture, the API contract
and the user experience. A model provides one step in the middle.

Concretely, this means:

- Business logic never goes in `src/ai/`.
- Nothing outside `src/ai/` may import an SDK or name a model.
- Anything you ask a model to do must be enforced or verified in code afterwards.
  If the pipeline cannot check an instruction, the model will eventually ignore
  it and nobody will notice.
- If replacing the model would require changing a file outside `src/ai/`, the
  design is wrong.

---

## Architecture rules

- **Keep modules isolated.** A module should be understandable without reading
  three others.
- **Do not put business logic in routes.** Routes declare paths and hand off.
  See [`../docs/coding-structure.md`](../docs/coding-structure.md).
- **Do not put SQL outside repositories.** Services must never see a Drizzle
  type or build a query.
- **Do not put AI logic in the frontend.** The test console talks to the API and
  nothing else — no key, no model, no database.
- **Do not let AI output reach SQL directly.** Every model response is
  normalised, grounded and schema-validated first. This is not optional; it is
  the difference between a life record and a fabrication.
- **Do not change the architecture without documenting the decision** in
  [`../docs/decision.md`](../docs/decision.md), with the options you considered
  and the trade-off you accepted.

## Code rules

- **Small files, small functions, one responsibility.** If a file is hard to
  hold in your head, split it — but do not split for its own sake.
- **Do not create files you do not need.** No barrel files, no empty
  interfaces, no abstraction with one implementation and no second one planned.
- **Do not add a dependency** without recording why in
  [`../docs/technology.md`](../docs/technology.md). Prefer writing 40 lines to
  adding a package.
- **Prefer readable over clever.** Someone will read this at 2am during an
  incident.
- **Avoid circular dependencies.** The leaf modules (`lexicon`, `temporal`,
  `segment`) import nothing from the project; keep it that way.
- **Comment intent, not mechanics.** Explain a constraint or a trade-off the
  code cannot show. Never narrate what the next line does.

## Testing rules

- **Write tests for new functionality.** A behaviour without a test will be
  broken by the next agent.
- **Test Lifelog's guarantees, not a model's wording.** Assert that a reminder
  is recognised as a reminder, not that a particular sentence came back.
- **Use the mock provider for failure modes.** Never call a real model in a test.
- **Every scenario in [`../docs/testing.md`](../docs/testing.md) must keep
  passing.** If you change behaviour deliberately, update the table and say so.

## Security rules

- **Never expose an API key.** Not in code, a comment, a test fixture, a commit
  message, a log line, a documentation example, or your own summary text.
- **Never log conversation content.** Use `summarizeText()` — length, word count
  and a hash. The user's private life does not belong in a log file.
- **Never commit `secrets/API-KEYS.md`.** It is gitignored. Keep it that way.
- **Run `npm run keys:check` before committing.** Stop if it reports a finding.
- **Never weaken the scanner to make a commit pass.** Fix the finding instead.

Full policy: [`../docs/security-checklist.md`](../docs/security-checklist.md).

## Change rules

- **Preserve backward compatibility where you can.** The API contract will be
  consumed by a mobile client.
- **Never silently remove existing functionality.** If something must go, say so
  explicitly in your summary and record it in
  [`../docs/changelog.md`](../docs/changelog.md).
- **Do not blindly rewrite large portions of the project.** Change the smallest
  thing that solves the problem.
- **Update the documentation in the same change as the code.** Documentation
  written later is documentation not written.

---

## What requires an explicit decision record

Do not do any of these casually. Each needs an entry in
[`../docs/decision.md`](../docs/decision.md):

- Changing the analysis schema in a non-additive way
- Changing the API contract
- Changing the database schema
- Adding, removing or replacing a dependency
- Adding a new AI provider or changing the default model
- Changing how grounding, follow-up or the task/reminder distinction works
- Anything that makes the system depend on a specific model's behaviour

## What must never be changed casually

- **`conversations.raw_text` is append-only.** It is the source of truth. Never
  add code that rewrites, normalises or truncates it.
- **The grounding stage.** It is what stops Lifelog from inventing a person's
  memories. Weakening it to make an extraction pass is never the right fix.
- **The task/reminder distinction.** Lifelog will send notifications one day.
  Notifying someone who never asked is worse than missing a reminder.
- **Log redaction.** Do not add a log line that bypasses it.

---

## When you finish

1. Run `npm test` and `npm run keys:check`.
2. Update [`../docs/implementation.md`](../docs/implementation.md).
3. Update any documentation your change made inaccurate.
4. Report what changed, what you did not do, and what you are unsure about.

If you ran out of time or context mid-task, see the interruption protocol in
[`../docs/implementation.md`](../docs/implementation.md). Leaving an accurate
half-finished state is far more useful than leaving a confident wrong one.
