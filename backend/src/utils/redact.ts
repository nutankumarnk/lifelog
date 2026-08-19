/**
 * Log redaction.
 *
 * Two categories must never reach a log line:
 *
 *   1. Credentials. A key in a log file is a leaked key — log files get copied
 *      into tickets, pasted into chat, and shipped to third-party aggregators.
 *   2. Conversation content. Lifelog's input *is* the user's private life.
 *      Logging it would put the most sensitive data in the least protected
 *      place. Only lengths, hashes and counts are ever logged.
 *
 * See docs/privacy-security.md and docs/security-checklist.md.
 */
import { createHash } from 'node:crypto';

/** Shapes of common API keys, so an accidental interpolation is still caught. */
const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /sk-or-v1-[A-Za-z0-9]{16,}/g, label: 'openrouter_key' },
  { pattern: /sk-proj-[A-Za-z0-9_-]{16,}/g, label: 'openai_key' },
  { pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g, label: 'anthropic_key' },
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, label: 'api_key' },
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g, label: 'google_key' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, label: 'github_token' },
  { pattern: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: 'jwt' },
  { pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/gi, label: 'bearer_token' },
  // Connection strings, including the password segment.
  { pattern: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi, label: 'connection_string' },
];

/** Replaces anything that looks like a credential with a labelled placeholder. */
export function redactSecrets(input: string): string {
  let output = input;
  for (const { pattern, label } of SECRET_PATTERNS) {
    output = output.replace(pattern, `[redacted:${label}]`);
  }
  return output;
}

/**
 * A stable, non-reversible identifier for a piece of text.
 * Lets two log lines be correlated without either containing the content.
 */
export function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export interface SafeTextSummary {
  chars: number;
  words: number;
  fingerprint: string;
}

/** The only representation of user text that may be logged. */
export function summarizeText(text: string): SafeTextSummary {
  return {
    chars: text.length,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    fingerprint: fingerprint(text),
  };
}

/** Keys whose values are stripped from any object before it is logged. */
const SENSITIVE_KEYS = new Set([
  'text',
  'rawtext',
  'raw_text',
  'content',
  'message',
  'messages',
  'prompt',
  'instructions',
  'usermessage',
  'analysis',
  'summary',
  'authorization',
  'apikey',
  'api_key',
  'password',
  'token',
  'secret',
  'databaseurl',
  'database_url',
]);

/** Deep-redacts an object so it is safe to attach to a log line. */
export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => redactObject(entry, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : redactObject(entry, depth + 1);
    }
    return output;
  }
  return value;
}
