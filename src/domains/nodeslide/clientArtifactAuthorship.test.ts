import { describe, expect, it } from 'vitest';
import type { SlideElement } from '../../../shared/nodeslide';
import { cloneNodeSlideElementWithoutAuthoredBinding } from './clientArtifactAuthorship';

describe('client ArtifactSpec authorship boundary', () => {
  it('strips server-authored canonical bindings when duplicating an element', () => {
    const element: SlideElement = {
      id: 'chart-1',
      slideId: 'slide-1',
      name: 'Observed chart',
      kind: 'chart',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.5 },
      rotation: 0,
      style: {},
      chart: { chartType: 'bar', labels: ['A'], series: [{ name: 'Value', values: [1] }] },
      sourceIds: ['source-1'],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable'],
      version: 1,
      authoredArtifactBinding: {
        schemaVersion: 'nodeslide.authored-artifact-binding/v1',
        artifactId: 'artifact-1',
        kind: 'chart',
        narrativeJob: 'Show the observed value.',
        truthState: 'observed',
        rationale: 'Bound to source-1.',
        claimIds: ['claim-1'],
        sourceIds: ['source-1'],
        specDigest: `sha256:${'a'.repeat(64)}`,
        projection: {
          primitive: 'chart',
          mode: 'native',
          browserContract: 'semantic',
          pptxContract: 'editable',
          editability: 'native',
          knownFidelityDifferences: [],
        },
      },
    };

    const clone = cloneNodeSlideElementWithoutAuthoredBinding(element);

    expect(clone).not.toHaveProperty('authoredArtifactBinding');
    expect(element).toHaveProperty('authoredArtifactBinding');
    expect(clone.chart).toEqual(element.chart);
    expect(clone.chart).not.toBe(element.chart);
  });
});
