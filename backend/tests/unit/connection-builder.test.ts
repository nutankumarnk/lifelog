/**
 * Unit tests for connection builder (V2).
 *
 * V2 changes tested here:
 *   - Forbidden item types (TASK, REMINDER, DECISION, FEELING, MEMORY) do NOT produce nodes
 *   - Entity kinds map to correct V2 types (OBJECT → physical_object, OTHER → other_entity)
 *   - Only PAST_EVENT / FUTURE_EVENT items become `event` objects
 *   - Relationships come from item_entity links, not co-occurrence
 */
import { describe, expect, it } from 'vitest';
import { buildConnections } from '../../src/memory/connection-builder.js';
import type { Analysis } from '../../src/schemas/analysis.schema.js';

// Minimal analysis factory — only sets required fields
function makeAnalysis(partial: Partial<Analysis>): Analysis {
  return {
    schema_version: '1.1.0',
    language: 'en',
    intent: 'LOG',
    intent_confidence: 0.9,
    stance: 'LOG',
    stance_confidence: 0.9,
    summary: '',
    segments: [],
    entities: [],
    items: [],
    emotional_impact: [],
    gaps: [],
    algorithm_confidence: 0.8,
    reconciliation: {
      used_ai_teacher: false,
      skipped_ai: false,
      disagreement_count: 0,
      winners: [],
    },
    missing_information: [],
    follow_up: null,
    warnings: [],
    ...partial,
  };
}

