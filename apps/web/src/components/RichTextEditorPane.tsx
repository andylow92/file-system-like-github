import { useEffect, useMemo, useState } from 'react';

type BlockType = 'heading1' | 'heading2' | 'paragraph' | 'bullet' | 'quote' | 'code';

interface EditorBlock {
  id: string;
  type: BlockType;
  text: string;
}

interface RichTextEditorPaneProps {
  filePath: string | null;
  markdown: string;
  savedMarkdown: string;
  isDirty: boolean;
  onChangeMarkdown: (markdown: string) => void;
  onSave: () => void;
}

function createBlock(type: BlockType, text = ''): EditorBlock {
  return { id: crypto.randomUUID(), type, text };
}

function parseMarkdownToBlocks(markdown: string): EditorBlock[] {
  if (!markdown.trim()) {
    return [createBlock('paragraph', '')];
  }

  const lines = markdown.split('\n');
  const blocks: EditorBlock[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        blocks.push(createBlock('code', codeLines.join('\n')));
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('# ')) {
      blocks.push(createBlock('heading1', line.slice(2)));
      continue;
    }

    if (line.startsWith('## ')) {
      blocks.push(createBlock('heading2', line.slice(3)));
      continue;
    }

    if (line.startsWith('- ')) {
      blocks.push(createBlock('bullet', line.slice(2)));
      continue;
    }

    if (line.startsWith('> ')) {
      blocks.push(createBlock('quote', line.slice(2)));
      continue;
    }

    if (!line.trim()) {
      blocks.push(createBlock('paragraph', ''));
      continue;
    }

    blocks.push(createBlock('paragraph', line));
  }

  if (codeLines.length > 0) {
    blocks.push(createBlock('code', codeLines.join('\n')));
  }

  return blocks.length > 0 ? blocks : [createBlock('paragraph', '')];
}

function serializeBlocksToMarkdown(blocks: EditorBlock[]): string {
  const content = blocks
    .map((block) => {
      switch (block.type) {
        case 'heading1':
          return `# ${block.text}`.trimEnd();
        case 'heading2':
          return `## ${block.text}`.trimEnd();
        case 'bullet':
          return `- ${block.text}`.trimEnd();
        case 'quote':
          return `> ${block.text}`.trimEnd();
        case 'code':
          return `\`\`\`\n${block.text}\n\`\`\``;
        case 'paragraph':
        default:
          return block.text;
      }
    })
    .join('\n');

  return content.replace(/\n{3,}/g, '\n\n').trim();
}

const blockTypeOptions: Array<{ label: string; value: BlockType }> = [
  { label: 'Text', value: 'paragraph' },
  { label: 'H1', value: 'heading1' },
  { label: 'H2', value: 'heading2' },
  { label: 'Bullet', value: 'bullet' },
  { label: 'Quote', value: 'quote' },
  { label: 'Code', value: 'code' },
];

export function RichTextEditorPane({
  filePath,
  markdown,
  savedMarkdown,
  isDirty,
  onChangeMarkdown,
  onSave,
}: RichTextEditorPaneProps) {
  const [blocks, setBlocks] = useState<EditorBlock[]>(() => parseMarkdownToBlocks(markdown));

  useEffect(() => {
    setBlocks(parseMarkdownToBlocks(markdown));
  }, [filePath, markdown]);

  const serializedMarkdown = useMemo(() => serializeBlocksToMarkdown(blocks), [blocks]);

  useEffect(() => {
    onChangeMarkdown(serializedMarkdown);
  }, [onChangeMarkdown, serializedMarkdown]);

  if (!filePath) {
    return <p className="empty-state">Select a markdown file to edit.</p>;
  }

  return (
    <div className="editor-pane">
      <header className="editor-header">
        <div>
          <strong>{filePath}</strong>
          <p className="editor-meta">{isDirty ? 'Unsaved changes' : 'All changes saved'}</p>
        </div>
        <button type="button" onClick={onSave} disabled={!isDirty} className="save-button">
          Save {isDirty ? '•' : ''}
        </button>
      </header>

      <div className="rich-editor" role="group" aria-label="Rich text editor">
        {blocks.length === 0 ? <p className="empty-state">No content to edit.</p> : null}
        {blocks.map((block, index) => (
          <div key={block.id} className="editor-row">
            <select
              aria-label="Block style"
              value={block.type}
              onChange={(event) => {
                const nextType = event.target.value as BlockType;
                setBlocks((current) =>
                  current.map((item) => (item.id === block.id ? { ...item, type: nextType } : item)),
                );
              }}
            >
              {blockTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <textarea
              value={block.text}
              rows={block.type === 'code' ? 5 : 2}
              className={block.type === 'code' ? 'block-input code' : 'block-input'}
              placeholder={block.type === 'paragraph' ? 'Type / for commands' : ''}
              onChange={(event) => {
                const nextText = event.target.value;
                setBlocks((current) =>
                  current.map((item) => (item.id === block.id ? { ...item, text: nextText } : item)),
                );
              }}
            />
            <button
              type="button"
              onClick={() => {
                setBlocks((current) => {
                  const next = [...current];
                  next.splice(index + 1, 0, createBlock('paragraph'));
                  return next;
                });
              }}
            >
              +
            </button>
          </div>
        ))}
      </div>

      {!savedMarkdown.trim() && !isDirty ? (
        <p className="empty-state">This file is empty. Start writing to add content.</p>
      ) : null}
    </div>
  );
}
