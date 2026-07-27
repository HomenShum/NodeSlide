// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeleteDeckDialog, deleteDeckConfirmationMatches } from './DeleteDeckDialog';

// Vitest runs without `globals`, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

const DECK_TITLE = 'Series B narrative';

function renderDialog(overrides: Partial<Parameters<typeof DeleteDeckDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <DeleteDeckDialog
      open
      deckTitle={DECK_TITLE}
      deleting={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe('DeleteDeckDialog', () => {
  it('is not rendered at all when closed', () => {
    render(
      <DeleteDeckDialog
        open={false}
        deckTitle={DECK_TITLE}
        deleting={false}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.queryByTestId('delete-deck-dialog')).toBeNull();
  });

  it('refuses to submit until the deck title is typed exactly', () => {
    const { onConfirm } = renderDialog();
    const confirm = screen.getByTestId('delete-deck-confirm') as HTMLButtonElement;
    const input = screen.getByTestId('delete-deck-confirmation') as HTMLInputElement;

    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'series b narrative' } });
    expect(confirm.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: DECK_TITLE } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('locks every exit while the deletion is in flight', () => {
    const { onCancel } = renderDialog({ deleting: true });
    const dialog = screen.getByTestId('delete-deck-dialog');
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect((screen.getByTestId('delete-deck-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('delete-deck-confirmation') as HTMLInputElement).disabled).toBe(
      true,
    );

    for (const button of screen.getAllByRole('button')) {
      if (!(button as HTMLButtonElement).disabled) fireEvent.click(button);
    }
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('surfaces a server refusal as an alert and keeps the dialog open', () => {
    renderDialog({ error: 'NodeSlide owner access denied.' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('owner access denied');
    expect(screen.getByTestId('delete-deck-dialog')).toBeTruthy();
  });

  it('says the deletion is permanent and that no copy is kept', () => {
    renderDialog();
    const body = screen.getByTestId('delete-deck-dialog').textContent ?? '';
    expect(body).toContain('cannot be undone');
    expect(body).toContain('no copy is kept');
    expect(body).toContain('Export your data first');
  });
});

describe('deleteDeckConfirmationMatches', () => {
  it('requires an exact, non-empty match', () => {
    expect(deleteDeckConfirmationMatches(DECK_TITLE, DECK_TITLE)).toBe(true);
    expect(deleteDeckConfirmationMatches(` ${DECK_TITLE}`, DECK_TITLE)).toBe(false);
    expect(deleteDeckConfirmationMatches('', '')).toBe(false);
  });
});
