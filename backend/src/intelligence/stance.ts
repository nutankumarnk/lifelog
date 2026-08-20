/**
 * First-hand behavior stance for the current message.
 *
 * Soft archetype signals only — not clinical labels, not a lasting profile.
 */
import type { Intent, Item, Stance } from '../schemas/analysis.schema.js';
import {
  DECISION_MARKERS,
  PLAN_MARKERS,
  QUESTION_MARKERS,
  REMINDER_MARKERS,
  TASK_MARKERS,
  containsAny,
} from './lexicon.js';

export interface StanceResult {
  stance: Stance;
  confidence: number;
}

const HELP_MARKERS = [
  'help me',
  'can you help',
  'what should i',
  'any advice',
  'suggest',
  'recommend',
];

const SOCIAL_MARKERS = ['with friends', 'my friend', 'hang out', 'party', 'dinner with', 'met '];

const CORRECT_MARKERS = ['actually', 'i meant', 'correction', 'not that', 'i misspoke'];

const VENT_MARKERS = [
  'so frustrated',
  'i hate',
  'this sucks',
  'fed up',
  'cant take',
  "can't take",
  'overwhelmed',
];

/**
 * Detects stance from markers, intent, and item mix.
 */
export function detectStance(
  text: string,
  intent: Intent,
  items: Item[],
): StanceResult {
  const lower = text.toLowerCase();

  if (intent === 'CORRECT' || containsAny(lower, CORRECT_MARKERS)) {
    return { stance: 'CORRECT', confidence: 0.85 };
  }
  if (containsAny(lower, VENT_MARKERS)) {
    return { stance: 'VENT', confidence: 0.8 };
  }
  if (containsAny(lower, HELP_MARKERS) || containsAny(lower, QUESTION_MARKERS)) {
    return { stance: 'REQUEST_HELP', confidence: 0.75 };
  }
  if (intent === 'SET_REMINDER' || items.some((i) => i.type === 'REMINDER')) {
    return { stance: 'PLAN', confidence: 0.8 };
  }
  if (intent === 'CAPTURE_TASK' || items.some((i) => i.type === 'TASK') || containsAny(lower, TASK_MARKERS)) {
    return { stance: 'PLAN', confidence: 0.75 };
  }
  if (intent === 'PLAN' || containsAny(lower, PLAN_MARKERS)) {
    return { stance: 'PLAN', confidence: 0.75 };
  }
  if (items.some((i) => i.type === 'DECISION') || containsAny(lower, DECISION_MARKERS)) {
    return { stance: 'DECIDE', confidence: 0.8 };
  }
  if (containsAny(lower, REMINDER_MARKERS)) {
    return { stance: 'PLAN', confidence: 0.7 };
  }
  if (items.some((i) => i.type === 'FEELING') && intent === 'REFLECT') {
    return { stance: 'VENT', confidence: 0.65 };
  }
  if (containsAny(lower, SOCIAL_MARKERS) || items.some((i) => i.type === 'MEMORY' || i.type === 'PAST_EVENT')) {
    if (containsAny(lower, SOCIAL_MARKERS)) return { stance: 'SOCIAL', confidence: 0.7 };
    return { stance: 'LOG', confidence: 0.7 };
  }
  if (intent === 'LOG' || intent === 'REFLECT') {
    return { stance: intent === 'REFLECT' ? 'VENT' : 'LOG', confidence: 0.55 };
  }
  if (intent === 'SMALL_TALK') {
    return { stance: 'SOCIAL', confidence: 0.6 };
  }
  return { stance: 'UNKNOWN', confidence: 0.4 };
}
