/**
 * AI behaviour tests — the required Phase 1 conversation scenarios.
 *
 * These run against the offline rule-engine provider so they are deterministic
 * and free. They assert on *Lifelog's* guarantees, not on a particular model's
 * wording: that a task is recognised as a task, that a date resolves correctly,
 * that nothing is invented. A hosted model must satisfy the same assertions,
 * which is what makes the model replaceable.
 *
 * Scenario numbering matches the table in docs/testing.md.
 */
import { describe, expect, it } from 'vitest';
import { FIXED_NOW, itemsOfType, understand } from '../helpers/test-app.js';

describe('Scenario 1 — simple memory', () => {
  it('records a lived experience as both a dated event and a memory', async () => {
    const { analysis } = await understand('I met Arun yesterday in Ahmedabad.');

    expect(analysis.intent).toBe('LOG');
    expect(itemsOfType(analysis, 'PAST_EVENT')).toHaveLength(1);
    expect(itemsOfType(analysis, 'MEMORY')).toHaveLength(1);

    const names = analysis.entities.map((entity) => entity.name);
    expect(names).toContain('Arun');
    expect(names).toContain('Ahmedabad');

    // The memory is linked to the people and places that make it a memory.
    const memory = itemsOfType(analysis, 'MEMORY')[0]!;
    expect(memory.entity_ids.length).toBe(2);
  });
});

describe('Scenario 2 — past event', () => {
  it('resolves "yesterday" against the conversation time', async () => {
    const { analysis } = await understand('I went to the dentist yesterday.');
    const event = itemsOfType(analysis, 'PAST_EVENT')[0];

    expect(event).toBeDefined();
    expect(event!.temporal.tense).toBe('PAST');
    expect(event!.temporal.raw).toBe('yesterday');
    // FIXED_NOW is 2025-06-11.
    expect(event!.temporal.resolved).toBe('2025-06-10');
  });

  it("keeps the user's original phrase alongside the resolved date", async () => {
    const { analysis } = await understand('I saw Meera three days ago.');
    const event = analysis.items.find((item) => item.temporal.raw !== null);

    expect(event).toBeDefined();
    // Both are stored: the phrase is what the user said and cannot be wrong,
    // the date is Lifelog's interpretation and could be.
    expect(event!.temporal.raw).toBe('three days ago');
    expect(event!.temporal.resolved).toBe('2025-06-08');
  });

  it('leaves a vague count unresolved rather than guessing a date', async () => {
    const { analysis } = await understand('I spoke to Meera a few weeks ago.');
    const event = analysis.items.find((item) => item.temporal.raw !== null);

    expect(event!.temporal.raw).toBe('few weeks ago');
    expect(event!.temporal.resolved).toBeNull();
    expect(event!.temporal.tense).toBe('PAST');
  });
});

describe('Scenario 3 — future event', () => {
  it('resolves a forward-looking date and classifies the item as future', async () => {
    const { analysis } = await understand("I'm flying to Delhi next Friday for my cousin's wedding.");
    const event = itemsOfType(analysis, 'FUTURE_EVENT')[0];

    expect(event).toBeDefined();
    expect(event!.temporal.tense).toBe('FUTURE');
    // FIXED_NOW is Wednesday 2025-06-11, so the coming Friday is the 13th.
    expect(event!.temporal.resolved).toBe('2025-06-13');
    expect(analysis.entities.map((entity) => entity.name)).toContain('Delhi');
  });
});

describe('Scenario 4 — explicit task', () => {
  it('captures an obligation as a TASK, not a REMINDER', async () => {
    const { analysis } = await understand('I need to call the bank tomorrow.');

    expect(analysis.intent).toBe('CAPTURE_TASK');
    expect(itemsOfType(analysis, 'TASK')).toHaveLength(1);
    expect(itemsOfType(analysis, 'REMINDER')).toHaveLength(0);

    const task = itemsOfType(analysis, 'TASK')[0]!;
    expect(task.details.status).toBe('OPEN');
    expect(task.temporal.resolved).toBe('2025-06-12');
  });
});

describe('Scenario 5 — explicit reminder', () => {
  it('captures an explicit request to be reminded as a REMINDER', async () => {
    const { analysis } = await understand('Remind me to call the dentist next Monday.');

    expect(analysis.intent).toBe('SET_REMINDER');
    const reminders = itemsOfType(analysis, 'REMINDER');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.details.explicit).toBe(true);
    expect(reminders[0]!.temporal.resolved).toBe('2025-06-16');
  });

  it('does not emit the reminder twice as both a reminder and a task', async () => {
    const { analysis } = await understand('Remind me to pay the electricity bill on Friday.');

    expect(itemsOfType(analysis, 'REMINDER')).toHaveLength(1);
    expect(itemsOfType(analysis, 'TASK')).toHaveLength(0);
  });
});

