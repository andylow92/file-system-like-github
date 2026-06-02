import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownPreviewPane } from '../MarkdownPreviewPane';

describe('MarkdownPreviewPane rich rendering', () => {
  afterEach(() => cleanup());

  it('renders GFM tables', () => {
    const md = ['| A | B |', '| - | - |', '| 1 | 2 |'].join('\n');
    const { container } = render(<MarkdownPreviewPane filePath="t.md" markdown={md} />);

    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('renders task list checkboxes', () => {
    const md = ['- [x] done', '- [ ] todo'].join('\n');
    const { container } = render(<MarkdownPreviewPane filePath="t.md" markdown={md} />);

    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
  });

  it('renders deeper headings (h3) the hand-rolled parser could not', () => {
    render(<MarkdownPreviewPane filePath="t.md" markdown={'### Deep heading'} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Deep heading' })).toBeInTheDocument();
  });

  it('strips YAML frontmatter and surfaces tags as chips', () => {
    const md = ['---', 'title: Hello', 'tags: [alpha, beta]', '---', '# Body'].join('\n');
    const { container } = render(<MarkdownPreviewPane filePath="t.md" markdown={md} />);

    expect(container).not.toHaveTextContent('title: Hello');
    expect(container).not.toHaveTextContent('---');
    expect(screen.getByText('#alpha')).toBeInTheDocument();
    expect(screen.getByText('#beta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Body' })).toBeInTheDocument();
  });

  it('renders markdown links as safe external anchors', () => {
    const { container } = render(
      <MarkdownPreviewPane filePath="t.md" markdown={'[site](https://example.com)'} />,
    );

    const anchor = container.querySelector('a');
    expect(anchor).toHaveAttribute('href', 'https://example.com');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders resolved wikilinks that navigate on click', () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <MarkdownPreviewPane
        filePath="t.md"
        markdown={'See [[Target]] here.'}
        allPaths={['notes/Target.md']}
        onNavigate={onNavigate}
      />,
    );

    const link = container.querySelector('a.wikilink');
    expect(link).toBeInTheDocument();
    expect(link).not.toHaveClass('wikilink--unresolved');

    fireEvent.click(link!);
    expect(onNavigate).toHaveBeenCalledWith('notes/Target.md');
  });

  it('marks unresolved wikilinks and does not navigate', () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <MarkdownPreviewPane
        filePath="t.md"
        markdown={'See [[Missing]].'}
        allPaths={['notes/Other.md']}
        onNavigate={onNavigate}
      />,
    );

    const link = container.querySelector('a.wikilink');
    expect(link).toHaveClass('wikilink--unresolved');
    fireEvent.click(link!);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
