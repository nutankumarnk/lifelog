/**
 * Integration tests for Notes API.
 *
 * GET /api/v1/notes
 * GET /api/v1/notes/:id
 * PATCH /api/v1/notes/:id
 * DELETE /api/v1/notes/:id
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

describe('Notes API', () => {
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

  it('lists notes ordered by newest first with pagination metadata', async () => {
    // Submit two notes
    await analyze(harness.app, { text: 'First conversation note', source: 'text' });
    await analyze(harness.app, { text: 'Second conversation note', source: 'voice' });

    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/notes',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notes).toHaveLength(2);
    expect(body.notes[0].original_text).toBe('Second conversation note');
    expect(body.notes[0].source).toBe('voice');
    expect(body.notes[0].processing_status).toBe('processed');
    expect(body.notes[1].original_text).toBe('First conversation note');
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.page).toBe(1);
  });

  it('filters notes by source and search query', async () => {
    await analyze(harness.app, { text: 'Meeting with Arun at cafe', source: 'voice' });
    await analyze(harness.app, { text: 'Buying groceries', source: 'text' });

    // Filter by source
    const voiceRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/notes?source=voice',
    });
    expect(voiceRes.json().notes).toHaveLength(1);
    expect(voiceRes.json().notes[0].original_text).toBe('Meeting with Arun at cafe');

    // Search query
    const searchRes = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/notes?search=groceries',
    });
    expect(searchRes.json().notes).toHaveLength(1);
    expect(searchRes.json().notes[0].original_text).toBe('Buying groceries');
  });

  it('fetches a single note detail with extracted objects and relationships', async () => {
    const createRes = await analyze(harness.app, {
      text: 'I met Arun at Blue Moon Cafe yesterday to discuss the Lifelog project.',
      source: 'text',
    });

    const conversationId = createRes.body.conversationId;

    const detailRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/notes/${conversationId}`,
    });

    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.id).toBe(conversationId);
    expect(detail.original_text).toBe('I met Arun at Blue Moon Cafe yesterday to discuss the Lifelog project.');
    expect(detail.source).toBe('text');
    expect(detail.processing_status).toBe('processed');
    expect(detail.objects.length).toBeGreaterThan(0);
  });

  it('returns 404 for non-existent note', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/notes/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('updates a note journal entry via PATCH /api/v1/notes/:id', async () => {
    const createRes = await analyze(harness.app, {
      text: 'Rough messy stream of thoughts about work and fatigue',
      source: 'voice',
    });

    const conversationId = createRes.body.conversationId;

    const patchRes = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/notes/${conversationId}`,
      payload: {
        title: 'Overcoming Work Fatigue',
        polished_entry: 'I reflected on my workday and realized I was feeling tired, but decided to rest.',
        mood: 'Reflective',
        highlights: ['Workday reflection', 'Prioritizing rest'],
      },
    });

    expect(patchRes.statusCode).toBe(200);
    const updated = patchRes.json();
    expect(updated.id).toBe(conversationId);
    expect(updated.journal.title).toBe('Overcoming Work Fatigue');
    expect(updated.journal.polished_entry).toBe(
      'I reflected on my workday and realized I was feeling tired, but decided to rest.',
    );
    expect(updated.journal.mood).toBe('Reflective');
    expect(updated.journal.highlights).toEqual(['Workday reflection', 'Prioritizing rest']);
  });

  it('deletes a note and its conversation-owned records', async () => {
    const createRes = await analyze(harness.app, {
      text: 'A journal entry that I no longer want to keep',
      source: 'text',
    });
    const conversationId = createRes.body.conversationId;

    const deleteRes = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/notes/${conversationId}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    const detailRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/notes/${conversationId}`,
    });
    expect(detailRes.statusCode).toBe(404);

    const listRes = await harness.app.inject({ method: 'GET', url: '/api/v1/notes' });
    expect(listRes.json().notes).toHaveLength(0);
  });

  it('returns 404 when deleting a note that does not exist', async () => {
    const res = await harness.app.inject({
      method: 'DELETE',
      url: '/api/v1/notes/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });
});
