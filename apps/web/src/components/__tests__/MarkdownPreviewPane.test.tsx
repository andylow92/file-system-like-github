import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownPreviewPane } from '../MarkdownPreviewPane';

describe('MarkdownPreviewPane', () => {
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
