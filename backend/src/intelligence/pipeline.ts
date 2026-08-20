/**
 * The Lifelog intelligence pipeline.
 *
 *   algorithm draft → enrich Reminder/Task → stance / gaps / impact
 *     → (optional) Gemma teacher for gaps → reconcile → calibrate → validate
 *
 * When the algorithm draft is high-confidence with no gaps, the hosted model is
 * skipped. Mock/local primaries still run as the extraction source so tests and
 * offline mode keep working. See docs/algorithm.md.
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

const SKIP_AI_CONFIDENCE = 0.78;

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
 */
export async function understandConversation(
  runtime: AiRuntimeOptions,
  request: UnderstandRequest,
): Promise<UnderstandResult> {
  const startedAt = Date.now();
  const segments = segmentConversation(request.text);

  const fullInstructions = buildInstructions();
  const fullUserMessage = buildUserMessage(request);

  // --- Algorithm draft (always, via local rule engine) -------------------
  const localProvider = new LocalRuleProvider();
  const draftProviderResult = await runProviders(
    { primary: localProvider, fallback: null, maxRetries: 0 },
    {
      text: request.text,
      now: request.now,
      timezone: request.timezone,
      instructions: fullInstructions,
      userMessage: fullUserMessage,
    },
  );

  let draft = processRawExtraction(
    request.text,
    request.now,
    request.timezone,
    (draftProviderResult.raw ?? {}) as Record<string, unknown>,
    segments,
  );

  let gaps: AnalysisGap[] = detectGaps(draft.items, { text: request.text, intent: draft.intent });
  let algorithmConfidence = scoreAlgorithmConfidence(draft.items, gaps);
  const stanceDraft = detectStance(request.text, draft.intent, draft.items);

  /** Gaps that actually need a hosted model — pronouns alone are not enough. */
  const AI_WORTHY_GAPS = new Set([
    'MULTI_FACT_SPLIT',
    'REMINDER_NOT_CAPTURED',
    'FEELING_NOT_SPLIT',
    'UNGROUNDED_ITEM',
    'REMINDER_MISSING_TIME',
  ]);
  const needsHostedHelp =
    gaps.some((gap) => AI_WORTHY_GAPS.has(gap.code)) || algorithmConfidence < 0.55;

  const primaryName = runtime.primary.name;
  const honorScriptedPrimary = primaryName === 'mock' || primaryName === 'local';
  const canSkipHosted =
    !honorScriptedPrimary && algorithmConfidence >= SKIP_AI_CONFIDENCE && !needsHostedHelp;

  let providerName = draftProviderResult.provider;
  let providerModel = draftProviderResult.model;
  let degraded = false;
  let attempts: ProviderAttempt[] = [...draftProviderResult.attempts];
  let rawModelOutput: unknown = draftProviderResult.raw;
  let usedAiTeacher = false;
  let skippedAi = false;
  let disagreementCount = 0;
  let winners: string[] = ['algorithm'];
  let emotionalImpact: EmotionalImpact[] = inferEmotionalImpact(
    request.text,
    draft.items,
    draft.entities,
  );

  if (canSkipHosted) {
    skippedAi = true;
    winners = ['algorithm'];
  } else if (honorScriptedPrimary) {
    // Tests and forced-local: primary extraction is authoritative.
    const providerResult = await runProviders(runtime, {
      text: request.text,
      now: request.now,
      timezone: request.timezone,
      instructions: fullInstructions,
      userMessage: fullUserMessage,
    });
    attempts = [...attempts, ...providerResult.attempts];
    rawModelOutput = providerResult.raw;
    providerName = providerResult.provider;
    providerModel = providerResult.model;
    degraded = providerResult.degraded;
    draft = processRawExtraction(
      request.text,
      request.now,
      request.timezone,
      (providerResult.raw ?? {}) as Record<string, unknown>,
      segments,
    );
    if (providerResult.degraded) {
      draft.warnings.push({
        code: 'PROVIDER_DEGRADED',
        message: `answered by the ${providerResult.provider} fallback provider`,
        detail: {
          failedProvider: providerResult.attempts.find((a) => a.status === 'error')?.provider ?? null,
          reason: providerResult.attempts.find((a) => a.status === 'error')?.errorKind ?? null,
        },
      });
    }
    gaps = detectGaps(draft.items, { text: request.text, intent: draft.intent });
    algorithmConfidence = scoreAlgorithmConfidence(draft.items, gaps);
    emotionalImpact = inferEmotionalImpact(request.text, draft.items, draft.entities);
    winners = [providerResult.degraded ? 'algorithm-fallback' : 'primary'];
  } else if (needsHostedHelp && runtime.primary.isAvailable()) {
    // Complex / multi-fact messages need a full hosted reading. The teacher
    // patch path is too brittle on free-tier hosts (timeouts return the local
    // fallback, which we already have as the draft). Prefer full extract.
    const providerResult = await runProviders(runtime, {
      text: request.text,
      now: request.now,
      timezone: request.timezone,
      instructions: fullInstructions,
      userMessage: fullUserMessage,
    });
    attempts = [...attempts, ...providerResult.attempts];
    rawModelOutput = providerResult.raw;
    providerName = providerResult.provider;
    providerModel = providerResult.model;
    degraded = providerResult.degraded;

    if (providerResult.degraded) {
      draft.warnings.push({
        code: 'PROVIDER_DEGRADED',
        message: `hosted model unavailable for a complex message; kept algorithm draft`,
        detail: {
          failedProvider: providerResult.attempts.find((a) => a.status === 'error')?.provider ?? null,
          reason: providerResult.attempts.find((a) => a.status === 'error')?.errorKind ?? null,
          gaps: gaps.map((gap) => gap.code),
        },
      });
      winners = ['algorithm'];
    } else {
      const hosted = processRawExtraction(
        request.text,
        request.now,
        request.timezone,
        (providerResult.raw ?? {}) as Record<string, unknown>,
        segments,
      );
      // Prefer hosted when it produced a richer split than the draft.
      const hostedRicher =
        hosted.items.length > draft.items.length ||
        hosted.entities.length > draft.entities.length ||
        hosted.items.some((item) => item.type === 'FEELING' || item.type === 'REMINDER');
      if (hostedRicher || hosted.items.length > 0) {
        draft = hosted;
        winners = ['primary'];
        usedAiTeacher = false;
      } else {
        draft.warnings.push({
          code: 'HOSTED_UNHELPFUL',
          message: 'hosted model returned no usable items; kept algorithm draft',
        });
        winners = ['algorithm'];
      }
    }
    gaps = detectGaps(draft.items, { text: request.text, intent: draft.intent });
    algorithmConfidence = scoreAlgorithmConfidence(draft.items, gaps);
    emotionalImpact = inferEmotionalImpact(request.text, draft.items, draft.entities);
  } else {
    // Hosted full extract when draft is weak but has no structured gaps list,
    // or primary unavailable for teacher.
    const providerResult = await runProviders(runtime, {
      text: request.text,
      now: request.now,
      timezone: request.timezone,
      instructions: fullInstructions,
      userMessage: fullUserMessage,
    });
    attempts = [...attempts, ...providerResult.attempts];
    rawModelOutput = providerResult.raw;
    providerName = providerResult.provider;
    providerModel = providerResult.model;
    degraded = providerResult.degraded;
    if (providerResult.degraded) {
      draft.warnings.push({
        code: 'PROVIDER_DEGRADED',
        message: `answered by the ${providerResult.provider} fallback provider`,
      });
      // Keep algorithm draft when hosted fails.
      winners = ['algorithm'];
    } else {
      draft = processRawExtraction(
        request.text,
        request.now,
        request.timezone,
        (providerResult.raw ?? {}) as Record<string, unknown>,
        segments,
      );
      winners = ['primary'];
    }
    gaps = detectGaps(draft.items, { text: request.text, intent: draft.intent });
    algorithmConfidence = scoreAlgorithmConfidence(draft.items, gaps);
    emotionalImpact = inferEmotionalImpact(request.text, draft.items, draft.entities);
  }

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
      used_ai_teacher: usedAiTeacher && !degraded,
      skipped_ai: skippedAi,
      disagreement_count: disagreementCount,
      winners,
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
    provider: providerName,
    model: providerModel,
    degraded,
    latencyMs: Date.now() - startedAt,
    attempts,
    rawModelOutput,
  };
}
