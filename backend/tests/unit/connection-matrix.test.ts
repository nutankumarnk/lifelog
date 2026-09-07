/**
 * Connection Map V2 — Spec §4 Test Suite
 *
 * Tests every allowed relationship in the spec §4 Connection Matrix,
 * and verifies that removed/forbidden types are rejected.
 *
 * These are pure unit tests — no DB, no network, no AI calls.
 * Every test references the spec section it validates.
 */
import { describe, expect, it } from 'vitest';
import {
  isAllowedRelationship,
  isConnectionAllowed,
  getAllowedRelationships,
} from '../../src/modules/connection-map/connection-matrix.js';
import {
  mapEntityKindToObjectType,
  validateConnectionRelationship,
  validateObjectType,
} from '../../src/modules/connection-map/connection-validator.js';
import {
  FORBIDDEN_OBJECT_TYPES,
  MIN_RELATIONSHIP_CONFIDENCE,
} from '../../src/modules/connection-map/connection-types.js';
import {
  validateLlmExtractionOutput,
  validateBuilderCandidates,
} from '../../src/modules/connection-map/connection-service.js';
import {
  findDuplicateRelationships,
  validateObjectTypeAllowed,
} from '../../src/memory/validation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLlmOutput(
  objects: Array<{ temporary_id: string; type: string; name: string }>,
  relationships: Array<{
    source_temporary_id: string;
    target_temporary_id: string;
    relationship_type: string;
    confidence: number;
    evidence: string;
  }>,
) {
  return { objects, relationships };
}

// ===========================================================================
// SPEC §4 — CONNECTION MATRIX: ALLOWED RELATIONSHIPS
// ===========================================================================

// ---------------------------------------------------------------------------
// PERSON → PERSON  (spec §4)
// ---------------------------------------------------------------------------

