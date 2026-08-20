# AI Engine

How Lifelog uses an AI model, what it deliberately does not ask a model to do,
and how to replace the model without redesigning anything.

The one-sentence summary: **the model is a component, and the component is
swappable.** Everything in this document is about keeping that true.

---

## Current setup

| | |
| --- | --- |
| Default provider | `auto` — OpenRouter when a key exists, otherwise the local rule engine |
| Hosted provider | OpenRouter, OpenAI-compatible `/chat/completions` |
| Default model | `google/gemma-4-26b-a4b-it:free` |
| Temperature | 0.1 |
| Timeout | 5s (then offline fallback; free-tier queues often stall longer) |
| Retries | 0 by default — timeouts/rate-limits are not retried |
| Fallback | `local` — Lifelog's own offline rule engine (warmed in parallel) |
| SDK | None. Plain `fetch`. |

Configured by `AI_PROVIDER`, `AI_MODEL`, `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`,
`AI_TEMPERATURE`. The key belongs in `secrets/API-KEYS.md`, never in `.env`.

---

## Why Gemma, and why OpenRouter

**OpenRouter** because it puts dozens of models behind one OpenAI-compatible
endpoint. Changing model is a config value rather than a new adapter, which
directly serves the replaceability requirement. The alternative — a vendor SDK —
would have pulled a large dependency into the project and made "swap the model"
mean "rewrite the adapter."

**Gemma 3 27B** because Phase 1 needs a model that follows a JSON schema
reliably, handles code-switched Indian-English input, and is cheap enough to run
on every message someone writes about their day. It is an open-weight model, so
if hosting economics change it can be self-hosted without redesign. It is not
the strongest model available; it does not need to be, because Lifelog checks
everything it says.

Neither choice is load-bearing. Both have decision entries in
[`decision.md`](decision.md).

---

## What the model is asked to do

One call per conversation. It receives system instructions
(`intelligence/prompt.ts`) and a user message containing the reference time and
the user's text, and returns a single JSON object.

It is asked for the things a model genuinely does better than code:

- what the message means, and which spans carry which facts
- which entities are mentioned, and how they relate to the user
- a first-pass type for each item, and a first-pass intent
- the *phrase* the user used for a time — never the date
- an opinion on what is missing

## What the model is never asked to do

Each of these is computed in code, because a model gets it subtly and invisibly
wrong:

| Not asked | Why | Where it happens instead |
| --- | --- | --- |
| Date arithmetic | A wrong date in a life record is invisible until it matters | `intelligence/temporal.ts` |
| Assigning ids | Duplicate or dangling ids corrupt entity links silently | `intelligence/normalize.ts` |
| Character offsets | Models cannot count characters | `intelligence/grounding.ts` |
| Calibrated confidence | Self-reported confidence is high and flat | `intelligence/confidence.ts` |
| The final item type | Type labels drift between model versions | `intelligence/classify.ts` |
| Whether to ask the user something | Models over-ask; restraint is a product rule | `intelligence/follow-up.ts` |

And the rule that keeps this honest: **every instruction in the prompt must be
enforceable downstream.** The prompt tells the model to ground every item — and
grounding is then verified in code. The prompt tells it not to compute dates —
and any date it computes is discarded. An instruction that cannot be checked is
a wish, and the model will eventually stop honouring it without anyone noticing.

---

## The provider interface

```ts
interface AiProvider {
  readonly name: string;
  readonly model: string;
  isAvailable(): boolean;
  analyze(request: AnalysisRequest): Promise<ProviderResult>;
}
```

An adapter translates a Lifelog request into one model's dialect and the reply
back into loose JSON. It contains **no product rules**. The instructions arrive
in the request already built by the intelligence layer; a provider relays them
verbatim and must never edit, extend or reinterpret them, or Lifelog's rules
would start to differ per model.

### The three implementations

**`openrouter`** — hosted models. Maps HTTP failures onto `AiProviderError` kinds
(`TIMEOUT`, `AUTH`, `RATE_LIMITED`, `UNAVAILABLE`, `NETWORK`, `BAD_OUTPUT`,
`UPSTREAM`) so the registry can decide what is retryable. Its parsing is tolerant
by design — see below.

**`local`** — Lifelog's own offline rule engine, reading the same lexicons the
intelligence layer uses. It exists so that **Lifelog works with no API key and no
network**: a new contributor can clone the repo and see the whole system function
in one command, and a user's message is never lost to a provider outage.

It is deliberately simpler than a hosted model. It handles direct, well-formed
sentences; paraphrase, irony and unusual phrasing degrade it. That is the correct
trade — it is a floor, not a competitor. When you see a weak extraction in
development, check `meta.provider` before blaming the pipeline.

