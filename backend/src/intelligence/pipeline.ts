/**
 * The Lifelog intelligence pipeline.
 *
 * This is where Lifelog's own reasoning lives. The AI provider contributes one
 * step in the middle; every decision that defines the product happens here, in
 * code Lifelog owns and can test without a network call.
 *
 *   segment → prompt → [AI provider] → normalise → ground → deduplicate
 *           → resolve time → classify → detect gaps → calibrate → validate
 *
 * Read top to bottom: each stage is a named function in its own module, and the
 * order is the contract. See docs/algorithm.md and docs/architecture.md.
 */
import { runProviders, type AiRuntimeOptions, type ProviderAttempt } from '../ai/registry.js';
import { AnalysisSchema, ANALYSIS_SCHEMA_VERSION, type Analysis, type Warning } from '../schemas/analysis.schema.js';
import {
  enforceTaskReminderDistinction,
  enrichFeelings,
  pruneEmptyItems,
  reconcileTenseAndType,
  resolveItemTemporals,
  type ClassificationContext,
} from './classify.js';
import { calibrate } from './confidence.js';
import { evaluateFollowUp } from './follow-up.js';
import { deduplicateItems, groundAnalysis } from './grounding.js';
import { HINGLISH_MARKERS, NON_LATIN_SCRIPT } from './lexicon.js';
import {
  coerceIntent,
  normalizeEntities,
  normalizeItems,
  normalizeMissingInformation,
} from './normalize.js';
import { buildInstructions, buildUserMessage } from './prompt.js';
import { segmentConversation } from './segment.js';

export interface UnderstandRequest {
  text: string;
  now: Date;
  timezone: string | null;
}

export interface UnderstandResult {
  analysis: Analysis;
  provider: string;
  model: string;
  degraded: boolean;
  latencyMs: number;
  attempts: ProviderAttempt[];
  /** The model's unmodified output, for debugging. Not returned by the API. */
  rawModelOutput: unknown;
}

/**
 * Detects the conversation language.
 *
 * Deliberately coarse. Lifelog only needs to label the record and notice
 * code-switching; it never uses this to gate extraction, because refusing to
 * understand a language is worse than mislabelling it.
 */
function detectLanguage(text: string, reported: string | undefined): string {
  const hasNonLatin = NON_LATIN_SCRIPT.test(text);
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const hinglishHits = words.filter((word) => HINGLISH_MARKERS.includes(word)).length;
  const hasLatin = /[a-z]/i.test(text);

  if (hasNonLatin && hasLatin) return 'mixed';
  if (hasNonLatin) return reported?.toLowerCase() ?? 'und';
  // Romanised Hindi inside English text is the common case here and no script
  // check can catch it, so a small marker list carries the decision.
  if (hinglishHits >= 2) return 'mixed';

  const claimed = reported?.trim().toLowerCase();
  if (claimed && claimed !== 'und' && claimed.length <= 12) return claimed;
  return hasLatin ? 'en' : 'und';
}

