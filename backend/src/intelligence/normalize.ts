/**
 * Normalisation: loose provider output → Lifelog's strict internal shape.
 *
 * Everything a model gets wrong in *form* is fixed here: missing fields, wrong
 * casing, near-miss enum values, duplicated ids, string-instead-of-object.
 * Nothing about *meaning* is decided here — classification, grounding and
 * follow-up logic each have their own module.
 *
 * The guiding rule is repair, never discard. A model that says
 * `"type": "task"` or `"type": "todo"` clearly meant TASK; dropping the item
 * would lose real user information over a formatting mistake.
 */
import {
  EMPTY_TEMPORAL,
  EntityKindEnum,
  IntentEnum,
  ItemTypeEnum,
  type Entity,
  type EntityKind,
  type Intent,
  type Item,
  type ItemType,
  type MissingInfo,
  type Warning,
} from '../schemas/analysis.schema.js';

/** Case/punctuation-folded form used to compare entity names. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(?:the|my|our|a|an)\s+/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Enum coercion
// ---------------------------------------------------------------------------

/** Common model phrasings mapped onto Lifelog's intents. */
const INTENT_ALIASES: Record<string, Intent> = {
  log: 'LOG',
  record: 'LOG',
  journal: 'LOG',
  diary: 'REFLECT',
  reflect: 'REFLECT',
  reflection: 'REFLECT',
  plan: 'PLAN',
  planning: 'PLAN',
  schedule: 'PLAN',
  task: 'CAPTURE_TASK',
  todo: 'CAPTURE_TASK',
  capture_task: 'CAPTURE_TASK',
  create_task: 'CAPTURE_TASK',
  reminder: 'SET_REMINDER',
  set_reminder: 'SET_REMINDER',
  remind: 'SET_REMINDER',
  ask: 'ASK',
  question: 'ASK',
  query: 'ASK',
  recall: 'ASK',
  correct: 'CORRECT',
  correction: 'CORRECT',
  update: 'CORRECT',
  small_talk: 'SMALL_TALK',
  smalltalk: 'SMALL_TALK',
  greeting: 'SMALL_TALK',
  chitchat: 'SMALL_TALK',
  none: 'UNKNOWN',
  unknown: 'UNKNOWN',
  other: 'UNKNOWN',
};

export function coerceIntent(value: unknown): { intent: Intent; exact: boolean } {
  const text = asString(value)?.trim() ?? '';
  const upper = text.toUpperCase();
  const direct = IntentEnum.safeParse(upper);
  if (direct.success) return { intent: direct.data, exact: true };

  const alias = INTENT_ALIASES[text.toLowerCase().replace(/[\s-]+/g, '_')];
  if (alias) return { intent: alias, exact: false };

  return { intent: 'UNKNOWN', exact: false };
}

const ITEM_TYPE_ALIASES: Record<string, ItemType> = {
  memory: 'MEMORY',
  experience: 'MEMORY',
  moment: 'MEMORY',
  past_event: 'PAST_EVENT',
  pastevent: 'PAST_EVENT',
  past: 'PAST_EVENT',
  event: 'PAST_EVENT',
  present_fact: 'PRESENT_FACT',
  fact: 'PRESENT_FACT',
  present: 'PRESENT_FACT',
  status: 'PRESENT_FACT',
  state: 'PRESENT_FACT',
  future_event: 'FUTURE_EVENT',
  futureevent: 'FUTURE_EVENT',
  future: 'FUTURE_EVENT',
  plan: 'FUTURE_EVENT',
  appointment: 'FUTURE_EVENT',
  task: 'TASK',
  todo: 'TASK',
  to_do: 'TASK',
  action: 'TASK',
  action_item: 'TASK',
  reminder: 'REMINDER',
  alert: 'REMINDER',
  notification: 'REMINDER',
  decision: 'DECISION',
  choice: 'DECISION',
  feeling: 'FEELING',
  emotion: 'FEELING',
  mood: 'FEELING',
  sentiment: 'FEELING',
};

export function coerceItemType(value: unknown): ItemType | null {
  const text = asString(value)?.trim() ?? '';
  const direct = ItemTypeEnum.safeParse(text.toUpperCase());
  if (direct.success) return direct.data;
  return ITEM_TYPE_ALIASES[text.toLowerCase().replace(/[\s-]+/g, '_')] ?? null;
}

