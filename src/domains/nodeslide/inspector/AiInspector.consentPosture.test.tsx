// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { AiInspector } from './AiInspector';

/**
 * Scenario: an agent (or an auditor) inspects the AI tab and asks one question — how is egress
 * to an external model authorized on this surface?
 *
 * Two things have to stay true at once, and they pull against each other:
 *
 *  1. Zero-friction consent deleted the session-scoped consent checkbox on purpose. Naming an
 *     external model and pressing send IS the consent; the token is still minted and validated
 *     server-side. Re-adding a checkbox to satisfy a linter would undo a shipped design decision.
 *  2. Deleting that checkbox also deleted `data-agent-web-consent`, the only attribute that told
 *     a machine what the posture was. The product kept enforcing consent while the DOM stopped
 *     describing it, which is the failure mode where a UI is honest to humans and silent to agents.
 *
 * The resolution is to advertise the posture that actually ships rather than the control that was
 * removed. This file pins both halves so neither can drift back.
 */

const { snapshot } = buildGoldenNodeSlide('ai-consent-posture-test', 1_000);
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

describe('AI composer advertises its consent posture to a machine', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('labels web egress as per-send and carries the current answer in aria-pressed', async () => {
    const user = userEvent.setup();
    renderInspector();

    const toggle = screen.getByTestId('ai-web-research-toggle');
    expect(toggle.getAttribute('data-agent-web-consent')).toBe('per-send');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    await user.click(toggle);
    expect(screen.getByTestId('ai-web-research-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not reinstate the session-scoped consent control the redesign removed', () => {
    renderInspector();

    // Both spellings of the deleted control: the testid it carried and the attribute value that
    // described it. Either one reappearing means a port put the checkbox back.
    expect(screen.queryByTestId('ai-provider-consent')).toBeNull();
    expect(document.querySelector('[data-agent-web-consent="session"]')).toBeNull();
    expect(screen.queryByLabelText('Allow external model access for this session')).toBeNull();
    expect(screen.queryByLabelText('Allow web research for this session')).toBeNull();
  });

  it('exposes exactly one consent posture marker, so an agent cannot read two answers', () => {
    renderInspector();
    expect(document.querySelectorAll('[data-agent-web-consent]')).toHaveLength(1);
  });
});
