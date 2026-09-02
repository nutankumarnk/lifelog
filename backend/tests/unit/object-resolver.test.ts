/**
 * Unit tests for object resolver.
 */
import { describe, expect, it } from 'vitest';
import { normalizeName, normalizeType, resolveObject } from '../../src/memory/object-resolver.js';

describe('object-resolver', () => {
  it('normalizes names by trimming, lowercasing, and collapsing whitespace', () => {
    expect(normalizeName('  Arun   Kumar ')).toBe('arun kumar');
    // U+201C/U+201D curly quotes — normalizeName collapses them to ASCII ".
    expect(normalizeName('\u201cArun\u201d')).toBe('"arun"');
    // U+2018/U+2019 curly apostrophes — normalizeName collapses them to ASCII '.
    expect(normalizeName('\u2018Arun\u2019')).toBe("'arun'");
  });

  it('normalizes types', () => {
    expect(normalizeType('  PERSON  ')).toBe('person');
    expect(normalizeType('Place')).toBe('place');
  });

  it('resolves existing object with exact normalized name and type', () => {
    const existing = [
      { id: '123', type: 'person', name: 'Arun', normalizedName: 'arun' },
      { id: '456', type: 'place', name: 'Blue Moon Cafe', normalizedName: 'blue moon cafe' },
    ];

    const result = resolveObject({ type: 'PERSON', name: '  Arun ' }, existing);
    expect(result.isNew).toBe(false);
    expect(result.existingId).toBe('123');
    expect(result.matchConfidence).toBe(1.0);
  });

  it('does not resolve when type differs', () => {
    const existing = [
      { id: '123', type: 'project', name: 'Arun', normalizedName: 'arun' },
    ];

    const result = resolveObject({ type: 'person', name: 'Arun' }, existing);
    expect(result.isNew).toBe(true);
    expect(result.existingId).toBeNull();
  });

  it('does not resolve when name differs', () => {
    const existing = [
      { id: '123', type: 'person', name: 'Arun Kumar', normalizedName: 'arun kumar' },
    ];

    // Conservative: "Arun" does not auto-merge with "Arun Kumar"
    const result = resolveObject({ type: 'person', name: 'Arun' }, existing);
    expect(result.isNew).toBe(true);
    expect(result.existingId).toBeNull();
  });
});
