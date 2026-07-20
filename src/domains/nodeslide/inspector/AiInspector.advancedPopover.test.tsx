// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { AiInspector } from './AiInspector';

/**
 * Scenario (G1): a deck owner works in the AI tab. The provider/privacy/scope
 * policy block no longer sits inline between the thread and the composer — it
 * opens as a compact popover from the composer footer. The popover must:
 *  - stay closed by default so the chat and composer are primary,
 *  - open from the footer trigger and render EVERY control functional
 *    (provider radios, write scope, operation mode, design behavior,
 *    reference use) under the same data-testids tests already depend on,
 *  - actually fire state changes (select a policy, flip provider), and
 *  - close from its labelled close button.
 */

const { snapshot } = buildGoldenNodeSlide('ai-popover-test', 1_000);
const slide = (() => {
  const first = snapshot.slides[0];
  if (!first) throw new Error('Golden seed produced no slides');
  return first;
})();

function renderInspector() {
  return render(
    <AiInspector
      deck={snapshot.deck}
      slide={slide}
      selectedElements={[]}
      patches={[]}
      traces={[]}
      variations={[]}
      variationsLoading={false}
      isSubmitting={false}
      variationBusy={false}
      variationGenerating={false}
      variationError={null}
      previewedVariationId={null}
      onPropose={() => undefined}
      onAccept={() => undefined}
      onReject={() => undefined}
      onGenerateVariations={() => undefined}
      onPreviewVariation={() => undefined}
      onAcceptVariation={() => undefined}
      onRejectVariation={() => undefined}
    />,
  );
}

describe('AI inspector advanced-controls popover', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('keeps advanced controls out of the way until the footer trigger opens them', async () => {
    const user = userEvent.setup();
    renderInspector();

    // Closed by default: the panel is not in the DOM, only the trigger is.
    expect(screen.queryByTestId('ai-provider-controls')).toBeNull();
    const trigger = screen.getByTestId('ai-provider-summary');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');

    await user.click(trigger);

    // Open: a native non-modal dialog renders with every policy control intact.
    const panel = screen.getByTestId('ai-provider-controls');
    expect(panel.tagName).toBe('DIALOG');
    expect(panel.hasAttribute('open')).toBe(true);
    expect(screen.getByTestId('ai-provider-route-status')).toBeTruthy();
    expect(screen.getByTestId('ai-provider-deterministic')).toBeTruthy();
    expect(screen.getByTestId('ai-provider-external')).toBeTruthy();
    expect(screen.getByTestId('ai-design-behavior')).toBeTruthy();
    expect(screen.getByTestId('ai-reference-use')).toBeTruthy();
    expect(screen.getByLabelText('Operation mode')).toBeTruthy();
    expect(screen.getByLabelText('AI write scope')).toBeTruthy();
  });

  it('controls inside the popover still fire: policy selects and provider flip', async () => {
    const user = userEvent.setup();
    renderInspector();
    await user.click(screen.getByTestId('ai-provider-summary'));

    // Policy selects are functional, not decorative.
    const designBehavior = screen.getByTestId('ai-design-behavior') as HTMLSelectElement;
    await user.selectOptions(designBehavior, 'reimagine');
    expect(designBehavior.value).toBe('reimagine');

    const referenceUse = screen.getByTestId('ai-reference-use') as HTMLSelectElement;
    await user.selectOptions(referenceUse, 'style_direction');
    expect(referenceUse.value).toBe('style_direction');

    // Flipping to the private deterministic route updates the radio state.
    const deterministic = screen.getByTestId('ai-provider-deterministic') as HTMLInputElement;
    expect(deterministic.checked).toBe(false);
    await user.click(deterministic);
    expect(deterministic.checked).toBe(true);
  });

  it('closes from the labelled close button and restores the trigger state', async () => {
    const user = userEvent.setup();
    renderInspector();

    await user.click(screen.getByTestId('ai-provider-summary'));
    expect(screen.getByTestId('ai-provider-controls')).toBeTruthy();

    await user.click(screen.getByTestId('ai-advanced-close'));
    expect(screen.queryByTestId('ai-provider-controls')).toBeNull();
    expect(screen.getByTestId('ai-provider-summary').getAttribute('aria-expanded')).toBe('false');
  });
});
