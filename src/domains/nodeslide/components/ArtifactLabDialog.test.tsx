import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ArtifactLabDialog } from './ArtifactLabDialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

describe('ArtifactLabDialog', () => {
  it('switches among all three evidence modes', () => {
    render(<ArtifactLabDialog open onClose={() => undefined} onUsePattern={() => undefined} />);
    expect(screen.getByTestId('artifact-gallery')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /model compare/i }));
    expect(screen.getByTestId('artifact-model-compare')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /harness compare/i }));
    expect(screen.getByTestId('artifact-harness-compare')).toBeTruthy();
  });

  it('returns an evidence-bounded pattern prompt to the composer', () => {
    const onUsePattern = vi.fn();
    render(<ArtifactLabDialog open onClose={() => undefined} onUsePattern={onUsePattern} />);
    const button = screen.getAllByRole('button', { name: 'Use slide' }).at(0);
    if (!button) throw new Error('Expected at least one reusable artifact pattern');
    fireEvent.click(button);
    expect(onUsePattern).toHaveBeenCalledWith(expect.stringContaining('editability'));
  });
});
// @vitest-environment jsdom
