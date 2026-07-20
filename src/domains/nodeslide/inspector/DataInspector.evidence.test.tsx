// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Slide, SlideElement, SourceRecord } from '../../../../shared/nodeslide';
import { DataInspector } from './DataInspector';

/*
 * Scenario: an analyst reviews a deck the agent built with web research plus
 * an uploaded CSV. In the Evidence (Data) tab she must be able to trace every
 * claim: each source lists the elements citing it, clicking one selects that
 * element on its slide, web excerpts highlight the claim terms they actually
 * contain, and the tab is honest about capture — a text excerpt is labelled
 * "no visual snapshot" (never a fake screenshot badge) and a failed refresh
 * says so.
 */

function element(overrides: Partial<SlideElement> & { id: string; slideId: string }): SlideElement {
  return {
    name: overrides.id,
    kind: 'text',
    bbox: { x: 0, y: 0, width: 400, height: 120 },
    rotation: 0,
    style: {},
    sourceIds: [],
    locked: false,
    exportCapabilities: [],
    version: 1,
    ...overrides,
  } as SlideElement;
}

function slide(id: string, title: string): Slide {
  return {
    id,
    deckId: 'deck-1',
    title,
    background: '#ffffff',
    elementOrder: [],
    version: 1,
  };
}

function source(overrides: Partial<SourceRecord> & { id: string }): SourceRecord {
  return {
    deckId: 'deck-1',
    title: overrides.id,
    sourceType: 'url',
    retrievedAt: 1_720_000_000_000,
    citation: 'Global EV adoption reached 28% of new sales in 2026.',
    ...overrides,
  } as SourceRecord;
}

const webSource = source({
  id: 'src-web',
  title: 'EV market report',
  url: 'https://example.com/ev-report',
  sourceType: 'url',
  format: 'web',
  provider: 'tavily',
  status: 'ready',
});

const csvSource = source({
  id: 'src-csv',
  title: 'Quarterly sales.csv',
  sourceType: 'spreadsheet',
  format: 'csv',
  citation: 'Uploaded spreadsheet with quarterly sales figures.',
  rowCount: 12,
  columns: ['quarter', 'revenue'],
});

const orphanSource = source({
  id: 'src-orphan',
  title: 'Unused note',
  sourceType: 'note',
  citation: 'A note nothing cites yet.',
});

const headline = element({
  id: 'el-headline',
  slideId: 'slide-2',
  name: 'Headline',
  content: 'EV adoption reached 28% in 2026',
  sourceIds: ['src-web'],
});

const chart = element({
  id: 'el-chart',
  slideId: 'slide-3',
  name: 'Revenue chart',
  kind: 'chart',
  chart: {
    chartType: 'bar',
    labels: ['Q1', 'Q2'],
    series: [{ name: 'Revenue', values: [1, 2] }],
    sourceId: 'src-csv',
  },
} as Partial<SlideElement> & { id: string; slideId: string });

const slides = [slide('slide-2', 'Market shift'), slide('slide-3', 'Revenue')];
const elements = [headline, chart];

afterEach(cleanup);

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a rendered element');
  return value;
}

describe('DataInspector evidence lineage', () => {
  it('lists citing elements per source and selects one on click (claim -> source -> element)', async () => {
    const onSelectElement = vi.fn();
    render(
      <DataInspector
        sources={[webSource, csvSource, orphanSource]}
        selectedElements={[]}
        elements={elements}
        slides={slides}
        onSelectElement={onSelectElement}
      />,
    );

    const lists = screen.getAllByTestId('evidence-citing-list');
    expect(lists).toHaveLength(3);

    // Web source is cited by the headline element via sourceIds.
    const webButton = within(must(lists[0])).getByTestId('evidence-citing-element');
    expect(webButton.textContent).toContain('Headline');
    expect(webButton.textContent).toContain('Market shift');
    await userEvent.click(webButton);
    expect(onSelectElement).toHaveBeenCalledWith('slide-2', 'el-headline');

    // CSV source is cited through the chart primitive's sourceId binding.
    const csvButton = within(must(lists[1])).getByTestId('evidence-citing-element');
    expect(csvButton.textContent).toContain('Revenue chart');
    await userEvent.click(csvButton);
    expect(onSelectElement).toHaveBeenCalledWith('slide-3', 'el-chart');

    // A source nothing cites states that honestly instead of hiding the row.
    expect(within(must(lists[2])).getByTestId('evidence-no-citations').textContent).toContain(
      'No elements cite this source yet.',
    );
  });

  it('highlights claim terms inside the stored web excerpt without altering its text', () => {
    render(
      <DataInspector
        sources={[webSource]}
        selectedElements={[]}
        elements={elements}
        slides={slides}
      />,
    );
    const excerpt = screen.getByTestId('evidence-excerpt');
    // The rendered excerpt is exactly the stored citation.
    expect(excerpt.textContent).toBe(webSource.citation);
    const marks = screen.getAllByTestId('evidence-highlight');
    const highlighted = marks.map((mark) => mark.textContent?.toLowerCase());
    expect(highlighted).toContain('adoption');
    expect(highlighted).toContain('reached');
  });

  it('labels web sources with the honest no-visual-snapshot note and never fakes one for uploads', () => {
    render(
      <DataInspector
        sources={[webSource, csvSource]}
        selectedElements={[]}
        elements={elements}
        slides={slides}
      />,
    );
    const notes = screen.getAllByTestId('evidence-no-snapshot');
    expect(notes).toHaveLength(1);
    expect(must(notes[0]).textContent).toContain('Text excerpt · no visual snapshot');
    // No screenshot badge, no broken <img>, anywhere in the tab.
    expect(document.querySelector('.ns-source-list img')).toBeNull();
  });

  it('renders the honest capture-failed state instead of a snapshot badge when refresh failed', () => {
    render(
      <DataInspector
        sources={[{ ...webSource, status: 'failed' }]}
        selectedElements={[]}
        elements={elements}
        slides={slides}
      />,
    );
    expect(screen.getByTestId('evidence-capture-failed').textContent).toContain('Capture failed');
    expect(screen.queryByTestId('evidence-no-snapshot')).toBeNull();
  });
});
