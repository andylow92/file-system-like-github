import { describe, expect, it } from 'vitest';
import { formatEvalReport, scoreEvalCase, summarizeEval, type EvalCase } from '@repo/shared';

const CASE: EvalCase = {
  id: 'demo',
  query: 'demo query',
  expected: ['a.md', 'b.md'],
};

describe('scoreEvalCase', () => {
  it('computes recall and reciprocal rank over the top-k', () => {
    const result = scoreEvalCase(CASE, ['x.md', 'a.md', 'y.md', 'b.md'], 5);
    expect(result.found).toEqual(['a.md', 'b.md']);
    expect(result.missing).toEqual([]);
    expect(result.recall).toBe(1);
    expect(result.reciprocalRank).toBe(1 / 2); // first hit at rank 2
  });

  it('only counts hits inside the cutoff', () => {
    const result = scoreEvalCase(CASE, ['x.md', 'y.md', 'a.md', 'b.md'], 2);
    expect(result.found).toEqual([]);
    expect(result.missing).toEqual(['a.md', 'b.md']);
    expect(result.recall).toBe(0);
    expect(result.reciprocalRank).toBe(0);
  });

  it('de-duplicates a per-chunk ranking, keeping the best position', () => {
    // A chunk-level engine can emit the same note several times; the repeats
    // must not consume top-k slots.
    const result = scoreEvalCase(CASE, ['x.md', 'x.md', 'x.md', 'a.md'], 2);
    expect(result.found).toEqual(['a.md']);
    expect(result.recall).toBe(0.5);
    expect(result.reciprocalRank).toBe(1 / 2);
  });
});

describe('summarizeEval', () => {
  it('averages recall and reciprocal rank and collects failures', () => {
    const perfect = scoreEvalCase(CASE, ['a.md', 'b.md'], 5);
    const miss = scoreEvalCase({ ...CASE, id: 'miss' }, ['a.md'], 5);
    const summary = summarizeEval([perfect, miss], 5);

    expect(summary.meanRecall).toBe(0.75); // (1 + 0.5) / 2
    expect(summary.meanReciprocalRank).toBe(1); // both first hits at rank 1
    expect(summary.failures.map((f) => f.id)).toEqual(['miss']);
  });

  it('is safe on an empty run', () => {
    const summary = summarizeEval([], 5);
    expect(summary.meanRecall).toBe(0);
    expect(summary.failures).toEqual([]);
  });
});

describe('formatEvalReport', () => {
  it('names the failing queries and their missing notes', () => {
    const miss = scoreEvalCase({ ...CASE, id: 'miss' }, ['a.md'], 5);
    const report = formatEvalReport('semantic', summarizeEval([miss], 5));
    expect(report).toContain('semantic: recall@5=0.5');
    expect(report).toContain('[miss] "demo query" missing: b.md');
  });
});
