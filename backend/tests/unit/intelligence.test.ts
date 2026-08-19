/**
 * Unit tests for the intelligence layer.
 *
 * Each module is tested in isolation, without a provider, a database or HTTP.
 * These are the tests that must keep passing when the AI model is replaced,
 * because none of them involve a model.
 */
import { describe, expect, it } from 'vitest';
import { findTemporalPhrases, inferTenseFromGrammar, interpretTemporal, reconcileTense, resolvePhrase } from '../../src/intelligence/temporal.js';
import { segmentConversation } from '../../src/intelligence/segment.js';
import { coerceEntityKind, coerceIntent, coerceItemType, normalizeEntities, normalizeItems, normalizeName } from '../../src/intelligence/normalize.js';
import { deduplicateItems, groundAnalysis } from '../../src/intelligence/grounding.js';
import { evaluateFollowUp } from '../../src/intelligence/follow-up.js';
import { calibrate, LOW_CONFIDENCE_THRESHOLD, MAX_CONFIDENCE } from '../../src/intelligence/confidence.js';
import { parseModelJson } from '../../src/ai/json.js';
import { EMPTY_TEMPORAL, type Item } from '../../src/schemas/analysis.schema.js';
import { buildInstructions } from '../../src/intelligence/prompt.js';

/** Wednesday 2025-06-11 10:00 UTC. */
const NOW = new Date('2025-06-11T10:00:00.000Z');

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    type: 'TASK',
    title: 'Do the thing',
    summary: '',
    source_text: 'I need to do the thing',
    source_span: { start: 0, end: 22 },
    segment_index: 0,
    temporal: { ...EMPTY_TEMPORAL },
    entity_ids: [],
    details: {},
    confidence: 0.7,
    ...overrides,
  };
}

describe('temporal resolution', () => {
  const cases: Array<[string, string | null]> = [
    ['yesterday', '2025-06-10'],
    ['today', '2025-06-11'],
    ['tomorrow', '2025-06-12'],
    ['day after tomorrow', '2025-06-13'],
    ['next Monday', '2025-06-16'],
    ['last Friday', '2025-06-06'],
    ['in 2 weeks', '2025-06-25'],
    ['3 days ago', '2025-06-08'],
    ['2025-12-25', '2025-12-25'],
    ['June 20', '2025-06-20'],
    ['20 June 2026', '2026-06-20'],
  ];

  for (const [phrase, expected] of cases) {
    it(`resolves "${phrase}" to ${expected}`, () => {
      expect(resolvePhrase(phrase, NOW).resolved).toBe(expected);
    });
  }

  it('treats a bare weekday as the upcoming one', () => {
    // NOW is Wednesday; the next Friday is the 13th.
    expect(resolvePhrase('friday', NOW).resolved).toBe('2025-06-13');
    expect(resolvePhrase('friday', NOW).tense).toBe('FUTURE');
  });

  it('gives a bare weekday lower confidence than a modified one', () => {
    expect(resolvePhrase('friday', NOW).confidence).toBeLessThan(
      resolvePhrase('next friday', NOW).confidence,
    );
  });

  it('records recurrence instead of a single date', () => {
    const resolved = resolvePhrase('every Monday', NOW);

    expect(resolved.precision).toBe('RECURRING');
    expect(resolved.recurrence).toBe('monday');
    expect(resolved.resolved).toBeNull();
  });

  it('refuses to resolve a directionally ambiguous phrase', () => {
    // "kal" is both yesterday and tomorrow.
    const resolved = resolvePhrase('kal', NOW);

    expect(resolved.resolved).toBeNull();
    expect(resolved.tense).toBe('UNSPECIFIED');
  });

  it('finds several phrases in one sentence, in reading order', () => {
    const found = findTemporalPhrases('I saw him yesterday and I will see him next Friday.');

    expect(found.map((match) => match.phrase.toLowerCase())).toEqual(['yesterday', 'next Friday'.toLowerCase()]);
    expect(found[0]!.start).toBeLessThan(found[1]!.start);
  });

  it('prefers the longest matching phrase', () => {
    const found = findTemporalPhrases('Let us meet the day after tomorrow.');
    expect(found[0]!.phrase.toLowerCase()).toBe('day after tomorrow');
  });

  it('always keeps the raw phrase next to the resolution', () => {
    const temporal = interpretTemporal('I met him yesterday', NOW);

    expect(temporal.raw).toBe('yesterday');
    expect(temporal.resolved).toBe('2025-06-10');
  });

  it('infers tense from irregular verbs', () => {
    expect(inferTenseFromGrammar('I bought a stove')).toBe('PAST');
    expect(inferTenseFromGrammar('I told her about it')).toBe('PAST');
    expect(inferTenseFromGrammar('I will call the bank')).toBe('FUTURE');
    expect(inferTenseFromGrammar('I am tired')).toBe('PRESENT');
  });

  it('lets grammar decide direction when the phrase is same-day', () => {
    // "Today I visited" is dated today but is unambiguously past.
    expect(reconcileTense('PRESENT', 'PAST')).toBe('PAST');
    expect(reconcileTense('PAST', 'PRESENT')).toBe('PAST');
    expect(reconcileTense('UNSPECIFIED', 'FUTURE')).toBe('FUTURE');
  });
});