**`mock`** — test only. Scriptable to return a fixed payload, raw text, a
specific error kind, or a delay. Every failure-path test uses it. No test ever
calls a real model.

### Selection and failover — `ai/registry.ts`

| `AI_PROVIDER` | Primary | Fallback |
| --- | --- | --- |
| `auto` (default) | OpenRouter if a key exists, else local | local, when OpenRouter is primary |
| `openrouter` | OpenRouter | local |
| `local` | local | none |
| `mock` | local | none (tests inject the mock directly) |

Retry policy lives in the registry, not in the adapters, so every provider gets
identical behaviour and an adapter stays a thin translation layer. Retryable
errors back off 250ms → 500ms → 1s. Auth failures are never retried — a bad key
will still be bad in a second.

When the fallback answers, the result is marked `degraded: true`, the response
carries `meta.degraded` and a `PROVIDER_DEGRADED` warning naming the failed
provider and the reason, and confidence is penalised. Degradation is always
recorded, never hidden.

Every attempt — provider, model, status, attempt number, latency, error class —
is recorded in `ai_invocations`. Never the prompt, never the key, never the
response.

---

## Handling unreliable output

Models return almost-JSON. `ai/json.ts` recovers from:

- markdown code fences
- prose before or after the object
- trailing commas
- **truncation by a token limit** — the parser tracks open braces and brackets on
  a stack and closes them in reverse order, so a partially complete analysis is
  still usable. A trailing fragment such as `"ti` is dropped rather than guessed at.

If nothing parses, the provider raises `BAD_OUTPUT` and the registry falls back.
After parsing, `RawModelAnalysisSchema` accepts the loose shape and normalisation
repairs it. The strict `AnalysisSchema` is applied only at the very end — and if
*that* fails, it is a Lifelog bug and it throws.

---

## Cost and latency

One model call per conversation. No streaming, no multi-turn, no chain of
thought, no caching. A conversation is one prompt and one response, so cost is
roughly linear in message length and predictable.

Typical hosted latency on a short message is a few hundred milliseconds to a
couple of seconds when the free endpoint is healthy. Free-tier queues can stall
far longer; the 5s timeout exists so the UI never hangs — Lifelog then answers
with the offline engine (`meta.degraded: true`). The local provider answers in
single-digit milliseconds, and it is warmed in parallel with the hosted call so
degradation does not add a second wait. The whole test suite runs against local.

The largest available cost lever is not the model — it is not calling one.
Lifelog's rule engine already handles a meaningful share of simple messages
("remind me to call mum tomorrow"), and a future phase could route those away
from a hosted model entirely. That option exists *because* the rules are in code.

---

## Known limitations of the current model

- **Long messages lose fidelity.** Extraction quality drops on inputs well past a
  few hundred words; the tail of a very long message tends to be summarised
  rather than segmented.
- **Paraphrasing instead of quoting.** Gemma sometimes rewrites `source_text`.
  Grounding catches it: close paraphrases survive with reduced confidence, distant
  ones are dropped.
- **Over-splitting.** It occasionally emits the same fact under two types.
  Deduplication handles it.
- **Computing dates despite being told not to.** It happens. Any date it computes
  is discarded before it can reach the database.
- **Over-reporting missing information.** Model-reported gaps are recorded but
  rank below Lifelog's own and rarely become the question.

Every one of these is contained by a pipeline stage. That containment is the
reason a mid-tier model is sufficient.

---

## Replacing the model

**Changing model on the same provider** — set `AI_MODEL`. Nothing else. Then run
the behaviour suite, because it asserts Lifelog's guarantees rather than any
model's wording, and it will tell you whether the new model holds up.

**Adding a new provider** — implement `AiProvider` in `backend/src/ai/`, wire it
into `buildAiRuntime()`, extend the `AI_PROVIDER` enum, add its key name to the
secrets allowlist and the scanner rules, and record the decision. The adapter
must contain no product rules; if the word "reminder" appears in it, something
belongs in `intelligence/` instead. Step-by-step in
[`../agents/workflow.md`](../agents/workflow.md).

**Self-hosting** — Gemma is open-weight. Point `OPENROUTER_BASE_URL` at any
OpenAI-compatible server, or write a small adapter. No other layer changes.

### The test that keeps this honest

> If replacing the model requires editing a file outside `backend/src/ai/`, the
> architecture has been violated somewhere and the fix belongs there, not in a
> workaround.

Concretely, nothing outside `backend/src/ai/` may import a vendor SDK, name a
model, or branch on which provider answered. The intelligence layer receives
loose JSON and does not know or care where it came from — which is why the entire
test suite can run with no network access at all.
