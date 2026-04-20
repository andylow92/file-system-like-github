import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreviewPane } from '../MarkdownPreviewPane';

describe('MarkdownPreviewPane', () => {
  it('sanitizes script tags from markdown input', () => {
    render(
      <MarkdownPreviewPane
        filePath="README.md"
        markdown={'# Hello\n\n<script>alert("xss")</script>\n\nSafe text'}
      />,
    );

    const preview = document.querySelector('.markdown-preview');
    expect(preview).toBeInTheDocument();
    expect(preview?.querySelector('script')).not.toBeInTheDocument();
    expect(preview?.innerHTML).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(screen.getByRole('heading', { level: 1, name: 'Hello' })).toBeInTheDocument();
    expect(screen.getByText('Safe text')).toBeInTheDocument();
  });

  it('escapes inline event handlers in non-code content', () => {
    render(
      <MarkdownPreviewPane
        filePath="README.md"
        markdown={'> <img src="x" onerror="alert(1)">\n\n- <a href="#" onclick="alert(2)">link</a>'}
      />,
    );

    const preview = document.querySelector('.markdown-preview');

    expect(preview?.querySelector('img')).not.toBeInTheDocument();
    expect(preview?.querySelector('a')).not.toBeInTheDocument();
    expect(preview?.innerHTML).toContain('&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
    expect(preview?.innerHTML).toContain(
      '&lt;a href=&quot;#&quot; onclick=&quot;alert(2)&quot;&gt;link&lt;/a&gt;',
    );
  });
});
