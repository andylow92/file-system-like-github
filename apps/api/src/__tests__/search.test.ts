import { describe, expect, it } from 'vitest';

import { buildSnippet, findTextMatch } from '@repo/shared';

describe('findTextMatch', () => {
  it('returns null for an empty query or no match', () => {
    expect(findTextMatch('hello world', '')).toBeNull();
    expect(findTextMatch('hello world', 'xyz')).toBeNull();
  });

  it('reports the first matching line and total occurrences', () => {
    const content = ['alpha beta', 'gamma', 'beta beta'].join('\n');
    const match = findTextMatch(content, 'beta');
    expect(match).not.toBeNull();
    expect(match?.line).toBe(1);
    expect(match?.count).toBe(3);
  });

  it('is case-insensitive', () => {
    const match = findTextMatch('The Quick Brown Fox', 'quick');
    expect(match?.line).toBe(1);
    expect(match?.count).toBe(1);
  });
});

describe('buildSnippet', () => {
  it('returns the whole line when short', () => {
    expect(buildSnippet('a short line', 'short')).toBe('a short line');
  });

  it('truncates and centers around the match for long lines', () => {
    const line = `${'x'.repeat(200)} needle ${'y'.repeat(200)}`;
    const snippet = buildSnippet(line, 'needle', 60);
    expect(snippet.length).toBeLessThanOrEqual(64);
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
  });
});
