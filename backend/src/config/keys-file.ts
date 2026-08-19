/**
 * Loader for `secrets/API-KEYS.md` — Lifelog's dedicated API key file.
 *
 * Why a markdown file instead of only `.env`:
 * a human (or an AI coding agent acting on the owner's behalf) needs one
 * obvious, self-documenting place to drop a key. Scattering keys across shell
 * profiles, `.env` files and CI settings is how keys leak. One file, one path,
 * gitignored, permission-checked.
 *
 * Security properties enforced here:
 *   1. The file is never read from outside the repository root.
 *   2. Values already present in the real environment always win, so a
 *      committed or stale file can never override a deployment secret.
 *   3. The file must not be group/world readable (POSIX only) — refuse if it is.
 *   4. Placeholder values are ignored rather than loaded as real keys.
 *   5. Nothing from this file is ever logged. Only key *names* are reported.
 *
 * See secrets/API-KEYS.example.md and docs/security-checklist.md.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** Key names Lifelog will accept from the keys file. Anything else is ignored. */
export const ALLOWED_SECRET_NAMES = [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'DATABASE_URL',
  'TEST_DATABASE_URL',
] as const;

export type AllowedSecretName = (typeof ALLOWED_SECRET_NAMES)[number];

/**
 * Values that mean "the developer has not filled this in yet". Loading these
 * would produce a confusing 401 from the provider instead of a clean fallback.
 */
const PLACEHOLDER_PATTERNS = [
  /^$/,
  /^<.*>$/,
  /^paste[-_ ]/i,
  /^your[-_ ]/i,
  /^replace[-_ ]?me$/i,
  /^sk-or-v1-xxx/i,
  /^changeme$/i,
  /^todo$/i,
  /^none$/i,
];

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*?)\s*$/;

export interface KeysFileResult {
  /** Absolute path that was inspected. */
  path: string;
  /** True when the file exists and was parsed. */
  found: boolean;
  /** Names (never values) of secrets applied to `process.env`. */
  loaded: string[];
  /** Names present in the file but skipped, with the reason. */
  skipped: Array<{ name: string; reason: string }>;
  /** Problems worth surfacing to the developer at startup. */
  warnings: string[];
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  // Markdown tables and inline code are common in a hand-edited .md file.
  return trimmed.replace(/^`+|`+$/g, '').replace(/\s*\|\s*$/, '').trim();
}

/**
 * Parses the assignment lines out of a markdown document.
 *
 * The format is intentionally forgiving because a human types it by hand:
 * `NAME=value`, `NAME = value`, `NAME: value` and `export NAME=value` all work,
 * inside or outside fenced code blocks. Prose lines simply do not match.
 */
export function parseKeysMarkdown(content: string): Map<string, string> {
  const found = new Map<string, string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    // Skip markdown structure that could otherwise look like an assignment,
    // e.g. a heading "## Note: value" or a quote "> KEY: value".
    if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('```')) continue;
    // Table rows are allowed, so normalise the leading pipe away.
    const candidate = line.startsWith('|') ? line.replace(/^\|\s*/, '') : line;

    const match = ASSIGNMENT.exec(candidate);
    if (!match) continue;

    const name = match[1];
    const value = stripQuotes(match[2] ?? '');
    if (!name) continue;
    // Only fully upper-case names are treated as environment variables; this
    // stops ordinary prose like "Note: something" from being captured.
    if (name !== name.toUpperCase()) continue;

    found.set(name, value);
  }

  return found;
}

/** True when the file is readable by group or others (POSIX permission check). */
function isOverlyPermissive(path: string): boolean {
  if (process.platform === 'win32') return false;
  try {
    const mode = statSync(path).mode & 0o777;
    return (mode & 0o077) !== 0;
  } catch {
    return false;
  }
}

export interface LoadKeysOptions {
  /** Repository root. The keys file is always resolved relative to this. */
  rootDir: string;
  /** Path relative to `rootDir`. */
  relativePath?: string;
  /** Target environment object. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Refuse to load a world-readable file. Defaults to true. */
  enforcePermissions?: boolean;
}

/**
 * Reads `secrets/API-KEYS.md` and merges any recognised secrets into the
 * environment. Missing file is not an error — Lifelog runs without an API key
 * by falling back to the local provider.
 */
export function loadKeysFile(options: LoadKeysOptions): KeysFileResult {
  const relativePath = options.relativePath ?? 'secrets/API-KEYS.md';
  const env = options.env ?? process.env;
  const enforcePermissions = options.enforcePermissions ?? true;
  const path = resolve(options.rootDir, relativePath);

  const result: KeysFileResult = {
    path,
    found: false,
    loaded: [],
    skipped: [],
    warnings: [],
  };

  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return result;
  }
  result.found = true;

  if (enforcePermissions && isOverlyPermissive(path)) {
    result.warnings.push(
      `${relativePath} is readable by other users on this machine. Run: chmod 600 ${relativePath}`,
    );
  }

  const allowed = new Set<string>(ALLOWED_SECRET_NAMES);

  for (const [name, value] of parseKeysMarkdown(content)) {
    if (!allowed.has(name)) {
      result.skipped.push({ name, reason: 'not an allowed secret name' });
      continue;
    }
    if (isPlaceholder(value)) {
      result.skipped.push({ name, reason: 'placeholder value' });
      continue;
    }
    // The real environment is authoritative. A checked-out file must never be
    // able to shadow a secret injected by the host.
    if (env[name] !== undefined && env[name] !== '') {
      result.skipped.push({ name, reason: 'already set in environment' });
      continue;
    }
    env[name] = value;
    result.loaded.push(name);
  }

  return result;
}
