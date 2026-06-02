import { describe, expect, it } from 'vitest';

import {
  extractBlockAnchors,
  extractBlockAnchorsFromNote,
  findBlock,
  stripAnchor,
  upsertBlockAnchor,
} from '@repo/shared';

describe('extractBlockAnchors', () => {
  it('finds a trailing anchor on a paragraph line', () => {
    const body = 'This is a claim. ^claim-1\n\nAnd another paragraph.';
    expect(extractBlockAnchors(body)).toEqual([
      { id: 'claim-1', line: 1, text: 'This is a claim.' },
    ]);
  });

  it('finds anchors on list items and headings', () => {
    const body = ['## Section ^sec-a', '', '- task one ^t1', '- task two ^t2', ''].join('\n');
    const anchors = extractBlockAnchors(body);
    expect(anchors.map((a) => a.id)).toEqual(['sec-a', 't1', 't2']);
    expect(anchors[0].line).toBe(1);
    expect(anchors[1].line).toBe(3);
    expect(anchors[2].line).toBe(4);
    expect(anchors[0].text).toBe('## Section');
  });

  it('ignores anchors inside fenced code blocks', () => {
    const body = [
      'Real anchor here. ^real',
      '',
      '```',
      'fake anchor in code ^nope',
      '```',
      '',
      'Another real one ^real-2',
    ].join('\n');
    expect(extractBlockAnchors(body).map((a) => a.id)).toEqual(['real', 'real-2']);
  });

  it('ignores anchors inside tilde fences too', () => {
    const body = ['~~~', 'still code ^nope', '~~~', 'after ^after'].join('\n');
    expect(extractBlockAnchors(body).map((a) => a.id)).toEqual(['after']);
  });

  it('rejects ids with disallowed characters', () => {
    // The trailing token must match [A-Za-z0-9-]+; an underscore should not parse.
    const body = 'paragraph ^bad_id';
    expect(extractBlockAnchors(body)).toEqual([]);
  });

  it('extractBlockAnchorsFromNote scans the body after stripping frontmatter', () => {
    const raw = ['---', 'title: T', '---', 'Body. ^x'].join('\n');
    expect(extractBlockAnchorsFromNote(raw).map((a) => a.id)).toEqual(['x']);
  });
});

describe('findBlock', () => {
  it('returns the paragraph carrying an anchor', () => {
    const body = ['First paragraph.', '', 'Second one. ^x', 'continued on next line.', ''].join(
      '\n',
    );
    const block = findBlock(body, 'x');
    expect(block).not.toBeNull();
    expect(block?.startLine).toBe(3);
    expect(block?.endLine).toBe(4);
    expect(block?.text).toBe('Second one.\ncontinued on next line.');
  });

  it('returns a list item plus its indented continuations', () => {
    const body = [
      '- item one',
      '- item two ^a',
      '  detail line',
      '  more detail',
      '- item three',
    ].join('\n');
    const block = findBlock(body, 'a');
    expect(block?.startLine).toBe(2);
    expect(block?.endLine).toBe(4);
    expect(block?.text).toBe('- item two\n  detail line\n  more detail');
  });

  it('returns the heading section under an anchored heading', () => {
    const body = ['# Top', '', '## Tasks ^sec', '- a', '- b', '', '## Next', 'tail'].join('\n');
    const block = findBlock(body, 'sec');
    expect(block?.startLine).toBe(3);
    expect(block?.endLine).toBe(6);
    expect(block?.text).toBe('## Tasks\n- a\n- b\n');
  });

  it('returns null when the anchor is not present', () => {
    expect(findBlock('Some body.', 'missing')).toBeNull();
  });

  it('does not look inside fenced code for the anchor', () => {
    const body = ['```', 'paragraph ^x', '```', '', 'real ^x'].join('\n');
    const block = findBlock(body, 'x');
    expect(block?.startLine).toBe(5);
    expect(block?.text).toBe('real');
  });
});

describe('upsertBlockAnchor', () => {
  it('adds a generated id to a line that has none', () => {
    const result = upsertBlockAnchor('first line\nsecond', undefined, 1, {
      generateId: () => 'gen-1',
    });
    expect(result.id).toBe('gen-1');
    expect(result.body).toBe('first line ^gen-1\nsecond');
  });

  it('uses the provided id when given', () => {
    const result = upsertBlockAnchor('paragraph', 'my-id', 1);
    expect(result.id).toBe('my-id');
    expect(result.body).toBe('paragraph ^my-id');
  });

  it('is idempotent when the line already carries the same id', () => {
    const body = 'paragraph ^my-id\nnext';
    const result = upsertBlockAnchor(body, 'my-id', 1);
    expect(result.body).toBe(body);
    expect(result.id).toBe('my-id');
  });

  it('preserves an existing anchor when none is requested', () => {
    const body = 'paragraph ^already-there';
    const result = upsertBlockAnchor(body, undefined, 1, { generateId: () => 'unused' });
    expect(result.body).toBe(body);
    expect(result.id).toBe('already-there');
  });

  it('replaces an existing anchor when a different id is requested', () => {
    const result = upsertBlockAnchor('text ^old', 'new', 1);
    expect(result.body).toBe('text ^new');
    expect(result.id).toBe('new');
  });

  it('throws on an out-of-range line', () => {
    expect(() => upsertBlockAnchor('one\ntwo', 'x', 5)).toThrow(/out of range/);
  });

  it('throws on an invalid id', () => {
    expect(() => upsertBlockAnchor('one', 'bad id!', 1)).toThrow(/match/);
  });
});

describe('stripAnchor', () => {
  it('removes a trailing anchor token', () => {
    expect(stripAnchor('hello ^id')).toBe('hello');
  });

  it('leaves lines without an anchor untouched', () => {
    expect(stripAnchor('hello world')).toBe('hello world');
  });
});
