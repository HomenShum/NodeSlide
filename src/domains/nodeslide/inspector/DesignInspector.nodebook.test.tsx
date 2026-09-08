// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import type { SlideElement } from '../../../../shared/nodeslide';
import { DesignInspector } from './DesignInspector';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function renderScenario(elements: SlideElement[], selected: SlideElement) {
  const { snapshot } = buildGoldenNodeSlide('nodebook-inspector-proof', 1_000);
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('fixture needs a slide');
  for (const element of elements) element.slideId = slide.id;
  return render(
    <DesignInspector
      slide={slide}
      slideElements={elements}
      selectedElements={[selected]}
      theme={snapshot.deck.theme}
      activeTastePackId={null}
      activeProfileId={null}
      activeProfileDigest={null}
      previewProfileId={null}
      profiles={[]}
      busy={false}
      onApplyTastePack={() => {}}
      onApplyProfile={undefined}
      onPreviewProfile={undefined}
      onUploadSource={undefined}
      tasteProfile={null}
      tasteProfileLoading={false}
      onEvictTasteSignal={undefined}
      onOpenPreferenceEvidence={undefined}
      onClearTastePack={() => {}}
      onApplyPatch={() => {}}
    />,
  );
}

function graphFixture(orphan = false): SlideElement[] {
  const { snapshot } = buildGoldenNodeSlide('nodebook-inspector-elements', 1_000);
  const base = snapshot.elements.slice(0, 3).map((element) => structuredClone(element));
  const first = base[0];
  const second = base[1];
  const connector = base[2];
  if (!first || !second || !connector) throw new Error('fixture needs three elements');
  first.kind = 'shape';
  first.content = 'Evidence sources';
  first.artifactBinding = {
    schemaVersion: 'nodeslide.production-artifact-binding/v1',
    artifactId: 'decision-flow',
    role: 'graph-node',
    graphKind: 'process',
    nodeId: 'evidence',
  };
  second.kind = 'shape';
  second.content = 'Decision memo';
  second.artifactBinding = {
    schemaVersion: 'nodeslide.production-artifact-binding/v1',
    artifactId: 'decision-flow',
    role: 'graph-node',
    graphKind: 'process',
    nodeId: 'decision',
  };
  connector.kind = 'connector';
  connector.artifactBinding = {
    schemaVersion: 'nodeslide.production-artifact-binding/v1',
    artifactId: 'decision-flow',
    role: 'graph-edge',
    graphKind: 'process',
    from: orphan ? 'missing' : 'evidence',
    to: 'decision',
    label: 'grounds',
  };
  return [first, second, connector];
}

describe('Design inspector shared NodeBook projection', () => {
  it('renders a package-owned diagram for a selected canonical graph node', async () => {
    const elements = graphFixture();
    renderScenario(elements, elements[0]!);
    expect(screen.getByRole('region', { name: 'NodeBook structured artifact preview' })).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelector('[data-nodebook-artifact-rendered] svg')).toBeTruthy(),
    );
  });

  it('surfaces an orphan edge as an honest alert without a misleading renderer', () => {
    const elements = graphFixture(true);
    renderScenario(elements, elements[0]!);
    expect(screen.getByRole('alert').textContent).toContain('endpoint is missing');
    expect(document.querySelector('[data-nodebook-artifact-rendered]')).toBeNull();
  });

  it('preserves the ordinary Design inspector when the selection has no graph binding', () => {
    const { snapshot } = buildGoldenNodeSlide('nodebook-inspector-ordinary', 1_000);
    const ordinary = structuredClone(snapshot.elements.find((element) => !element.artifactBinding));
    if (!ordinary) throw new Error('fixture needs an ordinary element');
    renderScenario([ordinary], ordinary);
    expect(screen.queryByRole('region', { name: 'NodeBook structured artifact preview' })).toBeNull();
    expect(screen.getByText(ordinary.name)).toBeTruthy();
  });
});
