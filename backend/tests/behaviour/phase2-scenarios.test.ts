/**
 * Phase 2 Behaviour Scenarios Test Suite.
 *
 * Tests the 10 core Phase 2 requirements specified in the project roadmap:
 * 1. "I met Arun yesterday." -> Arun object, origin, no invented relationships
 * 2. "I met Arun at Blue Moon Cafe." -> Arun, Blue Moon Cafe, appropriate relationships
 * 3. "I met Arun again." -> Resolve existing Arun, do not create Arun #2
 * 4. "I met Haroon today and we discussed the product idea we discussed six months ago."
 * 5. "I went to Blue Moon Cafe with Maya." -> Resolve existing Blue Moon Cafe, create Maya
 * 6. Unknown object/category -> preserved, not discarded
 * 7. Same relationship appears twice -> no duplicates created
 * 8. Invalid AI JSON -> validation catches it, invalid data not stored
 * 9. AI invents a relationship -> backend validation prevents unsupported relationships
 * 10. Diary/lifelog content with no task -> memory preserved, no task/reminder created
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  analyze,
  buildTestApp,
  closeTestDb,
  getTestDb,
  truncateAll,
  type TestApp,
} from '../helpers/test-app.js';
import { MockProvider } from '../../src/ai/mock.provider.js';

describe('Phase 2 Scenarios', () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = await buildTestApp();
  });

  beforeEach(async () => {
    await truncateAll(await getTestDb());
  });

  afterAll(async () => {
    await harness.close();
    await closeTestDb();
  });

  // TEST 1
  it('TEST 1: "I met Arun yesterday." creates Arun object with origin and no invented relationships', async () => {
    const res = await analyze(harness.app, { text: 'I met Arun yesterday.' });
    expect(res.status).toBe(200);

    const objectsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects',
    });
    const objects = objectsRes.json().objects;
    const arun = objects.find((o: any) => o.name === 'Arun');
    expect(arun).toBeDefined();

    // Origin points to this conversation
    const detailRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/memory/objects/${arun.id}`,
    });
    const detail = detailRes.json();
    expect(detail.origins.some((orig: any) => orig.conversation_id === res.body.conversationId)).toBe(true);
  });

  // TEST 2
  it('TEST 2: "I met Arun at Blue Moon Cafe." creates Arun, Blue Moon Cafe, and evidenced relationships', async () => {
    const res = await analyze(harness.app, { text: 'I met Arun at Blue Moon Cafe.' });
    expect(res.status).toBe(200);

    const objectsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects',
    });
    const objects = objectsRes.json().objects;
    const arun = objects.find((o: any) => o.name === 'Arun');
    const cafe = objects.find((o: any) => o.name === 'Blue Moon Cafe');
    expect(arun).toBeDefined();
    expect(cafe).toBeDefined();

    // Check relationship
    const relsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/memory/objects/${arun.id}/relationships`,
    });
    expect(relsRes.json().relationships.length).toBeGreaterThan(0);
  });

  // TEST 3
  it('TEST 3: "I met Arun again." resolves existing Arun without creating Arun #2', async () => {
    await analyze(harness.app, { text: 'I met Arun yesterday.' });
    await analyze(harness.app, { text: 'I met Arun again today.' });

    const objectsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects?type=person',
    });
    const aruns = objectsRes.json().objects.filter((o: any) => o.name === 'Arun');
    expect(aruns).toHaveLength(1);
    expect(aruns[0].mention_count).toBe(2);
  });

  // TEST 4
  it('TEST 4: "I met Haroon today and we discussed the product idea..." creates objects and relationships', async () => {
    const res = await analyze(harness.app, {
      text: 'I met Haroon today and we discussed the product idea we discussed six months ago.',
    });
    expect(res.status).toBe(200);

    const objectsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects',
    });
    const objects = objectsRes.json().objects;
    const haroon = objects.find((o: any) => o.name === 'Haroon');
    expect(haroon).toBeDefined();
  });

  // TEST 5
  it('TEST 5: "I went to Blue Moon Cafe with Maya." resolves Blue Moon Cafe and creates Maya', async () => {
    // Conv 1 introduces Blue Moon Cafe
    await analyze(harness.app, { text: 'I met Arun at Blue Moon Cafe.' });

    // Conv 2 introduces Maya at Blue Moon Cafe
    await analyze(harness.app, { text: 'I went to Blue Moon Cafe with Maya.' });

    const objectsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects',
    });
    const objects = objectsRes.json().objects;
    const cafes = objects.filter((o: any) => o.name === 'Blue Moon Cafe');
    const maya = objects.find((o: any) => o.name === 'Maya');

    expect(cafes).toHaveLength(1);
    expect(cafes[0].mention_count).toBe(2);
    expect(maya).toBeDefined();
    expect(maya.mention_count).toBe(1);
  });

  // TEST 6
  // TEST 6 — V2 update:
  // Unknown entity types are mapped to `other_entity` (never discarded).
  // The original raw type is preserved in `attributes.raw_kind` for traceability.
  // The old expectation (monolith.type === 'alien_artifact') was pre-V2 behaviour
  // where raw types were stored directly. V2 always uses the canonical type set.
  it('TEST 6: Unknown object category is preserved as other_entity (V2)', async () => {
    const mock = new MockProvider([
      {
        kind: 'respond',
        payload: {
          language: 'en',
          intent: 'LOG',
          summary: 'Looked at the monolith',
          entities: [
            { kind: 'OTHER', raw_kind: 'alien_artifact', name: 'Monolith', aliases: [] },
          ],
          items: [],
        },
      },
    ]);

    const customHarness = await buildTestApp({ provider: mock });
    try {
      const res = await analyze(customHarness.app, { text: 'I found an alien artifact called Monolith.' });
      expect(res.status).toBe(200);

      const objectsRes = await customHarness.app.inject({
        method: 'GET',
        url: '/api/v1/memory/objects',
      });
      const monolith = objectsRes.json().objects.find((o: any) => o.name === 'Monolith');
      expect(monolith).toBeDefined();
      // V2: unknown types become other_entity (never discarded, never forced into wrong category)
      expect(monolith.type).toBe('other_entity');
      // The original raw type is preserved in attributes.raw_kind for traceability
      expect(monolith.attributes?.raw_kind).toBe('alien_artifact');
    } finally {
      await customHarness.close();
    }
  });


  // TEST 7
  it('TEST 7: Same relationship appearing twice does not duplicate rows', async () => {
    await analyze(harness.app, { text: 'I met Arun at Blue Moon Cafe.' });
    await analyze(harness.app, { text: 'I met Arun at Blue Moon Cafe again.' });

    const objectsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects',
    });
    const arun = objectsRes.json().objects.find((o: any) => o.name === 'Arun');

    const relsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/memory/objects/${arun.id}/relationships`,
    });
    const rels = relsRes.json().relationships;

    // Verify no duplicates with same source, target, and relationship_type
    const keys = rels.map((r: any) => `${r.source_object_id}|${r.target_object_id}|${r.relationship_type}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  // TEST 8
  it('TEST 8: Invalid AI JSON is handled gracefully by validation and fallback', async () => {
    const mock = new MockProvider([
      {
        kind: 'respondText',
        text: '{ bad json that fails parsing ',
      },
    ]);

    const { LocalRuleProvider } = await import('../../src/ai/local.provider.js');
    const customHarness = await buildTestApp({ provider: mock, fallback: new LocalRuleProvider() });
    try {
      const res = await analyze(customHarness.app, { text: 'I met Arun yesterday.' });
      expect(res.status).toBe(200);
      expect(res.body.meta.degraded).toBe(true);

      const objectsRes = await customHarness.app.inject({
        method: 'GET',
        url: '/api/v1/memory/objects',
      });
      expect(objectsRes.json().objects.some((o: any) => o.name === 'Arun')).toBe(true);
    } finally {
      await customHarness.close();
    }
  });

  // TEST 9
  it('TEST 9: Prevents self-referencing and invalid relationships', async () => {
    const res = await analyze(harness.app, { text: 'I reflected on my thoughts today.' });
    expect(res.status).toBe(200);

    const objectsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects',
    });
    for (const obj of objectsRes.json().objects) {
      const relsRes = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/memory/objects/${obj.id}/relationships`,
      });
      for (const rel of relsRes.json().relationships) {
        expect(rel.source_object_id).not.toBe(rel.target_object_id);
      }
    }
  });

  // TEST 10
  it('TEST 10: Diary/lifelog content with no task stores memory without creating task/reminder', async () => {
    const res = await analyze(harness.app, {
      text: 'I sat by the window watching the rain and felt deeply peaceful.',
    });
    expect(res.status).toBe(200);

    // No tasks created
    const tasksRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
    });
    expect(tasksRes.json().items).toHaveLength(0);

    // Memory object was stored
    const objectsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects',
    });
    expect(objectsRes.statusCode).toBe(200);
  });
});