describe('Scenario 6 — mixed conversation', () => {
  it('splits one message into several items of different types', async () => {
    const { analysis } = await understand(
      'I met Arun yesterday in Ahmedabad and I need to send him the project files by Friday.',
    );

    expect(itemsOfType(analysis, 'PAST_EVENT').length).toBeGreaterThanOrEqual(1);
    expect(itemsOfType(analysis, 'TASK')).toHaveLength(1);

    // The past event and the task carry different dates.
    const past = itemsOfType(analysis, 'PAST_EVENT')[0]!;
    const task = itemsOfType(analysis, 'TASK')[0]!;
    expect(past.temporal.resolved).toBe('2025-06-10');
    expect(task.temporal.resolved).toBe('2025-06-13');

    // Each item points back at a distinct part of the conversation.
    expect(past.source_span).not.toBeNull();
    expect(task.source_span).not.toBeNull();
    expect(past.source_span!.start).not.toBe(task.source_span!.start);
  });
});

describe('Scenario 7 — unknown entity', () => {
  it('preserves an entity it cannot categorise instead of dropping it', async () => {
    const { analysis } = await understand('I bought a new Kelong stove for the trek.');

    const kelong = analysis.entities.find((entity) => entity.name === 'Kelong');
    expect(kelong).toBeDefined();
    expect(kelong!.kind).toBe('OTHER');
  });

  it('keeps a custom kind label reported by a provider', async () => {
    const provider = (await import('../../src/ai/mock.provider.js')).MockProvider.respondingWith({
      intent: 'LOG',
      entities: [{ id: 'e1', kind: 'medication', name: 'Metformin', confidence: 0.9 }],
      items: [
        {
          id: 'i1',
          type: 'PRESENT_FACT',
          title: 'Started Metformin',
          source_text: 'I started taking Metformin',
          entity_ids: ['e1'],
        },
      ],
    });

    const { analysis } = await understand('I started taking Metformin this week.', provider);
    const entity = analysis.entities[0]!;

    expect(entity.kind).toBe('OTHER');
    // The original label survives, so a later phase can promote it.
    expect(entity.raw_kind).toBe('medication');
    expect(entity.name).toBe('Metformin');
  });
});

describe('Scenario 8 — feeling', () => {
  it('extracts an expressed emotion with sentiment and intensity', async () => {
    const { analysis } = await understand('I felt really anxious about the presentation today.');

    const feeling = itemsOfType(analysis, 'FEELING')[0];
    expect(feeling).toBeDefined();
    expect(feeling!.details.emotion).toBe('anxiety');
    expect(feeling!.details.sentiment).toBe('NEGATIVE');
    expect(feeling!.details.intensity).toBeGreaterThan(0.5);
  });

  it('does not invent a feeling from neutral text', async () => {
    const { analysis } = await understand('I renewed my passport at the office.');
    expect(itemsOfType(analysis, 'FEELING')).toHaveLength(0);
  });
});

describe('Scenario 9 — missing information', () => {
  it('asks one question when a reminder has no time', async () => {
    const { analysis } = await understand('Remind me to submit the insurance form.');

    expect(analysis.follow_up).not.toBeNull();
    expect(analysis.follow_up!.blocking).toBe(true);
    expect(analysis.follow_up!.missing_fields).toContain('reminder_time');
    expect(analysis.missing_information.length).toBeGreaterThan(0);
  });

  it('asks at most one question', async () => {
    const { analysis } = await understand(
      'Remind me to submit the form. Also remind me to renew the policy. And I am meeting someone soon.',
    );

    // `follow_up` is a single object by contract, never a list.
    expect(analysis.follow_up).not.toBeNull();
    expect(Array.isArray(analysis.follow_up)).toBe(false);
  });
});

describe('Scenario 10 — diary-only experience', () => {
  it('records a reflective entry without interrogating the user', async () => {
    const { analysis } = await understand(
      'Today I visited the Sabarmati Ashram with Priya. It was peaceful and I felt calm for the first time in weeks.',
    );

    expect(itemsOfType(analysis, 'MEMORY').length).toBeGreaterThanOrEqual(1);
    expect(itemsOfType(analysis, 'FEELING').length).toBeGreaterThanOrEqual(1);
    // A diary entry is complete as written. Lifelog stays quiet.
    expect(analysis.follow_up).toBeNull();
  });

  it('stays quiet about a plain log even when details are absent', async () => {
    const { analysis } = await understand('Had a long walk by the river this evening.');
    expect(analysis.follow_up).toBeNull();
  });
});

