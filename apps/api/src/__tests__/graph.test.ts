import { describe, expect, it } from 'vitest';
import { buildGraph, type GraphDocument } from '@repo/shared';

describe('buildGraph', () => {
  it('builds nodes per note and edges per resolved wikilink', () => {
    const docs: GraphDocument[] = [
      { path: 'a.md', content: '# A\n\nSee [[b]].' },
      { path: 'b.md', content: '# B\n\nNo links here.' },
    ];

    const graph = buildGraph(docs);

    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['a.md', 'b.md']);
    expect(graph.nodes.find((n) => n.id === 'a.md')?.label).toBe('a');
    expect(graph.edges).toEqual([{ source: 'a.md', target: 'b.md' }]);
  });

  it('keeps unresolved link targets as distinct placeholder nodes', () => {
    const graph = buildGraph([{ path: 'a.md', content: 'Links to [[Nowhere]].' }]);

    const placeholder = graph.nodes.find((n) => n.id === 'Nowhere');
    expect(placeholder).toEqual({ id: 'Nowhere', label: 'Nowhere', tags: [], unresolved: true });
    expect(graph.nodes.find((n) => n.id === 'a.md')?.unresolved).toBeUndefined();
    expect(graph.edges).toContainEqual({ source: 'a.md', target: 'Nowhere' });
  });

  it('carries a typed relation onto the edge and attaches tags to nodes', () => {
    const docs: GraphDocument[] = [
      {
        path: 'claim.md',
        content: '---\ntags: [thesis]\n---\nBacked by [[evidence|rel:supports]].',
      },
      { path: 'evidence.md', content: '# Evidence' },
    ];

    const graph = buildGraph(docs);

    expect(graph.nodes.find((n) => n.id === 'claim.md')?.tags).toEqual(['thesis']);
    expect(graph.edges).toContainEqual({
      source: 'claim.md',
      target: 'evidence.md',
      type: 'supports',
    });
  });

  it('drops self-links and de-dupes repeated edges', () => {
    const docs: GraphDocument[] = [
      { path: 'a.md', content: 'See [[a]] and [[b]] and [[b]] again.' },
      { path: 'b.md', content: '# B' },
    ];

    const graph = buildGraph(docs);

    // No self-edge a.md -> a.md, and only one a.md -> b.md edge.
    expect(graph.edges).toEqual([{ source: 'a.md', target: 'b.md' }]);
  });

  it('ignores wikilinks inside fenced code', () => {
    const graph = buildGraph([
      { path: 'a.md', content: '```\n[[b]]\n```\n\nreal [[c]]' },
      { path: 'b.md', content: '# B' },
      { path: 'c.md', content: '# C' },
    ]);

    expect(graph.edges).toEqual([{ source: 'a.md', target: 'c.md' }]);
  });
});
