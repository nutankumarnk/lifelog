# Decision Log

Why Lifelog is the way it is.

**Append only.** Do not rewrite a historical decision — if it turns out to be
wrong, add a new entry that supersedes it and say so. The value of this file is
that it shows what was known at the time, including the mistakes.

Each entry: the problem, the options considered, what was chosen, why, what was
traded away, and what it means later.

---

## D-001 — The AI model is a replaceable component

**Date:** 2026-08-19 · **Status:** Accepted · **Supersedes:** nothing

**Problem.** Almost everything called an "AI product" is a prompt with a database
attached. Its behaviour is a property of a vendor's model: it changes when the
vendor retrains, it cannot be tested, and it cannot be reasoned about. Lifelog
stores people's lives — that is not an acceptable foundation.

**Options considered.**

1. *Prompt-driven.* Put all the rules in the prompt, store what comes back.
   Fastest to build, and best-case quality with a strong model.
2. *Model-driven with validation.* Trust the model, validate the shape.
3. *Lifelog-owned intelligence.* Rules in code; the model contributes one step in
   the middle; everything it returns is checked.

**Chosen:** 3.

**Why.** Three properties that options 1 and 2 cannot provide. The behaviour is
testable — 158 tests run with no network. The behaviour is stable across model
upgrades and outages. And the product's rules are inspectable: "why did Lifelog
call this a task?" has an answer in a file, not a shrug.

There is also a business argument. If the product is a prompt, the product is the
model vendor's. The rules for what a memory is, when to ask a question, how to
resolve "kal" — those accumulate value; a prompt does not.

**Trade-offs.** Substantially more code. The intelligence layer is the largest
part of the backend. Some extraction quality is left on the table by overriding a
model that was occasionally right. Every model instruction must also be enforced
in code, which is real duplication.

**Future impact.** Sets the test applied to every later change: *if replacing the
model requires editing a file outside `backend/src/ai/`, the change is wrong.*

---

## D-002 — Store the original conversation, always, first

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** Should Lifelog keep the raw text after extracting from it?

**Options considered.**

1. *Extraction only.* Smaller, simpler, what most pipelines do.
2. *Raw text only.* Truthful, but it is a text file, not a product.
3. *Both, with the raw text authoritative.*

**Chosen:** 3, written before analysis begins.

**Why.** A life record has a long half-life. Someone may read an entry in fifteen
years, when today's model is obsolete and they no longer remember the day. At
that distance an error in an interpretation is recoverable and an error in the
record is not — if the extraction says "met Arun in Ahmedabad" and the sentence
is gone, there is nothing to check it against.

Keeping the text also means a better model can re-read old conversations later,
and extraction loses things that matter: "finally finished the thing, absolutely
wrecked" and "completed the task; feeling tired" produce the same items and are
not the same memory.

Writing it *first* is the other half. The worst case becomes a conversation with
no analysis — fixable — rather than an analysis with no conversation, which
cannot be verified at all.

**Trade-offs.** More storage. Duplication between `raw_text` and `source_text`.
A larger deletion surface for Phase 8.

**Future impact.** Justifies re-analysis as an additive operation, and makes
grounding meaningful — an item can point at its source because the source exists.

---

## D-003 — PostgreSQL, not SQLite

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** Phase 1 is single-user and local. SQLite would be simpler.

**Options considered.** SQLite (zero setup, no service, file-based); PostgreSQL
(a service to run); MongoDB (flexible documents).

**Chosen:** PostgreSQL 16.

**Why.** Life information is relational — people attend events, events happen in
places, items reference entities — so the document option loses joins that would
then be rebuilt in application code.

SQLite versus Postgres came down to what happens later. The next phases need
full-text search (recall), and probably vector search after that; Postgres covers
both without adding a datastore. And Postgres would have to arrive eventually
anyway, the moment sync or concurrent access appears — at which point the
migration is of a database containing years of someone's life. That is not a task
worth scheduling. Paying the setup cost now costs one Docker service.

**Trade-offs.** Contributors need Docker or a local Postgres. Slower cold start.
Genuine over-engineering for a strictly single-user Phase 1.

**Future impact.** `jsonb`, full-text search, `pgvector` and row-level security
are all available when needed, with no migration.

---

## D-004 — Node.js and TypeScript

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** Language and runtime for the backend.

**Options considered.** Node + TypeScript; Python + FastAPI; Go.

**Chosen:** Node + TypeScript.

**Why.** The workload is I/O-bound — one model call, a few writes — which is what
an event loop is for. TypeScript's type system suits a domain whose central
problem is untrusted structured data, and `z.infer` means the runtime contract
and the compile-time type cannot drift. One language shared with the test console
and a likely React Native client means the analysis types are written once.

Python has the better ML ecosystem, which would matter if Lifelog were training
models. It is not; it is calling an HTTP API.

