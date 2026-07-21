import { describe, expect, it } from 'vitest';
import { buildBriefNodeSlide } from '../convex/lib/nodeslideSeed';
import type { DeckSnapshot, SlideElement } from './nodeslide';
import {
  type SlideContentShape,
  archetypeCandidates,
  chooseDeckArchetypes,
} from './nodeslideArchetypes';
import { findCollisions } from './nodeslideLayoutMetrics';

const BRIEF = {
  prompt: 'Prove that varied planned content materializes with varied, collision-free layouts.',
  audience: 'Design reviewers',
  purpose: 'Archetype variety acceptance',
  successCriteria: ['At least three distinct archetypes', 'No avoidable adjacent repeats'],
};

function collidableElements(snapshot: DeckSnapshot, slideId: string): SlideElement[] {
  return snapshot.elements.filter(
    (element) =>
      element.slideId === slideId &&
      element.kind !== 'shape' &&
      element.kind !== 'connector' &&
      element.role !== 'footer' &&
      element.role !== 'page_number',
  );
}

function expectZeroCollisions(snapshot: DeckSnapshot): void {
  for (const slide of snapshot.slides) {
    const rects = collidableElements(snapshot, slide.id).map((element) => ({
      id: element.id,
      bbox: element.bbox,
    }));
    expect(findCollisions(rects)).toEqual([]);
  }
}

function shape(
  index: number,
  total: number,
  partial: Partial<SlideContentShape>,
): SlideContentShape {
  return {
    index,
    total,
    hasMetric: false,
    hasChart: false,
    hasDiagram: false,
    hasMedia: false,
    hasFormula: false,
    bulletCount: 3,
    ...partial,
  };
}

