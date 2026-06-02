import { describe, expect, it } from 'vitest';

import { chunkNote, semanticSearch, tokenize } from '@repo/shared';

describe('tokenize', () => {
  it('lowercases, splits, and drops stopwords and short tokens', () => {
    expect(tokenize('The quick brown FOX a')).toEqual(['quick', 'brown', 'fox']);
  });

  it('ignores inline code', () => {
    expect(tokenize('use `npm install` now')).toEqual(['use', 'now']);
  });
});

describe('chunkNote', () => {
  it('strips frontmatter and splits by heading', () => {
    const content = [
      '---',
      'title: T',
      '---',
      '# Intro',
      'alpha text',
      '## Details',
      'beta text',
    ].join('\n');

    const chunks = chunkNote('n.md', content);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ heading: 'Intro', text: 'alpha text' });
    expect(chunks[1]).toMatchObject({ heading: 'Details', text: 'beta text' });
  });
});

describe('semanticSearch', () => {
  const documents = [
    {
      path: 'animals/cats.md',
      content: '# Cats\nFelines are independent pets that purr and chase mice.',
    },
    {
      path: 'finance/budget.md',
      content: '# Budget\nQuarterly revenue, expenses, and cash flow projections.',
    },
  ];

  it('ranks the topically relevant note above unrelated notes', () => {
    const hits = semanticSearch(documents, 'pet feline that purrs');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toBe('animals/cats.md');
    expect(hits[0].score).toBeGreaterThan(0);
    expect(hits[0].snippet).toContain('Felines');
  });

  it('returns nothing for an all-stopword query', () => {
    expect(semanticSearch(documents, 'the and of')).toEqual([]);
  });

  it('respects the limit', () => {
    const hits = semanticSearch(documents, 'revenue cash flow', { limit: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe('finance/budget.md');
  });

  it('ranks on heading terms even when the body never repeats them', () => {
    const docs = [
      {
        path: 'ops/backups.md',
        content: '# Backup strategy\nSnapshots run nightly to cold storage.',
      },
      { path: 'ops/network.md', content: '# Networking\nVLANs, routing, and firewall rules.' },
    ];
    const hits = semanticSearch(docs, 'backups');
    expect(hits[0]?.path).toBe('ops/backups.md');
  });
});
