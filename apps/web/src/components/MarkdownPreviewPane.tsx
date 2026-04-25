import { useState } from 'react';

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

    // Code blocks render via a React text node, which encodes for display
    // automatically. Escaping here would surface visible &lt; / &gt; entities
    // in the preview AND in the copied clipboard text.
    if (node.type === 'code') {
      return node;
    }

    return {
      ...node,
      content: escapeHtml(node.content),
    };
  });
}

interface CodeBlockProps {
  // The raw, un-escaped code content. Rendered as plain text (React handles
  // the encoding) and copied verbatim to the clipboard.
  content: string;
}

function CodeBlock({ content }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        // Fallback for older browsers / non-secure contexts.
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Swallow — the user can still select-and-copy manually.
    }
  }

  return (
    <div className="code-block">
      <button
        type="button"
        className={copied ? 'code-copy-btn is-copied' : 'code-copy-btn'}
        onClick={handleCopy}
        aria-label={copied ? 'Copied to clipboard' : 'Copy code to clipboard'}
        title={copied ? 'Copied' : 'Copy'}
      >
        {copied ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3.5 8.5 6.5 11.5 12.5 5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect
              x="5"
              y="5"
              width="8"
              height="9"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M3.5 10.5V3.5A1.5 1.5 0 0 1 5 2h6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <span className="code-copy-label">{copied ? 'Copied' : 'Copy'}</span>
      </button>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  );
}

function renderNodes(nodes: MarkdownNode[]) {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'h1':
        return (
          <h1
            key={index}
            dangerouslySetInnerHTML={{ __html: renderInlineFromEscaped(node.content) }}
          />
        );
      case 'h2':
        return (
          <h2
            key={index}
            dangerouslySetInnerHTML={{ __html: renderInlineFromEscaped(node.content) }}
          />
        );
      case 'blockquote':
        return (
          <blockquote
            key={index}
            dangerouslySetInnerHTML={{ __html: renderInlineFromEscaped(node.content) }}
          />
        );
      case 'paragraph':
        return (
          <p
            key={index}
            dangerouslySetInnerHTML={{ __html: renderInlineFromEscaped(node.content) }}
          />
        );
      case 'list':
        return (
          <ul key={index}>
            {node.items.map((item, itemIndex) => (
              <li
                key={itemIndex}
                dangerouslySetInnerHTML={{ __html: renderInlineFromEscaped(item) }}
              />
            ))}
          </ul>
        );
      case 'code':
        // The code content is intentionally NOT escaped here: React's child
        // text rendering handles the encoding, and the copy button needs the
        // raw string verbatim.
        return <CodeBlock key={index} content={node.content} />;
      case 'hr':
        return <hr key={index} />;
    }
  });
}

export function MarkdownPreviewPane({ filePath, markdown }: MarkdownPreviewPaneProps) {
  if (!filePath) {
    return <p className="empty-state">Select a markdown file to preview.</p>;
  }

  if (!markdown.trim()) {
    return <p className="empty-state">This file has no content yet.</p>;
  }

  const tokens = tokenizeMarkdown(markdown);
  const ast = parseMarkdown(tokens);
  const sanitizedAst = sanitizeMarkdownAst(ast);

  return <article className="markdown-preview github-markdown">{renderNodes(sanitizedAst)}</article>;
}
