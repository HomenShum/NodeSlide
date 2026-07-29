// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import type { DeckPatch } from '../../../../shared/nodeslide';
import type { SlideVariation } from '../../../../shared/nodeslideVariation';
import { AiInspector } from './AiInspector';

/**
 * Scenario: the owner asked for a model edit. The provider timed out, the deterministic
 * fallback produced the operations instead, and the result is now sitting in front of two
 * different reviewers who have to answer the same question — is accepting this safe?
 *
 *   The HUMAN reviewer reads the card. It says "Deterministic fallback" and "Fallback reason:
 *   provider timeout". That disclosure already worked, was verified live on production, and is
 *   not being changed by anything here.
 *
 *   The AGENT reviewer reads the DOM. Until `data-proposal-origin` existed it could see
 *   `data-decision="undecided"` — a decision is outstanding — and nothing at all about who
 *   wrote the thing being decided on. The one fact that determines whether accepting is safe
 *   reached it only as English prose inside a paragraph, or not at all.
 *
 * BOTH halves are pinned here, and they are pinned separately on purpose. The risk of adding a
 * machine-readable channel is that the visible one becomes deletable: someone tidies up the
 * evidence row, the attribute still passes every gate, and the human reviewer silently loses
 * the disclosure that was working. So there is a test that fails if the attribute goes, and a
 * test that fails if the copy goes, and neither can stand in for the other.
 */

const { snapshot } = buildGoldenNodeSlide('ai-proposal-origin-test', 2_000);
const slide = (() => {
  const first = snapshot.slides[0];
  if (!first) throw new Error('Golden seed produced no slides');
  return first;
})();

function variation(overrides: Partial<SlideVariation> = {}): SlideVariation {
  return {
    schemaVersion: 'nodeslide.variation/v1',
    id: 'variation-fallback',
    batchId: 'batch-1',
    deckId: snapshot.deck.id,
    slideId: slide.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersion: slide.version,
    baseElementVersions: {},
    axes: { contentAngle: 'outcome', density: 'tight', layoutArchetype: 'split' },
    origin: 'deterministic_fallback',
    fallbackReason: 'provider_timeout',
    operations: [],
    candidate: { slide, elements: [] },
    validation: {
      id: 'validation-1',
      deckId: snapshot.deck.id,
      deckVersion: snapshot.deck.version + 1,
      ok: true,
      publishOk: true,
      cleanOk: true,
      issues: [],
      checkedAt: 1,
      toolchainVersion: 'test',
    },
    status: 'ready',
    createdAt: 1,
    ...overrides,
  } as SlideVariation;
}

function renderInspector(
  variations: SlideVariation[],
  patches: DeckPatch[] = [],
): ReturnType<typeof render> {
  return render(
    <AiInspector
      deck={snapshot.deck}
      slide={slide}
      selectedElements={[]}
      patches={patches}
      traces={[]}
      variations={variations}
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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('the agent reviewer can read who authored the change', () => {
  it('publishes deterministic-fallback authorship as an attribute on the variation card', () => {
    renderInspector([variation()]);
    const card = screen.getByTestId('variation-card');

    expect(card.getAttribute('data-proposal-origin')).toBe('deterministic_fallback');
    // Alongside the decision, not instead of it. Two different questions: is a decision
    // outstanding, and is accepting safe.
    expect(card.getAttribute('data-decision')).toBe('undecided');
  });

  it('publishes free-route authorship when the model route actually produced the plan', () => {
    // A successful route has no fallback reason to carry, so the key is absent rather than set
    // to undefined — the same shape the record itself has.
    const { fallbackReason: _reason, ...routed } = variation();
    renderInspector([{ ...routed, id: 'variation-route', origin: 'free_route' }]);
    expect(screen.getByTestId('variation-card').getAttribute('data-proposal-origin')).toBe(
      'free_route',
    );
  });

  it('never writes the literal string "undefined", however the record arrives', () => {
    /*
     * The specific failure this attribute exists to prevent. A legacy record with no origin
     * must read `unattributed` — an honest "this row does not know" — and never the stringified
     * text of a missing value, which reads as an answer and is worse than an absent attribute.
     */
    // Built by OMISSION, not by assigning undefined: a row from before the field existed does
    // not carry the key at all, and a fixture that sets it to undefined would be testing a
    // shape the database cannot produce.
    const { origin: _origin, fallbackReason: _reason, ...legacy } = variation();
    renderInspector([{ ...legacy, id: 'variation-legacy' } as SlideVariation]);
    const value = screen.getByTestId('variation-card').getAttribute('data-proposal-origin');
    expect(value).toBe('unattributed');
    expect(value).not.toBe('undefined');
    expect(value).not.toBeNull();
  });
});

describe('the human reviewer keeps the disclosure that already worked', () => {
  it('still says "Deterministic fallback" in visible copy, with the reason spelled out', () => {
    /*
     * KNOCKOUT PAIR. Delete the evidence-row span or the fallback-reason paragraph from
     * VariationCard and this test goes red while every attribute check above stays green —
     * which is the whole point of writing it separately. Adding a machine-readable channel
     * must not make the human-readable one optional.
     */
    renderInspector([variation()]);
    const card = screen.getByTestId('variation-card');

    expect(card.textContent).toContain('Deterministic fallback');
    expect(card.textContent).toContain('Fallback reason:');
    // The reason is humanized for a person, so the assertion is on the words rather than on the
    // raw diagnostic token — a reader is being told what went wrong, not shown an enum.
    expect(card.textContent?.toLowerCase()).toContain('timeout');
  });

  it('distinguishes a private deterministic run from a route that failed', () => {
    /*
     * `provider_not_requested` is the same `deterministic_fallback` origin, and it is NOT a
     * failure: nobody asked for a provider. The visible copy has always drawn that line, and a
     * machine-readable origin that collapsed the two would make the DOM cruder than the prose.
     * The distinction lives in the reason, which is why the reason is threaded too.
     */
    renderInspector([
      variation({ id: 'variation-private', fallbackReason: 'provider_not_requested' }),
    ]);
    const card = screen.getByTestId('variation-card');

    expect(card.textContent).toContain('Private deterministic');
    expect(card.textContent).not.toContain('Deterministic fallback');
    // Same origin either way — the attribute reports authorship, not blame.
    expect(card.getAttribute('data-proposal-origin')).toBe('deterministic_fallback');
    // And a run nobody asked to be routed is not shown a "Fallback reason:" line, because
    // there was no failure to explain.
    expect(card.textContent).not.toContain('Fallback reason:');
  });
});
