/**
 * The Lifelog analysis contract.
 *
 * This file is the single source of truth for what "understanding a
 * conversation" produces. It is deliberately model-independent: no field here
 * exists because a particular LLM happens to emit it. The AI provider is
 * expected to produce something *close* to this shape; the intelligence layer
 * is responsible for repairing, grounding and validating it until it conforms.
 *
 * Changing this file changes the public API contract. Update docs/api.md,
 * docs/data-model.md and docs/changelog.md when you do.
 */
import { z } from 'zod';

/** Bumped whenever the analysis shape changes in a non-additive way. */
export const ANALYSIS_SCHEMA_VERSION = '1.1.0';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/**
 * What the user appears to want from Lifelog, not what the text is about.
 * "I need to call the bank" is intent CAPTURE_TASK; "did I call the bank?" is ASK.
 */
export const IntentEnum = z.enum([
  'LOG', // Recording something that happened or is true.
  'PLAN', // Describing something intended for the future.
  'CAPTURE_TASK', // Asking Lifelog to hold an action item.
  'SET_REMINDER', // Asking to be prompted at a time.
  'REFLECT', // Diary / emotional processing, no action expected.
  'ASK', // Querying Lifelog's memory. Answering is out of scope in Phase 1.
  'CORRECT', // Amending something previously said.
  'SMALL_TALK', // Greetings and chatter with no life data.
  'UNKNOWN', // Genuinely unclear. Never guess to avoid this value.
]);
export type Intent = z.infer<typeof IntentEnum>;

/**
 * First-hand behavior stance for *this message* — not a clinical or lasting
 * personality label. Soft archetype of what the user is doing right now.
 */
export const StanceEnum = z.enum([
  'VENT',
  'PLAN',
  'DECIDE',
  'REQUEST_HELP',
  'LOG',
  'SOCIAL',
  'CORRECT',
  'UNKNOWN',
]);
export type Stance = z.infer<typeof StanceEnum>;

/** The kinds of structured life information Phase 1 extracts. */
export const ItemTypeEnum = z.enum([
  'MEMORY', // A lived experience worth preserving.
  'PAST_EVENT', // Something that happened at a point in time.
  'PRESENT_FACT', // Something currently true about the user's life.
  'FUTURE_EVENT', // Something scheduled or expected.
  'TASK', // An action the user must complete.
  'REMINDER', // A time-anchored prompt the user wants to receive.
  'DECISION', // A choice the user has made.
  'FEELING', // An expressed emotional state.
]);
export type ItemType = z.infer<typeof ItemTypeEnum>;

/** Entity kinds. `OTHER` plus `raw_kind` keeps unknown/custom entities intact. */
export const EntityKindEnum = z.enum([
  'PERSON',
  'PLACE',
  'ORGANIZATION',
  'OBJECT',
  'TOPIC',
  'EVENT_NAME',
  'OTHER',
]);
export type EntityKind = z.infer<typeof EntityKindEnum>;

export const TenseEnum = z.enum(['PAST', 'PRESENT', 'FUTURE', 'UNSPECIFIED']);
export type Tense = z.infer<typeof TenseEnum>;

/** How precisely a temporal expression could be resolved to a calendar point. */
export const TemporalPrecisionEnum = z.enum([
  'EXACT_TIME',
  'DAY',
  'WEEK',
  'MONTH',
  'YEAR',
  'RELATIVE',
  'RECURRING',
  'NONE',
]);
export type TemporalPrecision = z.infer<typeof TemporalPrecisionEnum>;

export const TaskStatusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const PriorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const SentimentEnum = z.enum(['POSITIVE', 'NEGATIVE', 'MIXED', 'NEUTRAL']);

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const Confidence = z.number().min(0).max(1);

/**
 * A character range in the original conversation text. Spans are how Lifelog
 * proves an extraction is grounded in what the user actually wrote.
 */
export const SourceSpanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
});
export type SourceSpan = z.infer<typeof SourceSpanSchema>;

/**
 * Temporal information attached to an item.
 *
 * `raw` preserves what the user said ("yesterday"). `resolved` is Lifelog's
 * interpretation relative to the conversation timestamp. Both are kept, because
 * the resolution can be wrong while the raw phrase never is.
 */