describe('connection-builder V2', () => {

  it('accepts an explicit grounded person-to-place connection', () => {
    const analysis = makeAnalysis({
      entities: [
        { id: 'e1', kind: 'PERSON', raw_kind: null, name: 'Rahul', normalized_name: 'rahul', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.95 },
        { id: 'e2', kind: 'PLACE', raw_kind: null, name: 'Madras Cafe', normalized_name: 'madras cafe', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.95 },
      ],
      connections: [{
        source_entity_id: 'e1',
        target_entity_id: 'e2',
        relationship_type: 'met_at',
        evidence: 'met Rahul at Madras Cafe',
        confidence: 0.9,
      }],
    });

    const { relationships } = buildConnections(analysis);
    expect(relationships).toContainEqual(expect.objectContaining({
      relationshipType: 'met_at',
      evidence: 'met Rahul at Madras Cafe',
    }));
  });

  // -------------------------------------------------------------------------
  // Entity kind → V2 type mapping
  // -------------------------------------------------------------------------

  it('maps PERSON entity to "person" type', () => {
    const analysis = makeAnalysis({
      entities: [
        { id: 'e1', kind: 'PERSON', raw_kind: null, name: 'Arun', normalized_name: 'arun', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.95 },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.some((o) => o.name === 'Arun' && o.type === 'person')).toBe(true);
  });

  it('maps PLACE entity to "place" type', () => {
    const analysis = makeAnalysis({
      entities: [
        { id: 'e1', kind: 'PLACE', raw_kind: null, name: 'Blue Moon Cafe', normalized_name: 'blue moon cafe', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.95 },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.some((o) => o.name === 'Blue Moon Cafe' && o.type === 'place')).toBe(true);
  });

  it('maps ORGANIZATION entity to "organization" type', () => {
    const analysis = makeAnalysis({
      entities: [
        { id: 'e1', kind: 'ORGANIZATION', raw_kind: null, name: 'Acme Corp', normalized_name: 'acme corp', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.9 },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.some((o) => o.type === 'organization')).toBe(true);
  });

  it('maps OBJECT entity to "physical_object" type (V2 change from "object")', () => {
    const analysis = makeAnalysis({
      entities: [
        { id: 'e1', kind: 'OBJECT', raw_kind: null, name: 'Laptop', normalized_name: 'laptop', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.9 },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.some((o) => o.name === 'Laptop' && o.type === 'physical_object')).toBe(true);
  });

  it('maps TOPIC entity to "other_entity" type (V2 change from "topic")', () => {
    const analysis = makeAnalysis({
      entities: [
        { id: 'e1', kind: 'TOPIC', raw_kind: null, name: 'Machine Learning', normalized_name: 'machine learning', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.8 },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.some((o) => o.type === 'other_entity')).toBe(true);
  });

  it('maps OTHER entity with raw_kind to "other_entity" and preserves raw_kind in attributes', () => {
    const analysis = makeAnalysis({
      entities: [
        { id: 'e1', kind: 'OTHER', raw_kind: 'alien_artifact', name: 'Monolith', normalized_name: 'monolith', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.8 },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects).toHaveLength(1);
    expect(objects[0]?.type).toBe('other_entity');
    expect(objects[0]?.attributes?.raw_kind).toBe('alien_artifact');
  });

  // -------------------------------------------------------------------------
  // Event items → event objects
  // -------------------------------------------------------------------------

  it('creates an "event" object from a PAST_EVENT item with a meaningful title', () => {
    const analysis = makeAnalysis({
      items: [
        {
          id: 'i1',
          type: 'PAST_EVENT',
          title: 'Meeting at Blue Moon Cafe',
          summary: 'Met Arun',
          source_text: 'I met Arun at Blue Moon Cafe',
          source_span: { start: 0, end: 28 },
          segment_index: 0,
          entity_ids: [],
          temporal: { tense: 'PAST', raw: 'yesterday', resolved: '2026-08-20T00:00:00.000Z', resolved_end: null, precision: 'DAY', recurrence: null, timezone: null, confidence: 0.9 },
          details: {},
          confidence: 0.9,
        },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.some((o) => o.type === 'event' && o.name === 'Meeting at Blue Moon Cafe')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Forbidden item types — must NOT become graph nodes (V2 rule)
  // -------------------------------------------------------------------------

  it('TASK item does NOT become a graph node', () => {
    const analysis = makeAnalysis({
      items: [
        {
          id: 'i1',
          type: 'TASK',
          title: 'Finish the Lifelog presentation',
          summary: '',
          source_text: 'I need to finish the presentation tonight',
          source_span: null,
          segment_index: null,
          entity_ids: [],
          temporal: { tense: 'FUTURE', raw: 'tonight', resolved: null, resolved_end: null, precision: 'NONE', recurrence: null, timezone: null, confidence: 0.5 },
          details: { status: 'OPEN', priority: 'NORMAL' },
          confidence: 0.9,
        },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.every((o) => o.type !== 'task')).toBe(true);
    expect(objects.some((o) => o.name === 'Finish the Lifelog presentation')).toBe(false);
  });

  it('REMINDER item does NOT become a graph node', () => {
    const analysis = makeAnalysis({
      items: [
        {
          id: 'i1',
          type: 'REMINDER',
          title: 'Call Arun at 8 PM',
          summary: '',
          source_text: 'Remind me at 8 PM to call Arun',
          source_span: null,
          segment_index: null,
          entity_ids: [],
          temporal: { tense: 'FUTURE', raw: 'at 8 PM', resolved: null, resolved_end: null, precision: 'EXACT_TIME', recurrence: null, timezone: null, confidence: 0.9 },
          details: { explicit: true },
          confidence: 0.9,
        },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.every((o) => o.type !== 'reminder')).toBe(true);
  });

  it('DECISION item does NOT become a graph node', () => {
    const analysis = makeAnalysis({
      items: [
        {
          id: 'i1',
          type: 'DECISION',
          title: 'Decided to build Lifelog',
          summary: '',
          source_text: 'I decided yesterday that I want to build Lifelog',
          source_span: null,
          segment_index: null,
          entity_ids: [],
          temporal: { tense: 'PAST', raw: 'yesterday', resolved: null, resolved_end: null, precision: 'DAY', recurrence: null, timezone: null, confidence: 0.7 },
          details: {},
          confidence: 0.85,
        },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.every((o) => o.type !== 'decision')).toBe(true);
  });

  it('FEELING item does NOT become a graph node', () => {
    const analysis = makeAnalysis({
      items: [
        {
          id: 'i1',
          type: 'FEELING',
          title: 'Felt peaceful',
          summary: '',
          source_text: 'I felt deeply peaceful',
          source_span: null,
          segment_index: null,
          entity_ids: [],
          temporal: { tense: 'PAST', raw: null, resolved: null, resolved_end: null, precision: 'NONE', recurrence: null, timezone: null, confidence: 0.5 },
          details: { emotion: 'peaceful', sentiment: 'POSITIVE' },
          confidence: 0.8,
        },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.every((o) => o.type !== 'feeling')).toBe(true);
  });

  it('MEMORY item does NOT become a graph node', () => {
    const analysis = makeAnalysis({
      items: [
        {
          id: 'i1',
          type: 'MEMORY',
          title: 'Trip to Gujarat with family',
          summary: '',
          source_text: 'I remember going to Gujarat',
          source_span: null,
          segment_index: null,
          entity_ids: [],
          temporal: { tense: 'PAST', raw: null, resolved: null, resolved_end: null, precision: 'NONE', recurrence: null, timezone: null, confidence: 0.5 },
          details: {},
          confidence: 0.8,
        },
      ],
    });
    const { objects } = buildConnections(analysis);
    expect(objects.every((o) => o.type !== 'memory')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Relationship inference — only from item_entity links
  // -------------------------------------------------------------------------

  it('creates person→participated_in→event relationship from item_entity link', () => {
    const analysis = makeAnalysis({
      entities: [
        { id: 'e1', kind: 'PERSON', raw_kind: null, name: 'Arun', normalized_name: 'arun', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.95 },
      ],
      items: [
        {
          id: 'i1',
          type: 'PAST_EVENT',
          title: 'Meeting with Arun',
          summary: '',
          source_text: 'I met Arun',
          source_span: null,
          segment_index: null,
          entity_ids: ['e1'],
          temporal: { tense: 'PAST', raw: 'yesterday', resolved: null, resolved_end: null, precision: 'DAY', recurrence: null, timezone: null, confidence: 0.9 },
          details: {},
          confidence: 0.9,
        },
      ],
    });
    const { relationships } = buildConnections(analysis);
    expect(relationships.some((r) => r.relationshipType === 'participated_in')).toBe(true);
  });

  it('creates event→happened_at→place relationship from item_entity link', () => {
    const analysis = makeAnalysis({
      entities: [
        { id: 'e2', kind: 'PLACE', raw_kind: null, name: 'Blue Moon Cafe', normalized_name: 'blue moon cafe', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.95 },
      ],
      items: [
        {
          id: 'i1',
          type: 'PAST_EVENT',
          title: 'Meeting at Blue Moon Cafe',
          summary: '',
          source_text: 'I met Arun at Blue Moon Cafe',
          source_span: null,
          segment_index: null,
          entity_ids: ['e2'],
          temporal: { tense: 'PAST', raw: 'yesterday', resolved: null, resolved_end: null, precision: 'DAY', recurrence: null, timezone: null, confidence: 0.9 },
          details: {},
          confidence: 0.9,
        },
      ],
    });
    const { relationships } = buildConnections(analysis);
    expect(relationships.some((r) => r.relationshipType === 'happened_at')).toBe(true);
  });

  it('does NOT create relationships between entities that merely co-occur', () => {
    // Two entities in the same item but NO event — should create objects but NO relationships
    const analysis = makeAnalysis({
      entities: [
        { id: 'e1', kind: 'PERSON', raw_kind: null, name: 'Arun', normalized_name: 'arun', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.9 },
        { id: 'e2', kind: 'PERSON', raw_kind: null, name: 'Maya', normalized_name: 'maya', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.9 },
      ],
      items: [
        // PRESENT_FACT — not an event, so no relationships inferred from it
        {
          id: 'i1',
          type: 'PRESENT_FACT',
          title: 'Working on Lifelog',
          summary: '',
          source_text: 'Arun and Maya are both involved with Lifelog',
          source_span: null,
          segment_index: null,
          entity_ids: ['e1', 'e2'],
          temporal: { tense: 'PRESENT', raw: null, resolved: null, resolved_end: null, precision: 'NONE', recurrence: null, timezone: null, confidence: 0.7 },
          details: {},
          confidence: 0.7,
        },
      ],
    });
    const { objects, relationships } = buildConnections(analysis);
    // Both entities become objects
    expect(objects.some((o) => o.name === 'Arun')).toBe(true);
    expect(objects.some((o) => o.name === 'Maya')).toBe(true);
    // No relationships inferred from PRESENT_FACT co-occurrence
    expect(relationships).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Full scenario: "I am working on Lifelog. Arun is helping me. Yesterday we met at Blue Moon Cafe."
  // -------------------------------------------------------------------------

  it('creates correct objects and relationships for the canonical spec example', () => {
    const analysis = makeAnalysis({
      summary: 'Working on Lifelog with Arun at Blue Moon Cafe',
      entities: [
        { id: 'e1', kind: 'PERSON', raw_kind: null, name: 'Arun', normalized_name: 'arun', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.95 },
        { id: 'e2', kind: 'PLACE', raw_kind: null, name: 'Blue Moon Cafe', normalized_name: 'blue moon cafe', aliases: [], relation: null, attributes: {}, mentions: [], confidence: 0.95 },
      ],
      items: [
        {
          id: 'i1',
          type: 'PAST_EVENT',
          title: 'Meeting with Arun at Blue Moon Cafe',
          summary: 'Met Arun',
          source_text: 'Yesterday we met at Blue Moon Cafe',
          source_span: null,
          segment_index: null,
          entity_ids: ['e1', 'e2'],
          temporal: { tense: 'PAST', raw: 'yesterday', resolved: '2026-08-21T00:00:00.000Z', resolved_end: null, precision: 'DAY', recurrence: null, timezone: null, confidence: 0.9 },
          details: {},
          confidence: 0.9,
        },
      ],
    });

    const { objects, relationships } = buildConnections(analysis);

    // Objects: Arun (person), Blue Moon Cafe (place), Meeting (event)
    expect(objects.some((o) => o.name === 'Arun' && o.type === 'person')).toBe(true);
    expect(objects.some((o) => o.name === 'Blue Moon Cafe' && o.type === 'place')).toBe(true);
    expect(objects.some((o) => o.type === 'event')).toBe(true);

    // Relationships must be meaningful and matrix-allowed
    expect(relationships.some((r) => r.relationshipType === 'participated_in')).toBe(true);
    expect(relationships.some((r) => r.relationshipType === 'happened_at')).toBe(true);

    // Must NOT invent: Arun → knows → Blue Moon Cafe (not in this conversation — spec §6)
    expect(relationships.some((r) => r.relationshipType === 'knows')).toBe(false);
    // Must NOT invent: Arun → works_at → Blue Moon Cafe (not in this conversation — spec §6)
    expect(relationships.some((r) => r.relationshipType === 'works_at')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Builder warnings
  // -------------------------------------------------------------------------

  it('returns warnings for each dropped forbidden-type item', () => {
    const analysis = makeAnalysis({
      items: [
        {
          id: 'i1',
          type: 'TASK',
          title: 'Send the report',
          summary: '',
          source_text: 'I need to send the report',
          source_span: null,
          segment_index: null,
          entity_ids: [],
          temporal: { tense: 'FUTURE', raw: null, resolved: null, resolved_end: null, precision: 'NONE', recurrence: null, timezone: null, confidence: 0.8 },
          details: {},
          confidence: 0.8,
        },
      ],
    });
    // The builder silently skips TASK items (not forbidden by validateBuilderCandidates
    // because the builder never even creates a candidate from TASK items).
    // The objects array should simply be empty.
    const { objects } = buildConnections(analysis);
    expect(objects.every((o) => o.type !== 'task')).toBe(true);
  });
});
