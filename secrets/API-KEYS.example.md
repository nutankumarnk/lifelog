# Lifelog — API Keys

**This is the template. Do not put a real key in this file.**

Copy it to `secrets/API-KEYS.md` and edit that copy:

```bash
npm run keys:init      # creates secrets/API-KEYS.md with mode 600
```

`secrets/API-KEYS.md` is gitignored, is checked by the pre-commit hook, and is
loaded automatically when the backend starts. It is the one place a key belongs.

---

## How to fill this in

Put one assignment per line inside the block below. All of these forms work:

```
NAME=value
NAME = value
NAME: value
export NAME=value
```

Leave a line untouched to skip it. Placeholder values (`<paste-here>`,
`your-key`, `REPLACE_ME`, empty) are ignored rather than loaded, so a
half-filled file degrades cleanly instead of producing a confusing 401.

---

## Keys

```ini
# --- AI provider ------------------------------------------------------------
# Required only for hosted-model analysis. Without it Lifelog runs the offline
# rule engine, and everything still works at lower extraction quality.
# Get one at https://openrouter.ai/keys
OPENROUTER_API_KEY = <paste-your-openrouter-key-here>

# --- Database ---------------------------------------------------------------
# Optional here. Normally set in .env instead, since it is environment
# configuration rather than a shared secret.
# DATABASE_URL = postgres://lifelog:lifelog@127.0.0.1:5434/lifelog
```

---

## Which names are accepted

Only this allowlist is read. Anything else in this file is ignored on purpose,
so a stray note can never become an environment variable:

| Name                 | Required | Used for                                     |
| -------------------- | -------- | -------------------------------------------- |
| `OPENROUTER_API_KEY` | No       | Hosted model analysis via OpenRouter          |
| `OPENAI_API_KEY`     | No       | Reserved — no provider implemented yet        |
| `ANTHROPIC_API_KEY`  | No       | Reserved — no provider implemented yet        |
| `GOOGLE_API_KEY`     | No       | Reserved — no provider implemented yet        |
| `DATABASE_URL`       | No       | Postgres connection string                    |
| `TEST_DATABASE_URL`  | No       | Postgres connection string for the test suite |

To add a name, extend `ALLOWED_SECRET_NAMES` in
`backend/src/config/keys-file.ts` and update this table.

---

## Rules this file follows

1. **The real environment always wins.** If `OPENROUTER_API_KEY` is already set
   in the process environment, the value here is ignored. A file in a working
   copy can never shadow a deployment secret.
2. **Permissions are enforced.** If `secrets/API-KEYS.md` is readable by other
   users on the machine, the backend warns at startup. Fix with
   `chmod 600 secrets/API-KEYS.md`.
3. **Nothing is echoed.** Startup logs list which key *names* were loaded, never
   any value. `backend/src/utils/redact.ts` also strips key-shaped strings from
   every log line as a second line of defence.
4. **Rotate on exposure.** If a key ever reaches a commit, a screenshot, a chat
   message or a CI log, revoke it at the provider first and edit the file
   second. Deleting a commit does not un-leak a key.

## If you are an AI coding agent

The repository owner may paste a key into `secrets/API-KEYS.md` and ask you to
wire it up. When they do:

- Write it **only** to `secrets/API-KEYS.md`. Never to `.env.example`, a test
  fixture, a code comment, a commit message, or documentation.
- Never print the value back — not in your summary, not in a log line, not in a
  code block. Refer to it as `OPENROUTER_API_KEY`.
- Never `git add secrets/API-KEYS.md`. It is gitignored; keep it that way.
- Run `npm run keys:check` before committing, and stop if it reports a finding.

See `docs/security-checklist.md` for the full policy.
