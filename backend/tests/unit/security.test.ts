/**
 * Security unit tests.
 *
 * The rules in docs/security-checklist.md are only real if something enforces
 * them. These tests are that enforcement: they fail when a key could leak
 * through a log line, when the keys file could shadow a deployment secret, or
 * when the scanner stops catching a credential shape.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadKeysFile, parseKeysMarkdown, ALLOWED_SECRET_NAMES } from '../../src/config/keys-file.js';
import { redactObject, redactSecrets, summarizeText } from '../../src/utils/redact.js';
import { AppError } from '../../src/errors/app-error.js';

/**
 * Fake key values, assembled at runtime so the file itself contains no
 * committed key-shaped literal for the scanner to flag.
 */
const FAKE_OPENROUTER = `sk-or-v1-${'a1b2c3d4'.repeat(4)}`;
const FAKE_ANTHROPIC = `sk-ant-${'x9y8z7w6'.repeat(4)}`;

/**
 * The scanner is plain JavaScript so it can run from a git hook with no build
 * step, which leaves it without type declarations. Importing it through a
 * computed specifier keeps the tests type-safe against this local interface
 * rather than silently widening to `any`.
 */
interface ScannerModule {
  RULES: Array<{ id: string; description: string; pattern: RegExp }>;
  ALLOWED_PATHS: string[];
  mask: (value: string) => string;
}

const scannerPath = new URL('../../../scripts/check-secrets.mjs', import.meta.url).href;
const loadScanner = async (): Promise<ScannerModule> => (await import(scannerPath)) as ScannerModule;

/** Creates a throwaway repo root containing `secrets/API-KEYS.md`. */
function withKeysFile(contents: string, mode = 0o600): string {
  const root = mkdtempSync(join(tmpdir(), 'lifelog-keys-'));
  mkdirSync(join(root, 'secrets'));
  const path = join(root, 'secrets', 'API-KEYS.md');
  writeFileSync(path, contents, 'utf8');
  chmodSync(path, mode);
  return root;
}

describe('API keys file parsing', () => {
  it('reads assignments in every documented form', () => {
    const parsed = parseKeysMarkdown(`
# Heading that should be ignored

Some prose explaining things.

\`\`\`ini
OPENROUTER_API_KEY = ${FAKE_OPENROUTER}
ANTHROPIC_API_KEY:${FAKE_ANTHROPIC}
export GOOGLE_API_KEY="quoted-value"
\`\`\`
`);

    expect(parsed.get('OPENROUTER_API_KEY')).toBe(FAKE_OPENROUTER);
    expect(parsed.get('ANTHROPIC_API_KEY')).toBe(FAKE_ANTHROPIC);
    expect(parsed.get('GOOGLE_API_KEY')).toBe('quoted-value');
  });

  it('ignores prose that superficially looks like an assignment', () => {
    const parsed = parseKeysMarkdown(`
# Note: this is a heading
> Warning: do not commit this file
Rotate the key: every 90 days
Some sentence with a colon: and a value.
`);

    expect(parsed.size).toBe(0);
  });

  it('ignores commented-out lines', () => {
    const parsed = parseKeysMarkdown(`# DATABASE_URL = postgres://user:password@localhost/x`);
    expect(parsed.has('DATABASE_URL')).toBe(false);
  });
});

