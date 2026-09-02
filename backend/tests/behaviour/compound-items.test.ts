import { describe, expect, it } from 'vitest';
import { understandConversation } from '../../src/intelligence/pipeline.js';
import { LocalRuleProvider } from '../../src/ai/local.provider.js';

describe('compound multi-item extraction', () => {
  const local = new LocalRuleProvider();
  const runtime = { primary: local, fallback: null, maxRetries: 0 };
  const now = new Date('2026-08-28T12:00:00.000Z');
  const timezone = 'Asia/Kolkata';

  it('extracts multi-item compound sentences with Event, Task, and Reminder', async () => {
    const text = 'Meeting with client tomorrow at 10am, need to prepare slides tonight and remind me at 9am.';
    const result = await understandConversation(
      runtime,
      { text, now, timezone, locale: 'en' },
    );

    expect(result.analysis).toBeDefined();
    expect(result.analysis.items.length).toBeGreaterThanOrEqual(1);

    // Verify journal output
    expect(result.analysis.journal).toBeDefined();
    expect(result.analysis.journal?.title).toBeTruthy();
    expect(result.analysis.journal?.polished_entry).toBeTruthy();
  });

  it('generates a clean unfragmented first-person diary story without brackets', async () => {
    const text = 'I spoke with Dev about the quarterly roadmap today, agreed on the deadlines, and need to write the summary notes.';
    const result = await understandConversation(
      runtime,
      { text, now, timezone, locale: 'en' },
    );

    const journal = result.analysis.journal;
    expect(journal).toBeDefined();
    expect(journal?.polished_entry).not.toMatch(/\[(?:task|reminder|note)[^\]]*\]/i);
    expect(journal?.polished_entry).not.toMatch(/^[-*•]/m);
    expect(journal?.mood).toBeTruthy();
  });
});
