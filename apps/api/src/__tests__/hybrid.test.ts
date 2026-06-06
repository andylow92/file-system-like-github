import { describe, expect, it } from 'vitest';
import { DEFAULT_RRF_K, reciprocalRankFusion } from '@repo/shared';

describe('reciprocalRankFusion', () => {
  it('rewards items that appear in multiple rankings', () => {
    // `b` is rank 2 in both lists; `a` and `c` are rank 1 in one list each.
    const fused = reciprocalRankFusion([
      { keys: ['a', 'b'], label: 'text' },
      { keys: ['c', 'b'], label: 'semantic' },
    ]);

    expect(fused[0].key).toBe('b');
    expect(fused[0].sources).toEqual(['text', 'semantic']);
    // b: 1/(60+2) + 1/(60+2) = 2/62 ≈ 0.03226 beats a/c at 1/61 ≈ 0.01639.
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
  });

  it('records only the engines that matched, in input order', () => {
    const fused = reciprocalRankFusion([
      { keys: ['only-text'], label: 'text' },
      { keys: ['only-semantic'], label: 'semantic' },
    ]);

    const byKey = Object.fromEntries(fused.map((item) => [item.key, item.sources]));
    expect(byKey['only-text']).toEqual(['text']);
    expect(byKey['only-semantic']).toEqual(['semantic']);
  });

  it('scores by rank with the standard damping constant', () => {
    const [top] = reciprocalRankFusion([{ keys: ['a', 'b', 'c'] }]);
    expect(top.key).toBe('a');
    expect(top.score).toBeCloseTo(1 / (DEFAULT_RRF_K + 1), 10);
  });

  it('applies per-ranking weights', () => {
    // `b` leads `a` only because the semantic ranking that favors it is weighted up.
    const fused = reciprocalRankFusion([
      { keys: ['a'], label: 'text', weight: 1 },
      { keys: ['b'], label: 'semantic', weight: 5 },
    ]);
    expect(fused[0].key).toBe('b');
  });

  it('keeps the best (first) rank of a repeated key and is deterministic on ties', () => {
    const fused = reciprocalRankFusion([{ keys: ['dup', 'x', 'dup'] }]);
    const dup = fused.find((item) => item.key === 'dup')!;
    // Counted once at rank 1, not re-added at rank 3.
    expect(dup.score).toBeCloseTo(1 / (DEFAULT_RRF_K + 1), 10);

    // Equal scores break ties by key, so order is stable.
    const tie = reciprocalRankFusion([{ keys: ['banana'] }, { keys: ['apple'] }]);
    expect(tie.map((item) => item.key)).toEqual(['apple', 'banana']);
  });

  it('returns an empty array for no input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});
