# Functionality

What the system actually does today. Nothing here describes a future capability
as if it worked.

Status labels used throughout:

| Label | Meaning |
| --- | --- |
| **IMPLEMENTED** | Works, has tests, can be relied on |
| **PARTIAL** | Works within stated limits; the limits are documented |
| **EXPERIMENTAL** | Works but the design may change |
| **PLANNED** | Designed for, not built |
| **NOT IMPLEMENTED** | Absent. Do not assume it. |

---

## The whole of Phase 1, in one line

**Input:** one message of ordinary human text.
**Process:** conversation understanding.
**Output:** structured life information, plus the original text, both stored.

Everything below is a detail of that.

---

## Conversation handling

| Capability | Status | Notes |
| --- | --- | --- |
| Accept free-form text via HTTP | IMPLEMENTED | `POST /api/v1/conversations/analyze` |
| Preserve the original text exactly | IMPLEMENTED | Written first, byte-for-byte, never edited. Verified by test. |
| Reject empty and whitespace-only input | IMPLEMENTED | 400, nothing stored |
| Enforce a length ceiling | IMPLEMENTED | 20,000 characters; 413 beyond it |
| Split into meaningful segments | IMPLEMENTED | Sentences, and clauses when a sentence carries several facts. Offsets preserved. |
| Handle abbreviations and decimals when splitting | IMPLEMENTED | "Dr. Sharma" and "3.5" do not end a sentence |
| Multi-turn conversation threads | NOT IMPLEMENTED | Each request is independent. Phase 2. |
| Attachments, audio, images | NOT IMPLEMENTED | Text only. |

## Intent detection

| Capability | Status | Notes |
| --- | --- | --- |
| Nine intents | IMPLEMENTED | `LOG`, `PLAN`, `CAPTURE_TASK`, `SET_REMINDER`, `REFLECT`, `ASK`, `CORRECT`, `SMALL_TALK`, `UNKNOWN` |
| Override intent from extracted items | IMPLEMENTED | An explicit reminder forces `SET_REMINDER` regardless of the model's label |
| Answering an `ASK` | NOT IMPLEMENTED | Intent is detected; recall is Phase 4. |

## Entity extraction

| Capability | Status | Notes |
| --- | --- | --- |
| People | IMPLEMENTED | Including relation when stated ("my brother Arun") |
| Places | IMPLEMENTED | |
| Organisations | IMPLEMENTED | |
| Objects and topics | IMPLEMENTED | |
| Event names | IMPLEMENTED | |
| Unknown / custom kinds | IMPLEMENTED | Kind becomes `OTHER`, the original label is kept in `raw_kind`. Never dropped. |
| Merge duplicate mentions | IMPLEMENTED | Same person under different casing or ids becomes one entity with aliases |
| Cross-conversation identity | NOT IMPLEMENTED | "Arun" in two conversations is two rows. Phase 5. |
| Pronoun resolution across sentences | PARTIAL | Direct attachment only. "He said" does not reliably link back to a person named two sentences earlier. |

## Item extraction

All eight item types are extracted. See [`glossary.md`](glossary.md) for what
each one means.

| Capability | Status | Notes |
| --- | --- | --- |
| `MEMORY` | IMPLEMENTED | Experiential substance required, not just past tense |
| `PAST_EVENT` | IMPLEMENTED | |
| `PRESENT_FACT` | IMPLEMENTED | Empty and restated-obligation facts are pruned |
| `FUTURE_EVENT` | IMPLEMENTED | |
| `TASK` | IMPLEMENTED | With status, priority, and grammatical `display_text` |
| `REMINDER` | IMPLEMENTED | Only when the user explicitly asked to be reminded; grammatical `display_text` |
| `DECISION` | IMPLEMENTED | With alternatives when the user mentioned any |
| `FEELING` | IMPLEMENTED | With emotion word, sentiment and intensity |
| Behavior stance | IMPLEMENTED | First-hand message stance (`VENT`/`PLAN`/…), not a clinical profile |
| Inferred emotional impact | IMPLEMENTED | Separate from FEELING; always `inferred: true` with basis spans |
| Algorithm draft + AI teacher | IMPLEMENTED | Local draft first; Gemma fills gaps; code reconciles |
| Pattern-weight relearn | IMPLEMENTED | Runtime weights + lexicon proposals; never auto-edits source |
| One sentence → several items | IMPLEMENTED | "I met Arun yesterday and I need to send him the file" yields a past event, a memory and a task |
| Task/reminder distinction enforced in code | IMPLEMENTED | A model-labelled reminder with no request wording is demoted to a task, and vice versa. Recorded as a warning. |
| Item completion, editing, deletion | NOT IMPLEMENTED | Phase 3. |

## Temporal understanding

| Capability | Status | Notes |
| --- | --- | --- |
| Relative days | IMPLEMENTED | "yesterday", "today", "tomorrow", "day before yesterday" |
| Numeric offsets | IMPLEMENTED | "in 3 days", "2 weeks ago", and spelled-out forms ("three days ago") |
| Weekdays | IMPLEMENTED | "next Monday", "last Friday", and bare "Monday" as the upcoming one, at lower confidence |
| Recurrence | PARTIAL | "every Monday" is recorded as a recurrence string. Nothing expands it into occurrences yet. |
| Absolute dates | PARTIAL | Common ISO and day-month forms. Unusual formats stay unresolved. |
| Times of day | PARTIAL | Recognised when explicit; a date without a time has precision `DAY`. |
| Hinglish time words | IMPLEMENTED | "kal", "aaj", "parso" — "kal" is direction-ambiguous, so grammar decides |
| Several dates in one message | IMPLEMENTED | Each item resolves independently |
| Refuse to guess | IMPLEMENTED | An unresolvable phrase is kept raw with `resolved: null`. This is the correct behaviour, not a gap. |
| Timezone-aware resolution | NOT IMPLEMENTED | The IANA zone is stored; arithmetic is UTC. Phase 3. |

