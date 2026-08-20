/**
 * Emotional impact — inferred track, separate from expressed FEELING items.
 *
 * Never invents emotion from neutral text. Only emits impact when a FEELING
 * item already exists or strong emotion lexicon hits with clear basis spans.
 */
import type { EmotionalImpact, Entity, Item, SourceSpan } from '../schemas/analysis.schema.js';
import { EMOTION_LEXICON } from './lexicon.js';

function findSpan(text: string, needle: string): SourceSpan | null {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return null;
  return { start: idx, end: idx + needle.length };
}

/**
 * Builds inferred emotional impact records from expressed feelings / lexicon.
 */
export function inferEmotionalImpact(
  text: string,
  items: Item[],
  entities: Entity[],
): EmotionalImpact[] {
  const impacts: EmotionalImpact[] = [];

  for (const item of items) {
    if (item.type !== 'FEELING') continue;
    const emotion = String(item.details.emotion ?? item.title ?? '').trim();
    const sentiment = item.details.sentiment ?? 'NEUTRAL';
    const intensity = typeof item.details.intensity === 'number' ? item.details.intensity : 0.5;
    const basis =
      item.source_span ??
      (item.source_text ? findSpan(text, item.source_text) : null) ??
      (emotion ? findSpan(text, emotion) : null);

    impacts.push({
      valence: sentiment,
      intensity,
      about_entity_ids: [...item.entity_ids],
      basis_spans: basis ? [basis] : [],
      summary: emotion ? `Expressed ${emotion}` : item.summary || item.title,
      inferred: true,
      confidence: Math.min(0.85, (item.confidence ?? 0.5) + 0.1),
    });
  }

  // If no FEELING items, do not invent impact from neutral text.
  if (impacts.length > 0) return impacts;

  // Optional: single lexicon hit with an explicit feeling frame already handled
  // by FEELING extraction. Skip cold inference here to honour "never invent".
  void EMOTION_LEXICON;
  void entities;
  return impacts;
}
