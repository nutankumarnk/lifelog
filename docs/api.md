# API

The public HTTP contract.

**Treat this as important.** The mobile client will consume exactly these shapes,
and Phase 1 has no version negotiation, so a change here is a breaking change
until Phase 8 adds one. Any change needs an entry in [`decision.md`](decision.md)
and [`changelog.md`](changelog.md).

| | |
| --- | --- |
| Base URL (local) | `http://localhost:4319` |
| Version prefix | `/api/v1` |
| Content type | `application/json` |
| Authentication | **None in Phase 1.** Planned for Phase 8. |
| Rate limit | 60 requests/minute per IP by default |
| Max body | 20,000 characters of text |

Schemas: [`backend/src/schemas/api.schema.ts`](../backend/src/schemas/api.schema.ts)
and [`analysis.schema.ts`](../backend/src/schemas/analysis.schema.ts).

---

## POST /api/v1/conversations/analyze

Analyses one message and stores both the message and the analysis.

This is the only endpoint that does work. Everything Lifelog does in Phase 1
happens behind it.

### Request

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `text` | string | yes | 1–20,000 characters, not whitespace-only. Stored verbatim. |
| `occurred_at` | ISO 8601 datetime with offset | no | The client's wall clock. Relative phrases like "yesterday" resolve against it. Defaults to server time. |
| `timezone` | string | no | IANA zone, e.g. `Asia/Kolkata`. Recorded; not yet applied to arithmetic. |
| `client` | object | no | `{ app, version, platform }`. Free-form, never trusted, never used for authorization. |

```json
{
  "text": "I met Arun yesterday in Ahmedabad and I need to send him the project files by Friday.",
  "occurred_at": "2026-03-12T09:30:00Z",
  "timezone": "Asia/Kolkata"
}
```

### Response — 200

| Field | Type | Notes |
| --- | --- | --- |
| `conversationId` | UUID | The stored conversation. Always present. |
| `analysisId` | UUID | All-zero UUID when the analysis was produced but could not be stored. |
| `analysis` | object | The structured reading. See below. |
| `meta.provider` | string | `openrouter`, `local` or `mock` |
| `meta.model` | string | Model identifier that answered |
| `meta.degraded` | boolean | True when a fallback provider answered |
| `meta.persisted` | boolean | False when the analysis could not be stored |
| `meta.latency_ms` | integer | End-to-end analysis time |
| `meta.schema_version` | string | Version of the analysis contract |

#### The `analysis` object

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | string | `1.0.0` |
| `intent` | enum | One of nine. See [`glossary.md`](glossary.md). |
| `intent_confidence` | number | 0–1, never above 0.95 |
| `language` | string | BCP-47-ish tag, or `mixed` for code-switched text |
| `summary` | string | One neutral sentence |
| `segments` | array | The conversation split into pieces, with character spans |
| `entities` | array | People, places, organisations, objects, topics, unknowns |
| `items` | array | The extracted life information |
| `missing_information` | array | Important fields that are absent |
| `follow_up` | object or null | **At most one question, ever** |
| `warnings` | array | What the pipeline overrode, dropped or repaired |

Every item carries `type`, `title`, `summary`, verbatim `source_text`, a
`source_span` into the original text (null for a paraphrase), `segment_index`,
a `temporal` block, `entity_ids`, type-specific `details`, and a calibrated
`confidence`.

The `temporal` block always keeps both the user's phrase and Lifelog's reading of
it: `raw` is what they wrote, `resolved` is the ISO date, and `resolved` may be
`null` when the phrase is genuinely ambiguous. See [`algorithm.md`](algorithm.md).

#### Example response

Abbreviated — `segments` and unchanged defaults omitted for readability. This is
real output from the request above.

```json
{
  "conversationId": "9c1c5f6e-1f3f-4a6a-9a7f-1a2b3c4d5e6f",
  "analysisId": "2b8f0f5a-7d1e-4c2b-8f3a-9e0d1c2b3a45",
  "analysis": {
    "schema_version": "1.0.0",
    "intent": "CAPTURE_TASK",
    "intent_confidence": 0.8,
    "language": "en",
    "summary": "I met Arun yesterday in Ahmedabad and I need to send him the project files by Friday",
    "entities": [
      {
        "id": "e1",
        "kind": "PERSON",
        "raw_kind": null,
        "name": "Arun",
        "normalized_name": "arun",
        "aliases": [],
        "relation": null,
        "mentions": [{ "start": 6, "end": 10 }],
        "confidence": 0.65
      },
      {
        "id": "e2",
        "kind": "PLACE",
        "name": "Ahmedabad",
        "normalized_name": "ahmedabad",
        "mentions": [{ "start": 24, "end": 33 }],
        "confidence": 0.65
      }
    ],
    "items": [
      {
        "id": "i1",
        "type": "PAST_EVENT",
        "title": "I met Arun yesterday in Ahmedabad",
        "source_text": "I met Arun yesterday in Ahmedabad",
        "source_span": { "start": 0, "end": 33 },
        "segment_index": 0,
        "temporal": {
          "tense": "PAST",
          "raw": "yesterday",
          "resolved": "2026-03-11",
          "precision": "DAY",
          "recurrence": null,
          "timezone": "Asia/Kolkata",
          "confidence": 0.95
        },
        "entity_ids": ["e1", "e2"],
        "details": {},
        "confidence": 0.95
      },
      {
        "id": "i2",
        "type": "MEMORY",
        "title": "I met Arun yesterday in Ahmedabad",
        "source_text": "I met Arun yesterday in Ahmedabad",
        "source_span": { "start": 0, "end": 33 },
        "temporal": { "tense": "PAST", "raw": "yesterday", "resolved": "2026-03-11", "precision": "DAY" },
        "entity_ids": ["e1", "e2"],
        "details": { "significance": 0.5 },
        "confidence": 0.9
      },
      {
        "id": "i3",
        "type": "TASK",
        "title": "I need to send him the project files by Friday",
        "source_text": "I need to send him the project files by Friday.",
        "source_span": { "start": 38, "end": 85 },
        "segment_index": 1,
        "temporal": {
          "tense": "FUTURE",
          "raw": "by Friday",
          "resolved": "2026-03-13",
          "precision": "DAY",
          "confidence": 0.8
        },
        "entity_ids": [],
        "details": { "status": "OPEN", "priority": "NORMAL" },
        "confidence": 0.95
      }
    ],
    "missing_information": [],
    "follow_up": null,
    "warnings": []
  },
  "meta": {
    "provider": "local",
    "model": "lifelog-rules-v1",
    "degraded": false,
    "persisted": true,
    "latency_ms": 4,
    "schema_version": "1.0.0"
  }
}
```

