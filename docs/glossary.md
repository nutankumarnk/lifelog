# Glossary

Shared vocabulary. When two people use "memory" to mean different things, the
design drifts without anyone noticing. These are the meanings Lifelog uses.

Terms in **bold** are the ones that appear in code, in the schema, or in the API.

---

## The core objects

**Conversation**
One message the user sent to Lifelog, stored exactly as they wrote it. This is
the source of truth. It is written before anything else happens, never edited,
never normalised, never truncated. Table: `conversations`.

**Analysis**
One interpretation of one conversation, produced by the pipeline. A conversation
can have several analyses over time — re-reading a message with a better model
adds a row, it does not replace one. Table: `analyses`.

**Segment**
A meaningful piece of a conversation: a sentence, or a clause when a sentence
carries several independent facts. Segments carry character offsets back into
the original text. Table: `segments`.

**Item**
One unit of extracted life information. A conversation produces zero or more.
Every item has a type, a title, verbatim source text, temporal information and
a confidence. Table: `items`.

**Entity**
Something the conversation refers to: a person, place, organisation, object,
topic, event name, or something Lifelog has no category for. Table: `entities`.

**Follow-up**
A single clarifying question Lifelog decided to ask. At most one per analysis,
and only when a missing detail blocks something the user asked for. Table:
`follow_ups`.

---

## Item types

The eight values of `ItemTypeEnum`. Defined in
[`backend/src/schemas/analysis.schema.ts`](../backend/src/schemas/analysis.schema.ts).

**MEMORY**
A lived experience worth preserving. Usually carries people, a place, or a
feeling. "I met Arun yesterday in Ahmedabad" is both a past event and a memory —
the same sentence legitimately produces both, because they are different kinds
of record: one is a fact on a timeline, the other is something you might want to
re-read in ten years.

**PAST_EVENT**
Something that happened, anchored in time.

**PRESENT_FACT**
Something currently true about the user's life. "I'm working at Acme now."

**FUTURE_EVENT**
Something scheduled or expected. "The flight is on the 3rd."

**TASK**
An action the user needs to complete. Lifelog holds it; it does not prompt.

**REMINDER**
A time-anchored prompt the user *asked to receive*. The difference from a task
is the request, not the urgency — see below.

**DECISION**
A choice the user has made. "I'm going with Postgres."

**FEELING**
An emotional state the user actually expressed. Never inferred from neutral text.

### Task vs Reminder

The distinction Lifelog treats as load-bearing:

> A **task** is something you have to do.
> A **reminder** is something you asked to be told about.

"I need to call the dentist" is a task. "Remind me to call the dentist" is a
reminder. Lifelog will send notifications one day, and notifying someone who
never asked is a worse failure than missing a reminder they did ask for — so a
reminder must be backed by explicit request wording, checked in code after the
model has spoken. Enforced in
[`backend/src/intelligence/classify.ts`](../backend/src/intelligence/classify.ts).

---

## Intent

**Intent** is what the user appears to want *from Lifelog*, not what the message
is about. "I need to call the bank" is `CAPTURE_TASK`; "did I call the bank?" is
`ASK`. Nine values:

| Intent | Meaning |
| --- | --- |
| `LOG` | Recording something that happened or is true |
| `PLAN` | Describing something intended for the future |
| `CAPTURE_TASK` | Asking Lifelog to hold an action item |
| `SET_REMINDER` | Asking to be prompted at a time |
| `REFLECT` | Diary or emotional processing; no action expected |
| `ASK` | Querying Lifelog's memory (detected in Phase 1, answered in Phase 4) |
| `CORRECT` | Amending something said earlier |
| `SMALL_TALK` | Chatter with no life data |
| `UNKNOWN` | Genuinely unclear. Never guessed at to avoid this value. |

Intent decides whether Lifelog is allowed to ask a follow-up question, so it is
not a cosmetic label.

---

## Architecture terms