## Hallucination prevention

| Capability | Status | Notes |
| --- | --- | --- |
| Entity grounding | IMPLEMENTED | An entity whose name is absent from the text is dropped |
| Item grounding | IMPLEMENTED | `source_text` must appear in the message; the stored copy is the real substring |
| Paraphrase tolerance | IMPLEMENTED | Below 50% content-word overlap the item is dropped; above it, kept with reduced confidence and a warning |
| Temporal grounding | IMPLEMENTED | A time phrase the user never wrote is discarded |
| Reference hygiene | IMPLEMENTED | Items may only reference entities that survived |
| Empty result as a valid answer | IMPLEMENTED | Small talk yields no items rather than invented ones |

## Missing information and follow-up

| Capability | Status | Notes |
| --- | --- | --- |
| Detect genuinely missing fields | IMPLEMENTED | Reminder with no time, future event with no date, task with an unresolvable deadline |
| Record missing information without asking | IMPLEMENTED | Recording is cheap; asking is not |
| Ask at most one question | IMPLEMENTED | Ever. Not per turn — per analysis, and there is one analysis per message. |
| Stay silent on diary entries | IMPLEMENTED | `REFLECT`, `SMALL_TALK` and `ASK` are never interrogated |
| Stay silent on plain logs | IMPLEMENTED | Recording is not a request to be helped |
| Accept an answer to a follow-up | NOT IMPLEMENTED | The question is returned and stored; feeding an answer back is Phase 2. |

## Confidence

| Capability | Status | Notes |
| --- | --- | --- |
| Evidence-based calibration | IMPLEMENTED | Model self-reports are treated as one weak signal, then adjusted |
| Never report certainty | IMPLEMENTED | Capped at 0.95 |
| Low-confidence flagging | IMPLEMENTED | Threshold 0.45, surfaced in the console |

## Storage

| Capability | Status | Notes |
| --- | --- | --- |
| Store the conversation | IMPLEMENTED | Before analysis. A failure here fails the request. |
| Store the analysis | IMPLEMENTED | Whole, as JSON, plus normalised child rows |
| Store segments, entities, items, links, follow-ups | IMPLEMENTED | One transaction |
| Store provider metadata | IMPLEMENTED | Which provider, which model, degraded, latency |
| Survive a failed analysis write | IMPLEMENTED | Returns the analysis with `persisted: false` and a warning |
| Read stored data back over HTTP | NOT IMPLEMENTED | No `GET` endpoints yet. Phase 2. |
| Delete or export a conversation | NOT IMPLEMENTED | Phase 8. |

## AI provider handling

| Capability | Status | Notes |
| --- | --- | --- |
| Provider abstraction | IMPLEMENTED | Three implementations behind one interface |
| OpenRouter provider | IMPLEMENTED | Default model `google/gemma-4-26b-a4b-it:free` |
| Offline rule engine | IMPLEMENTED | Lifelog works with no key and no network |
| Mock provider | IMPLEMENTED | Test-only; scriptable failures |
| Retry with backoff | IMPLEMENTED | Retryable errors only, 250ms → 500ms → 1s |
| Failover and degradation reporting | IMPLEMENTED | `meta.degraded` plus a warning naming the failed provider |
| Recover malformed JSON | IMPLEMENTED | Markdown fences, trailing commas, prose wrappers, token-limit truncation |
| Streaming responses | NOT IMPLEMENTED | Analysis is a single request/response. |
| Response caching | NOT IMPLEMENTED | No requirement yet. |

## Language support

| Capability | Status | Notes |
| --- | --- | --- |
| English | IMPLEMENTED | |
| Code-switched text (Hinglish and similar) | PARTIAL | Labelled `mixed`, extraction proceeds, original script preserved. Rule-engine coverage of non-English grammar is thin; a hosted model handles it better. |
| Non-Latin scripts | PARTIAL | Stored and labelled correctly, never transliterated. Extraction quality depends on the provider. |
| Translation | NOT IMPLEMENTED | Deliberately. The user's own words are the record. |

## Operations

| Capability | Status | Notes |
| --- | --- | --- |
| Health endpoint | IMPLEMENTED | Reports database and provider state without leaking either |
| Structured logging with redaction | IMPLEMENTED | Conversation content never logged |
| Rate limiting | IMPLEMENTED | 60 requests/minute by default, in-memory |
| Security headers and CORS allowlist | IMPLEMENTED | Helmet; explicit origin list |
| Authentication | NOT IMPLEMENTED | Phase 8. Do not deploy publicly. |
| Encryption at rest | NOT IMPLEMENTED | Phase 8. |
| Metrics and tracing | NOT IMPLEMENTED | `ai_invocations` records the raw material for it. |

---

## Test console

The React app in `frontend/` is a testing tool, not the product UI. It accepts
text, shows a loading state, renders entities, every item type grouped, the
follow-up question, missing information, warnings and raw JSON. It talks to the
backend API and nothing else — no key, no model, no database. It will be
replaced entirely.