/** One neutral sentence describing the conversation, used when the model gives none. */
function fallbackSummary(text: string): string {
  const first = text.trim().replace(/\s+/g, ' ');
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

/**
 * Runs a conversation through the full understanding pipeline.
 *
 * Throws only when no provider could produce anything at all; every other
 * failure degrades into warnings on a valid analysis.
 */
export async function understandConversation(
  runtime: AiRuntimeOptions,
  request: UnderstandRequest,
): Promise<UnderstandResult> {
  const startedAt = Date.now();
  const warnings: Warning[] = [];

  // --- 1. Segment ---------------------------------------------------------
  // Done before the model call so segmentation is stable regardless of provider.
  const segments = segmentConversation(request.text);

  // --- 2. Ask the AI provider --------------------------------------------
  const providerResult = await runProviders(runtime, {
    text: request.text,
    now: request.now,
    timezone: request.timezone,
    instructions: buildInstructions(),
    userMessage: buildUserMessage(request),
  });

  if (providerResult.degraded) {
    const failure = providerResult.attempts.find((attempt) => attempt.status === 'error');
    warnings.push({
      code: 'PROVIDER_DEGRADED',
      message: `answered by the ${providerResult.provider} fallback provider`,
      detail: { failedProvider: failure?.provider ?? null, reason: failure?.errorKind ?? null },
    });
  }

  const raw = (providerResult.raw ?? {}) as Record<string, unknown>;

  // --- 3. Normalise -------------------------------------------------------
  const { intent: coercedIntent, exact } = coerceIntent(raw.intent);
  if (!exact && raw.intent !== undefined) {
    warnings.push({
      code: 'INTENT_COERCED',
      message: `mapped reported intent "${String(raw.intent)}" onto ${coercedIntent}`,
    });
  }

  const normalizedEntities = normalizeEntities(raw.entities);
  warnings.push(...normalizedEntities.warnings);

  const normalizedItems = normalizeItems(raw.items, normalizedEntities.idMap);
  warnings.push(...normalizedItems.warnings);

  // --- 4. Ground ----------------------------------------------------------
  const grounded = groundAnalysis(request.text, normalizedEntities.entities, normalizedItems.items);
  warnings.push(...grounded.warnings);

  // --- 5. Deduplicate -----------------------------------------------------
  const deduplicated = deduplicateItems(grounded.items);
  warnings.push(...deduplicated.warnings);

  // --- 6..9. Classification rules Lifelog owns ---------------------------
  const context: ClassificationContext = {
    text: request.text,
    now: request.now,
    timezone: request.timezone,
  };

  let items = deduplicated.items;
  for (const stage of [
    resolveItemTemporals,
    enforceTaskReminderDistinction,
    reconcileTenseAndType,
    enrichFeelings,
    pruneEmptyItems,
  ]) {
    const result = stage(items, context);
    items = result.items;
    warnings.push(...result.warnings);
  }

  // Classification can create duplicates that did not exist before it ran — a
  // TASK promoted to REMINDER can collide with a REMINDER on the same span. So
  // deduplication runs again, after types have settled.
  const settled = deduplicateItems(items);
  items = settled.items;
  warnings.push(...settled.warnings);

  // Attach each item to the segment its span falls inside.
  for (const item of items) {
    if (item.source_span) {
      const segment = segments.find(
        (candidate) =>
          item.source_span!.start >= candidate.span.start && item.source_span!.start < candidate.span.end,
      );
      item.segment_index = segment?.index ?? null;
    }
  }

  // --- 10. Intent reconciliation -----------------------------------------
  // An explicit reminder outranks whatever the model called the conversation.
  let intent = coercedIntent;
  if (items.some((item) => item.type === 'REMINDER') && intent !== 'SET_REMINDER') {
    intent = 'SET_REMINDER';
    warnings.push({
      code: 'INTENT_OVERRIDDEN',
      message: 'intent set to SET_REMINDER because the user asked to be reminded',
    });
  } else if (intent === 'UNKNOWN' && items.length > 0) {
    intent = items.some((item) => item.type === 'TASK') ? 'CAPTURE_TASK' : 'LOG';
  }

  // --- 11. Missing information and follow-up -----------------------------
  const { missing, followUp } = evaluateFollowUp(
    items,
    { intent, text: request.text },
    normalizeMissingInformation(raw.missing_information),
  );

  // --- 12. Assemble and validate -----------------------------------------
  const candidate = {
    schema_version: ANALYSIS_SCHEMA_VERSION,
    intent,
    intent_confidence: typeof raw.intent_confidence === 'number' ? raw.intent_confidence : 0.5,
    language: detectLanguage(request.text, typeof raw.language === 'string' ? raw.language : undefined),
    summary:
      typeof raw.summary === 'string' && raw.summary.trim()
        ? raw.summary.trim()
        : fallbackSummary(request.text),
    segments,
    entities: grounded.entities,
    items,
    missing_information: missing,
    follow_up: followUp,
    warnings,
  };

  const parsed = AnalysisSchema.safeParse(candidate);
  if (!parsed.success) {
    // Reaching here means a pipeline bug, not a model failure — the model's
    // output was normalised several stages ago. Fail loudly in development.
    throw new Error(
      `Pipeline produced an invalid analysis: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    );
  }

  const analysis = calibrate(parsed.data, {
    degraded: providerResult.degraded,
    repaired: warnings.some((warning) => warning.code === 'INTENT_COERCED'),
  });

  return {
    analysis,
    provider: providerResult.provider,
    model: providerResult.model,
    degraded: providerResult.degraded,
    latencyMs: Date.now() - startedAt,
    attempts: providerResult.attempts,
    rawModelOutput: providerResult.raw,
  };
}