**Intelligence Layer**
Lifelog's own rules and decision system: `backend/src/intelligence/`. Segmentation,
normalisation, grounding, temporal resolution, classification, follow-up logic
and confidence calibration. It is model-independent, testable without a network
call, and it is what the product actually is. Documented in
[`algorithm.md`](algorithm.md).

**AI Provider**
An adapter that talks to one AI model: `backend/src/ai/`. It translates a
Lifelog request into a model call and the model's answer back into loose JSON.
It contains no product rules. Three exist: `openrouter`, `local`, `mock`.

**Pipeline**
The ordered sequence of intelligence stages that turns raw text into a validated
analysis. `backend/src/intelligence/pipeline.ts`. The order is the contract.

**Grounding**
Verifying that every extraction traces back to characters the user actually
typed. An entity whose name is absent is dropped; an item whose source text is
absent is dropped, or kept with reduced confidence if it is a close paraphrase.
This is Lifelog's hallucination defence.

**Normalisation**
Repairing loose model output into Lifelog's strict shape: mapping aliases,
filling defaults, coercing types, merging duplicate entities. Happens before
grounding.

**Calibration**
Replacing the model's self-reported confidence with a number derived from
evidence Lifelog can check: was the item quoted or paraphrased, did the time
phrase resolve, does it reference real entities, did a fallback provider answer.
Nothing is ever reported above 0.95.

**Degraded**
The primary provider failed and a fallback answered. The response says so in
`meta.degraded` and in a warning. Degradation is recorded, never hidden.

**Warning**
A non-fatal note about how an analysis was produced: an intent was coerced, an
item was dropped as ungrounded, a reminder was demoted to a task. Warnings are
returned in the response and stored. They are the first thing to read when
debugging an unexpected result.

---

## Temporal terms

**Raw phrase**
What the user literally wrote: "yesterday", "next Friday", "kal". Always kept.

**Resolved**
Lifelog's interpretation of that phrase as an ISO date or datetime, computed
relative to the conversation's reference time. May be `null` — an unresolved
phrase is an honest answer, a guessed date is not.

**Precision**
How exactly the phrase pins down a moment: `EXACT_TIME`, `DAY`, `WEEK`, `MONTH`,
`YEAR`, `RELATIVE`, `RECURRING`, `NONE`.

**Reference time**
The clock Lifelog resolves relative phrases against: the client's `occurred_at`
if supplied, otherwise server time. Injectable, so tests never depend on the
wall clock.

**Tense**
`PAST`, `PRESENT`, `FUTURE` or `UNSPECIFIED`. Derived from the phrase and from
grammar, reconciled between the two. When tense and item type disagree, the
resolved date wins — it came from the user's own words.

---

## Data and security terms

**Source of truth**
`conversations.raw_text`. If every other table were dropped, no user data would
be lost. Everything else is an interpretation that can be recomputed.

**Interpretation**
Any derived record: items, entities, segments, follow-ups. Useful, replaceable,
never authoritative.

**Local id**
An id like `e1` or `i3`, unique within one analysis payload, used to join items
to entities inside the JSON. Distinct from the database UUID. Lifelog assigns
these itself and never trusts the model's numbering.

**Keys file**
`secrets/API-KEYS.md`. The one place an API key belongs. Gitignored,
name-allowlisted, permission-checked, never logged. See
[`security-checklist.md`](security-checklist.md).

**Redaction**
Removing credentials and conversation content from anything written to a log.
Only lengths, word counts and hashes of user text are ever logged.
`backend/src/utils/redact.ts`.

---

## Words to avoid

**"AI"** as a synonym for Lifelog. The model is one component. Say "the model"
or "the provider" when that is what you mean.

**"Prompt"** when you mean the algorithm. The prompt is how a model is asked to
do its part; the algorithm is what Lifelog does. Confusing them is how business
logic ends up inside a string literal.

**"Memory"** as a synonym for "row". A memory is a specific item type. The
broader concept is covered in [`memory.md`](memory.md).
