# The Lifelog Algorithm

**The most important document in this repository.**

This describes *what Lifelog does* when it reads a conversation. It is
model-independent: every rule here is implemented in code, in
`backend/src/intelligence/`, and can be tested without a network call.

It is deliberately not the prompt. The prompt
(`backend/src/intelligence/prompt.ts`) is *how a model is asked to do its part*.
The prompt may need rewriting for a different model. This algorithm should not.
If you find yourself copying a prompt into this file, or a rule from this file
into the prompt without also enforcing it in code, stop — that is exactly how
the product's behaviour becomes a property of a vendor's model.

---

## The governing idea

A model is good at reading meaning: paraphrase, implicature, mixed languages,
sarcasm, ellipsis. It is unreliable at everything else — arithmetic, consistency,
following a rule it agreed to two paragraphs ago, and admitting it does not know.

So Lifelog splits the work along that line:

| The model is asked for | Lifelog computes itself |
| --- | --- |
| What the message means | Every date and time |
| Which spans carry which facts | All ids and offsets |
| Which entities are mentioned | Which items survive |
| Its best guess at type and intent | The final type and intent |
| Its opinion on what is missing | Whether to ask anything |

And then a second rule governs the split:

> **Every instruction given to a model must be enforced or verified in code
> afterwards.** If the pipeline cannot check an instruction, the model will
> eventually ignore it and nobody will notice.

---

## The pipeline

Twelve stages, in this order. The order is a contract —
`backend/src/intelligence/pipeline.ts`.

```
 1. Segment              split text, preserve offsets
 2. Ask the provider     one model call, with retry and failover
 3. Normalise            repair loose output into the strict shape
 4. Ground               reject anything the user did not write
 5. Deduplicate          merge items covering the same span and type
 6. Resolve time         raw phrase → date, in code
 7. Task/reminder rule   enforce the product distinction
 8. Reconcile type       make type agree with resolved tense
 9. Enrich feelings      fill sentiment and intensity
10. Prune                drop empty and redundant facts
    (deduplicate again — classification can create new collisions)
11. Missing info + follow-up
12. Calibrate + validate
```

Grounding runs before classification because classifying a fabricated item
wastes work and risks keeping it. Calibration runs last because it scores
evidence the earlier stages produce.

---

## 1. Segmentation

Split the text into the smallest pieces that still carry a complete fact, and
record where each piece came from.

- Sentence boundaries first, protecting abbreviations ("Dr. Sharma") and decimals
  ("3.5 hours").
- Then clause splitting inside a long sentence, on coordinating conjunctions,
  but only when both sides are substantial. "I met Arun and Priya" is one clause;
  "I met Arun yesterday and I need to send him the file" is two.
- Every segment carries `{start, end}` offsets into the original text. Offsets
  are how everything downstream proves it is talking about something real.

Segmentation happens *before* the model call, so it is identical no matter which
provider answers.

## 2. Intent detection

Intent is what the user wants **from Lifelog**, not what the message is about.
"I need to call the bank" is `CAPTURE_TASK`. "Did I call the bank?" is `ASK`.

The model proposes; Lifelog then applies two overrides:

- **An explicit reminder outranks everything.** If any surviving item is a
  `REMINDER`, intent becomes `SET_REMINDER`. The user asked to be prompted; that
  is the intent, regardless of what else the message contained.
- **`UNKNOWN` with items is incoherent.** If the model says `UNKNOWN` but items
  survived, intent becomes `CAPTURE_TASK` when a task is present, otherwise `LOG`.

Intent matters because it gates the follow-up rule. Getting it wrong makes
Lifelog either silent when it should ask, or nagging when it should not.

## 3. Normalisation

Model output is treated as a suggestion in an unknown dialect.

- **Intent and type aliases are mapped.** `"note"` → `LOG`, `"todo"` → `TASK`,
  `"emotion"` → `FEELING`. An unmappable item type is dropped with a warning; an
  unmappable *entity* kind becomes `OTHER` with the original label preserved in
  `raw_kind`, because an uncategorised person is still a person.
- **Missing fields get defaults**, wrong types get coerced, out-of-range numbers
  get clamped.
- **Ids are reassigned.** Lifelog numbers entities `e1..en` and items `i1..in`
  itself and rewrites every cross-reference. A model's numbering is not trusted,
  because a duplicated or dangling id silently corrupts the entity links.
- **Entities that normalise to the same name are merged**, with surface forms
  collected as aliases. Case, punctuation and diacritics are folded for
  comparison only; the displayed name stays as the user wrote it.
- **Any date the model computed is discarded.** Only `temporal.raw` — the user's
  own phrase — is kept. Stage 6 does the arithmetic. This is not distrust of a
  particular model; it is that a wrong date in a life record is invisible until
  it matters.

## 4. Grounding — hallucination prevention

The safety property the whole system is built around. Lifelog stores a person's
life; a fabricated memory is worse than a missing one, because years later the
user has no way to tell it is false.

Three checks:

**Entity grounding.** The entity's name must appear in the text. Matching is
whitespace- and case-insensitive, and a compacted index maps back to real
offsets so a model that changed spacing still matches. One deliberate exception:
a relation-only entity ("my manager") is grounded by its relation word, because
the model is describing a real mention rather than inventing a name.

