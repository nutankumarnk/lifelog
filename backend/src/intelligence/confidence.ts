/**
 * Confidence calibration.
 *
 * A model's self-reported confidence is close to meaningless — it is high and
 * flat regardless of how hard the input was. Lifelog therefore treats the
 * model's number as one weak signal and adjusts it with evidence it can check
 * itself: was the item quoted or paraphrased, did the time phrase resolve, does
 * the item reference real entities, was a fallback provider used.
 *
 * The output is used for ranking and for deciding what to surface, not for
 * silently discarding data.
 */
import type { Analysis, Item } from '../schemas/analysis.schema.js';

export interface CalibrationContext {
  /** True when a fallback provider answered after the primary failed. */
  degraded: boolean;
  /** True when the model output needed syntactic repair before parsing. */
  repaired: boolean;
}

/** Confidence below this is worth showing to the user as uncertain. */
export const LOW_CONFIDENCE_THRESHOLD = 0.45;

/**
 * Nothing is ever reported as certain.
 *
 * Extraction is an interpretation of ambiguous natural language, and a 1.0 in
 * the UI would invite a user to stop checking. The conversation text is the
 * only thing Lifelog treats as certain, and it is stored separately.
 */
export const MAX_CONFIDENCE = 0.95;

function clamp(value: number): number {
  return Math.min(MAX_CONFIDENCE, Math.max(0.05, value));
}

function calibrateItem(item: Item, context: CalibrationContext): number {
  let score = item.confidence;

  // Quoted directly from the conversation: strong evidence.
  if (item.source_span) score += 0.1;
  else score -= 0.15;

  // A time phrase that resolved cleanly is corroborating evidence.
  if (item.temporal.raw && item.temporal.resolved) score += 0.05;
  // A phrase the user gave that Lifelog could not resolve is a real weakness.
  else if (item.temporal.raw && !item.temporal.resolved) score -= 0.1;

  // Items tied to named entities are rarely spurious.
  if (item.entity_ids.length > 0) score += 0.05;

  // A REMINDER that survived the explicit-request check is well evidenced.
  if (item.type === 'REMINDER' && item.details.explicit === true) score += 0.05;

  // Systemic penalties: the whole reading is less trustworthy.
  if (context.degraded) score -= 0.1;
  if (context.repaired) score -= 0.05;

  return Number(clamp(score).toFixed(2));
}

/**
 * Recalibrates every item's confidence and the overall intent confidence.
 * Mutates in place — the analysis object is owned by the pipeline at this point.
 */
export function calibrate(analysis: Analysis, context: CalibrationContext): Analysis {
  for (const item of analysis.items) {
    item.confidence = calibrateItem(item, context);
  }

  let intentConfidence = analysis.intent_confidence;
  if (analysis.items.length === 0 && analysis.intent !== 'SMALL_TALK' && analysis.intent !== 'UNKNOWN') {
    // Claiming a purposeful intent while extracting nothing is self-contradictory.
    intentConfidence -= 0.2;
  }
  if (context.degraded) intentConfidence -= 0.1;
  if (context.repaired) intentConfidence -= 0.05;

  analysis.intent_confidence = Number(clamp(intentConfidence).toFixed(2));
  return analysis;
}

/** Items Lifelog is unsure about, for the UI to mark as uncertain. */
export function lowConfidenceItems(analysis: Analysis): Item[] {
  return analysis.items.filter((item) => item.confidence < LOW_CONFIDENCE_THRESHOLD);
}
