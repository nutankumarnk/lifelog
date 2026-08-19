#!/usr/bin/env node
/**
 * Installs the pre-commit hook that runs the secret scanner on staged files.
 *
 * Git hooks are not committed and not shared, so this has to be run once per
 * clone. The hook is a safety net, not the policy — the policy is
 * docs/security-checklist.md.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const HOOKS_DIR = resolve(REPO_ROOT, '.git/hooks');
const HOOK_PATH = resolve(HOOKS_DIR, 'pre-commit');
const MARKER = '# lifelog-secret-scan';

const HOOK = `#!/bin/sh
${MARKER}
# Blocks a commit that contains something key-shaped. Bypass with --no-verify
# only when you are certain, and say why in the commit message.

node "$(git rev-parse --show-toplevel)/scripts/check-secrets.mjs" --staged || {
  echo ""
  echo "Commit blocked by the Lifelog secret scanner."
  exit 1
}
`;

if (!existsSync(HOOKS_DIR)) {
  mkdirSync(HOOKS_DIR, { recursive: true });
}

if (existsSync(HOOK_PATH)) {
  const existing = readFileSync(HOOK_PATH, 'utf8');
  if (existing.includes(MARKER)) {
    console.log('pre-commit hook is already installed.');
    process.exit(0);
  }
  console.error('A different pre-commit hook already exists at .git/hooks/pre-commit.');
  console.error('Add this line to it manually:');
  console.error('  node "$(git rev-parse --show-toplevel)/scripts/check-secrets.mjs" --staged || exit 1');
  process.exit(1);
}

writeFileSync(HOOK_PATH, HOOK, 'utf8');
if (process.platform !== 'win32') chmodSync(HOOK_PATH, 0o755);

console.log('Installed .git/hooks/pre-commit (runs the secret scanner on staged files).');
