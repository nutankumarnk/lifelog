#!/usr/bin/env node
/**
 * Creates `secrets/API-KEYS.md` from the template with mode 600.
 *
 * Refuses to overwrite an existing file, because that file is the only copy of
 * a developer's local keys.
 */
import { chmodSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const TEMPLATE = resolve(REPO_ROOT, 'secrets/API-KEYS.example.md');
const TARGET = resolve(REPO_ROOT, 'secrets/API-KEYS.md');

if (existsSync(TARGET)) {
  console.log('secrets/API-KEYS.md already exists — leaving it alone.');
  if (process.platform !== 'win32') chmodSync(TARGET, 0o600);
  process.exit(0);
}

if (!existsSync(TEMPLATE)) {
  console.error('secrets/API-KEYS.example.md is missing. Restore it from git.');
  process.exit(1);
}

copyFileSync(TEMPLATE, TARGET);
if (process.platform !== 'win32') chmodSync(TARGET, 0o600);

console.log('Created secrets/API-KEYS.md (mode 600).');
console.log('Open it and replace the placeholder with your real key.');
console.log('It is gitignored. Never commit it, never paste its contents anywhere.');
