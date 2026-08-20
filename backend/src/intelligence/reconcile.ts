/**
 * Reconciles algorithm draft with AI teacher patches.
 *
 * Prefers grounded algorithm fields. Accepts AI only for declared gaps when
 * the patch grounds to user text. Records disagreements for the learning journal.
 */
import type {
  AnalysisGap,
  EmotionalImpact,
  Entity,
  Item,
  Intent,
  Stance,
  Warning,
} from '../schemas/analysis.schema.js';
import { EMPTY_TEMPORAL, IntentEnum, ItemTypeEnum, StanceEnum } from '../schemas/analysis.schema.js';
import { normalizeName } from './normalize.js';

export interface TeacherPatch {
  op: string;
  payload?: Record<string, unknown>;
}

export interface DisagreementRecord {
  field: string;
  algorithmValue: unknown;
  aiValue: unknown;
  winner: 'algorithm' | 'ai';
  reason: string;
}

export interface ReconcileInput {
  text: string;
  intent: Intent;
  stance: Stance;
  items: Item[];
  entities: Entity[];
  emotionalImpact: EmotionalImpact[];
  gaps: AnalysisGap[];
  patches: TeacherPatch[];
}

export interface ReconcileResult {
  intent: Intent;
  stance: Stance;
  items: Item[];
  entities: Entity[];
  emotionalImpact: EmotionalImpact[];
  disagreements: DisagreementRecord[];
  warnings: Warning[];
  winners: string[];
}

function isSubstring(haystack: string, needle: string): boolean {
  return Boolean(needle) && haystack.includes(needle);
}

function nextId(prefix: string, existing: string[]): string {
  let n = existing.length + 1;
  let id = `${prefix}${n}`;
  while (existing.includes(id)) {
    n += 1;
    id = `${prefix}${n}`;
  }
  return id;
}

/**
 * Applies teacher patches onto the algorithm draft.
 */