**Item grounding.** `source_text` must appear in the text. If it does, the
stored copy is replaced with the *actual substring* — so what is stored is
literally what the user wrote, not the model's transcription of it. If it does
not appear, Lifelog measures content-word overlap:

- below 50% → the item is dropped as invented, with a warning;
- at or above 50% → kept as a paraphrase, confidence capped at 0.5, span set to
  null, and a warning recorded.

**Temporal grounding.** A time phrase that does not appear in the text is
discarded entirely — the item survives, but with no date. A model that invents
"next Friday" is exactly the failure mode this catches.

**Reference hygiene.** After drops, entity ids are renumbered densely and item
references are remapped; references to entities that did not survive are removed.

Everything dropped is recorded as a warning. Nothing disappears silently.

## 5. Deduplication

Two items are the same when they share a type *and* cover the same span, or —
when spans are absent — normalise to the same text. The higher-confidence copy
wins and inherits the union of both entity references.

Deduplication runs twice: once after grounding, and once after classification,
because classification itself can create collisions (a `TASK` promoted to
`REMINDER` can land on top of an existing `REMINDER`).

Different types on the same span are **not** merged. "I met Arun yesterday" is
legitimately both a `PAST_EVENT` and a `MEMORY`.

## 6. Temporal interpretation

Lifelog does all date arithmetic itself, from the user's own phrase, relative to
a reference time supplied by the request (or the server clock).

Recognised, roughly in order of confidence:

| Form | Example | Precision |
| --- | --- | --- |
| Same-day words | "today", "aaj" | `DAY` |
| Adjacent days | "yesterday", "tomorrow", "parso" | `DAY` |
| Numeric offsets | "in 3 days", "2 weeks ago", "three days ago" | `DAY` / `WEEK` |
| Modified weekdays | "next Monday", "last Friday" | `DAY` |
| Bare weekdays | "Monday" | `DAY`, lower confidence |
| Coarse periods | "next month", "last year" | `MONTH` / `YEAR` |
| Recurrence | "every Monday" | `RECURRING` |
| Absolute dates | ISO and common day-month forms | `DAY` |

Four rules govern the outcome:

**The raw phrase is always kept.** `temporal.raw` holds what the user said;
`temporal.resolved` holds Lifelog's interpretation. The resolution can be wrong;
the phrase never is. Both are stored, so a later phase can re-resolve without
losing the original.

**Refusing to resolve is a correct answer.** "Kal" means both yesterday and
tomorrow in Hindi. "In a few days" has no defined length. These stay
`resolved: null` with precision `RELATIVE`, and a `TEMPORAL_UNRESOLVED` warning.
Guessing would put a wrong date in a permanent record.

**The longest match wins.** "Next Monday" is matched as a whole, not as "Monday".

**Tense is reconciled between phrase and grammar.** The phrase supplies the date;
grammar supplies the direction. "Today I visited the temple" is dated today but
grammatically past — a same-day phrase carries no direction of its own, so
grammar decides. Where the phrase is directional ("yesterday"), it wins.

## 7. Task and reminder classification

The product rule Lifelog protects most carefully.

> A **task** is something the user has to do.
> A **reminder** is something the user asked to be told about.

Lifelog will send notifications eventually. Notifying someone who never asked is
a worse failure than missing a reminder they did ask for — one is a broken
promise, the other is a betrayal of the tool's restraint. So the rule is
asymmetric and is enforced in code, over whatever the model said:

