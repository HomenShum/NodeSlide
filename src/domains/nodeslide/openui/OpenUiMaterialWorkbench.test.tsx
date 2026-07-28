/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import type { PatchOperation } from '../../../../shared/nodeslide';
import { OpenUiMaterialWorkbench } from './OpenUiMaterialWorkbench';
import { AI2027_TRANSFORMATION_LADDER } from './openUiMaterials';

afterEach(cleanup);

function mount(onPropose: (operations: PatchOperation[], summary: string) => Promise<void>) {
  const { snapshot } = buildGoldenNodeSlide('openui-workbench-interaction', 1_700_000_000_000);
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Expected a golden fixture slide.');
  render(<OpenUiMaterialWorkbench deck={snapshot.deck} slide={slide} onPropose={onPropose} />);
  return { snapshot, slide };
}

function openLab() {
  fireEvent.click(screen.getByRole('button', { name: /Visual material lab/i }));
}

describe('OpenUiMaterialWorkbench interaction', () => {
  it('routes the allowlisted OpenUI action into exactly one unapplied proposal', async () => {
    let callCount = 0;
    let proposedOperations: PatchOperation[] | undefined;
    mount(async (operations) => {
      callCount += 1;
      proposedOperations = operations;
    });

    openLab();
    const action = screen.getByTestId('openui-create-proposal');
    fireEvent.click(action);
    fireEvent.click(action);

    await waitFor(() => expect(callCount).toBe(1));
    expect(proposedOperations).toHaveLength(1);
    expect(proposedOperations?.[0]?.op).toBe('add_slide');
    expect(screen.getByTestId('openui-proposal-status').textContent).toContain(
      'The deck is unchanged until you accept it.',
    );
  });

  /*
   * Hazard 3, as a test rather than as a promise. The lab renders one hardcoded fixture; if it
   * shows the fixture it has to show that the fixture is unverified. Deleting the banner, or
   * quietly promoting the spec's verification field, fails here.
   */
  it('shows the fixture verification status on the surface that renders the fixture', () => {
    mount(async () => {});
    openLab();

    const workbench = screen.getByTestId('openui-visual-workbench');
    expect(workbench.getAttribute('data-verification')).toBe('unverified_scenario');
    expect(workbench.getAttribute('data-verification')).toBe(
      AI2027_TRANSFORMATION_LADDER.verification,
    );

    const banner = screen.getByTestId('openui-verification');
    expect(banner.textContent).toMatch(/unverified/i);
    expect(banner.textContent).toMatch(/not bound to a source/i);
  });

  /*
   * trust-surfaces. A proposal that no human has ruled on must be readable as undecided both by
   * a person (no acceptance colour) and by an agent (a data attribute). This is the regression
   * test for the parity styling this port corrected: `is-proposed` used to paint the success
   * token while the sentence beside it said the deck had not changed.
   */
  it('marks a created proposal undecided and never claims acceptance', async () => {
    let called = 0;
    mount(async () => {
      called += 1;
    });

    const workbench = screen.getByTestId('openui-visual-workbench');
    expect(workbench.hasAttribute('data-decision')).toBe(true);
    expect(workbench.getAttribute('data-decision')).toBe('none');

    openLab();
    fireEvent.click(screen.getByTestId('openui-create-proposal'));
    await waitFor(() => expect(called).toBe(1));

    const status = await screen.findByTestId('openui-proposal-status');
    expect(status.getAttribute('data-decision')).toBe('undecided');
    expect(screen.getByTestId('openui-visual-workbench').getAttribute('data-decision')).toBe(
      'undecided',
    );
    expect(document.body.querySelector('[data-decision="accepted"]')).toBeNull();
  });

  /*
   * The provenance line is iconography, and iconography is a claim. A tick inside a shield next
   * to the word "unverified" is the same defect as an accept-coloured undecided card.
   */
  it('refuses verified iconography on the unverified provenance line', async () => {
    mount(async () => {});
    openLab();

    const ladder = await screen.findByTestId('openui-transformation-ladder');
    const provenance = ladder.querySelector('[data-provenance-verified]');
    expect(provenance).not.toBeNull();
    expect(provenance?.getAttribute('data-provenance-verified')).toBe('false');
    expect(provenance?.textContent).toMatch(/unverified/i);
  });
});
