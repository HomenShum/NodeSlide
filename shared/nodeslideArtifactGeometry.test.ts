import { describe, expect, it } from 'vitest';
import { compileNodeSlideNativeArtifactGeometry } from './nodeslideArtifactGeometry.js';

describe('native proportional ArtifactSpec geometry', () => {
  it('maps waterfall deltas to proportional bar heights', () => {
    const geometry = compileNodeSlideNativeArtifactGeometry({
      id: 'waterfall',
      kind: 'waterfall',
      payload: {
        unit: 'points',
        baseline: 50,
        deltas: [
          { label: 'small', value: 10 },
          { label: 'large', value: 20 },
        ],
        final: 80,
      },
    });
    const bars = geometry?.marks.bars;
    const connectors = geometry?.marks.connectors;
    if (!bars || !connectors) throw new Error('Expected waterfall bars and connectors.');
    const smallBar = bars[1];
    const largeBar = bars[2];
    const baselineBar = bars[0];
    const firstConnector = connectors[0];
    if (!smallBar || !largeBar || !baselineBar || !firstConnector) {
      throw new Error('Expected waterfall delta bars and subtotal connector.');
    }
    expect(largeBar.height).toBeCloseTo(smallBar.height * 2, 5);
    expect(connectors).toHaveLength(bars.length - 1);
    expect(firstConnector.from.x).toBeCloseTo(baselineBar.x + baselineBar.width, 5);
    expect(firstConnector.to.x).toBeCloseTo(smallBar.x, 5);
  });

  it('maps Sankey flow values to proportional widths', () => {
    const geometry = compileNodeSlideNativeArtifactGeometry({
      id: 'sankey',
      kind: 'sankey',
      payload: {
        unit: 'claims',
        nodes: [
          { id: 'a', layer: 'source' },
          { id: 'b', layer: 'sink' },
          { id: 'c', layer: 'sink' },
        ],
        links: [
          { source: 'a', target: 'b', value: 2 },
          { source: 'a', target: 'c', value: 8 },
        ],
      },
    });
    const links = geometry?.marks.links;
    if (!links) throw new Error('Expected Sankey links.');
    const smallLink = links[0];
    const largeLink = links[1];
    if (!smallLink || !largeLink) throw new Error('Expected two Sankey links.');
    expect(largeLink.width).toBeCloseTo(smallLink.width * 4, 5);
  });

  it('maps Gantt timing/confidence and dependency connectors', () => {
    const geometry = compileNodeSlideNativeArtifactGeometry({
      id: 'gantt',
      kind: 'gantt',
      payload: {
        unit: 'week',
        tasks: [
          { id: 'a', start: 0, end: 2, confidence: 0.5, dependsOn: [] },
          { id: 'b', start: 2, end: 6, confidence: 1, dependsOn: ['a'] },
        ],
      },
    });
    const tasks = geometry?.marks.tasks;
    const dependencies = geometry?.marks.dependencies;
    if (!tasks || !dependencies) throw new Error('Expected Gantt task geometry.');
    const shortTask = tasks[0];
    const longTask = tasks[1];
    if (!shortTask || !longTask) throw new Error('Expected two Gantt tasks.');
    expect(longTask.width).toBeCloseTo(shortTask.width * 2, 5);
    expect(longTask.opacity).toBeGreaterThan(shortTask.opacity);
    expect(dependencies).toHaveLength(1);
  });

  it('produces quantitative risk, trace, and spatial marks', () => {
    const risk = compileNodeSlideNativeArtifactGeometry({
      id: 'risk',
      kind: 'risk-matrix',
      payload: {
        likelihoodAxis: { low: 'low', high: 'high' },
        impactAxis: { low: 'low', high: 'high' },
        risks: [
          { id: 'a', likelihood: 1, impact: 1 },
          { id: 'b', likelihood: 5, impact: 5 },
        ],
      },
    });
    const risks = risk?.marks.risks;
    if (!risks) throw new Error('Expected risk geometry.');
    const lowRisk = risks[0];
    const highRisk = risks[1];
    if (!lowRisk || !highRisk) throw new Error('Expected two risk marks.');
    expect(highRisk.x).toBeGreaterThan(lowRisk.x);
    expect(highRisk.y).toBeLessThan(lowRisk.y);
    expect(highRisk.x + highRisk.radius).toBeLessThanOrEqual(100);
    expect(highRisk.y - highRisk.radius).toBeGreaterThanOrEqual(0);

    const trace = compileNodeSlideNativeArtifactGeometry({
      id: 'trace',
      kind: 'trace',
      payload: { spans: [{ spanId: 'a', startMs: 0, endMs: 10 }] },
    });
    const spans = trace?.marks.spans;
    if (!spans) throw new Error('Expected trace geometry.');
    const span = spans[0];
    if (!span) throw new Error('Expected one trace span.');
    expect(span.width).toBeGreaterThan(0);
    expect(span).toMatchObject({ startMs: 0, endMs: 10, durationMs: 10 });

    const spatial = compileNodeSlideNativeArtifactGeometry({
      id: 'spatial',
      kind: 'spatial-scene',
      payload: {
        viewports: [
          { id: 'whole', level: 1 },
          { id: 'detail', level: 2 },
        ],
      },
    });
    const viewports = spatial?.marks.viewports;
    if (!viewports) throw new Error('Expected spatial geometry.');
    const whole = viewports[0];
    const detail = viewports[1];
    if (!whole || !detail) throw new Error('Expected two spatial viewports.');
    expect(detail.width).toBeLessThan(whole.width);
  });
});
