// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { AiInspector } from './AiInspector';

/**
 * Scenario: a designer opens the AI tab on Claude Opus 5.5 without touching the effort picker. It must
 * show the row's own default (Opus 5.5 = medium, SPEC A.2.8), not a hard-coded 'high' that the next
 * send would use. The restore-from-storage rule is covered in nodeslideProvider.requestShape.test.ts
 * (nodeSlideEffortForModel): jsdom's Radix Select echoes an empty value back on a controlled
 * change, which hides a restored effort from this DOM.
 */
const { snapshot } = buildGoldenNodeSlide('ai-default-effort-test', 1_000);
const slide = (() => {
  const first = snapshot.slides[0];
  if (!first) throw new Error('Golden seed produced no slides');
  return first;
})();

function renderInspector(initialProviderModel?: 'anthropic/claude-opus-5.5') {
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
      {...(initialProviderModel ? { initialProviderModel } : {})}
    />,
  );
}

// The composer's footer hint prints the model label and the effort the next send will use.
const hint = () => document.querySelector('.ns-shortcut-hint')?.textContent ?? '';

describe('AI composer effort follows the model row default', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('starts a fresh Opus 5.5 composer at Medium', () => {
    renderInspector('anthropic/claude-opus-5.5');
    expect(hint()).toMatch(/Claude Opus 5\.5 · Medium effort/u);
  });

  it('keeps High for a row without its own default (the default Kimi route)', () => {
    renderInspector();
    expect(hint()).toMatch(/ · High effort/u);
  });
});