export const TemporalSchema = z.object({
  tense: TenseEnum,
  raw: z.string().nullable(),
  resolved: z.string().nullable(), // ISO 8601 date or datetime.
  resolved_end: z.string().nullable().default(null),
  precision: TemporalPrecisionEnum,
  recurrence: z.string().nullable().default(null), // e.g. "every monday"
  timezone: z.string().nullable().default(null),
  confidence: Confidence.default(0.5),
});
export type Temporal = z.infer<typeof TemporalSchema>;

export const EMPTY_TEMPORAL: Temporal = {
  tense: 'UNSPECIFIED',
  raw: null,
  resolved: null,
  resolved_end: null,
  precision: 'NONE',
  recurrence: null,
  timezone: null,
  confidence: 0,
};

/**
 * A person, place, organisation, object or topic mentioned in the conversation.
 *
 * Unknown entity types are never discarded. If the model reports a kind Lifelog
 * does not model, the kind becomes `OTHER` and the original label is preserved
 * in `raw_kind` so a later phase can promote it to a first-class kind.
 */
export const EntitySchema = z.object({
  id: z.string(),
  kind: EntityKindEnum,
  raw_kind: z.string().nullable().default(null),
  name: z.string().min(1),
  normalized_name: z.string().min(1),
  /** Other surface forms seen in this conversation ("Arun", "my brother"). */
  aliases: z.array(z.string()).default([]),
  /** Relationship to the user when stated ("brother", "manager", "dentist"). */
  relation: z.string().nullable().default(null),
  attributes: z.record(z.unknown()).default({}),
  mentions: z.array(SourceSpanSchema).default([]),
  confidence: Confidence.default(0.5),
});
export type Entity = z.infer<typeof EntitySchema>;

/** Type-specific payload. Kept as an open record so item types stay additive. */
export const ItemDetailsSchema = z
  .object({
    // TASK
    status: TaskStatusEnum.optional(),
    priority: PriorityEnum.optional(),
    // REMINDER — `explicit` records whether the user actually asked to be
    // reminded, as opposed to Lifelog inferring it. See docs/algorithm.md.
    explicit: z.boolean().optional(),
    trigger_at: z.string().nullable().optional(),
    /** Grammatical display sentence for UI. Never replaces source_text. */
    display_text: z.string().optional(),
    // FEELING
    emotion: z.string().optional(),
    sentiment: SentimentEnum.optional(),
    intensity: z.number().min(0).max(1).optional(),
    about: z.string().nullable().optional(),
    // DECISION
    alternatives: z.array(z.string()).optional(),
    // MEMORY
    significance: z.number().min(0).max(1).optional(),
  })
  .passthrough();
export type ItemDetails = z.infer<typeof ItemDetailsSchema>;

/**
 * Inferred emotional impact — always distinct from expressed FEELING items.
 * Must carry `inferred: true` and basis spans into the user text.
 */
export const EmotionalImpactSchema = z.object({
  valence: SentimentEnum,
  intensity: Confidence,
  about_entity_ids: z.array(z.string()).default([]),
  basis_spans: z.array(SourceSpanSchema).default([]),
  summary: z.string().default(''),
  inferred: z.literal(true),
  confidence: Confidence.default(0.4),
});
export type EmotionalImpact = z.infer<typeof EmotionalImpactSchema>;

/** A gap the algorithm could not resolve confidently. */
export const AnalysisGapSchema = z.object({
  code: z.string(),
  message: z.string(),
  about_item_id: z.string().nullable().default(null),
});
export type AnalysisGap = z.infer<typeof AnalysisGapSchema>;

/** How algorithm draft and AI teacher were combined. */
export const ReconciliationSchema = z.object({
  used_ai_teacher: z.boolean().default(false),
  skipped_ai: z.boolean().default(false),
  disagreement_count: z.number().int().min(0).default(0),
  winners: z.array(z.string()).default([]),
});
export type Reconciliation = z.infer<typeof ReconciliationSchema>;

/**
 * One meaningful piece of life information extracted from the conversation.
 *
 * A single sentence can produce several items: "I met Arun yesterday and I
 * need to send him the file" is a PAST_EVENT plus a TASK.
 */
