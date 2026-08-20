/**
 * Deterministic display-text normalizer.
 *
 * Turns raw / telegraphic user fragments into clear grammatical sentences for
 * UI fields (title, summary, display_text). Never mutates `source_text` — that
 * string is the grounding proof of what the user actually wrote.
 */
import type { Entity } from '../schemas/analysis.schema.js';

const SHORTCUTS: Array<[RegExp, string]> = [
  [/\btomo\b/gi, 'tomorrow'],
  [/\btmrw\b/gi, 'tomorrow'],
  [/\btmr\b/gi, 'tomorrow'],
  [/\btoday\b/gi, 'today'],
  [/\btnite\b/gi, 'tonight'],
  [/\btonite\b/gi, 'tonight'],
  [/\bpls\b/gi, 'please'],
  [/\bplz\b/gi, 'please'],
  [/\bu\b/gi, 'you'],
  [/\bur\b/gi, 'your'],
  [/\bw\/\b/gi, 'with'],
  [/\bmsg\b/gi, 'message'],
  [/\bappt\b/gi, 'appointment'],
];

const REMINDER_LEAD =
  /^(remind me to|remind me|reminder to|set a reminder to|set reminder to|alert me to|ping me to|notify me to)\s+/i;

const TASK_LEAD =
  /^(i need to|i have to|i must|i should|i gotta|i got to|need to|have to|must|should|make sure to|don't forget to|dont forget to)\s+/i;

/** Expands common shortcuts without changing meaning. */
export function expandShortcuts(text: string): string {
  let out = text.trim().replace(/\s+/g, ' ');
  for (const [pattern, replacement] of SHORTCUTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Sentence-case the first character; leave the rest alone (preserves names). */
export function sentenceCase(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Ensures a single trailing period (unless already punctuated). */
export function ensurePeriod(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (/[.!?]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

/** Prefer entity spellings when the surface form matches case-insensitively. */
export function preferEntitySpellings(text: string, entities: Entity[]): string {
  let out = text;
  const sorted = [...entities].sort((a, b) => b.name.length - a.name.length);
  for (const entity of sorted) {
    if (!entity.name) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(entity.name)}\\b`, 'gi');
    out = out.replace(pattern, entity.name);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a short list-row title (≤ maxWords words).
 */
export function shortenTitle(text: string, maxWords = 8): string {
  const words = text
    .replace(/[.!?]+$/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ');
}

export interface DisplayParts {
  /** Short label for list rows. */
  title: string;
  /** One clear grammatical sentence. */
  summary: string;
  /** Full display sentence for UI cards. */
  displayText: string;
}

/**
 * Reminder display form: "Remind me to …"
 * Strips an existing reminder lead then re-applies a canonical one.
 */
export function formatReminderDisplay(sourceOrTitle: string, entities: Entity[] = []): DisplayParts {
  let body = expandShortcuts(sourceOrTitle);
  body = body.replace(REMINDER_LEAD, '');
  body = preferEntitySpellings(body, entities);
  body = body.replace(/^(to\s+)/i, '');
  body = sentenceCase(body);
  // Imperative body after "Remind me to" should be lowercase verb if sentence-cased wrongly
  if (body.length > 1) {
    body = body.charAt(0).toLowerCase() + body.slice(1);
  }
  const displayText = ensurePeriod(`Remind me to ${body}`);
  const summary = displayText;
  const title = shortenTitle(displayText.replace(/^Remind me to /i, '').replace(/[.!?]+$/, ''));
  return { title: sentenceCase(title), summary, displayText };
}

/**
 * Task display form: imperative sentence ("Send the files on Friday.").
 */
export function formatTaskDisplay(sourceOrTitle: string, entities: Entity[] = []): DisplayParts {
  let body = expandShortcuts(sourceOrTitle);
  body = body.replace(TASK_LEAD, '');
  body = preferEntitySpellings(body, entities);
  body = sentenceCase(body);
  const displayText = ensurePeriod(body);
  const summary = displayText;
  const title = sentenceCase(shortenTitle(displayText.replace(/[.!?]+$/, '')));
  return { title, summary, displayText };
}