const ENTITY_KIND_ALIASES: Record<string, EntityKind> = {
  person: 'PERSON',
  people: 'PERSON',
  human: 'PERSON',
  contact: 'PERSON',
  individual: 'PERSON',
  place: 'PLACE',
  location: 'PLACE',
  city: 'PLACE',
  country: 'PLACE',
  venue: 'PLACE',
  address: 'PLACE',
  organization: 'ORGANIZATION',
  organisation: 'ORGANIZATION',
  company: 'ORGANIZATION',
  employer: 'ORGANIZATION',
  institution: 'ORGANIZATION',
  object: 'OBJECT',
  thing: 'OBJECT',
  item: 'OBJECT',
  product: 'OBJECT',
  topic: 'TOPIC',
  subject: 'TOPIC',
  concept: 'TOPIC',
  activity: 'TOPIC',
  event_name: 'EVENT_NAME',
  event: 'EVENT_NAME',
};

/**
 * Maps a model's entity label onto a Lifelog kind.
 *
 * Unrecognised labels become OTHER while the original string is preserved, so
 * a custom entity type ("recipe", "medication", "gurudwara") survives intact
 * and can be promoted to a first-class kind later.
 */
export function coerceEntityKind(value: unknown): { kind: EntityKind; rawKind: string | null } {
  const text = asString(value)?.trim() ?? '';
  if (!text) return { kind: 'OTHER', rawKind: null };

  const direct = EntityKindEnum.safeParse(text.toUpperCase());
  if (direct.success) return { kind: direct.data, rawKind: direct.data === 'OTHER' ? text : null };

  const alias = ENTITY_KIND_ALIASES[text.toLowerCase().replace(/[\s-]+/g, '_')];
  if (alias) return { kind: alias, rawKind: null };

  return { kind: 'OTHER', rawKind: text };
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface NormalizedEntities {
  entities: Entity[];
  /** Maps every id the model used (including duplicates) to the surviving id. */
  idMap: Map<string, string>;
  warnings: Warning[];
}

/**
 * Normalises entities and merges duplicates.
 *
 * A model routinely emits the same person twice ("Arun" and "arun", or once per
 * mention). Merging on the normalised name keeps one row per real-world thing
 * and records the other surface forms as aliases.
 */
export function normalizeEntities(rawEntities: unknown): NormalizedEntities {
  const entities: Entity[] = [];
  const idMap = new Map<string, string>();
  const byNormalizedName = new Map<string, Entity>();
  const warnings: Warning[] = [];

  for (const [index, raw] of asArray(rawEntities).entries()) {
    const record = asRecord(raw);
    const name = asString(record.name ?? record.text ?? record.value)?.trim();

    if (!name) {
      warnings.push({ code: 'ENTITY_DROPPED', message: `entity at position ${index} had no name` });
      continue;
    }

    const originalId = asString(record.id) ?? `e${index + 1}`;
    const { kind, rawKind } = coerceEntityKind(record.kind ?? record.type ?? record.category);
    const normalized = normalizeName(name);
    if (!normalized) {
      warnings.push({ code: 'ENTITY_DROPPED', message: `entity "${name}" normalised to empty` });
      continue;
    }

    const existing = byNormalizedName.get(normalized);
    if (existing) {
      idMap.set(originalId, existing.id);
      if (!existing.aliases.includes(name) && existing.name !== name) existing.aliases.push(name);
      if (existing.kind === 'OTHER' && kind !== 'OTHER') {
        existing.kind = kind;
        existing.raw_kind = rawKind;
      }
      existing.relation ??= asString(record.relation) ?? null;
      existing.mentions.push(...normalizeMentions(record.mentions));
      existing.confidence = Math.max(existing.confidence, clamp01(asNumber(record.confidence, 0.5)));
      continue;
    }

    const entity: Entity = {
      id: `e${entities.length + 1}`,
      kind,
      raw_kind: rawKind,
      name,
      normalized_name: normalized,
      aliases: asArray(record.aliases)
        .map(asString)
        .filter((alias): alias is string => Boolean(alias)),
      relation: asString(record.relation ?? record.relationship) ?? null,
      attributes: asRecord(record.attributes),
      mentions: normalizeMentions(record.mentions),
      confidence: clamp01(asNumber(record.confidence, 0.5)),
    };

    entities.push(entity);
    byNormalizedName.set(normalized, entity);
    idMap.set(originalId, entity.id);
  }

  return { entities, idMap, warnings };
}

function normalizeMentions(value: unknown): Array<{ start: number; end: number }> {
  return asArray(value)
    .map((mention) => {
      const record = asRecord(mention);
      const start = asNumber(record.start, -1);
      const end = asNumber(record.end, -1);
      return start >= 0 && end > start ? { start, end } : null;
    })
    .filter((mention): mention is { start: number; end: number } => mention !== null);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface NormalizedItems {
  items: Item[];
  warnings: Warning[];
}

/**
 * Normalises items into the strict `Item` shape.
 *
 * Ids are reassigned sequentially by Lifelog rather than trusted from the
 * model, because models reuse and skip ids. `entity_ids` are remapped through
 * `idMap` so references survive entity merging.
 */
export function normalizeItems(rawItems: unknown, idMap: Map<string, string>): NormalizedItems {
  const items: Item[] = [];
  const warnings: Warning[] = [];

  for (const [index, raw] of asArray(rawItems).entries()) {
    const record = asRecord(raw);
    const type = coerceItemType(record.type ?? record.kind ?? record.category);

    if (!type) {
      warnings.push({
        code: 'ITEM_DROPPED',
        message: `item at position ${index} had an unrecognised type`,
        detail: { type: asString(record.type) ?? null },
      });
      continue;
    }

    const sourceText = asString(record.source_text ?? record.text ?? record.quote) ?? '';
    const title =
      asString(record.title)?.trim() ||
      asString(record.summary)?.trim() ||
      sourceText.slice(0, 80).trim();

    if (!title) {
      warnings.push({ code: 'ITEM_DROPPED', message: `item at position ${index} had no title` });
      continue;
    }

    const validEntityIds = asArray(record.entity_ids ?? record.entities)
      .map(asString)
      .filter((id): id is string => Boolean(id))
      .map((id) => idMap.get(id) ?? id)
      .filter((id) => [...idMap.values()].includes(id));

    items.push({
      id: `i${items.length + 1}`,
      type,
      title: title.slice(0, 200),
      summary: asString(record.summary)?.trim() ?? '',
      source_text: sourceText,
      source_span: normalizeSpan(record.source_span ?? record.span),
      segment_index: (() => {
        const value = asNumber(record.segment_index, -1);
        return value >= 0 ? Math.trunc(value) : null;
      })(),
      temporal: normalizeTemporalShell(record.temporal),
      entity_ids: [...new Set(validEntityIds)],
      details: asRecord(record.details),
      confidence: clamp01(asNumber(record.confidence, 0.5)),
    });
  }

  return { items, warnings };
}

function normalizeSpan(value: unknown): { start: number; end: number } | null {
  const record = asRecord(value);
  const start = asNumber(record.start, -1);
  const end = asNumber(record.end, -1);
  return start >= 0 && end > start ? { start: Math.trunc(start), end: Math.trunc(end) } : null;
}

/**
 * Extracts only the temporal fields Lifelog trusts a model to report — the raw
 * phrase and a recurrence hint. Resolution happens in `temporal.ts` afterwards,
 * so any date the model computed is deliberately ignored here.
 */
function normalizeTemporalShell(value: unknown): typeof EMPTY_TEMPORAL {
  if (typeof value === 'string') {
    return { ...EMPTY_TEMPORAL, raw: value };
  }
  const record = asRecord(value);
  const raw = asString(record.raw ?? record.text ?? record.expression ?? record.phrase);
  return {
    ...EMPTY_TEMPORAL,
    raw: raw && raw.trim() ? raw.trim() : null,
    recurrence: asString(record.recurrence) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Missing information
// ---------------------------------------------------------------------------

export function normalizeMissingInformation(value: unknown): MissingInfo[] {
  return asArray(value)
    .map((raw): MissingInfo | null => {
      const record = asRecord(raw);
      const field = asString(record.field ?? record.name);
      if (!field) return null;
      const importance = (asString(record.importance) ?? 'MEDIUM').toUpperCase();
      return {
        field,
        about_item_id: null,
        reason: asString(record.reason) ?? '',
        importance:
          importance === 'HIGH' || importance === 'LOW'
            ? (importance as MissingInfo['importance'])
            : 'MEDIUM',
      };
    })
    .filter((entry): entry is MissingInfo => entry !== null);
}

/** Detects the conversation language. Cheap, and only used for labelling. */
export function detectLanguage(text: string, reported: unknown): string {
  const claimed = asString(reported)?.trim().toLowerCase();
  if (claimed && claimed !== 'und' && claimed.length <= 12) return claimed;
  return 'und';
}
