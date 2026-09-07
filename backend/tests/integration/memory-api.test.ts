/**
 * Integration tests for Phase 2 Memory Graph API.
 *
 * GET /api/v1/memory/objects
 * GET /api/v1/memory/objects/:id
 * GET /api/v1/memory/objects/:id/relationships
 * GET /api/v1/memory/conversations/:id
 * POST /api/v1/memory/process
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

describe('Memory Graph API', () => {
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

  it('creates memory objects with origins on conversation analysis', async () => {
    const res = await analyze(harness.app, {
      text: 'I met Arun at Blue Moon Cafe yesterday to discuss the Lifelog project.',
    });
    expect(res.status).toBe(200);

    const objectsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects',
    });

    expect(objectsRes.statusCode).toBe(200);
    const body = objectsRes.json();
    expect(body.objects.length).toBeGreaterThan(0);

    const arun = body.objects.find((o: any) => o.name === 'Arun' && o.type === 'person');
    expect(arun).toBeDefined();
    expect(arun.mention_count).toBe(1);

    // Check object detail with origins and relationships
    const detailRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/memory/objects/${arun.id}`,
    });

    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.id).toBe(arun.id);
    expect(detail.origins.length).toBeGreaterThan(0);
    expect(detail.origins[0].conversation_id).toBe(res.body.conversationId);
  });

  it('resolves existing objects across multiple conversations', async () => {
    // Conversation 1 mentions Arun
    await analyze(harness.app, { text: 'I met Arun yesterday.' });

    const firstList = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects?type=person',
    });
    const firstArun = firstList.json().objects.find((o: any) => o.name === 'Arun');
    expect(firstArun).toBeDefined();
    expect(firstArun.mention_count).toBe(1);

    // Conversation 2 mentions Arun again
    await analyze(harness.app, { text: 'Arun called me this morning.' });

    const secondList = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects?type=person',
    });
    const aruns = secondList.json().objects.filter((o: any) => o.name === 'Arun');
    // Should NOT create Arun #2; must resolve existing Arun
    expect(aruns).toHaveLength(1);
    expect(aruns[0].id).toBe(firstArun.id);
    expect(aruns[0].mention_count).toBe(2);
  });

  it('fetches memory objects for a specific conversation', async () => {
    const res = await analyze(harness.app, {
      text: 'I met Arun at Blue Moon Cafe.',
    });
    const conversationId = res.body.conversationId;

    const convObjectsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/memory/conversations/${conversationId}`,
    });

    expect(convObjectsRes.statusCode).toBe(200);
    const body = convObjectsRes.json();
    expect(body.conversation_id).toBe(conversationId);
    expect(body.objects.length).toBeGreaterThanOrEqual(2);
    expect(body.objects.some((o: any) => o.name === 'Arun')).toBe(true);
    expect(body.objects.some((o: any) => o.name === 'Blue Moon Cafe')).toBe(true);
  });

  it('fetches relationships connected to an object', async () => {
    await analyze(harness.app, {
      text: 'I met Arun at Blue Moon Cafe.',
    });

    const objectsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/objects',
    });
    const arun = objectsRes.json().objects.find((o: any) => o.name === 'Arun');
    expect(arun).toBeDefined();

    const relsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/memory/objects/${arun.id}/relationships`,
    });

    expect(relsRes.statusCode).toBe(200);
    const body = relsRes.json();
    expect(Array.isArray(body.relationships)).toBe(true);
  });

  it('returns nodes and edges from the graph endpoint', async () => {
    await analyze(harness.app, { text: 'I met Arun at Blue Moon Cafe yesterday.' });

    const graphRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/memory/graph',
    });

    expect(graphRes.statusCode).toBe(200);
    const graph = graphRes.json();
    expect(graph.objects.some((object: any) => object.name === 'Arun')).toBe(true);
    expect(Array.isArray(graph.relationships)).toBe(true);
    expect(graph.relationships.length).toBeGreaterThan(0);
  });
});
