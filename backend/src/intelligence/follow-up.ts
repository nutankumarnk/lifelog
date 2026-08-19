/**
 * Missing-information detection and follow-up questions.
 *
 * The hard part is restraint. A system that can always find something missing
 * will always ask, and a life-logging tool that interrogates you after every
 * sentence stops getting used. So Lifelog separates two ideas:
 *
 *   - MISSING INFORMATION is recorded whenever an important field is absent.
 *     It costs the user nothing and is useful to a later phase.
 *   - A FOLLOW-UP QUESTION is asked only when the gap blocks something the user
 *     has clearly asked Lifelog to do.
 *
 * Concretely: a reminder with no time cannot fire, so Lifelog asks. A diary
 * entry that does not say where it happened is a complete diary entry, so
 * Lifelog stays quiet. At most one question is ever returned.
 */
import type { FollowUp, Intent, Item, MissingInfo } from '../schemas/analysis.schema.js';

export interface FollowUpContext {
  intent: Intent;
  text: string;
}

export interface FollowUpResult {
  missing: MissingInfo[];
  followUp: FollowUp | null;
}

interface Candidate {
  missing: MissingInfo;
  question: string;
  /** Lower runs first. Ranks which single question is worth asking. */
  priority: number;
  blocking: boolean;
}

/** Truncates an item title for use inside a question. */
function shortTitle(item: Item, maxWords = 8): string {
  const words = item.title.trim().split(/\s+/);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(' ')}…` : item.title.trim();
}

/**
 * Decides what is missing and whether to ask about it.
 *
 * `modelMissing` is what the AI reported. It is merged in as advisory data but
 * never drives the question on its own — models over-report missing fields.
 */
export function evaluateFollowUp(
  items: Item[],
  context: FollowUpContext,
  modelMissing: MissingInfo[] = [],
): FollowUpResult {
  const candidates: Candidate[] = [];

  for (const item of items) {
    // --- A reminder with no time cannot ever fire. Always blocking. --------
    if (item.type === 'REMINDER') {
      const trigger = item.details.trigger_at ?? item.temporal.resolved;
      if (!trigger) {
        candidates.push({
          missing: {
            field: 'reminder_time',
            about_item_id: item.id,
            reason: 'A reminder cannot be scheduled without a time.',
            importance: 'HIGH',
          },
          question: `When should I remind you to ${shortTitle(item).replace(/^remind me to\s*/i, '')}?`,
          priority: 1,
          blocking: true,
        });
        continue;
      }
      // A date without a time of day is usable but imprecise.
      if (item.temporal.precision === 'DAY' && item.temporal.raw) {
        candidates.push({
          missing: {
            field: 'reminder_time_of_day',
            about_item_id: item.id,
            reason: 'The reminder has a date but no time of day.',
            importance: 'MEDIUM',
          },
          question: `What time on ${item.temporal.raw} should I remind you?`,
          priority: 3,
          blocking: false,
        });
      }
    }

    // --- A future event with no date cannot be placed on a timeline. ------
    if (item.type === 'FUTURE_EVENT' && !item.temporal.resolved && !item.temporal.recurrence) {
      candidates.push({
        missing: {
          field: 'event_date',
          about_item_id: item.id,
          reason: 'A planned event has no date, so it cannot be scheduled.',
          importance: 'MEDIUM',
        },
        question: `When is "${shortTitle(item)}" happening?`,
        priority: 4,
        blocking: false,
      });
    }

    // --- A task with an unresolvable deadline the user did state. ---------
    if (item.type === 'TASK' && item.temporal.raw && !item.temporal.resolved) {
      candidates.push({
        missing: {
          field: 'task_due_date',
          about_item_id: item.id,
          reason: `The deadline "${item.temporal.raw}" could not be resolved to a date.`,
          importance: 'MEDIUM',
        },
        question: `You mentioned "${item.temporal.raw}" — which date does that mean?`,
        priority: 2,
        blocking: false,
      });
    }
  }

  // Model-reported gaps are recorded, but only HIGH ones may become a question,
  // and only behind Lifelog's own candidates.
  for (const entry of modelMissing) {
    const alreadyKnown = candidates.some((candidate) => candidate.missing.field === entry.field);
    if (alreadyKnown) continue;
    candidates.push({
      missing: entry,
      question: `Could you tell me the ${entry.field.replace(/_/g, ' ')}?`,
      priority: entry.importance === 'HIGH' ? 6 : 9,
      blocking: false,
    });
  }

  const missing = candidates.map((candidate) => candidate.missing);

  // --- Should Lifelog actually ask? --------------------------------------
  const askable = candidates
    .filter((candidate) => isAskable(candidate, context))
    .sort((a, b) => a.priority - b.priority);

  const chosen = askable[0];
  if (!chosen) return { missing, followUp: null };

  return {
    missing,
    followUp: {
      question: chosen.question,
      reason: chosen.missing.reason,
      missing_fields: [chosen.missing.field],
      blocking: chosen.blocking,
    },
  };
}

/**
 * The restraint rule.
 *
 * A candidate may be asked only when the user's intent shows they want Lifelog
 * to act on it. Pure recording and pure reflection are never interrupted.
 */
function isAskable(candidate: Candidate, context: FollowUpContext): boolean {
  // Never interrogate a diary entry or a passing remark.
  if (context.intent === 'REFLECT' || context.intent === 'SMALL_TALK' || context.intent === 'ASK') {
    return false;
  }

  // A blocking gap in something the user explicitly requested always qualifies.
  if (candidate.blocking) return true;

  // Non-blocking gaps only when the user is asking Lifelog to schedule something.
  if (context.intent === 'SET_REMINDER') return candidate.priority <= 3;
  if (context.intent === 'PLAN' || context.intent === 'CAPTURE_TASK') return candidate.priority <= 4;

  // Plain LOG intent: the user is recording, not requesting. Stay quiet.
  return false;
}