One sentence produced three items — a past event, a memory and a task — because
they are three different kinds of record about the same moment.

#### Example with a follow-up

Request: `{"text": "Remind me to call the dentist next Monday."}`

```json
{
  "intent": "SET_REMINDER",
  "items": [
    {
      "id": "i1",
      "type": "REMINDER",
      "title": "Remind me to call the dentist next Monday",
      "temporal": { "tense": "FUTURE", "raw": "next Monday", "resolved": "2026-03-16", "precision": "DAY" },
      "details": { "status": "OPEN", "explicit": true, "trigger_at": "2026-03-16" },
      "confidence": 0.95
    }
  ],
  "missing_information": [
    {
      "field": "reminder_time_of_day",
      "about_item_id": "i1",
      "reason": "The reminder has a date but no time of day.",
      "importance": "MEDIUM"
    }
  ],
  "follow_up": {
    "question": "What time on next Monday should I remind you?",
    "reason": "The reminder has a date but no time of day.",
    "missing_fields": ["reminder_time_of_day"],
    "blocking": false
  }
}
```

`explicit: true` records that the user actually asked to be reminded. Had they
written "I need to call the dentist", this would be a `TASK`, no question would
be asked, and a `REMINDER_DEMOTED` warning would say why.

There is no endpoint for answering a follow-up in Phase 1. The question is
returned and stored; feeding an answer back is Phase 2.

### Errors

| Status | Code | Cause |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body failed schema validation |
| 400 | `EMPTY_INPUT` | `text` was empty or whitespace only |
| 413 | `INPUT_TOO_LARGE` | `text` exceeded 20,000 characters |
| 429 | `RATE_LIMITED` | Too many requests |
| 502 | `AI_INVALID_OUTPUT` | No provider produced usable output |
| 503 | `AI_UNAVAILABLE` | Every provider failed |
| 503 | `DATABASE_ERROR` | The conversation could not be stored |
| 504 | `AI_TIMEOUT` | Analysis took too long |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

A `DATABASE_ERROR` here means the *conversation* could not be stored, and the
request is refused — Lifelog will not analyse text it cannot keep. A failure to
store the *analysis* is different: the request succeeds with `persisted: false`
and an `ANALYSIS_NOT_PERSISTED` warning.

Full taxonomy: [`error-handling.md`](error-handling.md).

---

## GET /health

Reports whether Lifelog can do its job, not merely whether the process is alive.
Unauthenticated, so it never reveals connection strings, key values or provider
hostnames.

### Response — 200, or 503 when `status` is `error`

```json
{
  "status": "ok",
  "uptime_s": 128.4,
  "version": "1.0.0",
  "checks": {
    "database": "ok",
    "ai_provider": "ok"
  }
}
```

| Field | Values | Meaning |
| --- | --- | --- |
| `status` | `ok` / `degraded` / `error` | `degraded`: still answering, not at full quality. `error`: a core dependency is gone (503). |
| `checks.database` | `ok` / `error` / `skipped` | `skipped` when no database is configured |
| `checks.ai_provider` | `ok` / `degraded` / `error` | `degraded` when only the fallback is available |

---

## Conventions

**Errors** always use one envelope, whatever went wrong:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body was not valid.",
    "details": [{ "path": "text", "message": "text must not be empty" }],
    "requestId": "req-12"
  }
}
```

`message` is written for a person to read. `code` is what a client should branch
on. `details` appears for validation failures only. `requestId` correlates with
the server log — quote it in a bug report; an operator can find the real cause
without either of you handling the user's text.

**Naming.** Request and response envelopes use `camelCase` (`conversationId`).
Fields inside `analysis` use `snake_case` (`source_text`, `follow_up`) because
that is the shape the model is asked to produce and the shape stored as JSON.
The inconsistency is deliberate — it marks the boundary between Lifelog's own
API and the analysis payload.

**Unknown fields** in a request are ignored, not rejected. Additive fields in a
response are not a breaking change; a client must tolerate them.

**CORS** is an explicit origin allowlist (`CORS_ORIGINS`), defaulting to the
local test console only.

---

## Not in Phase 1

No read endpoints (`GET /conversations`, search, recall), no update or delete, no
follow-up answer endpoint, no authentication, no pagination, no streaming, no
webhooks. See [`roadmap.md`](roadmap.md).
