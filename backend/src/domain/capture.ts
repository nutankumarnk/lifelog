/**
 * Frames free-form "add this" text so the conversation engine can classify it.
 *
 * The product still stores a conversation first — there is no side door that
 * writes a task without the words that produced it. These helpers only supply
 * the obligation wording when the user typed an imperative fragment
 * ("call the bank tomorrow") instead of a full sentence.
 */
import { REMINDER_MARKERS, TASK_MARKERS, containsAny } from '../intelligence/lexicon.js';

function stripLeadingTo(text: string): string {
  return text.replace(/^to\s+/i, '').trim();
}

/** Ensures the text will be read as a TASK when it is not already a reminder. */
export function frameAsTask(text: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (containsAny(lower, TASK_MARKERS) || containsAny(lower, REMINDER_MARKERS)) return trimmed;
  return `I need to ${stripLeadingTo(trimmed)}`;
}

/** Ensures the text will be read as a REMINDER. */
export function frameAsReminder(text: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (containsAny(lower, REMINDER_MARKERS)) return trimmed;
  return `Remind me to ${stripLeadingTo(trimmed)}`;
}
