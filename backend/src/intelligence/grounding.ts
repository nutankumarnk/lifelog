/**
 * Grounding: hallucination prevention.
 *
 * Lifelog stores a person's life. A fabricated memory is worse than a missing
 * one, because the user cannot tell it is false when they read it back years
 * later. So every extraction must be traceable to characters the user actually
 * typed, and anything that cannot be traced is dropped or demoted.
 *
 * Three checks run here:
 *
 *   1. Entity grounding — the entity's name must appear in the text.
 *   2. Item grounding   — the item's `source_text` must appear in the text; if
 *                         the model paraphrased, a fuzzy match recovers the span.
 *   3. Reference hygiene — items may only reference entities that survived.
 *
 * Dropping is recorded as a warning, never done silently.
 */
import type { Entity, Item, SourceSpan, Warning } from '../schemas/analysis.schema.js';
import { normalizeName } from './normalize.js';

/** Whitespace/punctuation-insensitive index of `needle` in `haystack`. */
function looseIndexOf(haystack: string, needle: string): SourceSpan | null {
  if (!needle) return null;

  const direct = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (direct !== -1) return { start: direct, end: direct + needle.length };

  // Rebuild the text without whitespace, keeping a map back to real offsets, so
  // a model that changed spacing or line breaks still matches.
  const offsets: number[] = [];
  let compact = '';
  for (let i = 0; i < haystack.length; i += 1) {
    const char = haystack[i]!;
    if (/\s/.test(char)) continue;
    compact += char.toLowerCase();
    offsets.push(i);
  }

  const compactNeedle = needle.replace(/\s+/g, '').toLowerCase();
  if (!compactNeedle) return null;

  const found = compact.indexOf(compactNeedle);
  if (found === -1) return null;

  const start = offsets[found];
  const end = offsets[found + compactNeedle.length - 1];
  return start !== undefined && end !== undefined ? { start, end: end + 1 } : null;
}

/**
 * Fraction of the needle's content words that appear in the text.
 * Used when a model paraphrases instead of quoting.
 */
function contentWordOverlap(text: string, needle: string): number {
  const stop = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'in', 'on', 'at', 'is', 'was', 'i', 'my', 'me', 'it']);
  const words = needle
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !stop.has(word));

  if (words.length === 0) return 0;
  const lower = text.toLowerCase();
  const present = words.filter((word) => lower.includes(word)).length;
  return present / words.length;
}

export interface GroundingResult {
  entities: Entity[];
  items: Item[];
  warnings: Warning[];
  /** Count of extractions rejected as ungrounded. Surfaced for observability. */
  rejected: number;
}

export interface GroundingOptions {
  /**
   * Minimum content-word overlap for a paraphrased item to be kept.
   * Below this the item is treated as invented.
   */
  minOverlap?: number;
}

/**
 * Rejects extractions that are not supported by the conversation text.
 *
 * Entities are checked strictly: a name the user never wrote is a fabrication,
 * with one deliberate exception — a relation phrase like "my dentist" is
 * allowed to normalise ("dentist") because the model is describing a real
 * mention, not inventing one.
 */
