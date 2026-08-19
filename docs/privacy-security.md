# Privacy and Security

The data-handling philosophy, and how Lifelog treats what it is given.

[`security-checklist.md`](security-checklist.md) is the operational checklist —
what is enforced, by what, and what is deliberately unsolved. This document is
the reasoning behind it.

---

## An honest statement first

**Lifelog Phase 1 is not a production-secure system.**

It has no authentication, no authorization, no encryption at rest, and one
implicit local user. Do not run it on a public network, and do not put real
personal data in it that you cannot afford to lose.

That is not an oversight to be apologised for; it is the correct scope for a
phase whose job is to prove the understanding engine works. What *would* be
wrong is claiming otherwise, so nothing in these documents does.

Two threats are real *today*, and both are fully addressed:

1. **Credential exposure.** A leaked API key costs money immediately.
2. **Conversation content in logs.** Lifelog's input is the most private text a
   person writes.

Everything else is labelled future work, with a phase attached.

---

## What Lifelog is actually holding

This is worth stating plainly, because it shapes every decision below.

The input is not "user data" in the usual sense. It is what someone writes about
their own life: who they met, how they felt, what they decided, what they are
worried about, where they were. It is closer to a diary than to a form
submission.

Three principles follow:

**The most sensitive data must not sit in the least protected place.** Logs get
copied into tickets, pasted into chat, and shipped to third-party aggregators.
Conversation text therefore never reaches a log line, at any level, in any
environment.

**Nothing leaves the system that does not have to.** One model call per
conversation, carrying only the message and a reference time. No analytics, no
telemetry, no error-reporting service, no third-party frontend scripts.

**The user's words are theirs.** Stored verbatim, never rewritten, never
translated. Phase 8 adds export and deletion, because a life record you cannot
take with you or destroy is not really yours.

---

## API key handling

**Every credential lives in exactly one place: `secrets/API-KEYS.md`.**

One designated home, on purpose. When there is no obvious place for a key, it
ends up in four non-obvious ones — a shell profile, a `.env` somebody later
commits, a CI variable nobody can find, and a chat message. **The ambiguity is
the vulnerability**, more than any single control.

Around that file:

- gitignored, with the ignore rule written so the template and README are the
  only things under `secrets/` that can be committed;
- created at mode 600 by `npm run keys:init`, and the loader warns if the
  permissions loosen;
- **name-allowlisted** — only six specific variables are readable from it, so a
  malicious or careless keys file cannot set `PATH` or `DATABASE_URL`;
- placeholder-aware, so `<paste-your-key-here>` is never sent to a provider as if
  it were real;
- **always overridden by the real environment**, so a stale working copy cannot
  shadow a deployment secret;
- never printed. Startup logs report key *names* and whether one was found.

A pre-commit hook runs a scanner over staged files, with rules for the credential
shapes this project actually handles. Every one of these controls has a test —
a control without a test is a wish.

Full detail and the per-clone checklist: [`security-checklist.md`](security-checklist.md).

## Environment variables

Configuration goes in `.env`. **Secrets do not.** The separation is enforced by
convention and by the scanner, and `.env.example` says so at the top.

Configuration is read once at startup and validated. A missing or malformed value
fails the process rather than surfacing as a strange bug an hour later.

---

## Logging

The rule: **only shapes, never content.**

| Logged | Never logged |
| --- | --- |
| Character count, word count, 12-char hash of the text | The text |
| Item and entity *counts* | Titles, names, summaries |
| Provider, model, latency, error class | Prompts, responses, keys |
| Request id, method, URL, status | Headers, cookies, body |

Three mechanisms enforce it:

1. **Logger-level redaction** of `req.body.text`, `authorization` and `cookie`.
2. **A request serializer** that emits only method, URL and id — so a header can
   never be logged by accident, even by new code.
3. **`redactSecrets()` on internal error messages** before they are logged,
   because an upstream provider's error text can contain a key or a fragment of
   the conversation.

`summarizeText()` returns `{ chars, words, fingerprint }`. The fingerprint is a
truncated SHA-256: it lets two log lines be correlated as being about the same
message, without either containing any of it.

`redactObject()` deep-redacts a value before it is attached to a log line,
stripping known-sensitive keys and matching credential shapes in strings.

---

## Database security

Today: a local Docker container on a non-default port, with no encryption at rest
and one implicit user. Adequate for local development; nowhere near adequate for
real data.

