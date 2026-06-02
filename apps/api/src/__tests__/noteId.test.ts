import { describe, expect, it } from 'vitest';

import { ensureNoteId, findNoteId } from '@repo/shared';

describe('findNoteId', () => {
  it('returns the id from frontmatter', () => {
    const raw = ['---', 'id: abc-123', 'title: T', '---', 'body'].join('\n');
    expect(findNoteId(raw)).toBe('abc-123');
  });

  it('returns undefined when there is no frontmatter', () => {
    expect(findNoteId('# Title\nbody')).toBeUndefined();
  });

  it('returns undefined when frontmatter omits id', () => {
    const raw = ['---', 'title: T', '---', 'body'].join('\n');
    expect(findNoteId(raw)).toBeUndefined();
  });
});

describe('ensureNoteId', () => {
  it('creates a fresh frontmatter block when none exists', () => {
    const raw = '# Title\nbody\n';
    const result = ensureNoteId(raw, 'fresh-id');
    expect(result.changed).toBe(true);
    expect(result.id).toBe('fresh-id');
    expect(result.content).toBe('---\nid: fresh-id\n---\n\n# Title\nbody\n');
  });

  it('inserts id into an existing frontmatter block at the top', () => {
    const raw = ['---', 'title: T', '---', 'body'].join('\n');
    const result = ensureNoteId(raw, 'new-id');
    expect(result.changed).toBe(true);
    expect(result.id).toBe('new-id');
    expect(result.content).toBe('---\nid: new-id\ntitle: T\n---\nbody');
  });

  it('returns the existing id and leaves the file untouched (idempotent)', () => {
    const raw = ['---', 'id: keep', 'title: T', '---', 'body'].join('\n');
    const result = ensureNoteId(raw, 'ignored');
    expect(result.changed).toBe(false);
    expect(result.id).toBe('keep');
    expect(result.content).toBe(raw);
  });

  it('handles an empty body', () => {
    const result = ensureNoteId('', 'id-1');
    expect(result.changed).toBe(true);
    expect(result.content).toBe('---\nid: id-1\n---\n');
  });

  it('throws when the supplied id is empty', () => {
    expect(() => ensureNoteId('body', '')).toThrow(/cannot be empty/);
  });

  it('rejects ids that would break the YAML frontmatter', () => {
    // A newline could inject sibling keys (`id: x\nmalicious: true` becomes a
    // second YAML line); `:` / quotes / spaces / underscores fall outside the
    // safe charset too. `---` is fine — it is spliced inline as `id: ---`,
    // which does not terminate the frontmatter block.
    expect(() => ensureNoteId('body', 'x\nmalicious: true')).toThrow(/match \[A-Za-z0-9-\]/);
    expect(() => ensureNoteId('body', 'has space')).toThrow(/match/);
    expect(() => ensureNoteId('body', 'under_score')).toThrow(/match/);
    expect(() => ensureNoteId('body', 'has:colon')).toThrow(/match/);
    expect(() => ensureNoteId('body', 'has"quote')).toThrow(/match/);
  });

  it('accepts a UUID-shaped id', () => {
    const result = ensureNoteId('body', '550e8400-e29b-41d4-a716-446655440000');
    expect(result.changed).toBe(true);
    expect(result.id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });
});