export function groundAnalysis(
  text: string,
  entities: Entity[],
  items: Item[],
  options: GroundingOptions = {},
): GroundingResult {
  const minOverlap = options.minOverlap ?? 0.5;
  const warnings: Warning[] = [];
  let rejected = 0;

  // --- Entities -----------------------------------------------------------
  const keptEntities: Entity[] = [];
  const normalizedText = normalizeName(text);

  for (const entity of entities) {
    const span = looseIndexOf(text, entity.name);
    const nameInText = span !== null || normalizedText.includes(entity.normalized_name);

    // A relation-only entity ("my manager") is grounded by its relation word.
    const relationInText =
      entity.relation !== null && text.toLowerCase().includes(entity.relation.toLowerCase());

    if (!nameInText && !relationInText) {
      warnings.push({
        code: 'ENTITY_UNGROUNDED',
        message: `dropped entity "${entity.name}" — not found in the conversation`,
        detail: { kind: entity.kind },
      });
      rejected += 1;
      continue;
    }

    // Backfill the mention span when the model did not report one.
    if (entity.mentions.length === 0 && span) entity.mentions = [span];
    keptEntities.push(entity);
  }

  // Renumber so ids stay dense, and remap item references.
  const entityIdRemap = new Map<string, string>();
  keptEntities.forEach((entity, index) => {
    const newId = `e${index + 1}`;
    entityIdRemap.set(entity.id, newId);
    entity.id = newId;
  });
  const validEntityIds = new Set(keptEntities.map((entity) => entity.id));

  // --- Items --------------------------------------------------------------
  const keptItems: Item[] = [];

  for (const item of items) {
    const evidence = item.source_text || item.title;
    const span = looseIndexOf(text, evidence);

    if (span) {
      item.source_span = span;
      // Replace the model's copy with the real substring, so what is stored is
      // literally what the user wrote.
      item.source_text = text.slice(span.start, span.end);
    } else {
      const overlap = contentWordOverlap(text, evidence);
      if (overlap < minOverlap) {
        warnings.push({
          code: 'ITEM_UNGROUNDED',
          message: `dropped ${item.type} "${item.title}" — not supported by the conversation`,
          detail: { overlap: Number(overlap.toFixed(2)) },
        });
        rejected += 1;
        continue;
      }
      // Partially grounded: keep it, but say so and reduce confidence.
      warnings.push({
        code: 'ITEM_PARAPHRASED',
        message: `${item.type} "${item.title}" is a paraphrase, not a quote`,
        detail: { overlap: Number(overlap.toFixed(2)) },
      });
      item.confidence = Math.min(item.confidence, 0.5);
      item.source_span = null;
    }

    // A temporal phrase the user never used is also a fabrication.
    if (item.temporal.raw && !looseIndexOf(text, item.temporal.raw)) {
      warnings.push({
        code: 'TEMPORAL_UNGROUNDED',
        message: `discarded time phrase "${item.temporal.raw}" — not present in the conversation`,
      });
      item.temporal = { ...item.temporal, raw: null, resolved: null, precision: 'NONE', confidence: 0 };
    }

    item.entity_ids = item.entity_ids
      .map((id) => entityIdRemap.get(id) ?? id)
      .filter((id) => validEntityIds.has(id));

    keptItems.push(item);
  }

  // Renumber items so ids remain dense after drops.
  keptItems.forEach((item, index) => {
    item.id = `i${index + 1}`;
  });

  return { entities: keptEntities, items: keptItems, warnings, rejected };
}

/**
 * Removes duplicate items.
 *
 * A model asked to split facts will sometimes emit the same fact twice under
 * two types, or the same type twice with different wording. Two items are the
 * same when they share a type and cover the same span or the same normalised
 * text. The higher-confidence one wins.
 */
export function deduplicateItems(items: Item[]): { items: Item[]; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const seen = new Map<string, Item>();

  for (const item of items) {
    const spanKey = item.source_span ? `${item.source_span.start}:${item.source_span.end}` : '';
    const key = `${item.type}|${spanKey || normalizeName(item.source_text || item.title)}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, item);
      continue;
    }

    warnings.push({
      code: 'ITEM_DUPLICATE',
      message: `merged duplicate ${item.type} "${item.title}"`,
    });

    if (item.confidence > existing.confidence) {
      item.entity_ids = [...new Set([...existing.entity_ids, ...item.entity_ids])];
      seen.set(key, item);
    } else {
      existing.entity_ids = [...new Set([...existing.entity_ids, ...item.entity_ids])];
    }
  }

  const result = [...seen.values()];
  result.forEach((item, index) => {
    item.id = `i${index + 1}`;
  });

  return { items: result, warnings };
}
