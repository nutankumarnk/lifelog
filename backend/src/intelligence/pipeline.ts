/**
 * The Lifelog intelligence pipeline — AI-first.
 *
 *   segment → ask the AI (always, when a hosted model is configured)
 *     → normalise → ground → classify → Reminder/Task modules
 *     → stance / gaps / emotional impact → calibrate → validate
 *
 * The hosted model is the primary reader of the user's words. The offline rule
 * engine runs alongside it as a *training* draft and as the safety net when the
 * model is unavailable; it never pre-empts a successful model reading.
 *
 * See docs/algorithm.md.
 */
import { LocalRuleProvider } from '../ai/local.provider.js';
import { runProviders, type AiRuntimeOptions, type ProviderAttempt } from '../ai/registry.js';
import { enrichActionItems } from '../domain/action-items.js';
import {
  AnalysisSchema,
  ANALYSIS_SCHEMA_VERSION,
  type Analysis,
  type AnalysisGap,
  type EmotionalImpact,
  type Entity,
  type Intent,
  type Item,
  type Warning,
} from '../schemas/analysis.schema.js';
import {
  enforceTaskReminderDistinction,
  enrichFeelings,
  pruneEmptyItems,
  reconcileTenseAndType,
  resolveItemTemporals,
  type ClassificationContext,
} from './classify.js';
import { calibrate } from './confidence.js';
import { inferEmotionalImpact } from './emotional-impact.js';
import { evaluateFollowUp } from './follow-up.js';
import { detectGaps, scoreAlgorithmConfidence } from './gaps.js';
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
import { detectStance } from './stance.js';

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

function detectLanguage(text: string, reported: string | undefined): string {
  const hasNonLatin = NON_LATIN_SCRIPT.test(text);
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const hinglishHits = words.filter((word) => HINGLISH_MARKERS.includes(word)).length;
  const hasLatin = /[a-z]/i.test(text);

  if (hasNonLatin && hasLatin) return 'mixed';
  if (hasNonLatin) return reported?.toLowerCase() ?? 'und';
  if (hinglishHits >= 2) return 'mixed';

  const claimed = reported?.trim().toLowerCase();
  if (claimed && claimed !== 'und' && claimed.length <= 12) return claimed;
  return hasLatin ? 'en' : 'und';
}