export const ItemSchema = z.object({
  id: z.string(),
  type: ItemTypeEnum,
  /** Short human-readable label, suitable for a list row. */
  title: z.string().min(1),
  /** Lifelog's normalised restatement of the item. */
  summary: z.string().default(''),
  /** Verbatim text from the conversation that produced this item. */
  source_text: z.string().default(''),
  source_span: SourceSpanSchema.nullable().default(null),
  segment_index: z.number().int().min(0).nullable().default(null),
  temporal: TemporalSchema,
  /** Ids referencing `analysis.entities`. */
  entity_ids: z.array(z.string()).default([]),
  details: ItemDetailsSchema.default({}),
  confidence: Confidence.default(0.5),
});
export type Item = z.infer<typeof ItemSchema>;

/** A meaningful piece of the conversation, before classification. */
export const SegmentSchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  span: SourceSpanSchema,
});
export type Segment = z.infer<typeof SegmentSchema>;

/**
 * A field Lifelog believes is genuinely important and genuinely absent.
 * Missing information is recorded even when it is not worth asking about.
 */
export const MissingInfoSchema = z.object({
  field: z.string(),
  about_item_id: z.string().nullable().default(null),
  reason: z.string(),
  importance: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});
export type MissingInfo = z.infer<typeof MissingInfoSchema>;

/**
 * A single clarifying question. Lifelog asks at most one, and only when the
 * missing detail blocks something the user clearly wants (see docs/algorithm.md).
 */
export const FollowUpSchema = z.object({
  question: z.string().min(1),
  reason: z.string(),
  missing_fields: z.array(z.string()).default([]),
  /** True when Lifelog cannot honour the user's intent without an answer. */
  blocking: z.boolean().default(false),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

/** Non-fatal notes about how the analysis was produced. Surfaced for debugging. */
export const WarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  detail: z.record(z.unknown()).optional(),
});
export type Warning = z.infer<typeof WarningSchema>;

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

export const AnalysisSchema = z.object({
  schema_version: z.string().default(ANALYSIS_SCHEMA_VERSION),
  intent: IntentEnum,
  intent_confidence: Confidence.default(0.5),
  /** First-hand behavior stance for this message only. */
  stance: StanceEnum.default('UNKNOWN'),
  stance_confidence: Confidence.default(0.5),
  /** BCP-47-ish language tag, or "mixed" for code-switched input. */
  language: z.string().default('und'),
  summary: z.string().default(''),
  segments: z.array(SegmentSchema).default([]),
  entities: z.array(EntitySchema).default([]),
  items: z.array(ItemSchema).default([]),
  /** Inferred impacts only — expressed emotion lives as FEELING items. */
  emotional_impact: z.array(EmotionalImpactSchema).default([]),
  /** What the algorithm could not resolve before / after the teacher. */
  gaps: z.array(AnalysisGapSchema).default([]),
  /** Overall confidence in the algorithm draft before reconciliation. */
  algorithm_confidence: Confidence.default(0.5),
  reconciliation: ReconciliationSchema.default({
    used_ai_teacher: false,
    skipped_ai: false,
    disagreement_count: 0,
    winners: [],
  }),
  missing_information: z.array(MissingInfoSchema).default([]),
  follow_up: FollowUpSchema.nullable().default(null),
  warnings: z.array(WarningSchema).default([]),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

/**
 * The looser shape accepted *from an AI provider*.
 *
 * Models are unreliable, so this schema forgives missing fields, wrong casing
 * and unknown enum members. The intelligence layer normalises the result into
 * a strict `Analysis`. Never let a raw model object reach the API or database.
 */
export const RawModelAnalysisSchema = z
  .object({
    intent: z.string().optional(),
    intent_confidence: z.number().optional(),
    language: z.string().optional(),
    summary: z.string().optional(),
    entities: z.array(z.record(z.unknown())).optional(),
    items: z.array(z.record(z.unknown())).optional(),
    missing_information: z.array(z.record(z.unknown())).optional(),
    follow_up: z.union([z.record(z.unknown()), z.string(), z.null()]).optional(),
  })
  .passthrough();
export type RawModelAnalysis = z.infer<typeof RawModelAnalysisSchema>;

/** Items whose type implies the user expects an action from Lifelog. */
export const ACTIONABLE_ITEM_TYPES: ReadonlySet<ItemType> = new Set<ItemType>([
  'TASK',
  'REMINDER',
  'FUTURE_EVENT',
]);