describe('segmentation', () => {
  it('splits on sentence boundaries and keeps exact offsets', () => {
    const text = 'I met Arun. I need to call him. I felt happy.';
    const segments = segmentConversation(text);

    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(text.slice(segment.span.start, segment.span.end)).toBe(segment.text);
    }
  });

  it('splits a compound sentence into separate clauses', () => {
    const segments = segmentConversation(
      'I met Arun yesterday in Ahmedabad and I need to send him the project files.',
    );

    expect(segments.length).toBe(2);
    expect(segments[0]!.text).toContain('met Arun');
    expect(segments[1]!.text).toContain('need to send');
  });

  it('does not split a short sentence that merely contains "and"', () => {
    const segments = segmentConversation('I saw Arun and Priya.');
    expect(segments).toHaveLength(1);
  });

  it('does not treat an abbreviation as a sentence end', () => {
    const segments = segmentConversation('I met Dr. Sharma yesterday.');
    expect(segments).toHaveLength(1);
  });

  it('does not split a decimal number', () => {
    const segments = segmentConversation('The walk took 2.5 hours yesterday.');
    expect(segments).toHaveLength(1);
  });

  it('handles text with no terminating punctuation', () => {
    const segments = segmentConversation('I met Arun yesterday');

    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('I met Arun yesterday');
  });

  it('returns nothing for empty input', () => {
    expect(segmentConversation('   ')).toHaveLength(0);
  });
});

describe('normalisation', () => {
  it('maps model intent aliases onto Lifelog intents', () => {
    expect(coerceIntent('LOG')).toEqual({ intent: 'LOG', exact: true });
    expect(coerceIntent('journal').intent).toBe('LOG');
    expect(coerceIntent('create_task').intent).toBe('CAPTURE_TASK');
    expect(coerceIntent('nonsense').intent).toBe('UNKNOWN');
  });

  it('maps item type aliases', () => {
    expect(coerceItemType('todo')).toBe('TASK');
    expect(coerceItemType('Emotion')).toBe('FEELING');
    expect(coerceItemType('appointment')).toBe('FUTURE_EVENT');
    expect(coerceItemType('nonsense')).toBeNull();
  });

  it('preserves an unrecognised entity kind rather than dropping it', () => {
    expect(coerceEntityKind('company')).toEqual({ kind: 'ORGANIZATION', rawKind: null });
    expect(coerceEntityKind('recipe')).toEqual({ kind: 'OTHER', rawKind: 'recipe' });
  });

  it('normalises names for comparison', () => {
    expect(normalizeName('The Sabarmati Ashram')).toBe('sabarmati ashram');
    expect(normalizeName('Arun!')).toBe('arun');
    expect(normalizeName('my brother')).toBe('brother');
  });

  it('merges entities that normalise to the same name', () => {
    const { entities, idMap } = normalizeEntities([
      { id: 'a', kind: 'PERSON', name: 'Arun' },
      { id: 'b', kind: 'OTHER', name: 'arun' },
    ]);

    expect(entities).toHaveLength(1);
    expect(entities[0]!.kind).toBe('PERSON');
    expect(idMap.get('a')).toBe('e1');
    expect(idMap.get('b')).toBe('e1');
  });

  it('ignores any date the model computed', () => {
    const { items } = normalizeItems(
      [
        {
          type: 'TASK',
          title: 'Call the bank',
          source_text: 'call the bank',
          // A model's own arithmetic is discarded; only the phrase is kept.
          temporal: { raw: 'tomorrow', resolved: '1999-01-01' },
        },
      ],
      new Map(),
    );

    expect(items[0]!.temporal.raw).toBe('tomorrow');
    expect(items[0]!.temporal.resolved).toBeNull();
  });

  it('reassigns ids rather than trusting the model', () => {
    const { items } = normalizeItems(
      [
        { id: 'i7', type: 'TASK', title: 'A', source_text: 'A' },
        { id: 'i7', type: 'TASK', title: 'B', source_text: 'B' },
      ],
      new Map(),
    );

    expect(items.map((item) => item.id)).toEqual(['i1', 'i2']);
  });
});

