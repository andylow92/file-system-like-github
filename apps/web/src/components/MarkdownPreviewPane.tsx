interface MarkdownPreviewPaneProps {
  filePath: string | null;
  markdown: string;
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const html: string[] = [];
  let inList = false;
  let inCodeBlock = false;
  const closeListIfNeeded = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      closeListIfNeeded();
      if (inCodeBlock) {
        html.push('</code></pre>');
      } else {
        html.push('<pre><code>');
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      html.push(`${line.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}\n`);
      continue;
    }

    if (!line.trim()) {
      closeListIfNeeded();
      continue;
    }

    if (line.startsWith('## ')) {
      closeListIfNeeded();
      html.push(`<h2>${line.slice(3)}</h2>`);
      continue;
    }

    if (line.startsWith('# ')) {
      closeListIfNeeded();
      html.push(`<h1>${line.slice(2)}</h1>`);
      continue;
    }

    if (line.startsWith('- ')) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${line.slice(2)}</li>`);
      continue;
    }

    if (line.startsWith('> ')) {
      closeListIfNeeded();
      html.push(`<blockquote>${line.slice(2)}</blockquote>`);
      continue;
    }

    closeListIfNeeded();
    html.push(`<p>${line}</p>`);
  }

  closeListIfNeeded();

  return html.join('');
}

export function MarkdownPreviewPane({ filePath, markdown }: MarkdownPreviewPaneProps) {
  if (!filePath) {
    return <p className="empty-state">Select a markdown file to preview.</p>;
  }

  if (!markdown.trim()) {
    return <p className="empty-state">This file has no content yet.</p>;
  }

  return (
    <article
      className="markdown-preview github-markdown"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  );
}
