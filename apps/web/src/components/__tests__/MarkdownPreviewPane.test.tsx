import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownPreviewPane } from '../MarkdownPreviewPane';

describe('MarkdownPreviewPane', () => {
  afterEach(() => cleanup());

  it('sanitizes script tags from markdown input', () => {
    const { container } = render(
      <MarkdownPreviewPane
        filePath="README.md"
        markdown={'# Hello\n\n<script>alert("xss")</script>\n\nSafe text'}
      />,
    );

    const preview = container.querySelector('.markdown-preview');

    expect(preview).toBeInTheDocument();
    expect(preview?.querySelector('script')).not.toBeInTheDocument();
    expect(preview).toHaveTextContent('<script>alert("xss")</script>');
    expect(screen.getByRole('heading', { level: 1, name: 'Hello' })).toBeInTheDocument();
    expect(screen.getByText('Safe text')).toBeInTheDocument();
  });

  it('renders escaped html-like text and not executable image/link nodes', () => {
    const { container } = render(
      <MarkdownPreviewPane
        filePath="README.md"
        markdown={'> <img src="x" onerror="alert(1)">\n\n- <a href="#" onclick="alert(2)">link</a>'}
      />,
    );

    const preview = container.querySelector('.markdown-preview');

    expect(preview).toBeInTheDocument();
    expect(preview?.querySelector('script')).not.toBeInTheDocument();
    expect(preview?.querySelector('img')).not.toBeInTheDocument();
    expect(preview?.querySelector('a')).not.toBeInTheDocument();

    expect(preview).toHaveTextContent('<img src="x" onerror="alert(1)">');
    expect(preview).toHaveTextContent('<a href="#" onclick="alert(2)">link</a>');
  });
});

describe('MarkdownPreviewPane code block copy button', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const codeMarkdown = [
    '# Example',
    '',
    '```',
    'docker exec eigenoid-agent-librarian-agent \\',
    '  sqlite3 /home/eigenoid/.eigenoid/agents/librarian-agent/audit.db \\',
    '  "SELECT event_type, COUNT(*) FROM audit_events GROUP BY event_type ORDER BY 2 DESC"',
    '```',
  ].join('\n');

  it('renders a copy button for each fenced code block', () => {
    render(<MarkdownPreviewPane filePath="README.md" markdown={codeMarkdown} />);

    const button = screen.getByRole('button', { name: /copy code to clipboard/i });
    expect(button).toBeInTheDocument();
  });

  it('writes the raw (un-escaped) code content to the clipboard on click', async () => {
    render(<MarkdownPreviewPane filePath="README.md" markdown={codeMarkdown} />);

    const button = screen.getByRole('button', { name: /copy code to clipboard/i });
    fireEvent.click(button);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('docker exec eigenoid-agent-librarian-agent');
    expect(copied).toContain('SELECT event_type, COUNT(*) FROM audit_events');
    // Crucially the copied text must contain the raw characters, not HTML
    // entities — otherwise users would paste &quot; instead of " etc.
    expect(copied).not.toContain('&quot;');
    expect(copied).not.toContain('&amp;');
  });

  it('flips the button into a "Copied" state after a successful copy', async () => {
    render(<MarkdownPreviewPane filePath="README.md" markdown={codeMarkdown} />);

    const button = screen.getByRole('button', { name: /copy code to clipboard/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /copied to clipboard/i })).toBeInTheDocument(),
    );
  });

  it('renders raw code characters (not HTML entities) in the visible code block', () => {
    const md = '```\nconst x = "<div>" & 1\n```';
    render(<MarkdownPreviewPane filePath="README.md" markdown={md} />);

    // The user should see literal characters, not &lt; / &amp; entity strings.
    const codeEl = document.querySelector('.code-block code');
    expect(codeEl).not.toBeNull();
    expect(codeEl!.textContent).toBe('const x = "<div>" & 1');
  });
});