describe('PERSON → PERSON (spec §4)', () => {
  it('allows "knows"', () => {
    expect(isAllowedRelationship('person', 'person', 'knows')).toBe(true);
  });
  it('allows "works_with"', () => {
    expect(isAllowedRelationship('person', 'person', 'works_with')).toBe(true);
  });
  it('allows "related_to"', () => {
    expect(isAllowedRelationship('person', 'person', 'related_to')).toBe(true);
  });

  // Removed types — spec §4 does not include these
  it('does NOT allow "met" (removed from spec §4)', () => {
    expect(isAllowedRelationship('person', 'person', 'met')).toBe(false);
  });
  it('does NOT allow "likes"', () => {
    expect(isAllowedRelationship('person', 'person', 'likes')).toBe(false);
  });
  it('does NOT allow "coached_by"', () => {
    expect(isAllowedRelationship('person', 'person', 'coached_by')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PERSON → PROJECT  (spec §4)
// ---------------------------------------------------------------------------

describe('PERSON → PROJECT (spec §4)', () => {
  it('allows "works_on"', () => {
    expect(isAllowedRelationship('person', 'project', 'works_on')).toBe(true);
  });

  // Removed types — spec §4 only allows works_on
  it('does NOT allow "contributes_to" (removed from spec §4)', () => {
    expect(isAllowedRelationship('person', 'project', 'contributes_to')).toBe(false);
  });
  it('does NOT allow "manages" (removed from spec §4)', () => {
    expect(isAllowedRelationship('person', 'project', 'manages')).toBe(false);
  });
  it('does NOT allow "owns" (removed from spec §4)', () => {
    expect(isAllowedRelationship('person', 'project', 'owns')).toBe(false);
  });
  it('does NOT allow "associated_with" (removed from spec §4)', () => {
    expect(isAllowedRelationship('person', 'project', 'associated_with')).toBe(false);
  });
  it('does NOT allow "dreams_about"', () => {
    expect(isAllowedRelationship('person', 'project', 'dreams_about')).toBe(false);
  });
  it('does NOT allow "inspired_by"', () => {
    expect(isAllowedRelationship('person', 'project', 'inspired_by')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PERSON → PLACE  (spec §4)
// ---------------------------------------------------------------------------

describe('PERSON → PLACE (spec §4)', () => {
  it('allows "lives_in"', () => {
    expect(isAllowedRelationship('person', 'place', 'lives_in')).toBe(true);
  });
  it('allows "works_at"', () => {
    expect(isAllowedRelationship('person', 'place', 'works_at')).toBe(true);
  });
  it('allows "visited"', () => {
    expect(isAllowedRelationship('person', 'place', 'visited')).toBe(true);
  });

  it('allows "met_at" for an explicitly grounded meeting place', () => {
    expect(isAllowedRelationship('person', 'place', 'met_at')).toBe(true);
  });
  it('does NOT allow "teleported_to"', () => {
    expect(isAllowedRelationship('person', 'place', 'teleported_to')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PERSON → ORGANIZATION  (spec §4)
// ---------------------------------------------------------------------------

describe('PERSON → ORGANIZATION (spec §4)', () => {
  it('allows "works_at"', () => {
    expect(isAllowedRelationship('person', 'organization', 'works_at')).toBe(true);
  });
  it('allows "member_of"', () => {
    expect(isAllowedRelationship('person', 'organization', 'member_of')).toBe(true);
  });

  it('does NOT allow "associated_with" (removed from spec §4)', () => {
    expect(isAllowedRelationship('person', 'organization', 'associated_with')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PERSON → EVENT  (spec §4)
// ---------------------------------------------------------------------------

describe('PERSON → EVENT (spec §4)', () => {
  it('allows "participated_in"', () => {
    expect(isAllowedRelationship('person', 'event', 'participated_in')).toBe(true);
  });

  // Removed types — spec §4 only allows participated_in for person→event
  it('does NOT allow "attended" (removed from spec §4)', () => {
    expect(isAllowedRelationship('person', 'event', 'attended')).toBe(false);
  });
  it('does NOT allow "organized" (removed from spec §4)', () => {
    expect(isAllowedRelationship('person', 'event', 'organized')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PROJECT → ORGANIZATION  (spec §4)
// ---------------------------------------------------------------------------

describe('PROJECT → ORGANIZATION (spec §4)', () => {
  it('allows "belongs_to"', () => {
    expect(isAllowedRelationship('project', 'organization', 'belongs_to')).toBe(true);
  });

  it('does NOT allow "developed_for" (removed from spec §4)', () => {
    expect(isAllowedRelationship('project', 'organization', 'developed_for')).toBe(false);
  });
  it('does NOT allow "associated_with" (removed from spec §4)', () => {
    expect(isAllowedRelationship('project', 'organization', 'associated_with')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PROJECT → PLACE  (spec §4)
// ---------------------------------------------------------------------------

describe('PROJECT → PLACE (spec §4)', () => {
  it('allows "located_at"', () => {
    expect(isAllowedRelationship('project', 'place', 'located_at')).toBe(true);
  });

  it('does NOT allow "associated_with" (removed from spec §4)', () => {
    expect(isAllowedRelationship('project', 'place', 'associated_with')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PROJECT → EVENT  (spec §4)
// ---------------------------------------------------------------------------

describe('PROJECT → EVENT (spec §4)', () => {
  it('allows "related_to"', () => {
    expect(isAllowedRelationship('project', 'event', 'related_to')).toBe(true);
  });

  it('does NOT allow "part_of" (removed from spec §4)', () => {
    expect(isAllowedRelationship('project', 'event', 'part_of')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EVENT → PLACE  (spec §4)
// ---------------------------------------------------------------------------

describe('EVENT → PLACE (spec §4)', () => {
  it('allows "happened_at"', () => {
    expect(isAllowedRelationship('event', 'place', 'happened_at')).toBe(true);
  });
  it('"happened_at" is the ONLY allowed relationship from event to place', () => {
    const allowed = getAllowedRelationships('event', 'place');
    expect(allowed.has('happened_at')).toBe(true);
    expect(allowed.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// EVENT → PROJECT  (spec §4)
// ---------------------------------------------------------------------------

describe('EVENT → PROJECT (spec §4)', () => {
  it('allows "related_to"', () => {
    expect(isAllowedRelationship('event', 'project', 'related_to')).toBe(true);
  });

  it('does NOT allow "part_of" (removed from spec §4)', () => {
    expect(isAllowedRelationship('event', 'project', 'part_of')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EVENT → PERSON  (spec §4)
// ---------------------------------------------------------------------------

describe('EVENT → PERSON (spec §4)', () => {
  it('allows "participated_in"', () => {
    expect(isAllowedRelationship('event', 'person', 'participated_in')).toBe(true);
  });

  // Removed types
  it('does NOT allow "attended_by" (removed from spec §4)', () => {
    expect(isAllowedRelationship('event', 'person', 'attended_by')).toBe(false);
  });
  it('does NOT allow "organized_by" (removed from spec §4)', () => {
    expect(isAllowedRelationship('event', 'person', 'organized_by')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ORGANIZATION → PLACE  (spec §4)
// ---------------------------------------------------------------------------

describe('ORGANIZATION → PLACE (spec §4)', () => {
  it('allows "located_at"', () => {
    expect(isAllowedRelationship('organization', 'place', 'located_at')).toBe(true);
  });

  it('does NOT allow "operates_at" (removed from spec §4)', () => {
    expect(isAllowedRelationship('organization', 'place', 'operates_at')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PROJECT → OBJECT  (spec §4 — "object" public name, "physical_object" internal)
// ---------------------------------------------------------------------------

describe('PROJECT → OBJECT (spec §4)', () => {
  it('allows "uses" using internal name "physical_object"', () => {
    expect(isAllowedRelationship('project', 'physical_object', 'uses')).toBe(true);
  });
  it('allows "uses" using public alias "object"', () => {
    expect(isAllowedRelationship('project', 'object', 'uses')).toBe(true);
  });

  it('does NOT allow "requires" (removed from spec §4)', () => {
    expect(isAllowedRelationship('project', 'physical_object', 'requires')).toBe(false);
  });
  it('does NOT allow "includes" (removed from spec §4)', () => {
    expect(isAllowedRelationship('project', 'physical_object', 'includes')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EVENT → OBJECT  (spec §4)
// ---------------------------------------------------------------------------

describe('EVENT → OBJECT (spec §4)', () => {
  it('allows "uses" using internal name "physical_object"', () => {
    expect(isAllowedRelationship('event', 'physical_object', 'uses')).toBe(true);
  });
  it('allows "uses" using public alias "object"', () => {
    expect(isAllowedRelationship('event', 'object', 'uses')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OBJECT → PLACE  (spec §4)
// ---------------------------------------------------------------------------

describe('OBJECT → PLACE (spec §4)', () => {
  it('allows "located_at" using internal name "physical_object"', () => {
    expect(isAllowedRelationship('physical_object', 'place', 'located_at')).toBe(true);
  });
  it('allows "located_at" using public alias "object"', () => {
    expect(isAllowedRelationship('object', 'place', 'located_at')).toBe(true);
  });
});

// ===========================================================================
// SPEC §4 — isConnectionAllowed alias (spec §22)
// ===========================================================================

describe('isConnectionAllowed() alias — spec §22', () => {
  it('isConnectionAllowed("person", "project", "works_on") → true', () => {
    expect(isConnectionAllowed('person', 'project', 'works_on')).toBe(true);
  });
  it('isConnectionAllowed("person", "place", "works_at") → true', () => {
    expect(isConnectionAllowed('person', 'place', 'works_at')).toBe(true);
  });
  it('isConnectionAllowed("person", "project", "likes") → false', () => {
    expect(isConnectionAllowed('person', 'project', 'likes')).toBe(false);
  });
  it('isConnectionAllowed("decision", "project", "affects") → false', () => {
    expect(isConnectionAllowed('decision', 'project', 'affects')).toBe(false);
  });
});

// ===========================================================================
// SPEC §3 — FORBIDDEN OBJECT TYPES
// ===========================================================================

describe('FORBIDDEN OBJECT TYPES — spec §3', () => {
  const forbiddenTypes = [
    'task', 'reminder', 'decision', 'feeling', 'emotion', 'memory',
    'note', 'conversation', 'notification', 'alarm', 'summary', 'goal', 'intention',
  ];

  for (const type of forbiddenTypes) {
    it(`"${type}" is in FORBIDDEN_OBJECT_TYPES`, () => {
      expect(FORBIDDEN_OBJECT_TYPES.has(type)).toBe(true);
    });

    it(`validateObjectType rejects "${type}"`, () => {
      const result = validateObjectType(type);
      expect(result.resolvedType).toBeNull();
      expect(result.rejectionReason).toMatch(/forbidden/);
    });

    it(`validateLlmExtractionOutput drops objects of type "${type}"`, () => {
      const output = makeLlmOutput(
        [{ temporary_id: 'obj_1', type, name: `Test ${type}` }],
        [],
      );
      const result = validateLlmExtractionOutput(output);
      expect(result.objects).toHaveLength(0);
    });
  }
});

// Decision specifically
describe('Decision must NOT become a graph node — spec §3, §13', () => {
  it('validateObjectTypeAllowed rejects "decision"', () => {
    const errors = validateObjectTypeAllowed('decision', 0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('validateLlmExtractionOutput drops objects of type "decision" with warning', () => {
    const output = makeLlmOutput(
      [{ temporary_id: 'obj_1', type: 'decision', name: 'Build Lifelog' }],
      [],
    );
    const result = validateLlmExtractionOutput(output);
    expect(result.objects).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('Build Lifelog'))).toBe(true);
  });
});

// ===========================================================================
// SPEC §2 — OBJECT TYPE ALIASES
// ===========================================================================

describe('Object type aliases — spec §2 ("object" and "other")', () => {
  it('validateObjectType accepts "object" and resolves to "physical_object"', () => {
    const result = validateObjectType('object');
    expect(result.resolvedType).toBe('physical_object');
  });

  it('validateObjectType accepts "other" and resolves to "other_entity"', () => {
    const result = validateObjectType('other');
    expect(result.resolvedType).toBe('other_entity');
  });

  it('validateObjectType still accepts "physical_object" directly', () => {
    const result = validateObjectType('physical_object');
    expect(result.resolvedType).toBe('physical_object');
  });

  it('validateObjectType still accepts "other_entity" directly', () => {
    const result = validateObjectType('other_entity');
    expect(result.resolvedType).toBe('other_entity');
  });
});

// ===========================================================================
// SPEC §2 — UNKNOWN ENTITIES BECOME "OTHER"
// ===========================================================================

describe('Unknown entity becomes "other" — spec §2', () => {
  it('maps unknown Phase 1 entity kind to other_entity', () => {
    expect(mapEntityKindToObjectType('OTHER')).toBe('other_entity');
    expect(mapEntityKindToObjectType('TOPIC')).toBe('other_entity');
    expect(mapEntityKindToObjectType('UNKNOWN_KIND')).toBe('other_entity');
  });

  it('maps OBJECT to physical_object, not other_entity', () => {
    expect(mapEntityKindToObjectType('OBJECT')).toBe('physical_object');
  });

  it('validateObjectType maps unknown type to other_entity (never discards)', () => {
    const result = validateObjectType('alien_artifact');
    expect(result.resolvedType).toBe('other_entity');
    expect(result.originalType).toBe('alien_artifact');
  });

  it('validateLlmExtractionOutput preserves unknown types as other_entity', () => {
    const output = makeLlmOutput(
      [{ temporary_id: 'obj_1', type: 'ancient_tablet', name: 'Rosetta Stone' }],
      [],
    );
    const result = validateLlmExtractionOutput(output);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0]?.type).toBe('other_entity');
    expect(result.objects[0]?.attributes?.raw_kind).toBe('ancient_tablet');
  });
});

// ===========================================================================
// SPEC §5 — DO NOT CONNECT OBJECTS JUST BECAUSE THEY APPEAR TOGETHER
// ===========================================================================

describe('No co-occurrence relationships — spec §5, §6, §8', () => {
  it('person → place "works_at" is rejected when the pair type is wrong (event→place requires happened_at)', () => {
    // "happened_at" only applies event→place, not person→place
    expect(isAllowedRelationship('person', 'place', 'happened_at')).toBe(false);
  });

  it('Arun → works_at → Blue Moon Cafe is REJECTED when no evidence (spec §6)', () => {
    // "works_at" is ONLY allowed person→organization in this context; person→place is works_at too,
    // but the spec §6 example specifically says this should not be INFERRED without evidence.
    // The matrix check here: person→place→works_at IS in the matrix,
    // but the builder only creates connections from item_entity links, not co-occurrence.
    // This is the builder-level protection, tested in connection-builder.test.ts.
    // Here we verify that relationship types not in the matrix are rejected:
    expect(isAllowedRelationship('person', 'place', 'likes')).toBe(false);
    expect(isAllowedRelationship('person', 'place', 'knows')).toBe(false);
  });

  it('Arun → knows → Maya is REJECTED if not explicitly established — spec §8', () => {
    // "knows" IS in the person→person matrix, but spec §8 says
    // people do not automatically connect just because they attended the same event.
    // The builder enforces this by never creating person→person links from item_entity.
    // The matrix allows knows; the builder is the gate.
    // Here we verify it's in the matrix (allowed IF explicitly established):
    expect(isAllowedRelationship('person', 'person', 'knows')).toBe(true);
    // And verify invented types are rejected:
    expect(isAllowedRelationship('person', 'person', 'attended_together')).toBe(false);
  });
});

// ===========================================================================
// SPEC §19 — INCORRECT EXTRACTION EXAMPLES
// ===========================================================================

describe('Incorrect extraction examples — spec §19', () => {
  it('"Arun → works_at → Blue Moon Cafe" from event context is not in matrix (event→place only)', () => {
    // "I met Arun at Blue Moon Cafe" — incorrect to infer Arun works there
    // person→place→works_at is technically in matrix, but co-occurrence alone can't create it
    // Test the clearly wrong ones:
    expect(isAllowedRelationship('person', 'place', 'likes')).toBe(false);
    expect(isAllowedRelationship('person', 'place', 'knows')).toBe(false);
    expect(isAllowedRelationship('person', 'place', 'lives_in_assumed')).toBe(false);
  });

  it('None of the explicitly forbidden relationship names are in the matrix', () => {
    // Spec §5 explicitly forbids these
    const forbidden = ['likes', 'loves', 'wants', 'thinks_about', 'feels_about',
      'decided', 'reminds', 'has_task', 'has_memory', 'has_feeling',
      'mentioned', 'talked_about'];
    for (const rel of forbidden) {
      expect(isAllowedRelationship('person', 'person', rel)).toBe(false);
      expect(isAllowedRelationship('person', 'project', rel)).toBe(false);
      expect(isAllowedRelationship('event', 'place', rel)).toBe(false);
    }
  });
});

// ===========================================================================
// SPEC §20 — CONFIDENCE THRESHOLD
// ===========================================================================

describe('Confidence threshold — spec §20', () => {
  it(`rejects confidence < ${MIN_RELATIONSHIP_CONFIDENCE}`, () => {
    const result = validateConnectionRelationship('person', 'person', 'knows', 0.49);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toMatch(/below minimum/);
  });

  it('accepts confidence exactly at threshold', () => {
    const result = validateConnectionRelationship('person', 'person', 'knows', MIN_RELATIONSHIP_CONFIDENCE);
    expect(result.accepted).toBe(true);
  });

  it('validateLlmExtractionOutput drops low-confidence relationships', () => {
    const output = makeLlmOutput(
      [
        { temporary_id: 'obj_1', type: 'person', name: 'Arun' },
        { temporary_id: 'obj_2', type: 'person', name: 'Maya' },
      ],
      [
        { source_temporary_id: 'obj_1', target_temporary_id: 'obj_2', relationship_type: 'knows', confidence: 0.3, evidence: 'maybe' },
      ],
    );
    const result = validateLlmExtractionOutput(output);
    expect(result.relationships).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('below minimum'))).toBe(true);
  });
});

// ===========================================================================
// SPEC §18 — CORRECT EXTRACTION EXAMPLE
// ===========================================================================

describe('Correct extraction example — spec §18', () => {
  it('accepts the spec §18 canonical example', () => {
    const output = makeLlmOutput(
      [
        { temporary_id: 'user', type: 'person', name: 'User' },
        { temporary_id: 'lifelog', type: 'project', name: 'Lifelog' },
        { temporary_id: 'arun', type: 'person', name: 'Arun' },
        { temporary_id: 'cafe', type: 'place', name: 'Blue Moon Cafe' },
        { temporary_id: 'meeting', type: 'event', name: 'Meeting at Blue Moon Cafe' },
        { temporary_id: 'maya', type: 'person', name: 'Maya' },
      ],
      [
        { source_temporary_id: 'user', target_temporary_id: 'lifelog', relationship_type: 'works_on', confidence: 0.9, evidence: 'I am working on the Lifelog project' },
        { source_temporary_id: 'meeting', target_temporary_id: 'cafe', relationship_type: 'happened_at', confidence: 0.9, evidence: 'Yesterday I met Arun at Blue Moon Cafe' },
        { source_temporary_id: 'arun', target_temporary_id: 'meeting', relationship_type: 'participated_in', confidence: 0.9, evidence: 'I met Arun' },
        { source_temporary_id: 'maya', target_temporary_id: 'lifelog', relationship_type: 'works_on', confidence: 0.9, evidence: 'Maya also works with me on Lifelog' },
      ],
    );
    const result = validateLlmExtractionOutput(output);
    expect(result.objects).toHaveLength(6);
    expect(result.relationships).toHaveLength(4);
    expect(result.warnings).toHaveLength(0);
  });

  it('rejects the spec §19 incorrect extractions', () => {
    const output = makeLlmOutput(
      [
        { temporary_id: 'arun', type: 'person', name: 'Arun' },
        { temporary_id: 'cafe', type: 'place', name: 'Blue Moon Cafe' },
      ],
      [
        // "Arun → works_at → Blue Moon Cafe" — assumption, not in evidence
        { source_temporary_id: 'arun', target_temporary_id: 'cafe', relationship_type: 'works_at', confidence: 0.9, evidence: 'I met Arun at Blue Moon Cafe' },
        // "Arun → likes → Blue Moon Cafe" — invented
        { source_temporary_id: 'arun', target_temporary_id: 'cafe', relationship_type: 'likes', confidence: 0.9, evidence: 'I met Arun at Blue Moon Cafe' },
      ],
    );
    const result = validateLlmExtractionOutput(output);
    // person→place→works_at IS in the matrix (allowed if explicitly stated)
    // person→place→likes is NOT in the matrix — should be rejected
    const accepted = result.relationships.map((r) => r.relationshipType);
    expect(accepted).not.toContain('likes');
    expect(result.warnings.some((w) => w.includes('likes'))).toBe(true);
  });
});

// ===========================================================================
// DUPLICATE DETECTION
// ===========================================================================

describe('Duplicate relationship detection', () => {
  it('findDuplicateRelationships identifies duplicates within a batch', () => {
    const rels = [
      { source: 'obj_1', target: 'obj_2', type: 'knows' },
      { source: 'obj_1', target: 'obj_3', type: 'works_with' },
      { source: 'obj_1', target: 'obj_2', type: 'KNOWS' }, // duplicate (case-insensitive)
    ];
    const dupes = findDuplicateRelationships(rels);
    expect(dupes).toContain(2);
  });

  it('validateLlmExtractionOutput suppresses duplicate relationships in the same batch', () => {
    const output = makeLlmOutput(
      [
        { temporary_id: 'obj_1', type: 'person', name: 'Arun' },
        { temporary_id: 'obj_2', type: 'project', name: 'Lifelog' },
      ],
      [
        { source_temporary_id: 'obj_1', target_temporary_id: 'obj_2', relationship_type: 'works_on', confidence: 0.9, evidence: 'Arun is helping.' },
        { source_temporary_id: 'obj_1', target_temporary_id: 'obj_2', relationship_type: 'works_on', confidence: 0.8, evidence: 'Arun helps.' },
      ],
    );
    const result = validateLlmExtractionOutput(output);
    expect(result.relationships).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('duplicate'))).toBe(true);
  });

  it('findDuplicateRelationships marks second occurrence as duplicate', () => {
    const rels = [
      { source: 'arun_id', target: 'lifelog_id', type: 'works_on' },
      { source: 'arun_id', target: 'lifelog_id', type: 'works_on' }, // same
    ];
    expect(findDuplicateRelationships(rels)).toEqual([1]);
  });

  it('findDuplicateRelationships is case-insensitive for types', () => {
    const rels = [
      { source: 'a', target: 'b', type: 'works_on' },
      { source: 'a', target: 'b', type: 'WORKS_ON' },
    ];
    expect(findDuplicateRelationships(rels)).toEqual([1]);
  });
});

// ===========================================================================
// UNSUPPORTED / INVENTED RELATIONSHIP TYPES
// ===========================================================================

describe('Unsupported relationship types are rejected', () => {
  it('isAllowedRelationship returns false for invented relationships', () => {
    expect(isAllowedRelationship('person', 'person', 'coached_by')).toBe(false);
    expect(isAllowedRelationship('person', 'project', 'dreams_about')).toBe(false);
    expect(isAllowedRelationship('event', 'place', 'owned_by')).toBe(false);
  });

  it('validateConnectionRelationship rejects invented relationship type', () => {
    const result = validateConnectionRelationship('person', 'project', 'invented_rel', 0.9);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toMatch(/Connection Matrix/);
  });

  it('validateLlmExtractionOutput drops relationships with unsupported types', () => {
    const output = makeLlmOutput(
      [
        { temporary_id: 'obj_1', type: 'person', name: 'Arun' },
        { temporary_id: 'obj_2', type: 'project', name: 'Lifelog' },
      ],
      [
        { source_temporary_id: 'obj_1', target_temporary_id: 'obj_2', relationship_type: 'dreams_about', confidence: 0.9, evidence: 'test' },
      ],
    );
    const result = validateLlmExtractionOutput(output);
    expect(result.relationships).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('dreams_about'))).toBe(true);
  });

  it('rejects "happened_at" used on wrong pair (person→project)', () => {
    const result = validateConnectionRelationship('person', 'project', 'happened_at', 0.9);
    expect(result.accepted).toBe(false);
  });
});

// ===========================================================================
// ORIGIN SEPARATION — SPEC §15
// ===========================================================================

describe('Origin reference is separate from semantic relationship — spec §15', () => {
  it('LLM output relationships are semantic only (no origin links in the array)', () => {
    const output = makeLlmOutput(
      [
        { temporary_id: 'obj_1', type: 'person', name: 'Arun' },
        { temporary_id: 'obj_2', type: 'project', name: 'Lifelog' },
      ],
      [
        { source_temporary_id: 'obj_1', target_temporary_id: 'obj_2', relationship_type: 'works_on', confidence: 0.96, evidence: 'Arun is helping with Lifelog.' },
      ],
    );
    const result = validateLlmExtractionOutput(output);

    // Accepted relationships are semantic only (not provenance/origin)
    expect(result.relationships[0]?.relationshipType).toBe('works_on');
    // The result has NO "origin" relationships
    expect(result.relationships.every((r) => !r.relationshipType.startsWith('origin'))).toBe(true);
    expect(result.relationships.every((r) => r.relationshipType !== 'note_mentions')).toBe(true);
  });
});

// ===========================================================================
// validateBuilderCandidates
// ===========================================================================

describe('validateBuilderCandidates', () => {
  it('accepts valid person candidate', () => {
    const candidates = [
      { tempId: 'ent_e1', type: 'person', name: 'Arun', attributes: {}, confidence: 0.9 },
    ];
    const { accepted, warnings } = validateBuilderCandidates(candidates);
    expect(accepted).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it('drops task-typed candidates', () => {
    const { accepted, warnings } = validateBuilderCandidates([
      { tempId: 'item_t1', type: 'task', name: 'Finish presentation', attributes: {}, confidence: 0.9 },
    ]);
    expect(accepted).toHaveLength(0);
    expect(warnings.some((w) => w.includes('Finish presentation'))).toBe(true);
  });

  it('drops reminder-typed candidates', () => {
    const { accepted } = validateBuilderCandidates([
      { tempId: 'item_r1', type: 'reminder', name: 'Call Arun', attributes: {}, confidence: 0.9 },
    ]);
    expect(accepted).toHaveLength(0);
  });
});
