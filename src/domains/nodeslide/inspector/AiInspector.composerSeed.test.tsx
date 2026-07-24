// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { AiInspector } from './AiInspector';

/**
 * Scenario: someone is editing slide 4 and wants this slide to work like a reference artifact they
 * saw in the Artifact Lab. Until now the Lab only existed on the landing page, so a reference was
 * reachable before you had a deck and never while you were working on one. It now opens over the
 * workspace, and choosing a pattern hands the text to the scoped edit composer.
 *
 * Two of these tests exist because of defects in the first version of this code, not to pad the
 * happy path:
 *
 *   - Keying the effect off the pattern TEXT alone made a repeat pick a silent no-op. Same text, no
 *     change, effect never runs, the button looks broken. The nonce fixes that, so the nonce is what
 *     is tested.
 *   - An eager re-seed would wipe a draft someone was part-way through typing. Only a real pick may
 *     overwrite, and an absent seed must never clear anything.
 */

const { snapshot } = buildGoldenNodeSlide('ai-composer-seed-test', 2_000);
const slide = (() => {
  const first = snapshot.slides[0];
  if (!first) throw new Error('Golden seed produced no slides');
  return first;
})();

function renderInspector(composerSeed?: { text: string; nonce: number }) {
  const view = render(
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
      {...(composerSeed ? { composerSeed } : {})}
      onPropose={() => undefined}
      onAccept={() => undefined}
      onReject={() => undefined}
      onGenerateVariations={() => undefined}
      onPreviewVariation={() => undefined}
      onAcceptVariation={() => undefined}
      onRejectVariation={() => undefined}
    />,
  );
  const rerenderWith = (next?: { text: string; nonce: number }) =>
    view.rerender(
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
        {...(next ? { composerSeed: next } : {})}
        onPropose={() => undefined}
        onAccept={() => undefined}
        onReject={() => undefined}
        onGenerateVariations={() => undefined}
        onPreviewVariation={() => undefined}
        onAcceptVariation={() => undefined}
        onRejectVariation={() => undefined}
      />,
    );
  return { rerenderWith };
}

const composer = () => screen.getByRole('textbox') as HTMLTextAreaElement;

describe('the Artifact Lab hands a pattern to the workspace composer', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('seeds the composer when a pattern is chosen after mount', () => {
    const { rerenderWith } = renderInspector();
    expect(composer().value).toBe('');

    rerenderWith({ text: 'Open with the decision, then the two numbers behind it.', nonce: 1 });

    expect(composer().value).toBe('Open with the decision, then the two numbers behind it.');
  });

  it('seeds again when the SAME pattern is chosen twice', async () => {
    // The defect this catches: with the text as the only signal, the second pick does nothing.
    const user = userEvent.setup();
    const { rerenderWith } = renderInspector();

    rerenderWith({ text: 'Lead with the chart.', nonce: 1 });
    await user.clear(composer());
    await user.type(composer(), 'something else entirely');
    expect(composer().value).toBe('something else entirely');

    rerenderWith({ text: 'Lead with the chart.', nonce: 2 });

    expect(composer().value).toBe('Lead with the chart.');
  });

  it('leaves a draft alone when no pattern is chosen', async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderInspector();

    await user.type(composer(), 'my own half-written instruction');
    rerenderWith();

    expect(composer().value).toBe('my own half-written instruction');
  });

  it('never clears a draft with an empty pattern', async () => {
    // An empty seed is how "nothing chosen yet" is represented at mount, so it must be inert.
    const user = userEvent.setup();
    const { rerenderWith } = renderInspector({ text: '', nonce: 0 });

    await user.type(composer(), 'keep me');
    rerenderWith({ text: '', nonce: 1 });

    expect(composer().value).toBe('keep me');
  });

  it('puts the caret at the end so the person can keep typing', () => {
    const { rerenderWith } = renderInspector();

    rerenderWith({ text: 'Tighten the close.', nonce: 1 });

    expect(composer().selectionStart).toBe('Tighten the close.'.length);
  });
});
