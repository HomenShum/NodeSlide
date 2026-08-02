import { describe, expect, it } from 'vitest';
import type { SlideElement } from '../../shared/nodeslide';
import { evaluateDeckDiversity } from './nodeslideDeckDiversity';

function repeatedChart(slideIndex: number): SlideElement[] {
  const slideId = `slide-${slideIndex + 1}`;
  return [
    {
      id: `chart-${slideIndex + 1}`,
      slideId,
      name: 'Comparable companies range',
      kind: 'chart',
      bbox: { x: 0.12, y: 0.18, width: 0.76, height: 0.62 },
      rotation: 0,
      style: { color: '#111111' },
      sourceIds: ['definitive-proxy'],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
      chart: {
        chartType: 'bar',
        labels: ['Low', 'Offer', 'High'],
        series: [{ name: 'Value', values: [17, 28, 38] }],
        unit: 'USD/share',
        sourceId: 'definitive-proxy',
      },
    },
    {
      id: `label-${slideIndex + 1}`,
      slideId,
      name: 'Method label',
      kind: 'text',
      content: `Valuation method ${slideIndex + 1}`,
      bbox: { x: 0.12, y: 0.08, width: 0.5, height: 0.07 },
      rotation: 0,
      style: { color: '#111111', fontSize: 24 },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
    },
  ];
}

describe('deck diversity intentional series', () => {
  it('lets an investment committee compare a declared valuation series without disabling the generic repetition gate', () => {
    const slides = Array.from({ length: 6 }, (_, slideIndex) => ({
      slideIndex,
      elements: repeatedChart(slideIndex),
    }));
    expect(evaluateDeckDiversity(slides).passes).toBe(false);
    const declared = evaluateDeckDiversity(slides, {
      intentionalSeries: [
        {
          slideIndexes: [1, 2, 3, 4, 5, 6],
        },
      ],
    });
    expect(declared.nearDuplicatePairs).toEqual([]);
    expect(declared.passes).toBe(true);
  });
});
