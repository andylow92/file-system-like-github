import { describe, expect, it } from 'vitest';

import { assembleContextBundle, estimateTokens, type ContextCandidate } from '@repo/shared';

describe('estimateTokens', () => {
  it('approximates tokens as ceil(chars / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('assembleContextBundle', () => {
  const match = (path: string, text: string, score = 0.5): ContextCandidate => ({
    path,
    text,
    score,
  });

  it('packs matches within the budget and reports usage', () => {
    const bundle = assembleContextBundle({
      query: 'q',
      tokenBudget: 100,
      matches: [match('a.md', 'a'.repeat(40)), match('b.md', 'b'.repeat(40))],
    });

    expect(bundle.items.map((item) => item.path)).toEqual(['a.md', 'b.md']);
    expect(bundle.items.every((item) => item.kind === 'match')).toBe(true);
    expect(bundle.usedTokens).toBe(20); // ceil(40/4) * 2
    expect(bundle.usedTokens).toBeLessThanOrEqual(bundle.tokenBudget);
    expect(bundle.truncated).toBe(false);
  });

  it('stops at the budget and marks the bundle truncated', () => {
    const bundle = assembleContextBundle({
      query: 'q',
      tokenBudget: 12, // fits one 10-token item, not two
      matches: [match('a.md', 'a'.repeat(40)), match('b.md', 'b'.repeat(40))],
    });

    expect(bundle.items.map((item) => item.path)).toEqual(['a.md']);
    expect(bundle.truncated).toBe(true);
    expect(bundle.usedTokens).toBeLessThanOrEqual(12);
  });

  it('includes neighbors after matches when a focusPath is given', () => {
    const bundle = assembleContextBundle({
      query: 'q',
      focusPath: 'focus.md',
      tokenBudget: 1000,
      matches: [match('a.md', 'alpha')],
      neighbors: [
        { path: 'focus.md', text: 'focus body', score: 0 },
        { path: 'link.md', text: 'links here', score: 0 },
      ],
    });

    expect(bundle.focusPath).toBe('focus.md');
    expect(bundle.items.map((item) => `${item.path}:${item.kind}`)).toEqual([
      'a.md:match',
      'focus.md:neighbor',
      'link.md:neighbor',
    ]);
  });

  it('de-dupes identical passages, keeping the higher-priority (match) copy', () => {
    const passage: ContextCandidate = { path: 'a.md', heading: 'H', text: 'same text', score: 0.9 };
    const bundle = assembleContextBundle({
      query: 'q',
      tokenBudget: 1000,
      matches: [passage],
      neighbors: [{ ...passage, score: 0 }],
    });

    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0]).toMatchObject({ path: 'a.md', kind: 'match' });
  });

  it('omits focusPath when absent and returns an empty bundle for no candidates', () => {
    const bundle = assembleContextBundle({ query: 'q', tokenBudget: 100, matches: [] });

    expect(bundle.focusPath).toBeUndefined();
    expect(bundle.items).toEqual([]);
    expect(bundle.usedTokens).toBe(0);
    expect(bundle.truncated).toBe(false);
  });
});
