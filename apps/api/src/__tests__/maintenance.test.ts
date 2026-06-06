import { describe, expect, it } from 'vitest';

import { scanVault, type MaintenanceDocument } from '@repo/shared';

const doc = (path: string, content: string): MaintenanceDocument => ({ path, content });

describe('scanVault — broken_link', () => {
  it('flags a [[wikilink]] that resolves to no note and suggests a stub create', () => {
    const findings = scanVault([
      doc('index.md', '# Index\nSee [[guide]] and [[ghost]] for more.'),
      doc('guide.md', '# Guide\nBack to [[index]].'),
    ]);

    // The two real notes cross-link, so the only finding is the broken link.
    expect(findings).toHaveLength(1);
    const broken = findings[0];
    expect(broken.kind).toBe('broken_link');
    expect(broken.paths).toEqual(['index.md']);
    expect(broken.suggestion).toBeDefined();
    expect(broken.suggestion!.action).toBe('create');
    expect(broken.suggestion!.path).toBe('ghost.md');
    expect(broken.suggestion!.content).toContain('# ghost');
  });

  it('groups multiple notes linking the same missing target into one finding', () => {
    const findings = scanVault([
      doc('a.md', 'Mentions [[missing]] once. Linked from [[b]].'),
      doc('b.md', 'Also mentions [[missing]] here. See [[a]].'),
    ]);

    const broken = findings.filter((f) => f.kind === 'broken_link');
    expect(broken).toHaveLength(1);
    expect(broken[0].paths).toEqual(['a.md', 'b.md']);
    expect(broken[0].suggestion!.path).toBe('missing.md');
  });

  it('never proposes creating over a note that already exists', () => {
    // `[[notes/topic]]` resolves to the real note, so it is not broken.
    const findings = scanVault([
      doc('hub.md', 'See [[notes/topic]] and [[topic]].'),
      doc('notes/topic.md', '# Topic\nLinked from [[hub]].'),
    ]);
    expect(findings.filter((f) => f.kind === 'broken_link')).toHaveLength(0);
  });
});

describe('scanVault — orphan', () => {
  it('flags a note with no inbound or outbound resolved links, with no suggestion', () => {
    const findings = scanVault([
      doc('a.md', '# Alpha\nConnected to [[b]] here.'),
      doc('b.md', '# Bravo\nLinks back to [[a]].'),
      doc('lonely.md', '# Lonely\nSits by itself with nothing linking it.'),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('orphan');
    expect(findings[0].paths).toEqual(['lonely.md']);
    expect(findings[0].suggestion).toBeUndefined();
  });

  it('treats a note whose only link is broken as an orphan (no resolved links)', () => {
    const orphans = scanVault([doc('solo.md', 'Only links to [[nowhere]].')]).filter(
      (f) => f.kind === 'orphan',
    );
    expect(orphans.map((f) => f.paths[0])).toEqual(['solo.md']);
  });
});

describe('scanVault — duplicate', () => {
  it('flags a near-duplicate pair once (sorted) with a score and a cross-link suggestion', () => {
    const dups = scanVault([
      doc('dupB.md', '# Topic\nThe vault dedupes notes and fixes links overnight.'),
      doc('dupA.md', '# Topic\nThe vault dedupes notes and fixes links overnight.'),
    ]).filter((f) => f.kind === 'duplicate');

    expect(dups).toHaveLength(1);
    // Reported in sorted-path order regardless of input order.
    expect(dups[0].paths).toEqual(['dupA.md', 'dupB.md']);
    expect(dups[0].score).toBeCloseTo(1, 5);
    // Conservative fix: append a `> See also` cross-link to the first note.
    expect(dups[0].suggestion!.action).toBe('update');
    expect(dups[0].suggestion!.path).toBe('dupA.md');
    expect(dups[0].suggestion!.content).toContain('> See also [[dupB]]');
  });

  it('respects the duplicate threshold boundary', () => {
    const docs = [
      doc('partialA.md', 'alpha beta gamma delta epsilon zeta'),
      doc('partialB.md', 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'),
    ];

    const low = scanVault(docs, { duplicateThreshold: 0.1 }).filter((f) => f.kind === 'duplicate');
    expect(low).toHaveLength(1);
    expect(low[0].score!).toBeGreaterThan(0.1);
    expect(low[0].score!).toBeLessThan(0.9);

    const high = scanVault(docs, { duplicateThreshold: 0.9 }).filter((f) => f.kind === 'duplicate');
    expect(high).toHaveLength(0);
  });

  it('omits the cross-link suggestion when the pair already links each other', () => {
    const dups = scanVault(
      [
        doc('one.md', '# Shared\nIdentical body about caching strategy here. See [[two]].'),
        doc('two.md', '# Shared\nIdentical body about caching strategy here.'),
      ],
      { duplicateThreshold: 0.5 },
    ).filter((f) => f.kind === 'duplicate');

    expect(dups).toHaveLength(1);
    expect(dups[0].suggestion).toBeUndefined();
  });
});

describe('scanVault — clean vault, determinism, and empty corpus', () => {
  it('returns no findings for a healthy, connected vault', () => {
    const findings = scanVault([
      doc('apples.md', '# Apples\nApples grow on trees in orchards. See [[rockets]].'),
      doc('rockets.md', '# Rockets\nRockets burn fuel to reach orbit. See [[apples]].'),
    ]);
    expect(findings).toEqual([]);
  });

  it('is deterministic and independent of input order', () => {
    const docs = [
      doc('index.md', '# Index\nSee [[guide]] and [[ghost]].'),
      doc('guide.md', '# Guide\nBack to [[index]].'),
      doc('lonely.md', '# Lonely\nNothing links here at all.'),
      doc('dupA.md', '# Dup\nThe nightly dream cycle dedupes and repairs the vault.'),
      doc('dupB.md', '# Dup\nThe nightly dream cycle dedupes and repairs the vault.'),
    ];

    const once = scanVault(docs);
    expect(scanVault(docs)).toEqual(once);
    // Sorting makes the output independent of corpus order.
    expect(scanVault([...docs].reverse())).toEqual(once);
  });

  it('returns no findings for an empty corpus', () => {
    expect(scanVault([])).toEqual([]);
  });
});
