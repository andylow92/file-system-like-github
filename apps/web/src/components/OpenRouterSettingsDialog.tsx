import { useEffect, useRef, useState } from 'react';
import { DEFAULT_OPENROUTER_MODEL, SUGGESTED_OPENROUTER_MODELS } from '../openrouter/storage';

interface OpenRouterSettingsDialogProps {
  open: boolean;
  initialApiKey: string;
  initialModel: string;
  onClose: () => void;
  onSave: (next: { apiKey: string; model: string }) => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function OpenRouterSettingsDialog({
  open,
  initialApiKey,
  initialModel,
  onClose,
  onSave,
}: OpenRouterSettingsDialogProps) {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [model, setModel] = useState(initialModel || DEFAULT_OPENROUTER_MODEL);
  const [showKey, setShowKey] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setApiKey(initialApiKey);
    setModel(initialModel || DEFAULT_OPENROUTER_MODEL);
    setShowKey(false);
  }, [open, initialApiKey, initialModel]);

  useEffect(() => {
    if (!open) {
      return;
    }

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusables?.[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!nodes.length) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || active === dialogRef.current) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ apiKey: apiKey.trim(), model: model.trim() || DEFAULT_OPENROUTER_MODEL });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-dialog modal-info openrouter-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="openrouter-settings-title"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="openrouter-settings-title">OpenRouter settings</h2>
        <p>
          Used by the “Fix Format” button. Your key is stored in this browser only and sent directly
          to OpenRouter.
        </p>

        <form className="settings-form" onSubmit={handleSubmit}>
          <label className="settings-field">
            <span className="settings-label">API key</span>
            <div className="settings-key-row">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-or-..."
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="primary-btn settings-key-toggle"
                onClick={() => setShowKey((current) => !current)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="settings-hint">
              Get a key at{' '}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer noopener">
                openrouter.ai/keys
              </a>
              .
            </p>
          </label>

          <label className="settings-field">
            <span className="settings-label">Model</span>
            <input
              list="openrouter-model-suggestions"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={DEFAULT_OPENROUTER_MODEL}
              spellCheck={false}
              autoComplete="off"
            />
            <datalist id="openrouter-model-suggestions">
              {SUGGESTED_OPENROUTER_MODELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </datalist>
            <p className="settings-hint">
              Default: <code>{DEFAULT_OPENROUTER_MODEL}</code>. Any OpenRouter model id works.
            </p>
          </label>

          <div className="modal-actions">
            <button type="button" className="primary-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="save-button">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