function fallbackSummary(text: string): string {
  const first = text.trim().replace(/\s+/g, ' ');
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

interface ProcessedDraft {
  intent: Intent;
  intentConfidence: number;
  languageHint: string | undefined;
  summary: string;
  entities: Entity[];
  items: Item[];
  missingRaw: unknown;
  warnings: Warning[];
}

/** Shared normalisation → ground → classify → Reminder/Task enrich. */
function processRawExtraction(
  text: string,
  now: Date,
  timezone: string | null,
  raw: Record<string, unknown>,
  segments: ReturnType<typeof segmentConversation>,
): ProcessedDraft {
  const warnings: Warning[] = [];

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

  const grounded = groundAnalysis(text, normalizedEntities.entities, normalizedItems.items);
  warnings.push(...grounded.warnings);

  const deduplicated = deduplicateItems(grounded.items);
  warnings.push(...deduplicated.warnings);

  const context: ClassificationContext = { text, now, timezone };

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

  const settled = deduplicateItems(items);
  items = settled.items;
  warnings.push(...settled.warnings);

  for (const item of items) {
    if (item.source_span) {
      const segment = segments.find(
        (candidate) =>
          item.source_span!.start >= candidate.span.start && item.source_span!.start < candidate.span.end,
      );
      item.segment_index = segment?.index ?? null;
    }
  }

  items = enrichActionItems(items, { text, entities: grounded.entities });

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

  return {
    intent,
    intentConfidence: typeof raw.intent_confidence === 'number' ? raw.intent_confidence : 0.5,
    languageHint: typeof raw.language === 'string' ? raw.language : undefined,
    summary:
      typeof raw.summary === 'string' && raw.summary.trim()
        ? raw.summary.trim()
        : fallbackSummary(text),
    entities: grounded.entities,
    items,
    missingRaw: raw.missing_information,
    warnings,
  };
}

/**
 * Runs a conversation through the full understanding pipeline.
 *
 * The configured provider always gets the user's text. Only if it fails does
 * the offline engine's reading become the answer, and that is reported as
 * `degraded` so nobody mistakes a rule-engine reading for the model's.
 */
export async function understandConversation(
  runtime: AiRuntimeOptions,
  request: UnderstandRequest,
): Promise<UnderstandResult> {
  const startedAt = Date.now();
  const segments = segmentConversation(request.text);

  const instructions = buildInstructions();
  const userMessage = buildUserMessage(request);

  // --- Ask the provider (AI-first) ---------------------------------------
  const providerResult = await runProviders(runtime, {
    text: request.text,
    now: request.now,
    timezone: request.timezone,
    instructions,
    userMessage,
  });

  let draft = processRawExtraction(
    request.text,
    request.now,
    request.timezone,
    (providerResult.raw ?? {}) as Record<string, unknown>,
    segments,
  );

  const degraded = providerResult.degraded;
  const usedHostedModel = !degraded && runtime.primary.name === 'openrouter';

  if (degraded) {
    const failure = providerResult.attempts.find((attempt) => attempt.status === 'error');
    draft.warnings.push({
      code: 'PROVIDER_DEGRADED',
      message: `the AI model was unavailable; answered by the ${providerResult.provider} engine`,
      detail: {
        failedProvider: failure?.provider ?? null,
        reason: failure?.errorKind ?? null,
        detail: failure?.errorMessage ?? null,
      },
    });
  }

  // --- Training draft (offline engine, never overrides a model answer) ----
  // Runs only when the model answered, so we can measure the algorithm against
  // it later. It costs a few milliseconds and never changes the response.
  let algorithmConfidence = 0.5;
  if (usedHostedModel) {
    try {
      const local = new LocalRuleProvider();
      const localResult = await local.analyze({
        text: request.text,
        now: request.now,
        timezone: request.timezone,
        instructions,
        userMessage,
      });
      const localDraft = processRawExtraction(
        request.text,
        request.now,
        request.timezone,
        (localResult.raw ?? {}) as Record<string, unknown>,
        segments,
      );
      const localGaps = detectGaps(localDraft.items, {
        text: request.text,
        intent: localDraft.intent,
      });
      algorithmConfidence = scoreAlgorithmConfidence(localDraft.items, localGaps);
    } catch {
      algorithmConfidence = 0.4;
    }
  }

  const gaps: AnalysisGap[] = detectGaps(draft.items, {
    text: request.text,
    intent: draft.intent,
  });
  if (!usedHostedModel) {
    algorithmConfidence = scoreAlgorithmConfidence(draft.items, gaps);
  }

  const emotionalImpact: EmotionalImpact[] = inferEmotionalImpact(
    request.text,
    draft.items,
    draft.entities,
  );

  const stance = detectStance(request.text, draft.intent, draft.items);

  const { missing, followUp } = evaluateFollowUp(
    draft.items,
    { intent: draft.intent, text: request.text },
    normalizeMissingInformation(draft.missingRaw),
  );

  const candidate = {
    schema_version: ANALYSIS_SCHEMA_VERSION,
    intent: draft.intent,
    intent_confidence: draft.intentConfidence,
    stance: stance.stance,
    stance_confidence: stance.confidence,
    language: detectLanguage(request.text, draft.languageHint),
    summary: draft.summary,
    segments,
    entities: draft.entities,
    items: draft.items,
    emotional_impact: emotionalImpact,
    gaps,
    algorithm_confidence: algorithmConfidence,
    reconciliation: {
      used_ai_teacher: usedHostedModel,
      skipped_ai: false,
      disagreement_count: 0,
      winners: [degraded ? 'offline-engine' : providerResult.provider],
    },
    missing_information: missing,
    follow_up: followUp,
    warnings: draft.warnings,
  };

  const parsed = AnalysisSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `Pipeline produced an invalid analysis: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    );
  }

  const analysis = calibrate(parsed.data, {
    degraded,
    repaired: draft.warnings.some((warning) => warning.code === 'INTENT_COERCED'),
  });

  return {
    analysis,
    provider: providerResult.provider,
    model: providerResult.model,
    degraded,
    latencyMs: Date.now() - startedAt,
    attempts: providerResult.attempts,
    rawModelOutput: providerResult.raw,
  };
}