What *is* enforced, and matters regardless of scale:

- **All SQL is parameterised.** Drizzle builds statements; no query is assembled
  from user input.
- **All SQL is in two repository files**, so the entire data-access surface can be
  reviewed in one sitting.
- **AI output never reaches SQL directly.** Every model response is normalised,
  grounded and schema-validated first. This is a data-integrity control as much
  as a security one: the database must never contain something the user did not
  say.
- **Cascading deletes** from `conversations`, so removing a conversation removes
  every interpretation of it. Phase 8's deletion feature depends on this already
  being true.

## AI provider data flow

What leaves the machine, when a hosted provider is configured:

```
conversation text + reference time + timezone  →  OpenRouter  →  model
```

That is all. No user id (there isn't one), no history, no device information, no
previous conversations.

What this means honestly: **the message is processed by a third party.** They
have their own retention and training policies, and Lifelog cannot enforce them.
Two mitigations exist today, and neither is a substitute for reading the
provider's terms:

- The local rule engine handles many simple messages without any network call at
  all, and can be forced with `AI_PROVIDER=local` — Lifelog then works entirely
  offline.
- Because the intelligence rules are in code rather than in a prompt, moving to a
  self-hosted open-weight model requires no redesign. That option exists
  specifically so this dependency is not permanent.

`ai_invocations` records provider, model, status, latency and an error *class* —
never the prompt, never the key, never the response.

---

## Client-facing errors

Clients receive a code, a safe message and a request id. Never a stack trace, a
SQL fragment, a file path, a connection string or a provider hostname.

Enforced structurally: `AppError` carries `message` (for the log) and
`publicMessage` (for the wire) as **separate fields**, so a leak requires
deliberately putting internal text in the public field, not merely forgetting to
sanitise. A test asserts that no public message contains internal detail.

[`error-handling.md`](error-handling.md).

## Input handling

- 20,000-character ceiling, enforced at the transport layer before parsing and
  again in the schema.
- Rate limiting, 60 requests per minute per IP.
- Every request body validated against a Zod schema; unknown fields ignored.
- `client` metadata is stored but **never trusted and never used for
  authorization** — it is a debugging aid, not an identity.

## Frontend

The test console holds no key, contains no model logic, and has no database
access. It talks to the backend API and nothing else. It loads no third-party
scripts, sets no cookies, and stores nothing in the browser.

---

## Authentication — not in Phase 1

There is none. Every conversation belongs to a single implicit local user, and
`conversations.user_id` is always null.

The column exists now so Phase 8 can add real users without a destructive
migration on a table that by then will hold years of someone's life. Designing
the schema for a feature that does not exist yet is usually a mistake; here the
cost is one nullable column and the alternative is migrating the source of truth.

**Planned (Phase 8):** per-user accounts, session or token auth on every endpoint,
row-level ownership on every query, rate limiting per user rather than per IP.

## Future security work

Deliberately deferred, with the phase attached. Nothing here is claimed to exist.

| Area | Plan | Phase |
| --- | --- | --- |
| Authentication and authorization | Accounts, tokens, per-user data isolation | 8 |
| Encryption at rest | Postgres-level, plus application-level for `raw_text` | 8 |
| Encryption in transit | TLS termination; HSTS | 9 |
| Export and deletion | Full export, verifiable deletion including derived rows | 8 |
| Backups | Encrypted, tested restores, defined retention | 9 |
| Audit logging | Who read what, when — once there is more than one "who" | 8 |
| Key rotation | Documented procedure and a rotation schedule | 8 |
| Secret management | Move from a file to a managed store in deployment | 9 |
| Dependency scanning in CI | `npm audit` as a required check | 9 |
| Self-hosted inference option | Remove the third-party processing dependency entirely | 6+ |

---

## If a key is exposed

In this order, and the order matters:

1. **Revoke it at the provider.** Immediately. Before anything else — a key in a
   git history is public from the moment it is pushed.
2. Issue a new one and put it in `secrets/API-KEYS.md`.
3. Remove it from history (`git filter-repo`), and force-push if it was pushed.
4. Run `npm run keys:check` across the whole repository.
5. Work out how it got there, and add a scanner rule or a control so that path is
   closed.

Step 1 is the one that matters. Steps 3 and 4 clean up; they do not undo
exposure. Assume any key that reached a remote is compromised.
