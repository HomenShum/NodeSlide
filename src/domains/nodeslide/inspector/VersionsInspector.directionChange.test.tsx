// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deck, DeckSnapshot, DeckVersion } from '../../../../shared/nodeslide';
import type { SignatureProfile } from '../../../../shared/nodeslideSignature';
import { VersionsInspector } from './VersionsInspector';

/**
 * The scenario: someone applies "Finance reporting" to a board deck, then a week later restores an
 * older layout they liked. That restore silently removes the deck's direction, because a restored
 * snapshot carries the target version's governance — or its absence — with its content.
 *
 * The semantic is correct and stays. What these tests demand is that the user is told BEFORE the
 * restore happens, and — just as important — that they are NOT told when nothing changes. A
 * confirmation on every restore is a confirmation nobody reads, and it would train people to click
 * through the one that mattered.
 */

const DIGEST = `sha256:${'a'.repeat(64)}`;

const profile = {
  id: 'finance-reporting',
  name: 'Finance reporting',
  source: { digest: DIGEST },
} as unknown as SignatureProfile;

const deck = (over: Partial<Deck> = {}): Deck =>
  ({
    id: 'deck_1',
    title: 'Board review',
    version: 3,
    ...over,
  }) as unknown as Deck;

const version = (n: number, governed: boolean): DeckVersion =>
  ({
    id: `v${n}`,
    deckId: 'deck_1',
    version: n,
    label: `Version ${n}`,
    source: 'agent',
    createdAt: 1_700_000_000_000 + n,
    snapshot: {
      deck: governed
        ? { activeSignatureProfileId: 'finance-reporting', activeSignatureProfileDigest: DIGEST }
        : {},
      slides: [],
      elements: [],
      sources: [],
    } as unknown as DeckSnapshot,
  }) as DeckVersion;

// Auto-cleanup is not registered in this project, so every render would otherwise stay in the
// document and later queries would find an earlier test's buttons. That failure looks like a
// product bug and is not one, so each test gets a fresh document and queries its own container.
afterEach(cleanup);

const setup = (deckOver: Partial<Deck>, versions: readonly DeckVersion[]) => {
  const onRestore = vi.fn();
  const { container } = render(
    <VersionsInspector
      deck={deck(deckOver)}
      versions={versions}
      patches={[]}
      profiles={[profile]}
      onRestore={onRestore}
    />,
  );
  const ui = within(container);
  // The current version's Restore is disabled, so the button under test is the first enabled one.
  // Clicking the disabled one silently does nothing, which would make every assertion below pass
  // for the wrong reason.
  const clickRestore = () => {
    const target = ui
      .getAllByRole('button', { name: /^Restore$/i })
      .find((button) => !button.hasAttribute('disabled'));
    if (!target) throw new Error('No enabled Restore button — the fixture has nothing to restore.');
    fireEvent.click(target);
  };
  return { onRestore, clickRestore, ui };
};

const governedDeck = {
  activeSignatureProfileId: 'finance-reporting',
  activeSignatureProfileDigest: DIGEST,
};

describe('restoring across an activation is disclosed before it happens', () => {
  it('warns instead of restoring when the version predates the active direction', () => {
    // v3 is current, so v2 is the restorable one. v2 carries no direction.
    const { onRestore, clickRestore, ui } = setup(governedDeck, [
      version(3, true),
      version(2, false),
    ]);

    clickRestore();

    expect(onRestore).not.toHaveBeenCalled();
    expect(ui.getByRole('alertdialog')).toBeTruthy();
    expect(ui.getByRole('alertdialog').textContent).toMatch(/removes "Finance reporting"/u);
    expect(ui.getByRole('alertdialog').textContent).toMatch(/no longer be checked against it/u);
  });

  it('restores only after the change is acknowledged', () => {
    const { onRestore, clickRestore, ui } = setup(governedDeck, [
      version(3, true),
      version(2, false),
    ]);

    clickRestore();
    fireEvent.click(ui.getByRole('button', { name: /Restore anyway/i }));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0]?.[0].version).toBe(2);
  });

  it('cancelling leaves the deck untouched', () => {
    const { onRestore, clickRestore, ui } = setup(governedDeck, [
      version(3, true),
      version(2, false),
    ]);

    clickRestore();
    fireEvent.click(ui.getByRole('button', { name: /Cancel/i }));

    expect(onRestore).not.toHaveBeenCalled();
    expect(ui.queryByRole('alertdialog')).toBeNull();
  });

  it('does not interrupt a restore that changes nothing', () => {
    // Both governed by the same profile at the same digest. Nothing to disclose, so no friction.
    const { onRestore, clickRestore, ui } = setup(governedDeck, [
      version(3, true),
      version(2, true),
    ]);

    clickRestore();

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(ui.queryByRole('alertdialog')).toBeNull();
  });

  it('does not interrupt an ungoverned deck restoring an ungoverned version', () => {
    const { onRestore, clickRestore } = setup({}, [version(3, false), version(2, false)]);

    clickRestore();

    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('warns when a restore puts a direction back in force', () => {
    const { onRestore, clickRestore, ui } = setup({}, [version(3, false), version(2, true)]);

    clickRestore();

    expect(onRestore).not.toHaveBeenCalled();
    expect(ui.getByRole('alertdialog').textContent).toMatch(/back in force/u);
  });
});
