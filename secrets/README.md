# `secrets/`

Everything in this directory is gitignored except this README and
`API-KEYS.example.md`.

| File                 | Committed | Purpose                                       |
| -------------------- | --------- | --------------------------------------------- |
| `API-KEYS.example.md`| Yes       | Template. Never contains a real value.        |
| `API-KEYS.md`        | **No**    | Your real keys. Created by `npm run keys:init`.|
| `README.md`          | Yes       | This file.                                    |

## Quick start

```bash
npm run keys:init      # copies the template, sets mode 600
$EDITOR secrets/API-KEYS.md
npm run keys:check     # verifies nothing is about to be committed
```

## Why a file instead of only environment variables

One obvious place beats several non-obvious ones. When there is no designated
home for a key, it ends up pasted into a shell profile, a `.env` that someone
later commits, a CI variable nobody can find, and a chat message. A single
gitignored, permission-checked, allowlisted file that the app reads on startup
removes the ambiguity.

Environment variables still take precedence. In production you inject secrets
through the platform and this file is simply absent — see
`docs/privacy-security.md`.

## What protects this directory

1. `.gitignore` excludes `secrets/*` with explicit exceptions for the two
   committed files.
2. `npm run hooks:install` installs a pre-commit hook that refuses commits
   containing key-shaped strings or this directory's private files.
3. `npm run keys:check` runs the same scanner manually and in CI.
4. `backend/src/config/keys-file.ts` refuses placeholder values, ignores names
   outside its allowlist, and never logs a value.
5. `backend/src/utils/redact.ts` strips key-shaped strings from log output.

Full policy: `docs/security-checklist.md`.