export function reconcileWithTeacher(input: ReconcileInput): ReconcileResult {
  const warnings: Warning[] = [];
  const disagreements: DisagreementRecord[] = [];
  const winners: string[] = [];

  let { intent, stance } = input;
  const items = [...input.items];
  const entities = [...input.entities];
  const emotionalImpact = [...input.emotionalImpact];
  const gapCodes = new Set(input.gaps.map((gap) => gap.code));

  for (const patch of input.patches) {
    const op = String(patch.op || 'noop');
    const payload = patch.payload ?? {};

    if (op === 'noop') continue;

    if (op === 'set_intent') {
      const parsed = IntentEnum.safeParse(payload.intent);
      if (!parsed.success) continue;
      if (parsed.data !== intent) {
        disagreements.push({
          field: 'intent',
          algorithmValue: intent,
          aiValue: parsed.data,
          winner: 'ai',
          reason: 'teacher set_intent for gap fill',
        });
        intent = parsed.data;
        winners.push('intent:ai');
      }
      continue;
    }

    if (op === 'set_stance') {
      const parsed = StanceEnum.safeParse(payload.stance);
      if (!parsed.success) continue;
      if (parsed.data !== stance) {
        disagreements.push({
          field: 'stance',
          algorithmValue: stance,
          aiValue: parsed.data,
          winner: gapCodes.has('MULTI_FACT_SPLIT') || gapCodes.size > 0 ? 'ai' : 'algorithm',
          reason: 'teacher set_stance',
        });
        if (disagreements[disagreements.length - 1]?.winner === 'ai') {
          stance = parsed.data;
          winners.push('stance:ai');
        } else {
          winners.push('stance:algorithm');
        }
      }
      continue;
    }

    if (op === 'add_entity') {
      const name = String(payload.name || '').trim();
      if (!name || !isSubstring(input.text, name)) {
        warnings.push({
          code: 'TEACHER_ENTITY_REJECTED',
          message: 'teacher entity not grounded in user text',
          detail: { name },
        });
        disagreements.push({
          field: 'entity',
          algorithmValue: null,
          aiValue: name,
          winner: 'algorithm',
          reason: 'ungrounded entity',
        });
        winners.push('entity:algorithm');
        continue;
      }
      if (entities.some((e) => e.normalized_name === normalizeName(name))) continue;
      const id = nextId(
        'e',
        entities.map((e) => e.id),
      );
      entities.push({
        id,
        kind: 'OTHER',
        raw_kind: typeof payload.kind === 'string' ? payload.kind : null,
        name,
        normalized_name: normalizeName(name),
        aliases: [],
        relation: null,
        attributes: {},
        mentions: [],
        confidence: 0.55,
      });
      winners.push('entity:ai');
      continue;
    }

    if (op === 'add_item') {
      const sourceText = String(payload.source_text || '').trim();
      const typeRaw = String(payload.type || '');
      const typeParsed = ItemTypeEnum.safeParse(typeRaw);
      if (!typeParsed.success || !sourceText || !isSubstring(input.text, sourceText)) {
        warnings.push({
          code: 'TEACHER_ITEM_REJECTED',
          message: 'teacher item missing grounding or type',
          detail: { type: typeRaw, source_text: sourceText.slice(0, 80) },
        });
        disagreements.push({
          field: 'item',
          algorithmValue: null,
          aiValue: payload,
          winner: 'algorithm',
          reason: 'ungrounded or invalid add_item',
        });
        winners.push('item:algorithm');
        continue;
      }
      // Avoid duplicate same type+source
      if (items.some((item) => item.type === typeParsed.data && item.source_text === sourceText)) {
        continue;
      }
      const id = nextId(
        'i',
        items.map((i) => i.id),
      );
      items.push({
        id,
        type: typeParsed.data,
        title: String(payload.title || sourceText).slice(0, 80) || sourceText,
        summary: String(payload.summary || ''),
        source_text: sourceText,
        source_span: null,
        segment_index: null,
        temporal: { ...EMPTY_TEMPORAL, raw: typeof payload.temporal_raw === 'string' ? payload.temporal_raw : null },
        entity_ids: Array.isArray(payload.entity_ids)
          ? payload.entity_ids.map(String).filter((eid) => entities.some((e) => e.id === eid))
          : [],
        details: typeof payload.details === 'object' && payload.details ? (payload.details as Item['details']) : {},
        confidence: 0.55,
      });
      disagreements.push({
        field: `item:${id}`,
        algorithmValue: null,
        aiValue: { type: typeParsed.data, source_text: sourceText },
        winner: 'ai',
        reason: 'teacher filled gap with grounded item',
      });
      winners.push('item:ai');
      continue;
    }

    if (op === 'add_impact') {
      if (payload.inferred !== true) {
        warnings.push({
          code: 'TEACHER_IMPACT_REJECTED',
          message: 'emotional_impact must set inferred:true',
        });
        continue;
      }
      const summary = String(payload.summary || '').trim();
      emotionalImpact.push({
        valence:
          payload.valence === 'POSITIVE' ||
          payload.valence === 'NEGATIVE' ||
          payload.valence === 'MIXED' ||
          payload.valence === 'NEUTRAL'
            ? payload.valence
            : 'NEUTRAL',
        intensity: typeof payload.intensity === 'number' ? Math.min(1, Math.max(0, payload.intensity)) : 0.4,
        about_entity_ids: Array.isArray(payload.about_entity_ids)
          ? payload.about_entity_ids.map(String)
          : [],
        basis_spans: Array.isArray(payload.basis_spans)
          ? payload.basis_spans
              .map((span) => {
                if (!span || typeof span !== 'object') return null;
                const s = span as { start?: unknown; end?: unknown };
                if (typeof s.start !== 'number' || typeof s.end !== 'number') return null;
                return { start: s.start, end: s.end };
              })
              .filter((span): span is { start: number; end: number } => Boolean(span))
          : [],
        summary,
        inferred: true,
        confidence: 0.45,
      });
      winners.push('impact:ai');
    }
  }

  return {
    intent,
    stance,
    items,
    entities,
    emotionalImpact,
    disagreements,
    warnings,
    winners,
  };
}

/** Parses teacher JSON into patches. */
export function extractTeacherPatches(raw: unknown): TeacherPatch[] {
  if (!raw || typeof raw !== 'object') return [];
  const patches = (raw as { patches?: unknown }).patches;
  if (!Array.isArray(patches)) return [];
  return patches
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
    .map((p) => ({
      op: String(p.op || 'noop'),
      payload: typeof p.payload === 'object' && p.payload ? (p.payload as Record<string, unknown>) : {},
    }));
}
