/**
 * The golden fixture for the retrieval eval harness (backlog #20): a small,
 * fixed vault plus `query → expected-note` judgments, designed to exercise
 * each engine's distinct strength —
 *
 * - exact keyword / phrase and filename matches (lexical),
 * - paraphrased multi-word queries with no contiguous substring (semantic),
 * - and cases only the fused (hybrid) ranking gets right as a set.
 *
 * Treat the corpus + cases as frozen relevance judgments: extend them when a
 * new ranking behavior needs guarding, but don't rewrite existing notes to
 * make a failing engine pass — a failure is the harness doing its job.
 */
import type { EvalCase } from '@repo/shared';

export interface CorpusNote {
  path: string;
  content: string;
}

export const EVAL_CORPUS: CorpusNote[] = [
  {
    path: 'cooking/sourdough-starter.md',
    content: [
      '---',
      'tags: [cooking, baking]',
      '---',
      '# Sourdough starter',
      '',
      'A sourdough starter is a live culture of flour and water. Feed the',
      'starter daily and keep it warm; the slow fermentation is what gives the',
      'bread its sour flavor and open crumb.',
    ].join('\n'),
  },
  {
    path: 'cooking/pizza-dough.md',
    content: [
      '# Pizza dough',
      '',
      'Use strong flour and very little yeast. A long, cold fermentation in',
      'the fridge (48–72 hours) develops most of the flavor. Stretch by hand —',
      'never a rolling pin.',
    ].join('\n'),
  },
  {
    path: 'cooking/weeknight-curry.md',
    content: [
      '# Weeknight curry',
      '',
      'Onions, garlic, ginger, a spoon of paste, a tin of coconut milk.',
      'Twenty minutes start to finish; serve with rice.',
    ].join('\n'),
  },
  {
    path: 'infra/deploy-rollback.md',
    content: [
      '# Deployment rollback runbook',
      '',
      'When a release goes bad, roll back the deployment first and debug',
      'second. Run `kubectl rollout undo`, watch the dashboards, and confirm',
      'the rollback completed before announcing the all-clear. Every rollback',
      'gets a follow-up ticket.',
    ].join('\n'),
  },
  {
    path: 'infra/incident-postmortems.md',
    content: [
      '# Incident postmortems',
      '',
      'Write the postmortem within 48 hours, blameless. Capture the timeline,',
      'contributing causes, and whether a rollback was required.',
    ].join('\n'),
  },
  {
    path: 'infra/on-call.md',
    content: [
      '# On-call rotation',
      '',
      'Weekly handoff on Mondays. Page acknowledgment within five minutes;',
      'escalate to the secondary after fifteen.',
    ].join('\n'),
  },
  {
    path: 'pets/cats.md',
    content: [
      '# Cats',
      '',
      'Cats are independent, aloof companions. They groom themselves, sleep',
      'sixteen hours a day, and tolerate affection strictly on their own terms.',
    ].join('\n'),
  },
  {
    path: 'pets/dogs.md',
    content: [
      '# Dogs',
      '',
      'Dogs are loyal, social companions that need daily walks, training, and',
      'plenty of attention.',
    ].join('\n'),
  },
  {
    path: 'astro/telescopes.md',
    content: [
      '# Choosing a telescope',
      '',
      'Aperture matters more than magnification: a bigger aperture gathers',
      'more light and resolves finer detail. A solid mount beats fancy optics.',
    ].join('\n'),
  },
  {
    path: 'astro/astrophotography.md',
    content: [
      '# Astrophotography basics',
      '',
      'Photographing the night sky: use long exposures on a tracking mount to',
      'capture pinpoint stars without trails. Stack frames to cut the noise.',
    ].join('\n'),
  },
  {
    path: 'glossary.md',
    // The body deliberately never says "glossary" — the query must hit via the
    // filename, which only the lexical engine looks at.
    content: [
      '# Terms',
      '',
      'Alpha: the first test build. Beta: the wider preview. GA: generally',
      'available to everyone.',
    ].join('\n'),
  },
  {
    path: 'meetings/2026-01-planning.md',
    content: [
      '# January planning notes',
      '',
      'Discussed the deploy process, the team offsite, and pizza for the',
      'launch lunch. Action items assigned in the tracker.',
    ].join('\n'),
  },
];

/** Scoring cutoff the eval asserts at (top-k distinct notes per query). */
export const EVAL_K = 5;

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'exact-phrase',
    query: 'sourdough starter',
    expected: ['cooking/sourdough-starter.md'],
    description: 'Exact phrase present verbatim — both engines should hit.',
  },
  {
    id: 'keyword-rollback',
    query: 'rollback',
    expected: ['infra/deploy-rollback.md'],
    description: 'Single keyword; the runbook (many occurrences) must surface.',
  },
  {
    id: 'filename-only',
    query: 'glossary',
    expected: ['glossary.md'],
    description: 'Query only matches the filename — lexical-only territory.',
  },
  {
    id: 'multi-note-fermentation',
    query: 'fermentation',
    expected: ['cooking/sourdough-starter.md', 'cooking/pizza-dough.md'],
    description: 'Both fermentation notes must be retrieved, not just one.',
  },
  {
    id: 'paraphrase-runbook',
    query: 'how to roll back a bad deployment',
    expected: ['infra/deploy-rollback.md'],
    description: 'Multi-word paraphrase, no contiguous substring — semantic territory.',
  },
  {
    id: 'paraphrase-cats',
    query: 'independent aloof companion animal',
    expected: ['pets/cats.md'],
    description: 'Conceptual description that never appears as a phrase.',
  },
  {
    id: 'paraphrase-astro',
    query: 'photographing stars at night with long exposure',
    expected: ['astro/astrophotography.md'],
    description: 'Stemmed-token overlap (photographing/exposures/stars).',
  },
  {
    id: 'discriminate-telescope',
    query: 'telescope aperture',
    expected: ['astro/telescopes.md'],
    description: 'Two keywords that never appear adjacent in the note.',
  },
  {
    id: 'paraphrase-dogs',
    query: 'loyal dog walking',
    expected: ['pets/dogs.md'],
    description: 'Light stemming must bridge dogs/dog and walks/walking.',
  },
];
