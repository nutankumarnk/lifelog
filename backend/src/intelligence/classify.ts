/**
 * Classification rules Lifelog enforces regardless of what the model said.
 *
 * A model's type labels drift between versions and providers. These rules are
 * the parts of classification that must stay stable because the product's
 * behaviour depends on them:
 *
 *   - a REMINDER means the user asked to be prompted, not merely that they
 *     want to do something;
 *   - tense must agree with the resolved date, not with the model's guess;
 *   - a MEMORY needs experiential substance, not just a past-tense verb.
 *
 * Each rule is applied after normalisation and grounding, and each records a
 * warning when it changes something so the override is auditable.
 */
import type { Item, Warning } from '../schemas/analysis.schema.js';
import { EMOTION_LEXICON, REMINDER_MARKERS, TASK_MARKERS, containsAny } from './lexicon.js';
import { inferTenseFromGrammar, resolvePhrase } from './temporal.js';

export interface ClassificationContext {
  /** The full conversation, used to check wording around an item. */
  text: string;
  now: Date;
  timezone: string | null;
}

export interface ClassificationResult {
  items: Item[];
  warnings: Warning[];
}

/**
 * Resolves every item's temporal block from its raw phrase.
 *
 * The model supplies the phrase; Lifelog does the arithmetic. When no phrase
 * was reported, grammar provides a tense but never a date — an invented date is
 * exactly the failure this design avoids.
 */
export function resolveItemTemporals(items: Item[], context: ClassificationContext): ClassificationResult {
  const warnings: Warning[] = [];

  for (const item of items) {
    if (!item.temporal.raw) {
      const tense = inferTenseFromGrammar(item.source_text || item.title);
      item.temporal = {
        ...item.temporal,
        tense: item.temporal.tense === 'UNSPECIFIED' ? tense : item.temporal.tense,
        timezone: context.timezone,
        confidence: tense === 'UNSPECIFIED' ? 0 : 0.3,
      };
      continue;
    }

    const resolution = resolvePhrase(item.temporal.raw, context.now);
    const grammarTense = inferTenseFromGrammar(item.source_text || item.title);

    item.temporal = {
      ...item.temporal,
      // An ambiguous phrase ("kal" is both yesterday and tomorrow) defers to
      // the surrounding grammar rather than resolving to a coin-flip date.
      tense: resolution.tense === 'UNSPECIFIED' ? grammarTense : resolution.tense,
      resolved: resolution.resolved,
      resolved_end: resolution.resolvedEnd,
      precision: resolution.precision,
      recurrence: item.temporal.recurrence ?? resolution.recurrence,
      timezone: context.timezone,
      confidence: resolution.confidence,
    };

    if (resolution.precision === 'RELATIVE' && resolution.resolved === null) {
      warnings.push({
        code: 'TEMPORAL_UNRESOLVED',
        message: `kept "${item.temporal.raw}" unresolved — the phrase is ambiguous`,
        detail: { itemId: item.id },
      });
    }
  }

  return { items, warnings };
}

/**
 * Enforces the task/reminder distinction.
 *
 * This is a product rule, not a linguistic one: Lifelog will eventually send
 * notifications, and notifying someone who never asked to be notified is a
 * worse failure than missing a reminder they did ask for. So a REMINDER must be
 * backed by explicit request wording in the item's own text.
 */
export function enforceTaskReminderDistinction(
  items: Item[],
  context: ClassificationContext,
): ClassificationResult {
  const warnings: Warning[] = [];

  for (const item of items) {
    const evidence = item.source_text || item.title;
    const askedToBeReminded = containsAny(evidence, REMINDER_MARKERS);

    if (item.type === 'REMINDER' && !askedToBeReminded) {
      // The whole conversation can license a reminder for a single item, e.g.
      // "remind me about these: pay rent, call mum".
      if (containsAny(context.text, REMINDER_MARKERS)) {
        item.details = { ...item.details, explicit: true };
        continue;
      }
      item.type = 'TASK';
      item.details = {
        ...item.details,
        explicit: false,
        status: item.details.status ?? 'OPEN',
        priority: item.details.priority ?? 'NORMAL',
      };
      warnings.push({
        code: 'REMINDER_DEMOTED',
        message: `"${item.title}" became a TASK — the user did not ask to be reminded`,
        detail: { itemId: item.id },
      });
      continue;
    }

    if (item.type === 'REMINDER') {
      item.details = { ...item.details, explicit: true, status: item.details.status ?? 'OPEN' };
      if (item.details.trigger_at === undefined) {
        item.details = { ...item.details, trigger_at: item.temporal.resolved };
      }
      continue;
    }

    // The reverse case: the user clearly asked to be reminded but the model
    // labelled it a task.
    if (item.type === 'TASK') {
      if (askedToBeReminded) {
        item.type = 'REMINDER';
        item.details = {
          ...item.details,
          explicit: true,
          status: item.details.status ?? 'OPEN',
          trigger_at: item.temporal.resolved,
        };
        warnings.push({
          code: 'TASK_PROMOTED',
          message: `"${item.title}" became a REMINDER — the user asked to be reminded`,
          detail: { itemId: item.id },
        });
        continue;
      }
      item.details = {
        ...item.details,
        status: item.details.status ?? 'OPEN',
        priority: item.details.priority ?? 'NORMAL',
      };
    }
  }

  return { items, warnings };
}

