# Error Handling

Two audiences, two messages, one envelope.

> **Clients get a code, a safe message and a request id.
> Operators get the full detail in a redacted log line.**

The request id is the join between them: a user can quote it in a bug report and
an operator can find the real cause, without either of them handling the user's
private text.

Implementation: [`backend/src/errors/app-error.ts`](../backend/src/errors/app-error.ts)
and [`handler.ts`](../backend/src/errors/handler.ts).

---

## The envelope

Every error response, whatever went wrong:

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

`code` is what a client branches on. `message` is for a person to read. `details`
appears for validation failures only. `requestId` is always present.

## The taxonomy

| Code | Status | Public message | Retryable |
| --- | --- | --- | --- |
| `VALIDATION_ERROR` | 400 | The request body was not valid. | No |
| `EMPTY_INPUT` | 400 | Please provide some text to analyze. | No |
| `INPUT_TOO_LARGE` | 413 | That message is too long to analyze in one request. | No |
| `NOT_FOUND` | 404 | The requested resource does not exist. | No |
| `RATE_LIMITED` | 429 | Too many requests. Please slow down. | After a wait |
| `AI_INVALID_OUTPUT` | 502 | Analysis could not be completed for that message. Please try again. | Yes |
| `AI_UNAVAILABLE` | 503 | Conversation analysis is temporarily unavailable. Please try again shortly. | Yes |
| `DATABASE_ERROR` | 503 | Lifelog could not save that right now. Please try again shortly. | Yes |
| `AI_TIMEOUT` | 504 | Analyzing that message took too long. Please try again. | Yes |
| `INTERNAL_ERROR` | 500 | Something went wrong on our side. | Yes |

`AppError` carries `message` (for the log) and `publicMessage` (for the wire) as
**separate fields**. They are separate so that a stack trace, a SQL fragment or an
upstream provider error cannot leak into an API response by accident — not by
being careful at each throw site, but structurally.

---

## What each error class looks like in practice

### Validation errors

The request body is parsed with Zod in the controller. Two cases get their own
code rather than a generic validation failure, because a client can give the user
a much better message: `EMPTY_INPUT` for empty or whitespace-only text, and
`INPUT_TOO_LARGE` past the 20,000-character ceiling.

Oversized bodies are also rejected at the transport layer by Fastify's
`bodyLimit`, before any parsing happens.

Nothing is stored for a rejected request. There is no half-written conversation.

### AI errors

Provider failures are raised as `AiProviderError` with a kind, and the registry
decides what is retryable:

| Kind | Retryable | Mapped to |
| --- | --- | --- |
| `TIMEOUT` | yes | `AI_TIMEOUT` |
| `RATE_LIMITED` | yes | `RATE_LIMITED` |
| `UNAVAILABLE` | yes | `AI_UNAVAILABLE` |
| `NETWORK` | yes | `AI_UNAVAILABLE` |
| `UPSTREAM` | yes | `AI_UNAVAILABLE` |
| `BAD_OUTPUT` | no | `AI_INVALID_OUTPUT` |
| `AUTH` | **no** | `AI_UNAVAILABLE` |

Auth failures are never retried — a bad key will still be bad in 250ms, and
retrying it just burns the rate limit.

**Most provider failures never become an API error at all.** Retries run first
(250ms → 500ms → 1s), then the offline rule engine answers, and the client gets a
200 with `meta.degraded: true` and a `PROVIDER_DEGRADED` warning. An error is
returned only when *every* provider fails.

### Malformed AI output

Not treated as an error until recovery has been tried. `ai/json.ts` strips
markdown fences, ignores prose around the object, tolerates trailing commas, and
closes structures truncated by a token limit. After parsing, the loose schema
accepts almost anything and normalisation repairs it.

Only when nothing parses does it become `BAD_OUTPUT`, and even then the fallback
provider gets a turn first.

### Database errors

The two cases are deliberately asymmetric:

**Storing the conversation fails → the request fails** with `DATABASE_ERROR`.
Lifelog will not analyse text it cannot keep, because an analysis with nothing to
point back at is unverifiable.

**Storing the analysis fails → the request succeeds** with `persisted: false`,
`analysisId` as the all-zero UUID, and an `ANALYSIS_NOT_PERSISTED` warning. The
conversation is safe and the interpretation can be recomputed later. Losing the
user's words is unacceptable; losing a derived opinion is annoying.

Connection-level failures are recognised by SQLSTATE prefix (`08`, `53`, `57P`)
and by socket error codes (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`) so they are
reported as `DATABASE_ERROR` rather than a generic 500.

When no database is configured at all, the analyze endpoint is registered as a
stub that returns 503. Failing clearly at the boundary beats pretending to store
things.

### Network and timeout errors

Every provider call races a hard deadline (`AI_TIMEOUT_MS`, default 5s) in
addition to `AbortSignal`. Free-tier hosts sometimes accept the socket and then
stall without delivering a body. Retry backoff is bounded at 2s; timeouts and
rate limits are not retried so a saturated free queue cannot multiply wait time.
The offline fallback is warmed in parallel with the primary so degradation does
not add a second sequential wait.

### Internal errors

Anything unrecognised becomes `INTERNAL_ERROR`, logged with its stack, and
returned as "Something went wrong on our side." — no detail at all.

One case throws deliberately: if the pipeline produces an analysis that fails the
strict schema, that is a **Lifelog bug**, not a model failure. The model's output
was normalised several stages earlier, so a validation failure at the end means
one of Lifelog's own stages is wrong. It fails loudly rather than degrading,
because a quiet failure here would corrupt records.

---

## What never reaches a client

- Stack traces
- File paths and module names
- SQL statements, table names, SQLSTATE codes
- Connection strings
- Provider hostnames, model identifiers on failure, upstream error bodies
- API keys, in any form
- Any part of another user's data

Enforced in three places: the split between `message` and `publicMessage`; the
single error boundary that all errors pass through; and a test that asserts no
public message contains an internal marker.

## What operators get

Every error is logged with the request id, the code, the status, the method, the
URL, and the internal message **passed through `redactSecrets()`** — because an
upstream error message can contain a key or a fragment of the user's
conversation.

5xx logs at `error` with the stack. 4xx logs at `warn` without one; a client
mistake is not an incident.

Conversation content is never logged, at any level. See
[`privacy-security.md`](privacy-security.md).

---

## Warnings are not errors

A 200 response can carry `warnings`, and usually does. They record what the
pipeline overrode, dropped, merged or repaired: an ungrounded entity removed, a
reminder demoted to a task, a duplicate merged, a fallback provider used.

They are the first thing to read when a result looks wrong. The full list of
codes is in [`agent.md`](agent.md).

Warnings never change the status code. Lifelog succeeded; it is telling you how.

---

## Adding an error code

1. Add it to `ErrorCode`, `STATUS_BY_CODE` and `PUBLIC_MESSAGE_BY_CODE` in
   `app-error.ts`. TypeScript will not let you forget the last two.
2. Write the public message for the user, not the developer. Say what happened
   and whether to retry. Never name a component.
3. Add it to the table above and to [`api.md`](api.md).
4. Add it to the assertion in `tests/unit/security.test.ts` that checks every
   public message is free of internal detail.
