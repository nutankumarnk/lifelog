/**
 * Offline rule-engine provider.
 *
 * This is a real provider, not a stub. It reads a conversation using Lifelog's
 * own lexicon and temporal rules and emits the same loose shape a hosted model
 * would, so it flows through exactly the same normalisation, grounding and
 * validation pipeline.
 *
 * It exists for three reasons:
 *   1. Lifelog must run — and be demonstrable — with no API key and no network.
 *   2. It is the fallback when the hosted model times out or is rate limited,
 *      so an outage degrades quality instead of returning an error.
 *   3. It makes the test suite deterministic. Asserting on a hosted model's
 *      output would make the suite flaky and expensive.
 *
 * It is weaker than a hosted model at paraphrase, implication and unusual
 * phrasing. That is expected and documented in docs/ai-engine.md.
 *
 * Dependency note: this file imports the leaf modules `intelligence/lexicon`,
 * `intelligence/temporal` and `intelligence/segment`. Those have no imports of
 * their own, so no cycle is created.
 */
import type { AiProvider, AnalysisRequest, ProviderResult } from './provider.js';
import { segmentConversation } from '../intelligence/segment.js';
import {
  findTemporalPhrases,
  inferTenseFromGrammar,
  reconcileTense,
  resolvePhrase,
} from '../intelligence/temporal.js';
import {
  CORRECTION_MARKERS,
  DECISION_MARKERS,
  EMOTION_LEXICON,
  ENTITY_STOPWORDS,
  EXPERIENCE_VERBS,
  FEELING_FRAMES,
  PLAN_MARKERS,
  QUESTION_MARKERS,
  RELATION_WORDS,
  REMINDER_MARKERS,
  SMALL_TALK_PHRASES,
  TASK_MARKERS,
  containsAny,
} from '../intelligence/lexicon.js';

interface DraftEntity {
  id: string;
  kind: string;
  name: string;
  relation: string | null;
  mentions: Array<{ start: number; end: number }>;
  confidence: number;
}

interface DraftItem {
  id: string;
  type: string;
  title: string;
  summary: string;
  source_text: string;
  source_span: { start: number; end: number };
  segment_index: number;
  temporal: Record<string, unknown>;
  entity_ids: string[];
  details: Record<string, unknown>;
  confidence: number;
}

/** Capitalised runs, excluding sentence-initial words that are not proper nouns. */
function findProperNouns(text: string, offset: number): Array<{ name: string; start: number; end: number }> {
  const results: Array<{ name: string; start: number; end: number }> = [];
  const pattern = /\b([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,3})\b/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const name = match[1]!;
    const words = name.split(/\s+/);
    // Drop leading stopwords ("Yesterday Arun called" -> "Arun").
    while (words.length > 0 && ENTITY_STOPWORDS.has(words[0]!.toLowerCase())) words.shift();
    if (words.length === 0) continue;

    const kept = words.join(' ');
    if (kept.length < 2) continue;
    if (ENTITY_STOPWORDS.has(kept.toLowerCase())) continue;

    const start = match.index + name.indexOf(kept);
    results.push({ name: kept, start: offset + start, end: offset + start + kept.length });
  }

  return results;
}

