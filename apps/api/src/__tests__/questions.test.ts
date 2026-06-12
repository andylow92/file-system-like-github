import { describe, expect, it } from 'vitest';
import { findKnowledgeGaps, type QuestionEntry } from '@repo/shared';

function entry(overrides: Partial<QuestionEntry>): QuestionEntry {
  return {
    ts: '2026-06-10T10:00:00.000Z',
    actor: 'agent:test',
    query: 'a question',
    weakCoverage: true,
    uncoveredTerms: [],
    ...overrides,
  };
}

describe('findKnowledgeGaps', () => {
  it('groups recurring uncovered terms across questions', () => {
    const gaps = findKnowledgeGaps([
      entry({
        ts: '2026-06-01T00:00:00Z',
        query: 'how do rollbacks work',
        uncoveredTerms: ['rollback'],
      }),
      entry({
        ts: '2026-06-02T00:00:00Z',
        query: 'rollback runbook?',
        uncoveredTerms: ['rollback', 'runbook'],
      }),
      entry({
        ts: '2026-06-03T00:00:00Z',
        query: 'one-off question',
        uncoveredTerms: ['composting'],
      }),
    ]);

    expect(gaps).toEqual([
      {
        term: 'rollback',
        count: 2,
        queries: ['rollback runbook?', 'how do rollbacks work'],
        lastTs: '2026-06-02T00:00:00Z',
      },
    ]);
  });

  it('counts repeats of the same question — asking twice is demand', () => {
    const gaps = findKnowledgeGaps([
      entry({ query: 'what is our sso setup', uncoveredTerms: ['sso'] }),
      entry({ query: 'what is our sso setup', uncoveredTerms: ['sso'] }),
    ]);
    expect(gaps[0].count).toBe(2);
    expect(gaps[0].queries).toEqual(['what is our sso setup']); // de-duplicated examples
  });

  it('counts a term once per question even when repeated in the entry', () => {
    const gaps = findKnowledgeGaps(
      [
        entry({ query: 'q1', uncoveredTerms: ['kafka', 'Kafka'] }),
        entry({ query: 'q2', uncoveredTerms: ['kafka'] }),
      ],
      { minCount: 2 },
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ term: 'kafka', count: 2 });
  });

  it('honors minCount and sorts by count then term', () => {
    const entries = [
      entry({ query: 'q1', uncoveredTerms: ['beta', 'alpha'] }),
      entry({ query: 'q2', uncoveredTerms: ['beta', 'alpha'] }),
      entry({ query: 'q3', uncoveredTerms: ['beta'] }),
    ];
    const gaps = findKnowledgeGaps(entries);
    expect(gaps.map((gap) => [gap.term, gap.count])).toEqual([
      ['beta', 3],
      ['alpha', 2],
    ]);
    expect(findKnowledgeGaps(entries, { minCount: 3 }).map((gap) => gap.term)).toEqual(['beta']);
  });

  it('compares lastTs by parsed time, not lexicographically', () => {
    // '12:00+05:00' is 07:00Z — lexicographically larger but chronologically
    // *earlier* than '08:00Z'. The numeric comparison must pick 08:00Z.
    const gaps = findKnowledgeGaps([
      entry({ ts: '2026-06-10T12:00:00+05:00', query: 'q1', uncoveredTerms: ['gap'] }),
      entry({ ts: '2026-06-10T08:00:00Z', query: 'q2', uncoveredTerms: ['gap'] }),
    ]);
    expect(gaps[0].lastTs).toBe('2026-06-10T08:00:00Z');
  });

  it('caps example queries at maxQueries, most recent first', () => {
    const entries = ['q1', 'q2', 'q3'].map((query, i) =>
      entry({ ts: `2026-06-0${i + 1}T00:00:00Z`, query, uncoveredTerms: ['gap'] }),
    );
    const gaps = findKnowledgeGaps(entries, { maxQueries: 2 });
    expect(gaps[0].queries).toEqual(['q3', 'q2']);
  });

  it('returns no gaps for an empty or covered log', () => {
    expect(findKnowledgeGaps([])).toEqual([]);
    expect(findKnowledgeGaps([entry({ uncoveredTerms: [] })])).toEqual([]);
  });
});
