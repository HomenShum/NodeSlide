// @vitest-environment jsdom

/**
 * Binds the founder-roadshow recorder anchors to the shipped UI.
 *
 * A recorder anchor is a promise about a string a real user can see. When the anchor and the
 * product drift apart, the recorder does not fail loudly — it waits for a selector that will
 * never appear and dies as a TIMEOUT, which reads like flake and gets retried instead of fixed.
 * A regex-only test of the anchor cannot catch that, because the regex is self-consistent no
 * matter what the product renders.
 *
 * So this file renders the real `AiInspector` and matches the anchors against live accessible
 * names. It fails the moment someone renames the chip, and it is the only test here that can.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../convex/lib/nodeslideSeed';
import { AiInspector } from '../../src/domains/nodeslide/inspector/AiInspector';
import {
  selectedElementScopePattern,
  selectedSlidesScopePattern,
} from '../nodeslide-founder-roadshow-lib.mjs';

const { snapshot } = buildGoldenNodeSlide('roadshow-anchor-test', 1_000);
const slide = (() => {
  const first = snapshot.slides[0];
  if (!first) throw new Error('Golden seed produced no slides');
  return first;
})();

const slideElements = snapshot.elements.filter((element) => element.slideId === slide.id);
const twoElements = slideElements.slice(0, 2);
if (twoElements.length !== 2) throw new Error('Golden seed slide has fewer than two elements');

function renderInspector(selectedElements: typeof slideElements) {
  return render(
    <AiInspector
      deck={snapshot.deck}
      slide={slide}
      selectedElements={selectedElements}
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

describe('founder-roadshow anchors bind to the shipped write-scope row', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('matches the element-selection chip the recorder waits for', async () => {
    const user = userEvent.setup();
    renderInspector(twoElements);
    // The write-scope row lives behind the advanced-controls popover, so the recorder must
    // open it before the chip exists. Asserting from a closed popover would prove nothing.
    await user.click(screen.getByTestId('ai-provider-summary'));

    const pattern = selectedElementScopePattern(twoElements.length);
    const chips = screen
      .getAllByRole('button')
      .map((node) => (node.textContent ?? '').trim())
      .filter((label) => pattern.test(label));

    expect(chips).toEqual([`Selection · ${twoElements.length}`]);
  });

  it('reports the multi-slide chip as absent rather than letting a recorder time out on it', async () => {
    const user = userEvent.setup();
    renderInspector(twoElements);
    await user.click(screen.getByTestId('ai-provider-summary'));

    // `Selected slides (N)` is a live anchor in the repo this gate came from. It is not one
    // here: the shipped ScopeChoice union is deck | slide | elements. Asserting the absence
    // keeps the storyboard's `pending-product-selector` hook honest — if the chip ever ships,
    // this goes red and points at the storyboard entry that must be flipped.
    const pattern = selectedSlidesScopePattern();
    const chips = screen
      .getAllByRole('button')
      .map((node) => (node.textContent ?? '').trim())
      .filter((label) => pattern.test(label));

    expect(chips).toEqual([]);
  });
});
