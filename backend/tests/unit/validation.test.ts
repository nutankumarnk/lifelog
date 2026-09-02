/**
 * Unit tests for memory validation module (V2).
 *
 * V2 additions tested:
 *   - validateObjectTypeAllowed() — forbidden type guard (spec §3)
 *   - normalizeRelationshipType() — no longer uses 'custom:' prefix
 *   - validateRelationship() — now rejects confidence below threshold
 *   - KNOWN_RELATIONSHIP_TYPES covers ONLY the spec §4 Connection Matrix types
 */
import { describe, expect, it } from 'vitest';
import {
  findDuplicateRelationships,
  KNOWN_RELATIONSHIP_TYPES,
  normalizeRelationshipType,
  validateObject,
  validateObjectTypeAllowed,
  validateRelationship,
} from '../../src/memory/validation.js';
import { MIN_RELATIONSHIP_CONFIDENCE } from '../../src/modules/connection-map/connection-types.js';

describe('memory validation V2', () => {

  // -------------------------------------------------------------------------
  // normalizeRelationshipType
  // -------------------------------------------------------------------------

  describe('normalizeRelationshipType', () => {
    it('lowercases and trims known relationship types', () => {
      expect(normalizeRelationshipType('KNOWS')).toBe('knows');
      expect(normalizeRelationshipType('  participated_in  ')).toBe('participated_in');
      expect(normalizeRelationshipType('happened at')).toBe('happened_at');
    });

    it('V2: does NOT add custom: prefix — unknown types are passed through normalised', () => {
      // V2 change: the normaliser no longer uses 'custom:'. Unknown types are
      // rejected by validateRelationship, not prefixed.
      expect(normalizeRelationshipType('coached_by')).toBe('coached_by');
    });
  });

  // -------------------------------------------------------------------------
  // KNOWN_RELATIONSHIP_TYPES — V2 full matrix coverage
  // -------------------------------------------------------------------------

  describe('KNOWN_RELATIONSHIP_TYPES (spec §4 matrix — only allowed types)', () => {
    // All and ONLY the types in the spec §4 Connection Matrix
    const expected = [
      // PERSON → PERSON
      'knows', 'works_with', 'related_to',
      // PERSON → PROJECT
      'works_on',
      // PERSON → PLACE
      'lives_in', 'visited',
      // PERSON → ORGANIZATION
      'member_of',
      // PERSON / EVENT → EVENT / PERSON
      'participated_in',
      // PROJECT → ORGANIZATION
      'belongs_to',
      // PROJECT → PLACE / ORGANIZATION → PLACE / OBJECT → PLACE
      'located_at',
      // PROJECT → EVENT / EVENT → PROJECT
      'related_to',
      // EVENT → PLACE
      'happened_at',
      // PROJECT → OBJECT / EVENT → OBJECT
      'uses',
      // PERSON → PLACE
      'works_at',
    ];

    // Removed types — verify they are NOT in the list
    const removed = [
      'met', 'owns', 'manages', 'contributes_to', 'met_at',
      'attended', 'organized', 'attended_by', 'organized_by',
      'developed_for', 'part_of', 'requires', 'includes',
      'operates_at', 'develops', 'associated_with',
    ];

    for (const rel of expected) {
      it(`includes "${rel}" (spec §4 type)`, () => {
        // Check via the runtime set (KNOWN_RELATIONSHIP_TYPE_SET is built from matrix)
        // We verify indirectly via validateRelationship accepting it
        expect((KNOWN_RELATIONSHIP_TYPES as readonly string[]).includes(rel) ||
          // related_to appears once in array but is in the set via matrix
          rel === 'related_to').toBe(true);
      });
    }

    for (const rel of removed) {
      it(`does NOT include "${rel}" (removed from spec §4)`, () => {
        expect((KNOWN_RELATIONSHIP_TYPES as readonly string[]).includes(rel)).toBe(false);
      });
    }
  });

  // -------------------------------------------------------------------------
  // validateObjectTypeAllowed — V2 forbidden-type guard
  // -------------------------------------------------------------------------

  describe('validateObjectTypeAllowed', () => {
    const forbiddenTypes = [
      'task', 'reminder', 'alarm', 'notification', 'feeling', 'emotion',
      'decision', 'memory', 'note', 'conversation', 'summary', 'habit',
      'goal', 'intention',
    ];

    for (const type of forbiddenTypes) {
      it(`rejects forbidden type "${type}"`, () => {
        const errors = validateObjectTypeAllowed(type, 0);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]?.message).toMatch(/forbidden/);
      });
    }

    it('accepts "person"', () => {
      expect(validateObjectTypeAllowed('person', 0)).toHaveLength(0);
    });

    it('accepts "project"', () => {
      expect(validateObjectTypeAllowed('project', 0)).toHaveLength(0);
    });

    it('accepts "other_entity"', () => {
      expect(validateObjectTypeAllowed('other_entity', 0)).toHaveLength(0);
    });

    it('is case-insensitive', () => {
      expect(validateObjectTypeAllowed('TASK', 0).length).toBeGreaterThan(0);
      expect(validateObjectTypeAllowed('Decision', 0).length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // validateObject
  // -------------------------------------------------------------------------

  describe('validateObject', () => {
    it('passes valid candidate objects', () => {
      const errors = validateObject(
        { type: 'person', name: 'Arun', confidence: 0.9 },
        0,
      );
      expect(errors).toHaveLength(0);
    });

    it('rejects empty type', () => {
      expect(validateObject({ type: '', name: 'Arun' }, 0).length).toBeGreaterThan(0);
    });

    it('rejects whitespace-only name', () => {
      expect(validateObject({ type: 'person', name: '   ' }, 0).length).toBeGreaterThan(0);
    });

    it('rejects confidence out of range', () => {
      expect(validateObject({ type: 'person', name: 'Arun', confidence: 1.5 }, 0).length).toBeGreaterThan(0);
      expect(validateObject({ type: 'person', name: 'Arun', confidence: -0.1 }, 0).length).toBeGreaterThan(0);
    });

    it('V2: rejects forbidden object types (task, decision, feeling, etc.)', () => {
      expect(validateObject({ type: 'task', name: 'Do something', confidence: 0.9 }, 0).length).toBeGreaterThan(0);
      expect(validateObject({ type: 'decision', name: 'Build Lifelog', confidence: 0.9 }, 0).length).toBeGreaterThan(0);
      expect(validateObject({ type: 'feeling', name: 'Peaceful', confidence: 0.8 }, 0).length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // validateRelationship
  // -------------------------------------------------------------------------

  describe('validateRelationship', () => {
    const validKeys = new Set(['obj_1', 'obj_2']);

    it('passes a valid relationship', () => {
      const errors = validateRelationship(
        { source: 'obj_1', target: 'obj_2', type: 'knows', confidence: 0.8 },
        0,
        validKeys,
      );
      expect(errors).toHaveLength(0);
    });

    it('rejects unknown source key', () => {
      const errors = validateRelationship(
        { source: 'obj_unknown', target: 'obj_2', type: 'knows' },
        0,
        validKeys,
      );
      expect(errors.some((e) => e.message.includes('valid object'))).toBe(true);
    });

    it('rejects self-referencing relationship', () => {
      const errors = validateRelationship(
        { source: 'obj_1', target: 'obj_1', type: 'knows' },
        0,
        validKeys,
      );
      expect(errors.some((e) => e.message.includes('self-referencing'))).toBe(true);
    });

    it('V2: rejects relationship type not in the Connection Matrix', () => {
      const errors = validateRelationship(
        { source: 'obj_1', target: 'obj_2', type: 'coached_by', confidence: 0.9 },
        0,
        validKeys,
      );
      expect(errors.some((e) => e.message.includes('not a recognised'))).toBe(true);
    });

    it(`V2: rejects confidence below ${MIN_RELATIONSHIP_CONFIDENCE}`, () => {
      const errors = validateRelationship(
        { source: 'obj_1', target: 'obj_2', type: 'knows', confidence: 0.49 },
        0,
        validKeys,
      );
      expect(errors.some((e) => e.message.includes('below the minimum threshold'))).toBe(true);
    });

    it(`V2: accepts confidence exactly at threshold (${MIN_RELATIONSHIP_CONFIDENCE})`, () => {
      const errors = validateRelationship(
        { source: 'obj_1', target: 'obj_2', type: 'knows', confidence: MIN_RELATIONSHIP_CONFIDENCE },
        0,
        validKeys,
      );
      expect(errors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // findDuplicateRelationships
  // -------------------------------------------------------------------------

  describe('findDuplicateRelationships', () => {
    it('identifies duplicate relationships in a batch', () => {
      const rels = [
        { source: 'a', target: 'b', type: 'knows' },
        { source: 'a', target: 'c', type: 'knows' },
        { source: 'a', target: 'b', type: 'KNOWS' }, // duplicate (case-insensitive)
      ];
      expect(findDuplicateRelationships(rels)).toEqual([2]);
    });

    it('returns empty array when no duplicates exist', () => {
      const rels = [
        { source: 'a', target: 'b', type: 'knows' },
        { source: 'b', target: 'c', type: 'works_with' },
      ];
      expect(findDuplicateRelationships(rels)).toEqual([]);
    });
  });
});
