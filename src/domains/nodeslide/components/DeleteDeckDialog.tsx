import { LoaderCircle, Trash2, X } from 'lucide-react';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useModalDialog } from './useModalDialog';

export interface DeleteDeckDialogProps {
  open: boolean;
  deckTitle: string;
  deleting: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** The typed confirmation must equal the deck title exactly. */
export function deleteDeckConfirmationMatches(confirmation: string, deckTitle: string): boolean {
  return deckTitle.length > 0 && confirmation === deckTitle;
}

/**
 * Standalone destructive-action dialog; callers own the mutation and the
 * navigation that follows. Remounted per deck title so a stale confirmation
 * string can never carry across decks.
 */
export function DeleteDeckDialog({ open, ...props }: DeleteDeckDialogProps) {
  if (!open) return null;
  return <OpenDeleteDeckDialog key={props.deckTitle} {...props} />;
}

function OpenDeleteDeckDialog({
  deckTitle,
  deleting,
  error,
  onCancel,
  onConfirm,
}: Omit<DeleteDeckDialogProps, 'open'>) {
  const [confirmation, setConfirmation] = useState('');
  const confirmationRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const closeIfIdle = () => {
    if (!deleting) onCancel();
  };
  const { dialogRef, handleBackdropMouseDown, handleCancel, handleKeyDown } = useModalDialog({
    open: true,
    onClose: closeIfIdle,
    initialFocusRef: confirmationRef,
  });
  const confirmed = deleteDeckConfirmationMatches(confirmation, deckTitle);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirmed && !deleting) onConfirm();
  };

  return (
    <dialog
      ref={dialogRef}
      className="ns-delete-deck-dialog"
      aria-labelledby="ns-delete-deck-title"
      aria-busy={deleting}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
      data-testid="delete-deck-dialog"
    >
      <div className="ns-delete-deck-shell">
        <header className="ns-delete-deck-header">
          <span className="ns-delete-deck-mark" aria-hidden="true">
            <Trash2 size={18} />
          </span>
          <div>
            <span className="ns-eyebrow">Permanent data deletion</span>
            <h1 id="ns-delete-deck-title">Delete this deck?</h1>
          </div>
          <button
            type="button"
            className="ns-icon-button"
            onClick={closeIfIdle}
            disabled={deleting}
            aria-label="Cancel deck deletion"
          >
            <X size={16} />
          </button>
        </header>

        <form id={formId} onSubmit={submit}>
          <div className="ns-delete-deck-body">
            <p id={descriptionId}>
              This permanently deletes the deck and everything stored against it. It cannot be
              undone, and no copy is kept. Export your data first if you want one.
            </p>
            <label className="ns-delete-deck-confirm">
              Type <strong>{deckTitle}</strong> to confirm
              <input
                ref={confirmationRef}
                type="text"
                value={confirmation}
                aria-invalid={confirmation.length > 0 && !confirmed}
                aria-describedby={error ? errorId : descriptionId}
                autoComplete="off"
                spellCheck={false}
                disabled={deleting}
                data-testid="delete-deck-confirmation"
                onChange={(event) => setConfirmation(event.currentTarget.value)}
              />
            </label>
            {error ? (
              <output id={errorId} role="alert">
                {error}
              </output>
            ) : null}
          </div>
        </form>

        <footer className="ns-delete-deck-footer">
          <button
            type="button"
            className="ns-button ns-button--quiet"
            onClick={closeIfIdle}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            className="ns-button ns-button--danger"
            type="submit"
            form={formId}
            disabled={!confirmed || deleting}
            data-testid="delete-deck-confirm"
          >
            {deleting ? <LoaderCircle className="ns-spin" size={15} /> : <Trash2 size={15} />}
            {deleting ? 'Deleting…' : 'Delete deck permanently'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
