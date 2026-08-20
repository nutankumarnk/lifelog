/**
 * Domain module tests — Reminder / Task display enrichment.
 */
import { describe, expect, it } from 'vitest';
import { enrichActionItems } from '../../src/domain/action-items.js';
import { formatReminderDisplay, formatTaskDisplay } from '../../src/domain/display-text.js';
import { enrichReminder } from '../../src/domain/reminder.js';
import { enrichTask } from '../../src/domain/task.js';
import { EMPTY_TEMPORAL, type Entity, type Item } from '../../src/schemas/analysis.schema.js';
import { detectStance } from '../../src/intelligence/stance.js';
import { detectGaps, scoreAlgorithmConfidence } from '../../src/intelligence/gaps.js';
import { inferEmotionalImpact } from '../../src/intelligence/emotional-impact.js';
import { extractTeacherPatches, reconcileWithTeacher } from '../../src/intelligence/reconcile.js';
import {
  learnFromDisagreements,
  resetPatternStoreCache,
  type PatternStoreSnapshot,
} from '../../src/intelligence/pattern-store.js';

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

const priya: Entity = {
  id: 'e1',
  kind: 'PERSON',
  raw_kind: null,
  name: 'Priya',
  normalized_name: 'priya',
  aliases: [],
  relation: null,
  attributes: {},
  mentions: [],
  confidence: 0.8,
};

describe('display-text normalizer', () => {
  it('formats a raw reminder into grammatical display text', () => {
    const display = formatReminderDisplay('remind me call priya tomo 5', [priya]);
    expect(display.displayText.toLowerCase()).toContain('remind me to');
    expect(display.displayText).toContain('Priya');
    expect(display.displayText.toLowerCase()).toContain('tomorrow');
    expect(display.displayText.endsWith('.')).toBe(true);
  });

  it('formats a raw task into an imperative sentence', () => {
    const display = formatTaskDisplay('need send file friday');
    expect(display.displayText.toLowerCase()).toContain('send');
    expect(display.title.length).toBeGreaterThan(0);
    expect(display.displayText.endsWith('.')).toBe(true);
  });
});

describe('Reminder and Task modules', () => {
  it('enriches REMINDER without changing source_text', () => {
    const source = 'remind me call priya tomo 5';
    const item = makeItem({
      type: 'REMINDER',
      title: 'call priya',
      source_text: source,
      source_span: { start: 0, end: source.length },
      details: { explicit: true },
    });
    const enriched = enrichReminder(item, { text: source, entities: [priya] });
    expect(enriched.source_text).toBe(source);
    expect(enriched.details.display_text).toMatch(/Remind me to/i);
    expect(enriched.details.explicit).toBe(true);
    expect(enriched.details.status).toBe('OPEN');
  });

  it('enriches TASK without changing source_text', () => {
    const source = 'I need to send him the files on Friday';
    const item = makeItem({
      type: 'TASK',
      source_text: source,
      source_span: { start: 0, end: source.length },
    });
    const enriched = enrichTask(item, { text: source, entities: [] });
    expect(enriched.source_text).toBe(source);
    expect(enriched.details.display_text).toBeTruthy();
    expect(enriched.details.status).toBe('OPEN');
    expect(enriched.details.priority).toBe('NORMAL');
  });

  it('enrichActionItems only touches REMINDER and TASK', () => {
    const feeling = makeItem({
      id: 'i2',
      type: 'FEELING',
      title: 'happy',
      source_text: 'I felt happy',
    });
    const [out] = enrichActionItems([feeling], { text: 'I felt happy', entities: [] });
    expect(out.details.display_text).toBeUndefined();
    expect(out.title).toBe('happy');
  });
});

describe('stance and gaps', () => {
  it('detects PLAN stance for reminders', () => {
    const result = detectStance(
      'Remind me to call Priya tomorrow',
      'SET_REMINDER',
      [makeItem({ type: 'REMINDER', source_text: 'Remind me to call Priya tomorrow' })],
    );
    expect(result.stance).toBe('PLAN');
  });

  it('flags missing feeling split as a gap', () => {
    const gaps = detectGaps([], {
      text: 'I met Arun and I felt really happy',
      intent: 'LOG',
    });
    expect(gaps.some((gap) => gap.code === 'FEELING_NOT_SPLIT')).toBe(true);
  });

  it('scores lower confidence when gaps exist', () => {
    const items = [makeItem()];
    const withGaps = scoreAlgorithmConfidence(items, [
      { code: 'MULTI_FACT_SPLIT', message: 'x', about_item_id: null },
    ]);
    const without = scoreAlgorithmConfidence(items, []);
    expect(withGaps).toBeLessThan(without);
  });
});

describe('emotional impact', () => {
  it('infers impact only from FEELING items', () => {
    const text = 'I felt really happy with Arun';
    const feeling = makeItem({
      type: 'FEELING',
      title: 'happy',
      source_text: 'I felt really happy',
      source_span: { start: 0, end: 19 },
      details: { emotion: 'happy', sentiment: 'POSITIVE', intensity: 0.8 },
      entity_ids: ['e1'],
    });
    const impacts = inferEmotionalImpact(text, [feeling], [priya]);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.inferred).toBe(true);
    expect(impacts[0]?.valence).toBe('POSITIVE');
  });

  it('does not invent impact from neutral text', () => {
    const impacts = inferEmotionalImpact(
      'I went to the office',
      [makeItem({ type: 'PAST_EVENT', source_text: 'I went to the office', title: 'Office' })],
      [],
    );
    expect(impacts).toHaveLength(0);
  });
});

describe('teacher reconcile and pattern store', () => {
  it('accepts grounded add_item patches and rejects ungrounded ones', () => {
    const text = 'I met Arun yesterday and I felt really happy';
    const result = reconcileWithTeacher({
      text,
      intent: 'LOG',
      stance: 'LOG',
      items: [
        makeItem({
          type: 'PAST_EVENT',
          title: 'Met Arun',
          source_text: 'I met Arun yesterday',
          source_span: { start: 0, end: 20 },
        }),
      ],
      entities: [],
      emotionalImpact: [],
      gaps: [{ code: 'FEELING_NOT_SPLIT', message: 'missing feeling', about_item_id: null }],
      patches: [
        {
          op: 'add_item',
          payload: {
            type: 'FEELING',
            source_text: 'I felt really happy',
            title: 'Happy',
            details: { emotion: 'happy', sentiment: 'POSITIVE' },
          },
        },
        {
          op: 'add_item',
          payload: { type: 'FEELING', source_text: 'I felt devastated', title: 'No' },
        },
      ],
    });
    expect(result.items.some((item) => item.type === 'FEELING')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'TEACHER_ITEM_REJECTED')).toBe(true);
  });

  it('extracts patches from teacher JSON', () => {
    const patches = extractTeacherPatches({
      patches: [{ op: 'set_stance', payload: { stance: 'VENT' } }],
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]?.op).toBe('set_stance');
  });

  it('learns weights from disagreements without editing lexicon source', () => {
    resetPatternStoreCache();
    const store: PatternStoreSnapshot = { updatedAt: '', weights: [], proposals: [] };
    const updated = learnFromDisagreements(store, [
      {
        field: 'stance',
        algorithmValue: 'LOG',
        aiValue: 'VENT',
        winner: 'ai',
        reason: 'test',
      },
    ]);
    expect(updated.weights.some((w) => w.feature === 'stance' && w.label === 'VENT')).toBe(true);
  });
});