describe('NodeSlide slide archetypes (variety + anti-monotony + geometry gate)', () => {
  it('materializes varied planned slides into >=3 distinct archetypes with zero collisions', () => {
    const rawSpec = {
      title: 'Archetype variety proof',
      narrative: ['Every content shape earns a distinct layout.'],
      slides: [
        {
          title: 'Opening',
          section: 'Open / 01',
          headline: 'A statement slide opens the deck.',
          body: 'Big headline, horizontal bullets, no visual competition.',
          bullets: ['Promise', 'Proof', 'Path'],
        },
        {
          title: 'Three forces',
          section: 'Forces / 02',
          headline: 'Three bullets and no visual become three columns.',
          body: 'The comparison archetype spreads the key points across the canvas.',
          bullets: ['Speed compounds', 'Trust is earned', 'Structure survives'],
        },
        {
          title: 'The number',
          section: 'Metric / 03',
          headline: 'One metric carries this slide.',
          body: 'Stat-dominant layout: copy on the left, a huge metric on the right.',
          bullets: ['Measured, not asserted'],
          metric: '48%',
          metricLabel: 'reduction in handoff rework',
        },
        {
          title: 'The trend',
          section: 'Trend / 04',
          headline: 'The chart claims the majority of the canvas.',
          body: 'Chart-dominant layout narrows the copy column.',
          bullets: ['Quarterly signal'],
          chart: { labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [3, 5, 8, 13], unit: 'wins' },
        },
        {
          title: 'The picture',
          section: 'Evidence / 05',
          headline: 'Visual evidence anchors the slide.',
          body: 'Media-dominant layout gives the image its own column.',
          bullets: ['Replaceable, credited visual'],
          image: {
            altText: 'Workflow evidence screenshot placeholder',
            caption: 'Replace with a licensed asset before publication.',
          },
        },
        {
          title: 'The mechanics',
          section: 'Mechanics / 06',
          headline: 'A formula renders as a split right-column panel.',
          body: 'Split layout keeps copy left and the structured panel right.',
          bullets: ['Editable inputs', 'Recomputable output'],
          formula: {
            expression: 'value = evidence / claims',
            display: 'value = evidence ÷ claims',
            variables: [],
            syntax: 'plain',
          },
        },
        {
          title: 'Closing',
          section: 'Close / 07',
          headline: 'A statement slide closes the deck.',
          body: 'Back to the horizontal-bullet statement layout for the send-off.',
          bullets: ['Decide', 'Own', 'Ship'],
        },
      ],
    };

    const { snapshot } = buildBriefNodeSlide({
      deckId: 'deck_archetype_variety',
      projectId: 'project_archetype_variety',
      title: 'Archetype variety proof',
      brief: BRIEF,
      themeId: 'editorial-signal',
      rawSpec,
      now: 1_700_000_000_000,
    });

    const archetypes = snapshot.slides.map((slide) => slide.archetype);
    expect(archetypes).toEqual([
      'statement',
      'comparison',
      'stat-dominant',
      'chart-dominant',
      'media-dominant',
      'split',
      'statement',
    ]);
    expect(new Set(archetypes).size).toBeGreaterThanOrEqual(3);
    for (let index = 1; index < archetypes.length; index += 1) {
      expect(archetypes[index]).not.toBe(archetypes[index - 1]);
    }
    expectZeroCollisions(snapshot);

    // Comparison slide: three bullets share one row in three distinct columns.
    const comparisonSlide = snapshot.slides[1];
    expect(comparisonSlide).toBeDefined();
    if (!comparisonSlide) return;
    const comparisonBullets = snapshot.elements
      .filter((element) => element.slideId === comparisonSlide.id && element.role === 'bullet')
      .sort((left, right) => left.bbox.x - right.bbox.x);
    expect(comparisonBullets).toHaveLength(3);
    const [firstColumn, secondColumn, thirdColumn] = comparisonBullets;
    expect(firstColumn && secondColumn && thirdColumn).toBeTruthy();
    if (!firstColumn || !secondColumn || !thirdColumn) return;
    expect(secondColumn.bbox.y).toBe(firstColumn.bbox.y);
    expect(thirdColumn.bbox.y).toBe(firstColumn.bbox.y);
    expect(secondColumn.bbox.x).toBeGreaterThanOrEqual(firstColumn.bbox.x + firstColumn.bbox.width);
    expect(thirdColumn.bbox.x).toBeGreaterThanOrEqual(
      secondColumn.bbox.x + secondColumn.bbox.width,
    );

    // Chart-dominant slide: the chart claims roughly the right 55%.
    const chartSlide = snapshot.slides[3];
    expect(chartSlide).toBeDefined();
    if (!chartSlide) return;
    const chartElement = snapshot.elements.find(
      (element) => element.slideId === chartSlide.id && element.kind === 'chart',
    );
    expect(chartElement).toBeDefined();
    expect(chartElement?.bbox.width ?? 0).toBeGreaterThanOrEqual(0.5);
    expect(chartElement?.bbox.x ?? 1).toBeLessThanOrEqual(0.45);
  });

  it('materializes a structured process as editable nodes and connectors', () => {
    const textSlide = (label: string) => ({
      title: label,
      section: `${label} / section`,
      headline: `${label} advances the story.`,
      body: 'Concise supporting copy.',
      bullets: ['Signal', 'Action'],
    });
    const { snapshot, spec } = buildBriefNodeSlide({
      deckId: 'deck_diagram',
      projectId: 'project_diagram',
      title: 'Structured diagram proof',
      brief: BRIEF,
      themeId: 'editorial-signal',
      rawSpec: {
        title: 'Structured diagram proof',
        narrative: ['Show relationships spatially.'],
        slides: [
          textSlide('Opening'),
          {
            ...textSlide('Workflow'),
            diagram: {
              kind: 'process',
              direction: 'horizontal',
              nodes: [
                { id: 'intake', label: 'Intake', kind: 'step' },
                { id: 'review', label: 'Review', kind: 'decision' },
                { id: 'ship', label: 'Ship', kind: 'milestone' },
              ],
              edges: [
                { from: 'intake', to: 'review' },
                { from: 'review', to: 'ship' },
                { from: 'missing', to: 'ship' },
              ],
            },
          },
          textSlide('Evidence'),
          textSlide('Mechanics'),
          textSlide('Delivery'),
          textSlide('Decision'),
        ],
      },
      now: 1_700_000_000_000,
    });

    const slide = snapshot.slides[1];
    expect(slide?.archetype).toBe('diagram-dominant');
    const diagramElements = snapshot.elements.filter(
      (element) => element.slideId === slide?.id && element.role?.startsWith('diagram_'),
    );
    expect(diagramElements.filter((element) => element.kind === 'shape')).toHaveLength(3);
    expect(diagramElements.filter((element) => element.kind === 'connector')).toHaveLength(2);
    expect(
      diagramElements
        .filter((element) => element.kind === 'shape')
        .map((element) => element.content),
    ).toEqual(['Intake', 'Review', 'Ship']);
    expect(spec.slides[1]?.diagram?.edges).toHaveLength(2);
    expectZeroCollisions(snapshot);
  });

  it('alternates the media column by slide index for deck rhythm', () => {
    const mediaSlide = (label: string) => ({
      title: label,
      section: `${label} / media`,
      headline: `${label} keeps the visual honest.`,
      body: 'Media-dominant layout with an explicit image placeholder.',
      bullets: ['Credited visual'],
      image: { altText: `${label} evidence placeholder` },
    });
    const textSlide = (label: string) => ({
      title: label,
      section: `${label} / copy`,
      headline: `${label} carries the argument.`,
      body: 'Copy-only slide between the two media slides.',
      bullets: ['One', 'Two', 'Three'],
    });
    const { snapshot } = buildBriefNodeSlide({
      deckId: 'deck_media_rhythm',
      projectId: 'project_media_rhythm',
      title: 'Media rhythm proof',
      brief: BRIEF,
      themeId: 'editorial-signal',
      rawSpec: {
        title: 'Media rhythm proof',
        narrative: ['Alternate the visual column.'],
        slides: [
          textSlide('Opening'),
          textSlide('Setup'),
          mediaSlide('Even media'), // index 2 → visual right
          mediaSlide('Odd media'), // index 3 → visual left
          textSlide('Bridge'),
          textSlide('Closing'),
        ],
      },
      now: 1_700_000_000_000,
    });
    const imageFor = (slideIndex: number) => {
      const slide = snapshot.slides[slideIndex];
      if (!slide) return undefined;
      return snapshot.elements.find(
        (element) => element.slideId === slide.id && element.kind === 'image',
      );
    };
    expect(snapshot.slides[2]?.archetype).toBe('media-dominant');
    expect(snapshot.slides[3]?.archetype).toBe('media-dominant');
    expect(imageFor(2)?.bbox.x ?? 0).toBeGreaterThan(0.5);
    expect(imageFor(3)?.bbox.x ?? 1).toBeLessThan(0.5);
    expectZeroCollisions(snapshot);
  });

  it('anti-monotony: adjacent identical shapes alternate when an alternative exists', () => {
    const total = 5;
    const middleThreeBullets = (index: number) => shape(index, total, { bulletCount: 3 });
    const chosen = chooseDeckArchetypes([
      shape(0, total, {}),
      middleThreeBullets(1),
      middleThreeBullets(2),
      middleThreeBullets(3),
      shape(4, total, {}),
    ]);
    expect(chosen).toEqual(['statement', 'comparison', 'split', 'comparison', 'statement']);

    // Media slides have no honest alternative: repeats are allowed there.
    expect(archetypeCandidates(shape(1, total, { hasMedia: true }))).toEqual(['media-dominant']);
    const mediaRun = chooseDeckArchetypes([
      shape(0, total, { hasMedia: true }),
      shape(1, total, { hasMedia: true }),
    ]);
    expect(mediaRun).toEqual(['media-dominant', 'media-dominant']);
  });
});
