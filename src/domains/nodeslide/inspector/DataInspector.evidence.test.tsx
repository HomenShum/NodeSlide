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

const capturedWebSource = source({
  ...webSource,
  id: 'src-web',
  snapshot: {
    kind: 'search_excerpt',
    capturedAt: 1_720_000_000_000,
    text: 'Global EV adoption reached 28% of new sales in 2026.',
    contentDigest: 'content_sha256:captured-ev-excerpt',
  },
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

/** Written by the agent, not yet cited — the honest mid-work case. */
const draftClaim = element({
  id: 'el-draft',
  slideId: 'slide-2',
  name: 'Draft takeaway',
  content: 'Charging density is the binding constraint',
  sourceIds: [],
});

/** Slide furniture. Empty sourceIds here is not a missing citation. */
const pageNumber = element({
  id: 'el-page-number',
  slideId: 'slide-2',
  name: 'Page number',
  role: 'page_number',
  content: '02',
  sourceIds: [],
});

const accentRail = element({
  id: 'el-accent-rail',
  slideId: 'slide-3',
  name: 'Accent rail',
  kind: 'shape',
  role: 'decoration',
  sourceIds: [],
});

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

  it('opens the exact captured excerpt and its claim-bound region from the citing element', async () => {
    const onSelectElement = vi.fn();
    render(
      <DataInspector
        sources={[capturedWebSource]}
        selectedElements={[]}
        elements={elements}
        slides={slides}
        onSelectElement={onSelectElement}
      />,
    );

    expect(screen.queryByTestId('evidence-snapshot-region')).toBeNull();
    await userEvent.click(screen.getByTestId('evidence-citing-element'));

    expect(onSelectElement).toHaveBeenCalledWith('slide-2', 'el-headline');
    const region = screen.getByTestId('evidence-snapshot-region');
    expect(region.textContent).toContain(capturedWebSource.snapshot?.text);
    expect(screen.getByTestId('evidence-snapshot-binding').textContent).toContain(
      'Claim region bound to Headline',
    );
    const highlights = screen.getAllByTestId('evidence-snapshot-highlight');
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights.every((highlight) => highlight.dataset['elementId'] === 'el-headline')).toBe(
      true,
    );
    expect(screen.queryByTestId('evidence-no-snapshot')).toBeNull();
  });

  it('opens a captured excerpt directly and discloses that it is not a page photograph', async () => {
    render(
      <DataInspector
        sources={[capturedWebSource]}
        selectedElements={[]}
        elements={elements}
        slides={slides}
      />,
    );

    await userEvent.click(screen.getByTestId('evidence-snapshot-toggle'));
    const region = screen.getByTestId('evidence-snapshot-region');
    expect(region.textContent).toContain('not a photograph of the third-party page');
    expect(region.textContent).toContain('content_sha256:ca');
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

/*
 * Scenario: the same analyst, one step earlier. The agent has written a
 * takeaway it has not cited yet. NodeSlide's whole claim is that claims carry
 * their sources, so a claim carrying none has to be countable on the tab that
 * makes that claim — not a silent absence, and not an alarm either, because an
 * uncited element is usually mid-work.
 *
 * `tools/brain/capture-required-states.mjs` reaches the required `exception`
 * state with getByText(/no evidence|not attached|unsourced|0 sources/i). That
 * regex is asserted verbatim below so the harness and the surface cannot drift.
 */
const CAPTURE_EXCEPTION_PATTERN = /no evidence|not attached|unsourced|0 sources/i;

describe('DataInspector unsourced claims', () => {
  it('counts a claim with nothing bound to it, and lets the reviewer select it', async () => {
    const onSelectElement = vi.fn();
    render(
      <DataInspector
        sources={[webSource, csvSource]}
        selectedElements={[]}
        elements={[headline, chart, draftClaim]}
        slides={slides}
        onSelectElement={onSelectElement}
      />,
    );

    expect(screen.getByTestId('evidence-unsourced-count').textContent).toBe('1');
    const chip = screen.getByTestId('evidence-unsourced-element');
    expect(chip.textContent).toContain('Draft takeaway');
    expect(chip.textContent).toContain('Market shift');

    await userEvent.click(chip);
    expect(onSelectElement).toHaveBeenCalledWith('slide-2', 'el-draft');
  });

  it('does not count slide furniture — a page number and an accent rail assert nothing', () => {
    render(
      <DataInspector
        sources={[webSource, csvSource]}
        selectedElements={[]}
        elements={[headline, chart, pageNumber, accentRail]}
        slides={slides}
        onSelectElement={vi.fn()}
      />,
    );

    expect(screen.getByTestId('evidence-unsourced-count').textContent).toBe('0');
    expect(screen.getByTestId('evidence-coverage').textContent).toContain('Claims2');
    expect(screen.queryByTestId('evidence-unsourced-list')).toBeNull();
  });

  it('states a fully bound deck as a zero, and refuses the click rather than opening nothing', () => {
    render(
      <DataInspector
        sources={[webSource, csvSource]}
        selectedElements={[]}
        elements={elements}
        slides={slides}
        onSelectElement={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId<HTMLButtonElement>('evidence-unsourced-toggle');
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('evidence-coverage').textContent).toBe('Claims2Bound2Unsourced0');
  });

  it('collapses and reopens the list without losing the count', async () => {
    render(
      <DataInspector
        sources={[webSource]}
        selectedElements={[]}
        elements={[headline, draftClaim]}
        slides={slides}
        onSelectElement={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId('evidence-unsourced-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(toggle);
    expect(screen.queryByTestId('evidence-unsourced-list')).toBeNull();
    expect(screen.getByTestId('evidence-unsourced-count').textContent).toBe('1');
    await userEvent.click(toggle);
    expect(screen.getByTestId('evidence-unsourced-list')).not.toBeNull();
  });

  it('satisfies the capture harness assertion in both the zero and the populated case', () => {
    render(
      <DataInspector
        sources={[webSource]}
        selectedElements={[]}
        elements={elements}
        slides={slides}
      />,
    );
    // getByText throws when absent, so reaching the assertion is the assertion.
    expect(screen.getByText(CAPTURE_EXCEPTION_PATTERN).isConnected).toBe(true);
    cleanup();

    render(
      <DataInspector
        sources={[webSource]}
        selectedElements={[]}
        elements={[headline, draftClaim]}
        slides={slides}
      />,
    );
    expect(screen.getByText(CAPTURE_EXCEPTION_PATTERN).isConnected).toBe(true);
  });

  it('stays silent when the caller passes no deck elements, rather than reporting a false zero', () => {
    render(<DataInspector sources={[webSource]} selectedElements={[]} />);
    expect(screen.queryByTestId('evidence-coverage')).toBeNull();
  });
});
