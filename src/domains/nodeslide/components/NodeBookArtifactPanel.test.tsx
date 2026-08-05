// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NodeSlideNodeBookArtifactPanel } from './NodeBookArtifactPanel';

const flow = JSON.stringify({
  schemaVersion: 'nodekit.diagram/v1',
  diagramType: 'flow',
  nodes: [
    { id: 'evidence', label: 'Shared evidence' },
    { id: 'slide', label: 'Slide claim' },
  ],
  edges: [{ id: 'grounds', from: 'evidence', to: 'slide', label: 'grounds' }],
  groups: [],
  layout: { direction: 'LR', seed: 'nodeslide-consumer-v1' },
});

describe('NodeSlide consumes the packed NodeBook artifact runtime', () => {
  it('renders a deck-scoped structured flow without giving NodeBook ownership of deck identity', async () => {
    const view = render(
      <NodeSlideNodeBookArtifactPanel
        deckId="deck-proof-1"
        artifactId="artifact-proof-1"
        kind="flow"
        format="structured-json"
        payload={flow}
        title="Evidence to claim"
        version={1}
      />,
    );

    expect(
      view.container
        .querySelector('[data-nodebook-host="nodeslide"]')
        ?.getAttribute('data-nodebook-workspace-id'),
    ).toBe('deck-proof-1');
    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-nodebook-artifact-rendered] svg')
          ?.getAttribute('data-layout-seed'),
      ).toBe('nodeslide-consumer-v1'),
    );
  });

  it('reports format mismatch without rendering a misleading fallback', async () => {
    const view = render(
      <NodeSlideNodeBookArtifactPanel
        deckId="deck-proof-1"
        artifactId="artifact-mismatch"
        kind="flow"
        format="mermaid"
        payload={flow}
        title="Mismatch"
        version={1}
      />,
    );

    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toContain('ARTIFACT_FORMAT_MISMATCH'),
    );
    expect(view.container.querySelector('[data-nodebook-artifact-rendered]')).toBeNull();
  });
});
