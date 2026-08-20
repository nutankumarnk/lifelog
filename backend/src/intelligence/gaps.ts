/**
 * Gap detection — what the algorithm draft could not resolve confidently.
 */
import type { AnalysisGap, Item, Intent } from '../schemas/analysis.schema.js';
import { REMINDER_MARKERS, containsAny } from './lexicon.js';

export interface GapContext {
  text: string;
  intent: Intent;
}

const PRONOUNS = /\b(he|she|him|her|they|them|his|hers|their)\b/i;

/**
 * Lists unresolved issues that a teacher model may help with.
 */
export function detectGaps(items: Item[], context: GapContext): AnalysisGap[] {
  const gaps: AnalysisGap[] = [];
  const lower = context.text.toLowerCase();

  const multiClause =
    (context.text.match(/\band\b/gi) ?? []).length >= 1 &&
    items.length < 2 &&
    context.text.split(/\s+/).length > 12;
  if (multiClause) {
    gaps.push({
      code: 'MULTI_FACT_SPLIT',
      message: 'message may contain multiple facts but few items were extracted',
      about_item_id: null,
    });
  }

  if (PRONOUNS.test(context.text) && items.every((item) => item.entity_ids.length === 0)) {
    gaps.push({
      code: 'PRONOUN_UNRESOLVED',
      message: 'pronoun present without linked entities',
      about_item_id: null,
    });
  }

  for (const item of items) {
    if (item.type === 'REMINDER' && !item.temporal.raw && !containsAny(lower, ['tomorrow', 'today', 'at ', 'on '])) {
      gaps.push({
        code: 'REMINDER_MISSING_TIME',
        message: 'reminder has no temporal phrase',
        about_item_id: item.id,
      });
    }
    if (!item.source_text || item.source_span === null) {
      gaps.push({
        code: 'UNGROUNDED_ITEM',
        message: `item ${item.id} is not fully grounded`,
        about_item_id: item.id,
      });
    }
  }

  const askedReminder = containsAny(lower, REMINDER_MARKERS);
  if (askedReminder && !items.some((item) => item.type === 'REMINDER')) {
    gaps.push({
      code: 'REMINDER_NOT_CAPTURED',
      message: 'user asked to be reminded but no REMINDER item exists',
      about_item_id: null,
    });
  }

  const hasFeelingWord = /\b(happy|sad|angry|calm|anxious|excited|frustrated|loved|hurt)\b/i.test(
    context.text,
  );
  if (hasFeelingWord && !items.some((item) => item.type === 'FEELING')) {
    gaps.push({
      code: 'FEELING_NOT_SPLIT',
      message: 'emotion word present but no FEELING item',
      about_item_id: null,
    });
  }

  return gaps;
}

/** Rough algorithm confidence from grounding + gap count. */
export function scoreAlgorithmConfidence(items: Item[], gaps: AnalysisGap[]): number {
  if (items.length === 0) return gaps.length === 0 ? 0.7 : 0.35;
  const grounded = items.filter((item) => item.source_text && item.source_span).length;
  const groundRatio = grounded / items.length;
  const gapPenalty = Math.min(0.4, gaps.length * 0.08);
  return Math.max(0.15, Math.min(0.95, 0.45 + groundRatio * 0.45 - gapPenalty));
}
