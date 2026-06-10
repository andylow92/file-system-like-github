import { describe, expect, it } from 'vitest';
import { listSkills, parseSkill } from '@repo/shared';

const FULL_SKILL = [
  '---',
  'type: skill',
  'name: Release a hotfix',
  'description: Ship a one-line fix to production safely.',
  'tags: [ops, release]',
  '---',
  '# Hotfix release',
  '',
  '1. Branch from the latest release tag.',
  '2. Cherry-pick the fix, run the full gate.',
].join('\n');

const MINIMAL_SKILL = [
  '---',
  'type: skill',
  '---',
  '# Review a pull request',
  '',
  'Read the diff before the description; check tests first.',
].join('\n');

describe('parseSkill', () => {
  it('returns null for notes that are not skills', () => {
    expect(parseSkill('plain.md', '# Just a note\nNo frontmatter type.')).toBeNull();
    expect(parseSkill('typed.md', '---\ntype: meeting\n---\n# Standup')).toBeNull();
    // A frontmatter list value for `type` is not a skill marker.
    expect(parseSkill('list.md', '---\ntype: [skill, other]\n---\nBody')).toBeNull();
  });

  it('uses declared name/description when present', () => {
    const skill = parseSkill('ops/hotfix.md', FULL_SKILL)!;
    expect(skill).toEqual({
      path: 'ops/hotfix.md',
      name: 'Release a hotfix',
      description: 'Ship a one-line fix to production safely.',
      tags: ['ops', 'release'],
    });
  });

  it('falls back to the first heading and first paragraph line', () => {
    const skill = parseSkill('skills/pr-review.md', MINIMAL_SKILL)!;
    expect(skill.name).toBe('Review a pull request');
    expect(skill.description).toBe('Read the diff before the description; check tests first.');
  });

  it('falls back to the filename when the body has no heading', () => {
    const skill = parseSkill('skills/triage-bugs.md', '---\ntype: skill\n---\nJust steps.')!;
    expect(skill.name).toBe('triage-bugs');
  });

  it('matches the type marker case-insensitively', () => {
    expect(parseSkill('s.md', '---\ntype: Skill\n---\n# S')).not.toBeNull();
  });
});

describe('listSkills', () => {
  const documents = [
    { path: 'ops/hotfix.md', content: FULL_SKILL },
    { path: 'skills/pr-review.md', content: MINIMAL_SKILL },
    { path: 'notes/plain.md', content: '# Not a skill\nNothing to see.' },
  ];

  it('keeps only skill notes, sorted by name', () => {
    const skills = listSkills(documents);
    expect(skills.map((skill) => skill.name)).toEqual([
      'Release a hotfix',
      'Review a pull request',
    ]);
  });

  it('filters by a case-insensitive substring over name/description/path/tags', () => {
    expect(listSkills(documents, 'HOTFIX').map((s) => s.path)).toEqual(['ops/hotfix.md']);
    expect(listSkills(documents, 'check tests').map((s) => s.path)).toEqual([
      'skills/pr-review.md',
    ]);
    expect(listSkills(documents, 'release').map((s) => s.path)).toEqual(['ops/hotfix.md']); // tag
    expect(listSkills(documents, 'no-such-skill')).toEqual([]);
  });
});