**Trade-offs.** If Lifelog ever needs local inference or heavy numerical work,
this becomes the wrong choice and a service boundary appears.

---

## D-005 — An AI provider abstraction with an offline fallback

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** How should the model be called, and what happens when it is
unavailable?

**Options considered.**

1. Call the provider's SDK directly from the service.
2. An interface with one hosted implementation.
3. An interface, a hosted implementation, **and an offline rule engine**.

**Chosen:** 3.

**Why.** Options 1 and 2 both mean Lifelog stops working when a provider does,
and option 1 additionally welds the codebase to one vendor's SDK.

The offline engine buys three things that turned out to matter more than
expected. A fresh clone works end to end with no credentials, so a new
contributor sees the whole system in one command. The test suite is deterministic
and runs with no network. And a provider outage degrades quality instead of
losing a user's message.

**Trade-offs.** The rule engine is a second extraction implementation to
maintain, and it is meaningfully weaker than a hosted model — which can confuse
debugging when someone forgets to check `meta.provider`. That is why the provider
is named in every response.

**Future impact.** Makes self-hosting or routing simple messages away from a paid
model straightforward later.

---

## D-006 — OpenRouter and Gemma as the default

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** Which hosted model, reached how?

**Options considered.** OpenAI or Anthropic SDK directly; OpenRouter as an
aggregator; self-hosted from the start.

**Chosen:** OpenRouter, `google/gemma-4-26b-a4b-it:free` (originally Gemma 3 27B;
switched 2026-08-20 without adapter changes), over plain `fetch`.

**Why.** OpenRouter puts dozens of models behind one OpenAI-compatible endpoint,
so changing model is a config value rather than a new adapter — which directly
serves D-001. Using `fetch` rather than an SDK keeps the dependency count at zero
and keeps the adapter honest.

Gemma 3 27B follows a JSON schema reliably, handles code-switched
Indian-English input, and is cheap enough to run on every message someone writes
about their day. Open weights, so self-hosting stays available. It is not the
strongest model on the list and does not need to be, because Lifelog checks
everything it says.

**Trade-offs.** A dependency on an aggregator's uptime, and a small latency
overhead versus calling a provider directly. Gemma paraphrases more than a
frontier model would, which grounding then catches.

**Future impact.** `AI_MODEL` is a config value. Changing it requires running the
behaviour suite and nothing else.

---

## D-007 — Grounding as a hard requirement

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** Models invent plausible detail. In a life record, an invented memory
is indistinguishable from a real one after enough time has passed.

**Options considered.** Trust the model; flag low-confidence extractions for the
user; **require every extraction to trace to characters the user actually typed.**

**Chosen:** the third, with a fuzzy tier for paraphrase.

**Why.** Flagging pushes the problem to a user who has no way to check — that is
exactly the situation where the original text has faded from memory. Verification
is mechanical and cheap: the text is right there.

The two-tier design matters. Exact match keeps the real substring. Below 50%
content-word overlap the item is dropped. Between the two it survives with
reduced confidence and a warning, because a model that paraphrases is describing
something real, badly.

**Trade-offs.** Some legitimate extractions are lost — heavy paraphrase,
implicature the user did not spell out. That asymmetry is deliberate: a missing
item is a gap the user can fill; a fabricated one is a corrupted memory.

**Future impact.** Constrains every future extraction feature. Inference beyond
the text — "you seem stressed lately" — cannot be an item; it would need a
separate, clearly-labelled kind of record.

---

## D-008 — The task/reminder distinction is enforced in code

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** "I need to call the dentist" and "remind me to call the dentist" are
nearly identical sentences with very different consequences once Lifelog can send
notifications.

**Options considered.** Let the model decide; treat them as one type with a flag;
**enforce the distinction in code after the model has spoken.**

**Chosen:** the third.

**Why.** The failure modes are not symmetric. Missing a reminder someone asked
for is a broken promise. Notifying someone who never asked is a betrayal of the
restraint that makes the tool usable — and it is the kind of thing that gets an
app deleted. So the rule is deliberately conservative: a `REMINDER` requires
explicit request wording in the item's own text, or in the conversation when one
sentence licenses several ("remind me about these: pay rent, call mum").

Model labels drift between versions. This behaviour must not.

**Trade-offs.** Some real reminders are demoted to tasks when the phrasing is
indirect. Accepted, in that direction, on purpose.

**Future impact.** The `explicit` flag records which way each decision went, so a
notification phase can choose how aggressively to act on each.

---

## D-009 — Ask at most one follow-up question, rarely

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** Lifelog can almost always find something missing. Should it ask?

**Options considered.** Ask whenever something is missing; ask for anything
high-importance; **record everything, ask only when a gap blocks something the
user requested, one question maximum.**

**Chosen:** the third.