describe('grounding', () => {
  const text = 'I met Arun in Ahmedabad.';

  it('keeps extractions found in the text', () => {
    const result = groundAnalysis(
      text,
      [
        {
          id: 'e1',
          kind: 'PERSON',
          raw_kind: null,
          name: 'Arun',
          normalized_name: 'arun',
          aliases: [],
          relation: null,
          attributes: {},
          mentions: [],
          confidence: 0.8,
        },
      ],
      [makeItem({ type: 'PAST_EVENT', source_text: 'I met Arun', source_span: null, entity_ids: ['e1'] })],
    );

    expect(result.entities).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    // The mention span is backfilled from the text.
    expect(result.entities[0]!.mentions).toHaveLength(1);
  });

  it('replaces the model\'s copy with the real substring', () => {
    const result = groundAnalysis(
      text,
      [],
      [makeItem({ source_text: 'i met arun', source_span: null })],
    );

    expect(result.items[0]!.source_text).toBe('I met Arun');
    const span = result.items[0]!.source_span!;
    expect(text.slice(span.start, span.end)).toBe('I met Arun');
  });

  it('keeps a close paraphrase but lowers its confidence', () => {
    const result = groundAnalysis(
      'I met Arun in Ahmedabad and we discussed the project timeline.',
      [],
      [makeItem({ source_text: 'discussed project timeline with Arun', source_span: null, confidence: 0.9 })],
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.confidence).toBeLessThanOrEqual(0.5);
    expect(result.warnings.some((warning) => warning.code === 'ITEM_PARAPHRASED')).toBe(true);
  });

  it('rejects an item with no support in the text', () => {
    const result = groundAnalysis(
      text,
      [],
      [makeItem({ source_text: 'renew the passport before the holiday', source_span: null })],
    );

    expect(result.items).toHaveLength(0);
    expect(result.rejected).toBe(1);
  });

  it('deduplicates items sharing a type and a span', () => {
    const { items, warnings } = deduplicateItems([
      makeItem({ id: 'i1', confidence: 0.5 }),
      makeItem({ id: 'i2', confidence: 0.9, entity_ids: ['e1'] }),
    ]);

    expect(items).toHaveLength(1);
    // The higher-confidence copy wins, and entity references are unioned.
    expect(items[0]!.confidence).toBe(0.9);
    expect(warnings[0]!.code).toBe('ITEM_DUPLICATE');
  });

  it('does not merge different types on the same span', () => {
    const { items } = deduplicateItems([
      makeItem({ id: 'i1', type: 'PAST_EVENT' }),
      makeItem({ id: 'i2', type: 'MEMORY' }),
    ]);

    expect(items).toHaveLength(2);
  });
});

describe('follow-up restraint', () => {
  it('asks when a reminder has no time', () => {
    const reminder = makeItem({
      type: 'REMINDER',
      title: 'remind me to submit the form',
      details: { explicit: true },
    });

    const { followUp } = evaluateFollowUp([reminder], { intent: 'SET_REMINDER', text: 'Remind me to submit the form.' });

    expect(followUp).not.toBeNull();
    expect(followUp!.blocking).toBe(true);
  });

  it('stays silent on a diary entry even when details are missing', () => {
    const memory = makeItem({ type: 'MEMORY', title: 'A walk by the river' });

    const { followUp } = evaluateFollowUp([memory], { intent: 'REFLECT', text: 'Had a walk by the river.' });

    expect(followUp).toBeNull();
  });

  it('stays silent on a plain log', () => {
    const event = makeItem({ type: 'FUTURE_EVENT', title: 'Dinner with Priya' });

    const { followUp } = evaluateFollowUp([event], { intent: 'LOG', text: 'Dinner with Priya sometime.' });

    expect(followUp).toBeNull();
    // The gap is still recorded, it is just not worth interrupting for.
    const { missing } = evaluateFollowUp([event], { intent: 'LOG', text: 'Dinner with Priya sometime.' });
    expect(missing.some((entry) => entry.field === 'event_date')).toBe(true);
  });

  it('asks only one question when several gaps exist', () => {
    const items = [
      makeItem({ id: 'i1', type: 'REMINDER', title: 'remind me to call mum', details: { explicit: true } }),
      makeItem({ id: 'i2', type: 'FUTURE_EVENT', title: 'the trip' }),
    ];

    const { followUp } = evaluateFollowUp(items, { intent: 'SET_REMINDER', text: 'Remind me to call mum.' });

    expect(followUp).not.toBeNull();
    // The blocking gap wins over the merely incomplete one.
    expect(followUp!.missing_fields).toEqual(['reminder_time']);
  });

  it('never asks a question when the user is querying memory', () => {
    const items = [makeItem({ type: 'REMINDER', title: 'remind me', details: { explicit: true } })];
    const { followUp } = evaluateFollowUp(items, { intent: 'ASK', text: 'When did I last see Arun?' });

    expect(followUp).toBeNull();
  });
});