/** Guesses an entity kind from the words immediately before the mention. */
function guessKind(fullText: string, start: number, name: string): string {
  const before = fullText.slice(Math.max(0, start - 28), start).toLowerCase();
  const after = fullText.slice(start + name.length, start + name.length + 20).toLowerCase();

  // A bare "to"/"from" is too weak on its own — "switch from Notion to
  // Obsidian" is not travel. Require a locative preposition or a motion verb,
  // allowing an intervening determiner ("visited the Sabarmati Ashram").
  if (/\b(?:in|at|near|around|inside|outside|visited|reached|toured|explored)\s+(?:the\s+|a\s+)?$/.test(before)) {
    return 'PLACE';
  }
  if (/\b(?:arrived in|flew to|moved to|drove to|travelled to|traveled to|went to|flying to|going to)\s+(?:the\s+)?$/.test(before)) {
    return 'PLACE';
  }
  if (/\b(?:with|met|meet|meeting|saw|called|texted|told|asked|and)\s+$/.test(before)) return 'PERSON';
  if (/\b(?:my|our)\s+(?:friend|brother|sister|mother|father|mom|dad|boss|manager|colleague|doctor|dentist|wife|husband|cousin|uncle|aunt)\s+$/.test(before)) {
    return 'PERSON';
  }
  if (/\b(?:at|joined|works at|working at|for)\s+$/.test(before) && /\b(?:inc|ltd|llc|corp|technologies|labs|systems)\b/.test(name.toLowerCase())) {
    return 'ORGANIZATION';
  }
  if (/^\s*(?:said|told|called|asked|replied|is|was|and i)\b/.test(after)) return 'PERSON';
  return 'OTHER';
}

/** Relation words used without a name: "my dentist", "my manager". */
function findRelationEntities(text: string, offset: number): Array<{ name: string; relation: string; start: number; end: number }> {
  const results: Array<{ name: string; relation: string; start: number; end: number }> = [];
  const pattern = new RegExp(`\\b(my|our)\\s+(${RELATION_WORDS.join('|')})\\b`, 'gi');
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    results.push({
      name: match[0],
      relation: match[2]!.toLowerCase(),
      start: offset + match.index,
      end: offset + match.index + match[0].length,
    });
  }
  return results;
}

function detectEmotion(text: string): { emotion: string; sentiment: string; intensity: number } | null {
  const lower = text.toLowerCase();

  for (const entry of EMOTION_LEXICON) {
    for (const word of entry.words) {
      if (!lower.includes(word)) continue;
      // Intensifiers push the prior up; hedges pull it down.
      let intensity = entry.intensity;
      if (/\b(?:very|really|so|extremely|incredibly|super|totally|deeply)\s+\w*$/.test(lower.slice(0, lower.indexOf(word) + word.length))) {
        intensity = Math.min(1, intensity + 0.2);
      }
      if (/\b(?:a bit|slightly|kind of|kinda|somewhat|a little)\b/.test(lower)) {
        intensity = Math.max(0.1, intensity - 0.2);
      }
      return { emotion: entry.emotion, sentiment: entry.polarity, intensity };
    }
  }

  // A feeling frame with an unknown emotion word still counts as a feeling —
  // preserving the user's word matters more than fitting Lifelog's taxonomy.
  if (containsAny(lower, FEELING_FRAMES)) {
    const frame = FEELING_FRAMES.find((candidate) => lower.includes(candidate))!;
    const after = lower.slice(lower.indexOf(frame) + frame.length).trim();
    const word = after.split(/[\s,.!?]+/).filter(Boolean)[0];
    if (word && word.length > 2 && !['like', 'that', 'the', 'a', 'it'].includes(word)) {
      return { emotion: word, sentiment: 'NEUTRAL', intensity: 0.5 };
    }
  }

  return null;
}

function titleFrom(text: string, maxWords = 12): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const title = words.slice(0, maxWords).join(' ');
  const clean = title.replace(/[.,;:!?]+$/, '');
  return words.length > maxWords ? `${clean}…` : clean || text.slice(0, 60);
}

export class LocalRuleProvider implements AiProvider {
  readonly name = 'local';
  readonly model = 'lifelog-rule-engine-v1';

  isAvailable(): boolean {
    return true;
  }

