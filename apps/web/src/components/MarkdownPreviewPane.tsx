interface MarkdownPreviewPaneProps {
  filePath: string | null;
  markdown: string;
}

type MarkdownNode =
  | { type: 'h1' | 'h2' | 'paragraph' | 'blockquote'; content: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; content: string }
  | { type: 'hr' };

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInlineFromEscaped(escaped: string): string {
  return escaped
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
}

function tokenizeMarkdown(markdown: string): string[] {
  return markdown.split('\n');
}

function parseMarkdown(lines: string[]): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length > 0) {
      nodes.push({ type: 'list', items: listBuffer });
      listBuffer = [];
    }
  };

  const flushCode = () => {
    if (codeBuffer.length > 0 || inCodeBlock) {
      nodes.push({ type: 'code', content: codeBuffer.join('\n') });
      codeBuffer = [];
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      flushList();
      if (inCodeBlock) {
        flushCode();
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    if (line.startsWith('- ')) {
      listBuffer.push(line.slice(2));
      continue;
    }

    flushList();

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      nodes.push({ type: 'hr' });
    } else if (line.startsWith('# ')) {
      nodes.push({ type: 'h1', content: line.slice(2) });
    } else if (line.startsWith('## ')) {
      nodes.push({ type: 'h2', content: line.slice(3) });
    } else if (line.startsWith('> ')) {
      nodes.push({ type: 'blockquote', content: line.slice(2) });
    } else {
      nodes.push({ type: 'paragraph', content: line });
    }
  }

  flushList();

  if (inCodeBlock || codeBuffer.length > 0) {
    flushCode();
  }

  return nodes;
}

function sanitizeMarkdownAst(nodes: MarkdownNode[]): MarkdownNode[] {
  return nodes.map((node) => {
    if (node.type === 'list') {
      return {
        ...node,
        items: node.items.map((item) => escapeHtml(item)),
      };
    }

    if (node.type === 'hr') {
      return node;
    }

    return {
      ...node,
      content: escapeHtml(node.content),
    };
  });
}

function renderHtml(nodes: MarkdownNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'h1':
          return `<h1>${renderInlineFromEscaped(node.content)}</h1>`;
        case 'h2':
          return `<h2>${renderInlineFromEscaped(node.content)}</h2>`;
        case 'blockquote':
          return `<blockquote>${renderInlineFromEscaped(node.content)}</blockquote>`;
        case 'paragraph':
          return `<p>${renderInlineFromEscaped(node.content)}</p>`;
        case 'code':
          return `<pre><code>${node.content}</code></pre>`;
        case 'list':
          return `<ul>${node.items
            .map((item) => `<li>${renderInlineFromEscaped(item)}</li>`)
            .join('')}</ul>`;
        case 'hr':
          return `<hr />`;
      }
    })
    .join('');
}

function renderMarkdown(markdown: string): string {
  const tokens = tokenizeMarkdown(markdown);
  const ast = parseMarkdown(tokens);
  const sanitizedAst = sanitizeMarkdownAst(ast);

  return renderHtml(sanitizedAst);
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
