import { useEffect, useRef } from 'react';

interface ModalDialogProps {
  open: boolean;
  title: string;
  description: string;
  variant?: 'info' | 'error' | 'destructive';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalDialog({
  open,
  title,
  description,
  variant = 'info',
  confirmLabel = 'Close',
  cancelLabel,
  onConfirm,
  onClose,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables?.length) {
      focusables[0].focus();
    } else {
      dialogRef.current?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!dialogRef.current) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const nodes = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
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

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={`modal-dialog modal-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-description"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="modal-title">{title}</h2>
        <p id="modal-description">{description}</p>
        <div className="modal-actions">
          {cancelLabel ? (
            <button type="button" className="primary-btn" onClick={onClose}>
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={variant === 'destructive' ? 'danger-btn' : 'save-button'}
            onClick={onConfirm ?? onClose}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