  async analyze(request: AnalysisRequest): Promise<ProviderResult> {
    const startedAt = Date.now();
    const { text, now } = request;

    const segments = segmentConversation(text);
    const entities: DraftEntity[] = [];
    const items: DraftItem[] = [];
    const entityIndex = new Map<string, DraftEntity>();

    const addEntity = (
      name: string,
      kind: string,
      relation: string | null,
      span: { start: number; end: number },
      confidence: number,
    ): string => {
      const key = name.toLowerCase().replace(/[^a-z0-9\u0900-\u097F ]/g, '').trim();
      const existing = entityIndex.get(key);
      if (existing) {
        existing.mentions.push(span);
        // A later mention with a more specific kind upgrades the earlier guess.
        if (existing.kind === 'OTHER' && kind !== 'OTHER') existing.kind = kind;
        if (!existing.relation && relation) existing.relation = relation;
        return existing.id;
      }
      const entity: DraftEntity = {
        id: `e${entities.length + 1}`,
        kind,
        name,
        relation,
        mentions: [span],
        confidence,
      };
      entities.push(entity);
      entityIndex.set(key, entity);
      return entity.id;
    };

    // --- Entity pass over the whole text ---------------------------------
    for (const proper of findProperNouns(text, 0)) {
      addEntity(proper.name, guessKind(text, proper.start, proper.name), null, {
        start: proper.start,
        end: proper.end,
      }, 0.65);
    }
    for (const relational of findRelationEntities(text, 0)) {
      addEntity(relational.name, 'PERSON', relational.relation, {
        start: relational.start,
        end: relational.end,
      }, 0.7);
    }

    // --- Item pass, segment by segment -----------------------------------
    for (const segment of segments) {
      const body = segment.text;
      const lower = body.toLowerCase();
      const span = segment.span;

      const entityIds = entities
        .filter((entity) =>
          entity.mentions.some((mention) => mention.start >= span.start && mention.end <= span.end),
        )
        .map((entity) => entity.id);

      const temporalPhrases = findTemporalPhrases(body);
      const grammarTense = inferTenseFromGrammar(body);

      /** Builds the temporal block, preferring an explicit phrase over grammar. */
      const temporalFor = (phraseIndex = 0): Record<string, unknown> => {
        const phrase = temporalPhrases[phraseIndex];
        if (!phrase) {
          return {
            tense: grammarTense,
            raw: null,
            resolved: null,
            precision: 'NONE',
            confidence: grammarTense === 'UNSPECIFIED' ? 0 : 0.3,
          };
        }
        const resolution = resolvePhrase(phrase.phrase, now);
        return {
          tense: reconcileTense(resolution.tense, grammarTense),
          raw: phrase.phrase,
          resolved: resolution.resolved,
          resolved_end: resolution.resolvedEnd,
          precision: resolution.precision,
          recurrence: resolution.recurrence,
          confidence: resolution.confidence,
        };
      };

      const pushItem = (
        type: string,
        details: Record<string, unknown>,
        confidence: number,
        phraseIndex = 0,
      ): void => {
        items.push({
          id: `i${items.length + 1}`,
          type,
          title: titleFrom(body),
          summary: body,
          source_text: body,
          source_span: span,
          segment_index: segment.index,
          temporal: temporalFor(phraseIndex),
          entity_ids: entityIds,
          details,
          confidence,
        });
      };

      // Order matters: an explicit reminder request outranks the obligation
      // wording it usually contains ("remind me to call the bank").
      const isReminder = containsAny(lower, REMINDER_MARKERS);
      const isTask = containsAny(lower, TASK_MARKERS);
      const isDecision = containsAny(lower, DECISION_MARKERS);
      const emotion = detectEmotion(body);
      const isPlan = containsAny(lower, PLAN_MARKERS);
      const hasExperienceVerb = containsAny(lower, EXPERIENCE_VERBS);

      const temporal = temporalFor();
      const tense = String(temporal.tense);

      if (isReminder) {
        // Only the reminder is recorded. The action inside it ("call the
        // dentist") is the reminder's payload, not a second obligation — and
        // emitting both would show the user the same thing twice.
        pushItem(
          'REMINDER',
          { explicit: true, trigger_at: temporal.resolved ?? null, status: 'OPEN' },
          0.85,
        );
      } else if (isTask) {
        pushItem('TASK', { status: 'OPEN', priority: /\b(urgent|asap|immediately)\b/i.test(lower) ? 'URGENT' : 'NORMAL' }, 0.8);
      }

      if (isDecision) {
        pushItem('DECISION', {}, 0.75);
      }

      if (emotion) {
        pushItem('FEELING', { ...emotion, about: null }, 0.75);
      }

      // Events and memories. A segment already recorded as a task, reminder or
      // decision is not re-recorded as an event describing the same span.
      const alreadyActionable = isReminder || isTask || isDecision;

      if (tense === 'FUTURE' && !alreadyActionable && (isPlan || temporalPhrases.length > 0)) {
        pushItem('FUTURE_EVENT', {}, temporalPhrases.length > 0 ? 0.8 : 0.6);
      } else if (tense === 'PAST' && !alreadyActionable) {
        if (hasExperienceVerb) {
          pushItem('PAST_EVENT', {}, 0.8);
          // An experience with a person, a place or a feeling is worth keeping
          // as a memory, not just as a dated event.
          if (entityIds.length > 0 || emotion) {
            pushItem('MEMORY', { significance: emotion ? 0.7 : 0.5 }, 0.7);
          }
        } else if (!emotion) {
          pushItem('PAST_EVENT', {}, 0.6);
        }
      } else if (tense === 'PRESENT' && !alreadyActionable && !emotion && !isDecision) {
        // Only record a present fact when the segment states something, rather
        // than merely greeting or acknowledging.
        if (body.trim().split(/\s+/).length >= 4) {
          pushItem('PRESENT_FACT', {}, 0.6);
        }
      }

      // A second temporal phrase in one segment implies a second event.
      if (temporalPhrases.length > 1 && !alreadyActionable) {
        const second = resolvePhrase(temporalPhrases[1]!.phrase, now);
        if (second.tense === 'FUTURE' && tense !== 'FUTURE') {
          pushItem('FUTURE_EVENT', {}, 0.6, 1);
        } else if (second.tense === 'PAST' && tense !== 'PAST') {
          pushItem('PAST_EVENT', {}, 0.6, 1);
        }
      }
    }

    // --- Intent -----------------------------------------------------------
    const lowerAll = text.toLowerCase();
    const trimmed = text.trim();
    let intent = 'LOG';
    let intentConfidence = 0.6;

    const isSmallTalk =
      trimmed.split(/\s+/).length <= 3 &&
      SMALL_TALK_PHRASES.some((phrase) => trimmed.toLowerCase().replace(/[!.?]/g, '') === phrase);

    if (isSmallTalk) {
      intent = 'SMALL_TALK';
      intentConfidence = 0.8;
    } else if (containsAny(lowerAll, CORRECTION_MARKERS)) {
      intent = 'CORRECT';
      intentConfidence = 0.7;
    } else if (items.some((item) => item.type === 'REMINDER')) {
      intent = 'SET_REMINDER';
      intentConfidence = 0.85;
    } else if (containsAny(lowerAll, QUESTION_MARKERS) || (trimmed.endsWith('?') && !containsAny(lowerAll, TASK_MARKERS))) {
      intent = 'ASK';
      intentConfidence = 0.75;
    } else if (items.some((item) => item.type === 'TASK')) {
      intent = 'CAPTURE_TASK';
      intentConfidence = 0.8;
    } else if (items.some((item) => item.type === 'FUTURE_EVENT')) {
      intent = 'PLAN';
      intentConfidence = 0.7;
    } else if (
      items.length > 0 &&
      items.every((item) => item.type === 'FEELING' || item.type === 'MEMORY')
    ) {
      intent = 'REFLECT';
      intentConfidence = 0.7;
    } else if (items.length === 0) {
      intent = 'UNKNOWN';
      intentConfidence = 0.3;
    }

    return {
      raw: {
        intent,
        intent_confidence: intentConfidence,
        summary: titleFrom(text, 25),
        entities: entities.map((entity) => ({
          id: entity.id,
          kind: entity.kind,
          name: entity.name,
          relation: entity.relation,
          mentions: entity.mentions,
          confidence: entity.confidence,
        })),
        items,
      },
      rawText: '',
      latencyMs: Date.now() - startedAt,
    };
  }
}