describe('confidence calibration', () => {
  const baseAnalysis = () => ({
    schema_version: '1.0.0',
    intent: 'LOG' as const,
    intent_confidence: 0.8,
    language: 'en',
    summary: '',
    segments: [],
    entities: [],
    items: [makeItem({ confidence: 0.9 })],
    missing_information: [],
    follow_up: null,
    warnings: [],
  });

  it('never reports full certainty', () => {
    const analysis = calibrate(baseAnalysis(), { degraded: false, repaired: false });
    expect(analysis.items[0]!.confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
  });

  it('penalises an ungrounded item', () => {
    const grounded = calibrate(baseAnalysis(), { degraded: false, repaired: false }).items[0]!.confidence;

    const analysis = baseAnalysis();
    analysis.items[0]!.source_span = null;
    const ungrounded = calibrate(analysis, { degraded: false, repaired: false }).items[0]!.confidence;

    expect(ungrounded).toBeLessThan(grounded);
  });

  it('penalises a degraded reading', () => {
    const normal = calibrate(baseAnalysis(), { degraded: false, repaired: false }).items[0]!.confidence;
    const degraded = calibrate(baseAnalysis(), { degraded: true, repaired: false }).items[0]!.confidence;

    expect(degraded).toBeLessThan(normal);
  });

  it('penalises a purposeful intent that extracted nothing', () => {
    const analysis = baseAnalysis();
    analysis.items = [];

    const calibrated = calibrate(analysis, { degraded: false, repaired: false });
    expect(calibrated.intent_confidence).toBeLessThan(0.8);
  });

  it('keeps the low-confidence threshold meaningful', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    expect(LOW_CONFIDENCE_THRESHOLD).toBeLessThan(MAX_CONFIDENCE);
  });
});

describe('model JSON recovery', () => {
  it('parses clean JSON', () => {
    expect(parseModelJson('{"a":1}')).toMatchObject({ ok: true, value: { a: 1 } });
  });

  it('strips a markdown fence', () => {
    const result = parseModelJson('```json\n{"a":1}\n```');

    expect(result.ok).toBe(true);
    expect(result.repairs).toContain('stripped-fences');
  });

  it('ignores prose around the JSON', () => {
    const result = parseModelJson('Sure! Here you go:\n{"a":1}\nLet me know if you need more.');
    expect(result.value).toEqual({ a: 1 });
  });

  it('is not confused by braces inside strings', () => {
    const result = parseModelJson('{"text":"he said {hello} to me"}');
    expect(result.value).toEqual({ text: 'he said {hello} to me' });
  });

  it('closes nested structures truncated by a token limit', () => {
    const result = parseModelJson('{"items":[{"type":"TASK","title":"Call the bank"');

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ items: [{ type: 'TASK', title: 'Call the bank' }] });
  });

  it('reports failure instead of throwing', () => {
    const result = parseModelJson('I cannot help with that.');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('reports failure on empty output', () => {
    expect(parseModelJson('').ok).toBe(false);
  });
});

describe('prompt', () => {
  const instructions = buildInstructions();

  it('forbids the model from computing dates', () => {
    expect(instructions).toContain('DO NOT COMPUTE DATES');
  });

  it('states the task/reminder distinction Lifelog enforces in code', () => {
    expect(instructions).toContain('TASK vs REMINDER');
    expect(instructions).toMatch(/asks to be reminded/i);
  });

  it('requires verbatim grounding', () => {
    expect(instructions).toContain('GROUND EVERYTHING');
    expect(instructions).toContain('character-for-character');
  });

  it('tells the model that extracting nothing is a valid answer', () => {
    expect(instructions).toMatch(/empty result is a valid and correct answer/i);
  });
});
