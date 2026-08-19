#!/usr/bin/env node
/**
 * Secret scanner.
 *
 * Run manually (`npm run keys:check`), from the pre-commit hook, and in CI.
 *
 * Scope, deliberately: this catches *accidents* — a key pasted into a source
 * file, a `.env` staged by a wildcard `git add`, a connection string left in a
 * README. It cannot stop someone determined to commit a secret, and it does not
 * scan git history. Treat a clean run as "no obvious mistake", not as proof.
 *
 * Exit codes: 0 clean, 1 findings, 2 scanner error.
 */
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

/**
 * Credential shapes worth failing a commit over. Each pattern is anchored on a
 * vendor prefix or a structural giveaway, because a generic "long random
 * string" rule produces so many false positives that people start ignoring it.
 */
const RULES = [
  { id: 'openrouter-key', description: 'OpenRouter API key', pattern: /sk-or-v1-[A-Za-z0-9]{20,}/g },
  { id: 'openai-key', description: 'OpenAI API key', pattern: /sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/g },
  { id: 'anthropic-key', description: 'Anthropic API key', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'google-key', description: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'github-token', description: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { id: 'slack-token', description: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'aws-access-key', description: 'AWS access key id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'private-key-block', description: 'PEM private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  {
    id: 'db-url-with-password',
    description: 'database URL containing a password',
    pattern: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:/@"']+:[^\s:/@"']+@[^\s"']+/g,
  },
  {
    id: 'generic-assignment',
    description: 'hardcoded secret assignment',
    // Only fires on a plausible value: 20+ chars with no spaces or template syntax.
    pattern: /\b(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*["'`]([^"'`\s${}]{20,})["'`]/gi,
  },
];

/** Values that match a rule but are obviously not real. */
const ALLOWED_VALUES = [
  /^postgres(?:ql)?:\/\/lifelog:lifelog@/i, // the documented local dev database
  /^postgres(?:ql)?:\/\/user:password@/i,
  /example|placeholder|dummy|sample|redacted|xxxx|<[^>]+>|your[-_]|paste[-_]|replace[-_]me|changeme/i,
];

/** Paths that legitimately describe secret formats and would self-trigger. */
const ALLOWED_PATHS = [
  'scripts/check-secrets.mjs',
  'backend/src/utils/redact.ts',
  'backend/src/config/keys-file.ts',
  'secrets/API-KEYS.example.md',
  'secrets/README.md',
  'docs/security-checklist.md',
  'docs/privacy-security.md',
  '.gitignore',
  'package-lock.json',
];

const SKIP_DIRECTORIES = ['node_modules/', 'dist/', 'build/', 'coverage/', '.git/'];

/** Files that must never be committed at all, regardless of content. */
const FORBIDDEN_PATHS = [/^secrets\/(?!README\.md$|API-KEYS\.example\.md$)/, /^\.env$/, /^\.env\.(?!example$)/];

const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp4|mov|wasm|node)$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function isAllowedPath(path) {
  return ALLOWED_PATHS.includes(path) || SKIP_DIRECTORIES.some((prefix) => path.includes(prefix));
}

function isAllowedValue(value) {
  return ALLOWED_VALUES.some((pattern) => pattern.test(value));
}

/** Masks a finding so the scanner's own output never leaks the secret. */
function mask(value) {
  if (value.length <= 10) return '*'.repeat(value.length);
  return `${value.slice(0, 6)}${'*'.repeat(Math.min(20, value.length - 10))}${value.slice(-4)}`;
}

function listFiles(mode) {
  const command =
    mode === 'staged'
      ? 'git diff --cached --name-only --diff-filter=ACMR'
      : 'git ls-files';
  try {
    return execSync(command, { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    console.error('check-secrets: not a git repository, or git is unavailable.');
    process.exit(2);
  }
}

function scanFile(path) {
  const findings = [];
  const absolute = resolve(REPO_ROOT, path);

  for (const forbidden of FORBIDDEN_PATHS) {
    if (forbidden.test(path)) {
      findings.push({ path, line: 0, rule: 'forbidden-path', description: 'file must never be committed', match: path });
      return findings;
    }
  }

  if (isAllowedPath(path) || BINARY_EXTENSIONS.test(path)) return findings;

  let content;
  try {
    if (statSync(absolute).size > MAX_FILE_BYTES) return findings;
    content = readFileSync(absolute, 'utf8');
  } catch {
    return findings; // Deleted or unreadable; nothing to scan.
  }

  const lines = content.split('\n');
  for (const rule of RULES) {
    for (const [index, line] of lines.entries()) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(line)) !== null) {
        const value = match[1] ?? match[0];
        if (isAllowedValue(value) || isAllowedValue(line)) continue;
        findings.push({
          path,
          line: index + 1,
          rule: rule.id,
          description: rule.description,
          match: mask(value),
        });
      }
    }
  }

  return findings;
}

function main() {
  const mode = process.argv.includes('--staged') ? 'staged' : 'all';
  const files = listFiles(mode);
  const findings = files.flatMap(scanFile);

  if (findings.length === 0) {
    console.log(`check-secrets: scanned ${files.length} ${mode === 'staged' ? 'staged ' : ''}file(s), no findings.`);
    process.exit(0);
  }

  console.error(`\ncheck-secrets: ${findings.length} finding(s).\n`);
  for (const finding of findings) {
    const location = finding.line > 0 ? `${finding.path}:${finding.line}` : finding.path;
    console.error(`  ${location}`);
    console.error(`    ${finding.description} [${finding.rule}]`);
    console.error(`    ${finding.match}\n`);
  }
  console.error('If a real credential was exposed, revoke it at the provider before doing anything else.');
  console.error('Removing the line does not un-leak a key that has already been pushed.');
  console.error('If this is a false positive, add the path to ALLOWED_PATHS in scripts/check-secrets.mjs.\n');
  process.exit(1);
}

// Only scan when executed as a command. Importing this module (the unit tests
// do) must not trigger a scan or call process.exit.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();

export { RULES, ALLOWED_PATHS, mask, scanFile };
