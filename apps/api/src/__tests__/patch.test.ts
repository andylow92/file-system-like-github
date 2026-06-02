import { describe, expect, it } from 'vitest';

import {
  BlockNotFoundError,
  SectionNotFoundError,
  applyAppend,
  applyPatchOp,
  applyPrepend,
  replaceBlock,
  replaceSection,
} from '@repo/shared';

describe('applyAppend', () => {
  it('returns the text alone when content is empty', () => {
    const result = applyAppend('', 'first line');
    expect(result.content).toBe('first line');
    expect(result.changed).toBe(true);
  });

  it('inserts a newline separator when content lacks a trailing newline', () => {
    expect(applyAppend('# Title\nbody', 'more').content).toBe('# Title\nbody\nmore');
  });

  it('does not double up newlines when content already ends with one', () => {
    expect(applyAppend('# Title\nbody\n', 'more').content).toBe('# Title\nbody\nmore');
  });

  it('preserves trailing newlines inside the appended text', () => {
    expect(applyAppend('a', 'b\n').content).toBe('a\nb\n');
  });
});

describe('applyPrepend', () => {
  it('returns the text alone when content is empty', () => {
    expect(applyPrepend('', 'hello').content).toBe('hello');
  });

  it('inserts the text at the start when there is no frontmatter', () => {
    expect(applyPrepend('body', 'top').content).toBe('top\nbody');
  });

  it('inserts after the frontmatter block so metadata stays at the top', () => {
    const raw = '---\ntitle: Hi\n---\n\nbody\n';
    const result = applyPrepend(raw, '> status: WIP');
    expect(result.content).toBe('---\ntitle: Hi\n---\n> status: WIP\n\nbody\n');
    expect(result.changed).toBe(true);
  });

  it('does not double newlines when the inserted text already ends with one', () => {
    expect(applyPrepend('body', 'top\n').content).toBe('top\nbody');
  });
});

describe('replaceSection', () => {
  const note = ['# Doc', '', '## Tasks', '- old', '', '## Next', 'tail', ''].join('\n');

  it('replaces only the body under the matching heading, leaving siblings intact', () => {
    const result = replaceSection(note, '## Tasks', '- a\n- b');
    expect(result.content).toBe(
      ['# Doc', '', '## Tasks', '- a', '- b', '## Next', 'tail', ''].join('\n'),
    );
    expect(result.changed).toBe(true);
  });

  it('stops at headings of equal or higher level', () => {
    const nested = ['## Tasks', '- a', '### sub', 'detail', '## Next', 'tail'].join('\n');
    const result = replaceSection(nested, '## Tasks', '- new');
    expect(result.content).toBe(['## Tasks', '- new', '## Next', 'tail'].join('\n'));
  });

  it('extends to EOF when there is no following heading at the same level', () => {
    const tail = '## Tasks\n- old\n';
    const result = replaceSection(tail, '## Tasks', '- new\n');
    expect(result.content).toBe('## Tasks\n- new\n');
  });

  it('produces an empty section when body is an empty string', () => {
    const result = replaceSection(note, '## Tasks', '');
    expect(result.content).toBe(['# Doc', '', '## Tasks', '## Next', 'tail', ''].join('\n'));
  });

  it('throws SectionNotFoundError when the heading is missing', () => {
    expect(() => replaceSection(note, '## Missing', 'x')).toThrow(SectionNotFoundError);
  });

  it('rejects headings without leading `#`s', () => {
    expect(() => replaceSection(note, 'Tasks', 'x')).toThrow(/must start with 1-6 `#` characters/);
  });
});

describe('replaceBlock', () => {
  it('replaces a paragraph block and re-attaches the anchor', () => {
    const note = 'First paragraph. ^claim-1\n\nNext.';
    const result = replaceBlock(note, 'claim-1', 'Revised claim text.');
    expect(result.content).toBe('Revised claim text. ^claim-1\n\nNext.');
    expect(result.changed).toBe(true);
  });

  it('replaces a list item including its indented continuations', () => {
    const note = ['- item one', '- item two ^a', '  detail', '  more', '- item three'].join('\n');
    const result = replaceBlock(note, 'a', '- item two updated');
    expect(result.content).toBe(['- item one', '- item two updated ^a', '- item three'].join('\n'));
  });

  it('replaces a heading section, keeping siblings intact', () => {
    const note = ['# Doc', '', '## Tasks ^sec', '- old', '', '## Next', 'tail'].join('\n');
    const result = replaceBlock(note, 'sec', '## Tasks\n- new');
    expect(result.content).toBe(
      ['# Doc', '', '## Tasks ^sec', '- new', '## Next', 'tail'].join('\n'),
    );
  });

  it('preserves the frontmatter and works in body coordinates', () => {
    const note = '---\ntitle: T\n---\n\nbody. ^x\nafter';
    const result = replaceBlock(note, 'x', 'new body.\nafter');
    expect(result.content).toBe('---\ntitle: T\n---\n\nnew body. ^x\nafter');
  });

  it('respects an anchor the caller already included in the body', () => {
    const result = replaceBlock('original. ^x', 'x', 'new body ^x');
    expect(result.content).toBe('new body ^x');
  });

  it('throws BlockNotFoundError when the anchor is missing', () => {
    expect(() => replaceBlock('no anchor here', 'missing', 'x')).toThrow(BlockNotFoundError);
  });
});

describe('applyPatchOp', () => {
  it('routes to the matching transform', () => {
    expect(applyPatchOp('a', { type: 'append', text: 'b' }).content).toBe('a\nb');
    expect(applyPatchOp('a', { type: 'prepend', text: 'b' }).content).toBe('b\na');
    expect(
      applyPatchOp('## H\nold', { type: 'replace_section', heading: '## H', body: 'new' }).content,
    ).toBe('## H\nnew');
    expect(
      applyPatchOp('paragraph ^x\n\nafter', {
        type: 'replace_block',
        blockId: 'x',
        body: 'fresh',
      }).content,
    ).toBe('fresh ^x\n\nafter');
  });
});
