# Security Checklist

This is the operational security document for Lifelog: the concrete list of what
is enforced, what enforces it, and what is deliberately not solved yet.

[`privacy-security.md`](privacy-security.md) explains the data-handling
philosophy. This file is the checklist you actually work from.

---

## An honest statement of where Lifelog stands

Lifelog Phase 1 is **not a hardened production system**, and this document does
not claim otherwise. Saying "seal-proof" about software that has no
authentication would be a lie that gets someone hurt.

What Phase 1 *does* have is a specific, enforced set of protections around the
two things that can cause real damage today:

1. **Credential exposure.** A leaked API key costs money and can be used to
   impersonate the project. This is fully addressed and mechanically enforced.
2. **Conversation content leaking into logs.** Lifelog's input is the most
   private text a person writes. This is fully addressed.

What Phase 1 **does not** have, and must not be deployed without, is listed in
[Not yet solved](#not-yet-solved). Everything there is tracked in
[`roadmap.md`](roadmap.md), mostly under Phase 8.

**Do not run Phase 1 on a public network or with real personal data you cannot
afford to lose.**

---

## 1. API keys

### The rule

**Every credential lives in exactly one place: `secrets/API-KEYS.md`.**

That file is gitignored, permission-checked, allowlisted, and never printed.
It is created by `npm run keys:init` from the committed template
[`secrets/API-KEYS.example.md`](../secrets/API-KEYS.example.md).

There is one designated home on purpose. When there is no obvious place for a
key, it ends up in four non-obvious ones — a shell profile, a `.env` someone
later commits, a CI variable nobody can find, and a chat message. Ambiguity is
the actual vulnerability.

### What enforces it

| Control | Where | What it stops |
| --- | --- | --- |
| `.gitignore` excludes `secrets/*` with two explicit exceptions | [`.gitignore`](../.gitignore) | Committing the keys file |
| Pre-commit hook runs the scanner on staged files | `npm run hooks:install` | Committing any key-shaped string |
| Secret scanner with 10 credential rules | [`scripts/check-secrets.mjs`](../scripts/check-secrets.mjs) | Keys pasted into source, docs or config |
| Name allowlist — only 6 variables are readable from the file | [`keys-file.ts`](../backend/src/config/keys-file.ts) | A keys file setting `PATH` or any other variable |
| Real environment always wins over the file | `keys-file.ts` | A stale working copy shadowing a deployment secret |
| Placeholder detection | `keys-file.ts` | `<paste-your-key>` being sent to a provider as a real key |
| POSIX permission check, warns unless mode 600 | `keys-file.ts` | Other users on the machine reading the file |
| Startup logs report key *names*, never values | [`index.ts`](../backend/src/index.ts) | Keys in log files |
| Log redaction for 9 credential shapes | [`redact.ts`](../backend/src/utils/redact.ts) | Keys reaching logs through any other path |

All of these are covered by tests in
[`backend/tests/unit/security.test.ts`](../backend/tests/unit/security.test.ts).
A control without a test is a wish.

### Checklist — every developer, once per clone

- [ ] `npm run keys:init` — creates `secrets/API-KEYS.md` with mode 600
- [ ] `npm run hooks:install` — installs the pre-commit scanner
- [ ] `npm run keys:check` — confirms the repository is clean
- [ ] Confirm `git check-ignore secrets/API-KEYS.md` prints a match
- [ ] Never `git add -f` anything under `secrets/`

### Checklist — before every commit

- [ ] `npm run keys:check` passes (the hook does this automatically)
- [ ] No key, token or connection string in the diff, including in a comment,
      a test fixture, a commit message, or a documentation example
- [ ] No `--no-verify` unless you can state exactly why in the commit message

### If a key is exposed

Order matters. Do these in sequence.

1. **Revoke the key at the provider.** Immediately, before anything else.
   Deleting a commit does not un-leak a key — it was public the moment it was
   pushed, and public repositories are scraped continuously.
2. Issue a replacement key and put it in `secrets/API-KEYS.md`.
3. Review the provider's usage log for calls you did not make.
4. Only then clean the history, and only if the repository is private and you
   can coordinate with everyone who has cloned it.
5. Record the incident in [`decision.md`](decision.md) — what leaked, how, and
   what control was added so it cannot happen the same way twice.

Never reverse steps 1 and 4.

---

## 2. Conversation data

Lifelog's input is a person's private life. It is more sensitive than most
production databases, and it is handled accordingly.

### The rule

**Conversation text never appears in a log line.** Only its length, word count
and a SHA-256 fingerprint are logged, which is enough to correlate two log lines
about the same message without either containing the message.

### What enforces it

- `summarizeText()` in [`redact.ts`](../backend/src/utils/redact.ts) is the only
  sanctioned way to log anything about user text.
- Fastify's logger redacts `req.body.text`, `authorization` and `cookie` at the
  transport level ([`server.ts`](../backend/src/server.ts)).
- `redactObject()` strips 18 sensitive key names from any object before logging.
- The error handler passes every message through `redactSecrets()` before
  logging it, because an upstream provider error can echo request content back.

### Checklist

- [ ] Never `console.log` a request body, a prompt, or an analysis
- [ ] Never add conversation text to an error message
- [ ] Never send conversation text to a third-party error tracker or APM
- [ ] When adding a log line, log identifiers and counts, not content

---

## 3. The API surface

| Control | Setting | Where |
| --- | --- | --- |
| Security headers | `@fastify/helmet` defaults | `server.ts` |
| CORS | Explicit origin allowlist, `credentials: false` | `server.ts`, `CORS_ORIGINS` |
| Rate limiting | 60 requests/minute per IP | `server.ts`, `RATE_LIMIT_MAX` |
| Body size limit | Rejected at the transport layer before parsing | `server.ts` |
| Input validation | Zod on every field, length-capped | [`api.schema.ts`](../backend/src/schemas/api.schema.ts) |
| Error responses | Fixed envelope, no stacks, no internal detail | [`handler.ts`](../backend/src/errors/handler.ts) |
| Health endpoint | Reports status only; no connection strings or hostnames | [`health.route.ts`](../backend/src/routes/health.route.ts) |

Two API tests assert that no response ever contains a stack trace, a filesystem
path, or a connection string.

### SQL injection

Every query goes through Drizzle's parameterised query builder, and every query
lives in a repository. **No raw SQL string is ever built from user input.** The
one raw statement in the codebase is a `TRUNCATE` used by the test harness, with
no interpolation.

`drizzle-orm` is pinned at ≥ 0.45.2 because earlier versions had a SQL injection
advisory in identifier escaping.

### Dependencies

`npm audit` reports **0 vulnerabilities**. Two decisions keep it that way:

- `vite` and `vitest` are pinned to patched majors.
- `esbuild` is force-resolved to `^0.25.0` via an `overrides` entry, because
  `drizzle-kit` still pulls an old `@esbuild-kit/*` chain with a dev-server
  advisory. The rationale is recorded inline in
  [`package.json`](../package.json).

- [ ] Run `npm audit` before every release and after every dependency change
- [ ] Do not add a dependency without recording why in [`technology.md`](technology.md)

---

## 4. AI provider data flow

When a hosted model is configured, the user's conversation text is sent to
OpenRouter, which routes it to a model host. **This is the single largest
privacy consideration in the system**, and it must be stated plainly to users
before Lifelog is used with real data.

- The API key is sent only in an `Authorization` header, over HTTPS, only to the
  configured base URL.
- Only the conversation text and the reference time are sent. No database
  contents, no other conversations, no identifiers.
- Model responses are treated as untrusted input: parsed defensively, validated
  against a schema, and grounded against the original text before anything is
  stored. See [`algorithm.md`](algorithm.md).
- Only the error *class* of a model call is stored in `ai_invocations` — never
  the prompt, the response, or the key.
- Setting `AI_PROVIDER=local` keeps every conversation on the machine. This is
  the correct setting for sensitive data until Phase 8.

- [ ] Users are told, before use, that text goes to a third party when a hosted
      model is configured
- [ ] `AI_PROVIDER=local` is documented as the private option

---

## 5. Database

- Credentials come from `DATABASE_URL`, never hardcoded.
- Connection strings are redacted from all log output.
- The application user should own only the `lifelog` database — do not run the
  application as a superuser outside local development.
- The test suite uses a separate database and truncates between tests.
- Migrations are checked in and applied explicitly; nothing runs DDL at startup.

- [ ] Production database is not reachable from the public internet
- [ ] Application database user has no superuser rights
- [ ] Backups exist and restoring one has actually been tested

---

## Not yet solved

These are known gaps, not oversights. Each one is a reason Phase 1 must not
handle real personal data in a shared environment.

| Gap | Impact | Planned |
| --- | --- | --- |
| **No authentication** | Anyone who can reach the API can read and write | Phase 8 |
| **No authorization** | `conversations.user_id` exists but is always null | Phase 8 |
| **No encryption at rest** | Database compromise exposes every conversation | Phase 8 |
| **No audit log** | No record of who read what | Phase 8 |
| **No key rotation automation** | Rotation is a manual edit | Phase 9 |
| **No secret scanning of git history** | The scanner checks the working tree only | Phase 9 |
| **No TLS termination in-process** | Must sit behind a reverse proxy | Phase 9 |
| **No data export or deletion endpoint** | A user cannot yet take their data out | Phase 4 |
| **No CSP** | The API returns JSON only, so low risk today | When a real UI ships |
| **Rate limiting is per-instance, in-memory** | Ineffective across multiple instances | Phase 9 |

---

## Before any deployment beyond localhost

Every box must be ticked. Not most of them.

- [ ] Authentication is implemented and enforced on every route
- [ ] `conversations.user_id` is populated and every query filters on it
- [ ] TLS terminates in front of the application
- [ ] `CORS_ORIGINS` lists only real production origins
- [ ] `NODE_ENV=production` and `LOG_LEVEL` is not `debug` or `trace`
- [ ] Secrets are injected by the platform, and `secrets/API-KEYS.md` is absent
- [ ] Database is private, backed up, and a restore has been tested
- [ ] `npm audit` is clean
- [ ] `npm run keys:check` is part of CI
- [ ] Rate limiting is backed by shared state
- [ ] Users have been told what is sent to the AI provider
- [ ] This checklist has been re-read, because it will have changed

---

## Related documents

- [`privacy-security.md`](privacy-security.md) — data-handling philosophy
- [`../secrets/API-KEYS.example.md`](../secrets/API-KEYS.example.md) — the keys file format
- [`error-handling.md`](error-handling.md) — what clients are and are not told
- [`decision.md`](decision.md) — why these choices were made
