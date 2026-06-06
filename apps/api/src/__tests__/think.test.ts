import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assembleAnswerKit,
  assembleContextBundle,
  type ContextCandidate,
  type ContextBundle,
} from '@repo/shared';

const match = (p: string, text: string, score = 0.5, heading?: string): ContextCandidate => ({
  path: p,
  ...(heading ? { heading } : {}),
  text,
  score,
});

const bundleOf = (
  query: string,
  matches: ContextCandidate[],
  neighbors?: ContextCandidate[],
): ContextBundle => assembleContextBundle({ query, tokenBudget: 100_000, matches, neighbors });

describe('think.ts source hygiene', () => {
  it('stays plain UTF-8 text (no NUL bytes that would make git treat it as binary)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      path.resolve(here, '../../../../packages/shared/src/think.ts'),
      'utf8',
    );
    expect(source.includes(String.fromCharCode(0))).toBe(false);
  });
});

describe('assembleAnswerKit — citations', () => {
  it('numbers every passage and maps each citation back to its passage', () => {
    const bundle = bundleOf('feline behaviour', [
      match('cats.md', 'Felines purr and chase mice.', 0.6, 'Cats'),
      match('lions.md', 'Lions are large felines that roar.', 0.4),
    ]);

    const kit = assembleAnswerKit('feline behaviour', bundle);

    expect(kit.citations.map((c) => c.n)).toEqual([1, 2]);
    expect(kit.citations.map((c) => c.path)).toEqual(['cats.md', 'lions.md']);
    // The heading rides along, and citation n points at passages[n - 1].
    expect(kit.citations[0].heading).toBe('Cats');
    expect(kit.passages[kit.citations[0].n - 1]).toBe(bundle.items[0]);
    expect(kit.citations[1].heading).toBeUndefined();
    expect(kit.coverage).toEqual({ citations: 2, notes: 2, topScore: 0.6 });
  });

  it('surfaces a `^block-id` anchor in a passage as a stable citation address', () => {
    const bundle = bundleOf('thesis', [
      match('claim.md', 'The vault doubles as a shared brain. ^claim-1', 0.5),
    ]);

    const kit = assembleAnswerKit('thesis', bundle);

    expect(kit.citations[0].block).toBe('claim-1');
    // A passage without an anchor reports no block.
    const noAnchor = assembleAnswerKit('x', bundleOf('x', [match('a.md', 'no anchor here', 0.5)]));
    expect(noAnchor.citations[0].block).toBeUndefined();
  });

  it('counts distinct notes, not passages, in coverage', () => {
    const bundle = bundleOf('cats', [
      match('cats.md', 'Cats purr.', 0.5, 'Intro'),
      match('cats.md', 'Cats also hunt.', 0.4, 'Behaviour'),
    ]);
    const kit = assembleAnswerKit('cats', bundle);

    expect(kit.citations).toHaveLength(2);
    expect(kit.coverage.notes).toBe(1);
  });
});

describe('assembleAnswerKit — gap analysis (offline)', () => {
  it('flags weak coverage when the top match score is below the threshold', () => {
    const weak = assembleAnswerKit(
      'feline',
      bundleOf('feline', [match('a.md', 'Felines purr.', 0.05)]),
    );
    expect(weak.gaps.weakCoverage).toBe(true);
    expect(weak.gaps.topScore).toBe(0.05);

    const strong = assembleAnswerKit(
      'feline',
      bundleOf('feline', [match('a.md', 'Felines purr.', 0.5)]),
    );
    expect(strong.gaps.weakCoverage).toBe(false);
    expect(strong.gaps.topScore).toBe(0.5);
  });

  it('honors a custom weak-coverage threshold', () => {
    const bundle = bundleOf('feline', [match('a.md', 'Felines purr.', 0.5)]);
    const kit = assembleAnswerKit('feline', bundle, { weakCoverageThreshold: 0.6 });
    expect(kit.gaps.threshold).toBe(0.6);
    expect(kit.gaps.weakCoverage).toBe(true);
  });

  it('ignores neighbor passages (score 0) when measuring coverage', () => {
    const kit = assembleAnswerKit(
      'feline',
      bundleOf(
        'feline',
        [match('a.md', 'Felines purr.', 0.5)],
        [{ path: 'neighbor.md', text: 'links here', score: 0 }],
      ),
    );
    // The neighbor's 0 score must not drag topScore down below the match's.
    expect(kit.gaps.topScore).toBe(0.5);
    expect(kit.gaps.weakCoverage).toBe(false);
  });

  it('detects query terms no passage supports (stem-aware), dropping stopwords', () => {
    const bundle = bundleOf('what is a feline submarine', [
      match('cats.md', 'Felines purr and chase mice.', 0.5),
    ]);
    const kit = assembleAnswerKit('what is a feline submarine', bundle);

    // "feline" is covered by the "Felines" passage (same stem); "submarine" is
    // not. Stopwords (what/is/a) are dropped entirely.
    expect(kit.gaps.uncoveredTerms).toEqual(['submarine']);
  });
});

describe('assembleAnswerKit — empty corpus', () => {
  it('returns an empty, weak kit with every query term uncovered', () => {
    const bundle = bundleOf('quantum chromodynamics', []);
    const kit = assembleAnswerKit('quantum chromodynamics', bundle);

    expect(kit.citations).toEqual([]);
    expect(kit.passages).toEqual([]);
    expect(kit.gaps.weakCoverage).toBe(true);
    expect(kit.gaps.topScore).toBe(0);
    expect(kit.gaps.uncoveredTerms).toEqual(['quantum', 'chromodynamics']);
    expect(kit.coverage).toEqual({ citations: 0, notes: 0, topScore: 0 });
  });
});