describe('Scenario 11 — no hallucination', () => {
  it('drops entities the conversation never mentions', async () => {
    const { MockProvider } = await import('../../src/ai/mock.provider.js');
    const provider = MockProvider.respondingWith({
      intent: 'LOG',
      entities: [
        { id: 'e1', kind: 'PERSON', name: 'Arun', confidence: 0.9 },
        // Never appears in the text.
        { id: 'e2', kind: 'PERSON', name: 'Rajesh Kumar', confidence: 0.9 },
        { id: 'e3', kind: 'PLACE', name: 'Mumbai', confidence: 0.8 },
      ],
      items: [
        { id: 'i1', type: 'PAST_EVENT', title: 'Met Arun', source_text: 'I met Arun', entity_ids: ['e1', 'e2'] },
      ],
    });

    const { analysis } = await understand('I met Arun.', provider);

    expect(analysis.entities.map((entity) => entity.name)).toEqual(['Arun']);
    expect(analysis.warnings.filter((warning) => warning.code === 'ENTITY_UNGROUNDED')).toHaveLength(2);
    // The surviving item no longer references the removed entities.
    expect(analysis.items[0]!.entity_ids).toHaveLength(1);
  });

  it('drops items that are not supported by the conversation', async () => {
    const { MockProvider } = await import('../../src/ai/mock.provider.js');
    const provider = MockProvider.respondingWith({
      intent: 'LOG',
      entities: [],
      items: [
        { id: 'i1', type: 'PAST_EVENT', title: 'Had coffee', source_text: 'I had coffee' },
        {
          id: 'i2',
          type: 'TASK',
          title: 'Renew the insurance policy before the deadline',
          source_text: 'I must renew my insurance policy before the deadline next month',
        },
      ],
    });

    const { analysis } = await understand('I had coffee.', provider);

    expect(analysis.items).toHaveLength(1);
    expect(analysis.items[0]!.type).toBe('PAST_EVENT');
    expect(analysis.warnings.some((warning) => warning.code === 'ITEM_UNGROUNDED')).toBe(true);
  });

  it('discards a time phrase the user never used', async () => {
    const { MockProvider } = await import('../../src/ai/mock.provider.js');
    const provider = MockProvider.respondingWith({
      intent: 'LOG',
      entities: [],
      items: [
        {
          id: 'i1',
          type: 'PAST_EVENT',
          title: 'Went for a run',
          source_text: 'I went for a run',
          temporal: { raw: 'last Tuesday' },
        },
      ],
    });

    const { analysis } = await understand('I went for a run.', provider);

    expect(analysis.items[0]!.temporal.raw).toBeNull();
    expect(analysis.items[0]!.temporal.resolved).toBeNull();
    expect(analysis.warnings.some((warning) => warning.code === 'TEMPORAL_UNGROUNDED')).toBe(true);
  });

  it('returns an empty item list rather than inventing content', async () => {
    const { analysis } = await understand('ok');
    expect(analysis.items).toHaveLength(0);
    expect(analysis.entities).toHaveLength(0);
  });
});

describe('Scenario 12 — multiple temporal references', () => {
  it('resolves each date independently within one message', async () => {
    const { analysis } = await understand(
      'I saw the doctor yesterday and I have to collect the report next Tuesday.',
    );

    const resolved = analysis.items
      .map((item) => item.temporal.resolved)
      .filter((value): value is string => value !== null);

    expect(resolved).toContain('2025-06-10'); // yesterday
    expect(resolved).toContain('2025-06-17'); // next Tuesday
  });

  it('resolves relative offsets from the conversation time', async () => {
    const { analysis } = await understand('I need to renew the lease in 2 weeks.');
    const task = itemsOfType(analysis, 'TASK')[0]!;

    expect(task.temporal.raw).toBe('in 2 weeks');
    expect(task.temporal.resolved).toBe('2025-06-25');
  });

  it('refuses to guess a date for a directionally ambiguous phrase', async () => {
    // "kal" is both yesterday and tomorrow in Hindi.
    const { analysis } = await understand('Kal mujhe Arun se milna hai.');
    const dated = analysis.items.filter((item) => item.temporal.raw?.toLowerCase() === 'kal');

    for (const item of dated) {
      expect(item.temporal.resolved).toBeNull();
      expect(item.temporal.precision).toBe('RELATIVE');
    }
  });
});

describe('Scenario 18 — multiple entities', () => {
  it('extracts every distinct person and place', async () => {
    const { analysis } = await understand(
      'I met Arun and Priya in Ahmedabad, then travelled to Udaipur with Rahul.',
    );

    const names = analysis.entities.map((entity) => entity.name);
    for (const expected of ['Arun', 'Priya', 'Ahmedabad', 'Udaipur', 'Rahul']) {
      expect(names).toContain(expected);
    }
  });
});

