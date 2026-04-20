import { useState } from 'react';

interface EditorPaneProps {
  initialValue: string;
  onSave: (content: string) => Promise<void> | void;
}

export function EditorPane({ initialValue, onSave }: EditorPaneProps) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  async function handleSave() {
    setStatus('saving');
    await onSave(value);
    setStatus('saved');
  }

  return (
    <div>
      <textarea
        aria-label="Markdown editor"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={12}
      />
      <div>
        <button type="button" onClick={handleSave} disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving...' : 'Save'}
        </button>
        {status === 'saved' ? <span>Saved</span> : null}
      </div>
    </div>
  );
}
