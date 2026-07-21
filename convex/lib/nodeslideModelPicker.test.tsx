// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type DeckSnapshot, NODESLIDE_OFFERED_AGENT_MODELS } from '../../shared/nodeslide';
import { AiInspector } from '../../src/domains/nodeslide/inspector/AiInspector';
import { buildGoldenNodeSlide } from './nodeslideSeed';

/*
 * Render coverage for the AI-tab model picker.
 *
 * The composer now uses the AI Elements PromptInput family, whose model picker
 * is a Radix Select — its options mount in a portal only when opened, so the
 * SSR (`renderToStaticMarkup`) suite in nodeslideReviewUi.test.tsx physically
 * cannot see them and can only assert the data contract. This interaction test
 * restores the behavioural guarantee that AiInspector actually RENDERS every
 * offered model into the picker: emptying the model map here fails the suite.
 *
 * Radix Select depends on pointer-capture, scrollIntoView, ResizeObserver, and
 * matchMedia — none implemented by jsdom — so they are stubbed before render.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
  if (!globalThis.matchMedia) {
    globalThis.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof globalThis.matchMedia;
  }
});

function renderInspector() {
  const snapshot: DeckSnapshot = buildGoldenNodeSlide('model-picker-test', 1_000).snapshot;
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Missing slide fixture.');
  return render(
    <AiInspector<string>
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
      references={[]}
      commands={[]}
      initialInstruction=""
      initialReadContext={[]}
      onPropose={() => undefined}
      onAccept={() => undefined}
      onReject={() => undefined}
      onPreviewPatch={() => undefined}
      onGenerateVariations={() => undefined}
      onPreviewVariation={() => undefined}
      onAcceptVariation={() => undefined}
      onRejectVariation={() => undefined}
    />,
  );
}

describe('NodeSlide AI composer — model picker render coverage', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders every offered agent model plus the deterministic fallback when opened', async () => {
    const user = userEvent.setup();
    renderInspector();

    const trigger = screen.getByTestId('ai-model-select');
    await user.click(trigger);

    const listbox = await screen.findByRole('listbox');
    const optionText = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');

    // Every model in the data source is rendered as its own option.
    for (const model of NODESLIDE_OFFERED_AGENT_MODELS) {
      const rendered = optionText.filter((text) => text.includes(model.label)).length;
      expect(rendered, `model "${model.label}" is missing from the picker`).toBeGreaterThan(0);
    }

    // Distinct labels prove it is not a single hard-coded row.
    expect(optionText.some((text) => text.includes('Claude Sonnet 5'))).toBe(true);
    expect(optionText.some((text) => text.includes('GPT-5.6 Sol'))).toBe(true);

    // The private deterministic fallback stays offered.
    expect(optionText.some((text) => text.includes('Deterministic'))).toBe(true);

    // Guards the count against a future collapse to one/zero rows.
    expect(optionText.length).toBeGreaterThanOrEqual(NODESLIDE_OFFERED_AGENT_MODELS.length);
  });
});
