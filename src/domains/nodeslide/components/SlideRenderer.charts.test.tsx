// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChartData, Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import { SlideRenderer } from './SlideRenderer';

/*
 * D1 — real chart types in the editor canvas.
 *
 * Each chartType renders a distinct pure-SVG (or CSS-primitive) shape with the
 * right node counts for its data, multi-series colors come from the theme
 * palette, and the legacy bar/donut/line/area DOM stays exactly as it was so
 * golden decks render unchanged.
 */

const theme: ThemeSpec = {
  id: 'theme-test',
  name: 'Test',
  mode: 'light',
  colors: {
    canvas: '#ffffff',
    ink: '#1a1a1a',
    muted: '#666666',
    accent: '#3355ff',
    accentSoft: '#dde3ff',
    insight: '#fff3d6',
    insightInk: '#7a5200',
    trace: '#f0f0f0',
    border: '#e0e0e0',
  },
  typography: { display: 'Georgia', body: 'Helvetica', data: 'monospace' },
  defaultRadius: 8,
  spacingUnit: 8,
};

function chartElement(chart: ChartData): SlideElement {
  return {
    id: 'el-chart',
    slideId: 'slide-1',
    name: 'Quarterly chart',
    kind: 'chart',
    bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.6 },
    rotation: 0,
    style: {},
    chart,
    sourceIds: ['src-1'],
    locked: false,
    exportCapabilities: ['web_native', 'pptx_editable'],
    version: 1,
  };
}

function slideWith(elements: SlideElement[]): Slide {
  return {
    id: 'slide-1',
    deckId: 'deck-1',
    title: 'Chart slide',
    background: '#ffffff',
    elementOrder: elements.map((element) => element.id),
    version: 1,
  };
}

function renderChart(chart: ChartData) {
  const element = chartElement(chart);
  return render(<SlideRenderer elements={[element]} slide={slideWith([element])} theme={theme} />)
    .container;
}

const labels = ['Q1', 'Q2', 'Q3'];
const twoSeries = [
  { name: 'North', values: [4, 8, 6] },
  { name: 'South', values: [2, 5, 9] },
];

afterEach(cleanup);

describe('SlideRenderer chart types (D1)', () => {
  it('keeps the legacy vertical bar look as the default', () => {
    const container = renderChart({
      chartType: 'bar',
      labels,
      series: [{ name: 'North', values: [4, 8, 6] }],
    });
    // Unchanged golden structure: CSS bar columns, no SVG.
    expect(container.querySelectorAll('.ns-chart--bar .ns-chart-bar').length).toBe(3);
    expect(container.querySelector('svg rect')).toBeNull();
  });

  it('renders a horizontal bar chart as SVG rects with category labels', () => {
    const container = renderChart({
      chartType: 'bar-horizontal',
      labels,
      series: twoSeries,
      unit: 'units',
    });
    const host = container.querySelector('[data-chart-type="bar-horizontal"]');
    expect(host).not.toBeNull();
    expect(host?.querySelectorAll('svg rect').length).toBe(6); // 3 labels x 2 series
    const texts = [...(host?.querySelectorAll('svg text') ?? [])].map((node) => node.textContent);
    expect(texts).toEqual(labels);
    expect(host?.getAttribute('aria-label')).toContain('units');
  });

  it('renders a stacked bar chart with one segment per non-zero series value', () => {
    const container = renderChart({ chartType: 'stacked-bar', labels, series: twoSeries });
    const host = container.querySelector('[data-chart-type="stacked-bar"]');
    expect(host?.querySelectorAll('svg rect').length).toBe(6);
    // Segments in the same column share one x and stack upward from the axis.
    const rects = [...(host?.querySelectorAll('svg rect') ?? [])];
    const firstColumn = rects.filter(
      (rect) => rect.getAttribute('x') === rects[0]?.getAttribute('x'),
    );
    expect(firstColumn.length).toBe(2);
  });

  it('renders a pie chart with one wedge per slice', () => {
    const container = renderChart({
      chartType: 'pie',
      labels,
      series: [{ name: 'Share', values: [50, 30, 20] }],
    });
    const host = container.querySelector('[data-chart-type="pie"]');
    expect(host?.querySelectorAll('svg circle').length).toBe(3);
  });

  it('renders one polyline per series for line charts with theme-palette colors', () => {
    const container = renderChart({ chartType: 'line', labels, series: twoSeries });
    const polylines = [...container.querySelectorAll('svg polyline')];
    expect(polylines.length).toBe(2);
    expect(polylines[0]?.getAttribute('stroke')).toBe(theme.colors.accent);
    expect(polylines[1]?.getAttribute('stroke')).toBe(theme.colors.insightInk);
  });

  it('renders area fills plus lines for area charts', () => {
    const container = renderChart({ chartType: 'area', labels, series: twoSeries });
    expect(container.querySelectorAll('svg polygon').length).toBe(2);
    expect(container.querySelectorAll('svg polyline').length).toBe(2);
  });

  it('keeps the legacy donut rendering', () => {
    const container = renderChart({
      chartType: 'donut',
      labels,
      series: [{ name: 'Share', values: [3, 1, 1] }],
    });
    expect(container.querySelector('.ns-chart-donut')).not.toBeNull();
    expect(container.querySelector('.ns-chart-donut span')?.textContent).toBe('60%');
  });
});