**Why.** A tool that interrogates you after every sentence stops being used, and
the whole value proposition is that writing in it is as easy as writing to a
friend. Recording a gap costs the user nothing and is useful to a later phase;
asking costs attention, which is the scarce resource.

The gate is intent. `REFLECT`, `SMALL_TALK` and `ASK` are never interrogated — a
diary entry that does not say where it happened is a complete diary entry. Plain
`LOG` is not asked either: the user is recording, not requesting help.

**Trade-offs.** Some genuinely useful clarifications are never requested. Missing
information is still recorded, so a later phase can surface it in a way that does
not interrupt.

---

## D-010 — Confidence is calibrated, never taken from the model

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** Models report confidence that is high and flat regardless of how
hard the input was.

**Chosen:** treat the model's number as one weak signal, adjust it with evidence
Lifelog can verify (quoted vs paraphrased, time phrase resolved or not, entities
referenced, provider degraded, output repaired), and **cap everything at 0.95**.

**Why.** Uncalibrated confidence is worse than none — it invites the interface to
hide "low confidence" items using a number that means nothing. The cap exists
because a 1.0 in a UI invites the user to stop checking, and extraction is an
interpretation of ambiguous natural language. The conversation text is the only
thing Lifelog treats as certain, and it is stored separately.

**Trade-offs.** The heuristic weights are judgement calls with no ground truth
behind them. They are in one small file, and they are meant to be revisited when
there is real feedback data.

---

## D-011 — No Redis in Phase 1

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** Caching, rate limiting and job queues are the usual reasons to add
Redis early.

**Chosen:** not yet.

**Why.** None of the three has a requirement today. Rate limiting is per-process
and Phase 1 is one process. There is nothing to cache — analyses are unique per
message. There are no background jobs. Adding Redis "for later" means another
service to run, secure, monitor and back up, in exchange for nothing present.

**Revisit when:** there is more than one instance (rate limiting needs a shared
store), or a job queue appears (scheduled reminder delivery, Phase 3).

---

## D-012 — A dedicated secrets file, not `.env`

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** `.env` is the convention, and `.env` files get committed constantly.

**Options considered.** `.env` with a gitignore rule; a secret manager;
**a separate, single-purpose, gitignored `secrets/API-KEYS.md`** with a loader,
an allowlist and a scanner.

**Chosen:** the third.

**Why.** The real vulnerability is ambiguity about where a key belongs. When
there is no obvious home, keys end up in a shell profile, a committed `.env`, a
CI variable nobody can find, and a chat message. One designated location, clearly
labelled and mechanically protected, closes all four.

Markdown rather than `.env` syntax was chosen so the file can explain itself:
which keys are needed, where to get them, and what not to do — read by both the
human pasting the key and the AI agent asked to put it there.

A managed secret store is the right answer in deployment, and is Phase 9. It is
the wrong answer for a local development file.

**Trade-offs.** Non-standard, so it needs documenting — hence
[`security-checklist.md`](security-checklist.md) and `secrets/README.md`.

---

## D-013 — Store the analysis as both a JSON blob and normalised rows

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** Duplicating the analysis is redundant. Which representation wins?

**Chosen:** both, written in one transaction.

**Why.** They answer different questions. The blob reconstructs one analysis
exactly, in one read, and insures against a future schema change losing a nuance.
The rows answer questions *across* conversations — "every task due this week",
"every mention of Arun" — which is the entire point of extracting structure and
is impossible over blobs without scanning everything.

Writing them together means they cannot disagree.

**Trade-offs.** Storage, and a schema change now touches two places.

---

## D-014 — Documentation is part of the architecture

**Date:** 2026-08-19 · **Status:** Accepted

**Problem.** This project will be worked on largely by AI agents, each starting
with no memory of what came before. Undocumented reasoning is not merely lost —
it gets re-derived incorrectly, and the same mistakes get made repeatedly.

**Chosen:** a documentation system with defined files and defined purposes,
updated in the same change as the code, with `implementation.md` as the live
state and an interruption protocol for agents that run out of context.

**Why.** For an AI agent, documentation is the only continuity that exists. For a
human, it is the difference between contributing and interrogating the original
author. This file in particular is what stops a future change from quietly
undoing a decision whose reasoning was never written down.

**Trade-offs.** Real ongoing effort, and documentation that drifts is worse than
none — hence the rule that a change making a document wrong is an incomplete
change.

---

## Template for new entries

```
## D-0NN — Short title

**Date:** YYYY-MM-DD · **Status:** Accepted | Superseded by D-0NN

**Problem.** What forced a choice.

**Options considered.** With the real trade-off of each, not strawmen.

**Chosen:** what.

**Why.** The reasoning, including what was known at the time.

**Trade-offs.** What was given up. Be honest; this is the useful part.

**Future impact.** What this constrains or enables later.
```