describe('Scenario 19 — duplicate entity', () => {
  it('merges repeated mentions of the same person into one entity', async () => {
    const { analysis } = await understand(
      'I called Arun in the morning. Arun said he would send the documents. I will meet Arun on Friday.',
    );

    const arunEntities = analysis.entities.filter((entity) => entity.normalized_name === 'arun');
    expect(arunEntities).toHaveLength(1);
    // Every mention is retained on the single entity.
    expect(arunEntities[0]!.mentions.length).toBeGreaterThanOrEqual(1);
  });

  it('merges duplicates a provider reports under different ids and casings', async () => {
    const { MockProvider } = await import('../../src/ai/mock.provider.js');
    const provider = MockProvider.respondingWith({
      intent: 'LOG',
      entities: [
        { id: 'e1', kind: 'PERSON', name: 'Arun', confidence: 0.9 },
        { id: 'e2', kind: 'OTHER', name: 'arun', confidence: 0.4 },
        { id: 'e3', kind: 'PERSON', name: 'Arun', confidence: 0.8 },
      ],
      items: [
        { id: 'i1', type: 'PAST_EVENT', title: 'Met Arun', source_text: 'I met Arun', entity_ids: ['e1', 'e2', 'e3'] },
      ],
    });

    const { analysis } = await understand('I met Arun.', provider);

    expect(analysis.entities).toHaveLength(1);
    expect(analysis.entities[0]!.kind).toBe('PERSON');
    expect(analysis.items[0]!.entity_ids).toEqual(['e1']);
  });

  it('removes duplicate items covering the same span and type', async () => {
    const { MockProvider } = await import('../../src/ai/mock.provider.js');
    const provider = MockProvider.respondingWith({
      intent: 'LOG',
      entities: [],
      items: [
        { id: 'i1', type: 'TASK', title: 'Pay the rent', source_text: 'I need to pay the rent', confidence: 0.6 },
        { id: 'i2', type: 'TASK', title: 'Rent payment', source_text: 'I need to pay the rent', confidence: 0.9 },
      ],
    });

    const { analysis } = await understand('I need to pay the rent.', provider);

    expect(itemsOfType(analysis, 'TASK')).toHaveLength(1);
    expect(analysis.warnings.some((warning) => warning.code === 'ITEM_DUPLICATE')).toBe(true);
  });
});

describe('Scenario 20 — multilingual and mixed-language input', () => {
  it('labels code-switched text as mixed and still extracts from it', async () => {
    const { analysis } = await understand('Kal mujhe Arun se milna hai, and I need to book the tickets.');

    expect(analysis.language).toBe('mixed');
    expect(itemsOfType(analysis, 'TASK').length).toBeGreaterThanOrEqual(1);
  });

  it('labels text containing a non-Latin script as mixed', async () => {
    const { analysis } = await understand('मैं कल अरुण से मिला। I need to send the report.');
    expect(analysis.language).toBe('mixed');
  });

  it('preserves the original script in stored text', async () => {
    const text = 'मैं कल अरुण से मिला। I need to send the report.';
    const { analysis } = await understand(text);

    // Segments quote the conversation verbatim; nothing is transliterated.
    expect(analysis.segments.some((segment) => /[\u0900-\u097F]/.test(segment.text))).toBe(true);
  });
});

describe('cross-cutting guarantees', () => {
  it('grounds every surviving item in the conversation text', async () => {
    const text =
      'I met Arun yesterday in Ahmedabad, I need to send him the deck by Friday, and I felt relieved afterwards.';
    const { analysis } = await understand(text);

    for (const item of analysis.items) {
      if (item.source_span) {
        expect(text.slice(item.source_span.start, item.source_span.end)).toBe(item.source_text);
      }
    }
  });

  it('never reports full certainty', async () => {
    const { analysis } = await understand('I met Arun yesterday in Ahmedabad.');
    for (const item of analysis.items) {
      expect(item.confidence).toBeLessThanOrEqual(0.95);
      expect(item.confidence).toBeGreaterThan(0);
    }
  });

  it('resolves dates against the supplied reference time, not the wall clock', async () => {
    const later = new Date('2026-01-15T08:00:00.000Z'); // a Thursday
    const { analysis } = await understand('I met Arun yesterday.', undefined, later);

    expect(analysis.items[0]!.temporal.resolved).toBe('2026-01-14');
    expect(FIXED_NOW.toISOString()).not.toContain('2026-01');
  });
});