- A `REMINDER` whose own text contains no request wording ("remind me", "alert
  me", "ping me", "notify me") is **demoted to a `TASK`**, with `explicit: false`
  and a warning. Exception: if the *whole conversation* contains request wording,
  the reminder stands — "remind me about these: pay rent, call mum" licenses both.
- A `TASK` whose text *does* contain request wording is **promoted to a
  `REMINDER`**, with `explicit: true` and a warning.
- A surviving `REMINDER` gets `trigger_at` from its resolved time, if any.

The `explicit` flag records which way the decision went, so a later phase can
decide how aggressively to notify.

## 8. Memory and event classification

Both can come from the same sentence, because they are different kinds of record:
a `PAST_EVENT` is a fact on a timeline, a `MEMORY` is something worth re-reading.
"I met Arun yesterday in Ahmedabad" is both. A memory needs experiential
substance — people, a place, or a feeling — not merely a past-tense verb, or
every mundane sentence becomes a keepsake.

**Type must agree with the resolved date.** A `PAST_EVENT` dated next Tuesday is
incoherent. When they disagree, the date wins, because it came from the user's
own words through Lifelog's own resolver, while the type came from the model:

- future date + `PAST_EVENT`/`MEMORY` → `FUTURE_EVENT`
- past date + `FUTURE_EVENT` → `PAST_EVENT`

Tasks, reminders, feelings and decisions are exempt: they are inherently
forward- or state-oriented, and their tense says nothing about their type.

**Empty facts are pruned.** A `PRESENT_FACT` of fewer than three words carries no
information. A `PRESENT_FACT` that merely restates an obligation already captured
as a `TASK` on the same span is noise in a record the user will one day read.

## 9. Feeling extraction

A `FEELING` is emitted only when an emotional state is actually expressed. Mood
is never inferred from neutral text — "I went to the office" is not a feeling.

**The user's own word is kept.** Lifelog fills in what it can derive — sentiment
polarity and an intensity estimate from its emotion lexicon — but never renames
"gutted" to "sadness". The specific word is the thing that makes a diary entry
worth re-reading.

## 10. Unknown and custom entities

Anything that matters but fits no category becomes kind `OTHER` with the model's
own label preserved in `raw_kind`. Nothing is discarded for being uncategorised.

This is what lets a later phase promote a recurring `raw_kind` — say, "recipe" or
"medication" — into a first-class kind, using real user data rather than a guess
made up front. Dropping unknowns would destroy exactly the evidence needed to
design the categories properly.

## 11. Missing information and follow-up

Two separate ideas, deliberately:

- **Missing information is recorded** whenever an important field is absent. It
  costs the user nothing and is useful later.
- **A question is asked** only when the gap blocks something the user has
  clearly asked Lifelog to do.

A system that can always find something missing will always ask, and a
life-logging tool that interrogates you after every sentence stops getting used.

What counts as a gap, in priority order:

| Priority | Gap | Blocking |
| --- | --- | --- |
| 1 | A reminder with no time at all | Yes — it can never fire |
| 2 | A task whose stated deadline could not be resolved | No |
| 3 | A reminder with a date but no time of day | No |
| 4 | A future event with no date | No |
| 6 / 9 | Model-reported gaps (`HIGH` / other) | No |

Then the restraint rule decides whether to ask at all:

- Intent `REFLECT`, `SMALL_TALK` or `ASK` → **never ask.** A diary entry that
  does not say where it happened is a complete diary entry.
- A blocking gap in something explicitly requested → always ask.
- `SET_REMINDER` → ask for priority ≤ 3.
- `PLAN` or `CAPTURE_TASK` → ask for priority ≤ 4.
- Plain `LOG` → **stay quiet.** The user is recording, not requesting help.

**At most one question is ever returned**, the highest-priority one. Model-reported
gaps are recorded but rank below Lifelog's own, because models over-report what
is missing.

## 12. Confidence

A model's self-reported confidence is close to meaningless — high and flat
regardless of how hard the input was. Lifelog treats it as one weak signal and
adjusts it with evidence it can verify:

| Signal | Adjustment |
| --- | --- |
| Quoted verbatim from the conversation | +0.10 |
| Not quoted (paraphrased or spanless) | −0.15 |
| A time phrase that resolved cleanly | +0.05 |
| A time phrase the user gave that would not resolve | −0.10 |
| References named entities | +0.05 |
| A reminder that passed the explicit-request check | +0.05 |
| A fallback provider answered | −0.10 |
| The output needed repair before parsing | −0.05 |

Intent confidence takes −0.20 when a purposeful intent produced no items at all,
which is self-contradictory.

**Nothing is ever reported above 0.95.** Extraction is an interpretation of
ambiguous natural language, and a 1.0 in the interface invites the user to stop
checking. The conversation text is the only thing Lifelog treats as certain, and
it is stored separately. Below 0.45 an item is flagged as uncertain — flagged,
not hidden. Confidence ranks and marks; it never silently discards.

## 13. User-intent preservation

Running through all of the above: **Lifelog never rewrites what the user meant.**

- The original text is stored before anything else happens and is never edited.
- `source_text` holds the real substring, not the model's copy of it.
- Entity names keep the user's spelling, script and language. Nothing is
  translated or transliterated.
- The user's own emotion word survives; only the derived polarity is added.
- The raw time phrase outlives every resolution attempt.
- An unresolved phrase stays unresolved rather than becoming a plausible date.
- Everything the pipeline overrode, dropped or merged is reported as a warning.

The user's words are the record. Everything Lifelog produces is an opinion about
them, and every opinion is auditable.

---

## Failure behaviour

The algorithm has to keep working when its inputs misbehave.

| Failure | Behaviour |
| --- | --- |
| Provider timeout or rate limit | Retry with backoff, then fall back to the offline engine; `degraded: true` |
| Every provider fails | The request fails with a mapped error; the conversation is already stored |
| Output is not valid JSON | Recover it — strip fences, drop trailing commas, close structures truncated by a token limit |
| Output is not JSON at all | Treat as a provider failure and fall back |
| Fields are the wrong type | Normalisation coerces or defaults them |
| The model invents content | Grounding drops it |
| The model computes a date | The date is discarded; the phrase is re-resolved |
| The pipeline produces an invalid analysis | Throw. This is a Lifelog bug, not a model failure, and must fail loudly. |

---

## Related documents

- [`ai-engine.md`](ai-engine.md) — how the model is called, and how to replace it
- [`memory.md`](memory.md) — why the raw conversation is authoritative
- [`testing.md`](testing.md) — the scenarios that hold these rules in place
- [`decision.md`](decision.md) — why the rules are the way they are