/**
 * Aligns item type with resolved tense.
 *
 * A PAST_EVENT dated next Tuesday is incoherent. When the date and the type
 * disagree, the date wins — it came from the user's own words via Lifelog's
 * own resolver, whereas the type came from the model.
 */
export function reconcileTenseAndType(items: Item[]): ClassificationResult {
  const warnings: Warning[] = [];

  for (const item of items) {
    const { tense } = item.temporal;
    // Tasks and reminders are inherently forward-looking; their tense says
    // nothing about their type.
    if (item.type === 'TASK' || item.type === 'REMINDER' || item.type === 'FEELING' || item.type === 'DECISION') {
      continue;
    }

    if (tense === 'FUTURE' && (item.type === 'PAST_EVENT' || item.type === 'MEMORY')) {
      item.type = 'FUTURE_EVENT';
      warnings.push({
        code: 'TYPE_RECLASSIFIED',
        message: `"${item.title}" became a FUTURE_EVENT — its date is in the future`,
        detail: { itemId: item.id, temporal: item.temporal.raw },
      });
      continue;
    }

    if (tense === 'PAST' && item.type === 'FUTURE_EVENT') {
      item.type = 'PAST_EVENT';
      warnings.push({
        code: 'TYPE_RECLASSIFIED',
        message: `"${item.title}" became a PAST_EVENT — its date has passed`,
        detail: { itemId: item.id, temporal: item.temporal.raw },
      });
    }
  }

  return { items, warnings };
}

/**
 * Fills in feeling details the model left incomplete.
 *
 * The user's own emotion word is kept as-is; Lifelog only adds the polarity and
 * intensity it can derive. Renaming "gutted" to "sadness" would lose the thing
 * that makes a diary entry worth re-reading.
 */
export function enrichFeelings(items: Item[]): ClassificationResult {
  for (const item of items) {
    if (item.type !== 'FEELING') continue;

    const evidence = `${item.source_text} ${item.title}`.toLowerCase();
    const known = EMOTION_LEXICON.find((entry) => entry.words.some((word) => evidence.includes(word)));

    item.details = {
      ...item.details,
      emotion: item.details.emotion ?? known?.emotion ?? 'unspecified',
      sentiment: item.details.sentiment ?? known?.polarity ?? 'NEUTRAL',
      intensity: item.details.intensity ?? known?.intensity ?? 0.5,
      about: item.details.about ?? null,
    };
  }

  return { items, warnings: [] };
}

/**
 * Removes PRESENT_FACT items that carry no information.
 *
 * Models like to emit a "fact" for every sentence. A fact that is really just
 * an obligation restated, or fewer than a few words, adds noise to a life
 * record that a user will eventually have to read.
 */
export function pruneEmptyItems(items: Item[]): ClassificationResult {
  const warnings: Warning[] = [];

  const kept = items.filter((item) => {
    if (item.type !== 'PRESENT_FACT') return true;

    const words = (item.source_text || item.title).trim().split(/\s+/).length;
    if (words < 3) {
      warnings.push({
        code: 'ITEM_PRUNED',
        message: `dropped an empty PRESENT_FACT ("${item.title}")`,
      });
      return false;
    }
    // Restated obligations are already represented as a TASK.
    if (containsAny(item.source_text || item.title, TASK_MARKERS)) {
      const hasTaskForSameSpan = items.some(
        (other) =>
          other.type === 'TASK' &&
          other.source_span &&
          item.source_span &&
          other.source_span.start === item.source_span.start,
      );
      if (hasTaskForSameSpan) {
        warnings.push({
          code: 'ITEM_PRUNED',
          message: `dropped a PRESENT_FACT that restates a TASK ("${item.title}")`,
        });
        return false;
      }
    }
    return true;
  });

  kept.forEach((item, index) => {
    item.id = `i${index + 1}`;
  });

  return { items: kept, warnings };
}
