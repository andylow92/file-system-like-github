import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

interface RichTextEditorPaneProps {
  filePath: string | null;
  markdown: string;
  savedMarkdown: string;
  isDirty: boolean;
  onChangeMarkdown: (markdown: string) => void;
  onSave: () => void;
}

type WrapFormat = 'bold' | 'italic' | 'code' | 'link';
type LineFormat = 'heading1' | 'heading2' | 'bullet' | 'quote';
type BlockFormat = 'codeblock';

const wrapSyntax: Record<WrapFormat, { prefix: string; suffix: string; placeholder: string }> = {
  bold: { prefix: '**', suffix: '**', placeholder: 'bold text' },
  italic: { prefix: '*', suffix: '*', placeholder: 'italic text' },
  code: { prefix: '`', suffix: '`', placeholder: 'code' },
  link: { prefix: '[', suffix: '](https://)', placeholder: 'link text' },
};

const linePrefix: Record<LineFormat, string> = {
  heading1: '# ',
  heading2: '## ',
  bullet: '- ',
  quote: '> ',
};

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function RichTextEditorPane({
  filePath,
  markdown,
  savedMarkdown,
  isDirty,
  onChangeMarkdown,
  onSave,
}: RichTextEditorPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(markdown);

  useEffect(() => {
    setValue(markdown);
  }, [filePath, markdown]);

  const commitChange = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      onChangeMarkdown(nextValue);
    },
    [onChangeMarkdown],
  );

  const applyWrap = useCallback(
    (format: WrapFormat) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { selectionStart, selectionEnd } = textarea;
      const { prefix, suffix, placeholder } = wrapSyntax[format];
      const current = textarea.value;
      const selected = current.slice(selectionStart, selectionEnd) || placeholder;
      const next =
        current.slice(0, selectionStart) + prefix + selected + suffix + current.slice(selectionEnd);

      commitChange(next);

      const caretStart = selectionStart + prefix.length;
      const caretEnd = caretStart + selected.length;
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(caretStart, caretEnd);
      });
    },
    [commitChange],
  );

  const applyLine = useCallback(
    (format: LineFormat) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { selectionStart, selectionEnd } = textarea;
      const current = textarea.value;
      const lineStart = current.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1;
      const rawLineEnd = current.indexOf('\n', selectionEnd);
      const lineEnd = rawLineEnd === -1 ? current.length : rawLineEnd;

      const prefix = linePrefix[format];
      const block = current.slice(lineStart, lineEnd);
      const transformed = block
        .split('\n')
        .map((line) => {
          const stripped = line.replace(/^(#{1,6}\s|-\s|>\s)/, '');
          return prefix + stripped;
        })
        .join('\n');

      const next = current.slice(0, lineStart) + transformed + current.slice(lineEnd);
      commitChange(next);

      const delta = transformed.length - block.length;
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(selectionStart + prefix.length, selectionEnd + delta);
      });
    },
    [commitChange],
  );

  const applyBlock = useCallback(
    (format: BlockFormat) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { selectionStart, selectionEnd } = textarea;
      const current = textarea.value;
      const selected = current.slice(selectionStart, selectionEnd) || 'code here';

      const opening = format === 'codeblock' ? '```\n' : '';
      const closing = format === 'codeblock' ? '\n```' : '';
      const next =
        current.slice(0, selectionStart) +
        opening +
        selected +
        closing +
        current.slice(selectionEnd);

      commitChange(next);

      const caretStart = selectionStart + opening.length;
      const caretEnd = caretStart + selected.length;
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(caretStart, caretEnd);
      });
    },
    [commitChange],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isMod = event.metaKey || event.ctrlKey;
    if (!isMod) return;

    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      applyWrap('bold');
    } else if (key === 'i') {
      event.preventDefault();
      applyWrap('italic');
    } else if (key === 'k') {
      event.preventDefault();
      applyWrap('link');
    } else if (key === 'e') {
      event.preventDefault();
      applyWrap('code');
    }
  }

  const stats = useMemo(() => {
    return {
      words: countWords(value),
      chars: value.length,
      lines: value ? value.split('\n').length : 0,
    };
  }, [value]);

  if (!filePath) {
    return <p className="empty-state">Select a markdown file to edit.</p>;
  }

  return (
    <div className="editor-pane">
      <header className="editor-header">
        <div>
          <div className="editor-title">{filePath}</div>
          <p className={isDirty ? 'editor-meta is-dirty' : 'editor-meta'}>
            {isDirty ? 'Unsaved changes' : 'All changes saved'}
          </p>
        </div>
        <button type="button" onClick={onSave} disabled={!isDirty} className="save-button">
          Save
        </button>
      </header>

      <div className="editor-surface" role="group" aria-label="Markdown editor">
        <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => applyLine('heading1')}
            title="Heading 1"
            aria-label="Heading 1"
          >
            H1
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => applyLine('heading2')}
            title="Heading 2"
            aria-label="Heading 2"
          >
            H2
          </button>
          <span className="toolbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="toolbar-btn bold"
            onClick={() => applyWrap('bold')}
            title="Bold (⌘B)"
            aria-label="Bold"
          >
            B
          </button>
          <button
            type="button"
            className="toolbar-btn italic"
            onClick={() => applyWrap('italic')}
            title="Italic (⌘I)"
            aria-label="Italic"
          >
            I
          </button>
          <button
            type="button"
            className="toolbar-btn mono"
            onClick={() => applyWrap('code')}
            title="Inline code (⌘E)"
            aria-label="Inline code"
          >
            {'</>'}
          </button>
          <span className="toolbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => applyLine('bullet')}
            title="Bulleted list"
            aria-label="Bulleted list"
          >
            •
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => applyLine('quote')}
            title="Quote"
            aria-label="Quote"
          >
            "
          </button>
          <button
            type="button"
            className="toolbar-btn mono"
            onClick={() => applyBlock('codeblock')}
            title="Code block"
            aria-label="Code block"
          >
            {'{ }'}
          </button>
          <span className="toolbar-sep" aria-hidden="true" />
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => applyWrap('link')}
            title="Link (⌘K)"
            aria-label="Link"
          >
            ↗
          </button>
        </div>

        <textarea
          ref={textareaRef}
          className="markdown-textarea"
          aria-label="Markdown source"
          value={value}
          spellCheck
          placeholder="# Start writing…"
          onKeyDown={handleKeyDown}
          onChange={(event) => commitChange(event.target.value)}
        />

        <div className="editor-footer" aria-live="off">
          <span>
            {stats.words} {stats.words === 1 ? 'word' : 'words'} · {stats.chars}{' '}
            {stats.chars === 1 ? 'char' : 'chars'} · {stats.lines}{' '}
            {stats.lines === 1 ? 'line' : 'lines'}
          </span>
          <span>markdown</span>
        </div>
      </div>

      {!savedMarkdown.trim() && !isDirty ? (
        <p className="empty-state">This file is empty. Start writing to add content.</p>
      ) : null}
    </div>
  );
}