describe('API keys file loading', () => {
  it('loads only allowlisted names', () => {
    const root = withKeysFile(`
OPENROUTER_API_KEY = ${FAKE_OPENROUTER}
SOME_OTHER_VARIABLE = should-not-load
PATH = /evil/bin
`);
    const env: NodeJS.ProcessEnv = {};
    const result = loadKeysFile({ rootDir: root, env });

    expect(result.loaded).toEqual(['OPENROUTER_API_KEY']);
    expect(env.SOME_OTHER_VARIABLE).toBeUndefined();
    // A keys file must never be able to rewrite PATH.
    expect(env.PATH).toBeUndefined();
    expect(result.skipped.map((entry) => entry.name)).toContain('SOME_OTHER_VARIABLE');
  });

  it('never overrides a value already present in the environment', () => {
    const root = withKeysFile(`OPENROUTER_API_KEY = ${FAKE_OPENROUTER}`);
    const env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'injected-by-the-platform' };

    const result = loadKeysFile({ rootDir: root, env });

    expect(env.OPENROUTER_API_KEY).toBe('injected-by-the-platform');
    expect(result.loaded).toEqual([]);
    expect(result.skipped).toContainEqual({
      name: 'OPENROUTER_API_KEY',
      reason: 'already set in environment',
    });
  });

  it('skips placeholder values instead of loading them as keys', () => {
    const root = withKeysFile(`
OPENROUTER_API_KEY = <paste-your-openrouter-key-here>
ANTHROPIC_API_KEY = your-key-here
GOOGLE_API_KEY = REPLACE_ME
`);
    const env: NodeJS.ProcessEnv = {};
    const result = loadKeysFile({ rootDir: root, env });

    expect(result.loaded).toEqual([]);
    expect(result.skipped.every((entry) => entry.reason === 'placeholder value')).toBe(true);
  });

  it('warns when the file is readable by other users', () => {
    const root = withKeysFile(`OPENROUTER_API_KEY = ${FAKE_OPENROUTER}`, 0o644);
    const result = loadKeysFile({ rootDir: root, env: {} });

    expect(result.warnings.some((warning) => warning.includes('chmod 600'))).toBe(true);
  });

  it('treats a missing file as normal, not as an error', () => {
    const result = loadKeysFile({ rootDir: resolve(tmpdir(), 'lifelog-does-not-exist'), env: {} });

    expect(result.found).toBe(false);
    expect(result.loaded).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('reports names but never values', () => {
    const root = withKeysFile(`OPENROUTER_API_KEY = ${FAKE_OPENROUTER}`);
    const result = loadKeysFile({ rootDir: root, env: {} });

    const serialized = JSON.stringify(result);
    expect(serialized).toContain('OPENROUTER_API_KEY');
    expect(serialized).not.toContain(FAKE_OPENROUTER);
  });

  it('documents every allowlisted name in the example file', () => {
    const example = readFileSync(
      resolve(import.meta.dirname, '../../../secrets/API-KEYS.example.md'),
      'utf8',
    );

    for (const name of ALLOWED_SECRET_NAMES) {
      expect(example).toContain(name);
    }
  });
});

describe('log redaction', () => {
  it('redacts every credential shape it knows', () => {
    const samples = [
      FAKE_OPENROUTER,
      FAKE_ANTHROPIC,
      `sk-proj-${'q1w2e3r4'.repeat(4)}`,
      `AIza${'B'.repeat(35)}`,
      `ghp_${'c'.repeat(36)}`,
      // Assembled at runtime so this synthetic fixture does not itself trip the
      // repository secret scanner.
      ['postgres://appuser', 'notarealpassword@db.internal:5432/lifelog'].join(':'),
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    ];

    for (const sample of samples) {
      const redacted = redactSecrets(`value=${sample}`);
      expect(redacted).not.toContain(sample);
      expect(redacted).toContain('[redacted:');
    }
  });

  it('strips conversation content from a log object', () => {
    const redacted = redactObject({
      conversationId: 'abc',
      text: 'I met Arun yesterday in Ahmedabad and I have a doctor appointment.',
      body: { prompt: 'system instructions', apiKey: FAKE_OPENROUTER },
      count: 3,
    }) as Record<string, any>;

    expect(redacted.text).toBe('[redacted]');
    expect(redacted.body.prompt).toBe('[redacted]');
    expect(redacted.body.apiKey).toBe('[redacted]');
    // Non-sensitive fields survive, otherwise logs become useless.
    expect(redacted.conversationId).toBe('abc');
    expect(redacted.count).toBe(3);
  });

  it('summarizes user text without reproducing any of it', () => {
    const text = 'I met Arun yesterday in Ahmedabad.';
    const summary = summarizeText(text);

    expect(summary.chars).toBe(text.length);
    expect(summary.words).toBe(6);
    expect(JSON.stringify(summary)).not.toContain('Arun');
    // Stable, so two log lines about the same text can be correlated.
    expect(summarizeText(text).fingerprint).toBe(summary.fingerprint);
  });

  it('does not mangle ordinary text', () => {
    const text = 'I need to call the bank about account 12345.';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('client-facing error messages', () => {
  it('keeps internal detail out of every public message', () => {
    const codes = [
      'VALIDATION_ERROR',
      'EMPTY_INPUT',
      'INPUT_TOO_LARGE',
      'AI_UNAVAILABLE',
      'AI_TIMEOUT',
      'AI_INVALID_OUTPUT',
      'DATABASE_ERROR',
      'NOT_FOUND',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const;

    for (const code of codes) {
      const error = new AppError(code, 'internal: postgres at 10.0.0.5 refused, key sk-or-v1-secret');

      expect(error.publicMessage).not.toContain('postgres');
      expect(error.publicMessage).not.toContain('10.0.0.5');
      expect(error.publicMessage).not.toContain('sk-or-');
      expect(error.publicMessage.length).toBeGreaterThan(0);
    }
  });
});

describe('secret scanner', () => {
  it('masks findings so its own output cannot leak a key', async () => {
    const { mask } = await loadScanner();
    const masked = mask(FAKE_OPENROUTER);

    expect(masked).not.toContain('a1b2c3d4a1b2c3d4');
    expect(masked).toContain('*');
    expect(masked.startsWith('sk-or-')).toBe(true);
  });

  it('has a rule for each credential shape Lifelog handles', async () => {
    const { RULES } = await loadScanner();
    const ids = RULES.map((rule) => rule.id);

    for (const expected of ['openrouter-key', 'anthropic-key', 'openai-key', 'db-url-with-password', 'private-key-block']) {
      expect(ids).toContain(expected);
    }
  });

  it('matches a planted credential and ignores documented placeholders', async () => {
    const { RULES } = await loadScanner();
    const rule = RULES.find((candidate) => candidate.id === 'openrouter-key');
    expect(rule).toBeDefined();

    rule!.pattern.lastIndex = 0;
    expect(rule!.pattern.test(`const key = "${FAKE_OPENROUTER}";`)).toBe(true);

    rule!.pattern.lastIndex = 0;
    expect(rule!.pattern.test('OPENROUTER_API_KEY = <paste-your-key-here>')).toBe(false);
  });

  it('never allowlists the private keys file itself', async () => {
    const { ALLOWED_PATHS } = await loadScanner();

    expect(ALLOWED_PATHS).not.toContain('secrets/API-KEYS.md');
    expect(ALLOWED_PATHS).toContain('secrets/API-KEYS.example.md');
  });
});
