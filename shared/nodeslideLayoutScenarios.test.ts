import { describe, expect, it } from 'vitest';
import { buildBriefNodeSlide, buildGoldenNodeSlide } from '../convex/lib/nodeslideSeed';
import { validateNodeSlideSnapshot } from '../convex/lib/nodeslideValidation';
import type { DeckSnapshot, SlideElement } from './nodeslide';
import { findCollisions } from './nodeslideLayoutMetrics';

const BRIEF = {
  prompt: 'Build a long-copy evidence story that must never ship colliding geometry.',
  audience: 'Reviewers',
  purpose: 'Prove measured layout',
  successCriteria: ['Zero colliding elements'],
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

function baseSlide(index: number) {
  return {
    title: `Slide ${index + 1}`,
    section: `Story / ${index + 1}`,
    headline: `Point ${index + 1}`,
    body: 'A bounded statement.',
    bullets: ['Context', 'Action', 'Outcome'],
  };
}

describe('NodeSlide layout scenarios (measured stacking + collision gate)', () => {
  it('materializes a long-copy slide (600-char body + 3 bullets + chart) with zero collisions', () => {
    const longBody = Array.from({ length: 75 }, () => 'measured').join(' ');
    expect(longBody.length).toBeGreaterThanOrEqual(600);
    const longBullets = [
      'A deliberately verbose first key point that keeps wrapping onto extra lines of copy',
      'A second key point that is also much longer than the compact default bullet length',
      'A third key point stretching the stack so the geometry gate has to earn its keep',
    ];
    const rawSpec = {
      title: 'Long copy proof',
      narrative: ['Prove measured layout.'],
      slides: [
        baseSlide(0),
        {
          ...baseSlide(1),
          body: longBody,
          bullets: longBullets,
          chart: { labels: ['Before', 'After'], values: [3, 9], unit: 'score' },
        },
        baseSlide(2),
        baseSlide(3),
        baseSlide(4),
        baseSlide(5),
      ],
    };

    const snapshot = buildBriefNodeSlide({
      deckId: 'deck-long-copy-layout',
      projectId: 'project-long-copy-layout',
      title: 'Long copy proof',
      brief: BRIEF,
      themeId: 'quiet-precision',
      rawSpec,
      now: 1_000,
    }).snapshot;

    expectZeroCollisions(snapshot);
    const issues = validateNodeSlideSnapshot(snapshot, 1_000).issues;
    expect(issues.filter((issue) => issue.code === 'collision')).toEqual([]);
    expect(issues.filter((issue) => issue.code === 'overflow')).toEqual([]);

    // Bullets stack sequentially below the body block on the long-copy slide.
    const longSlide = snapshot.slides[1];
    if (!longSlide) throw new Error('Missing long-copy slide.');
    const slideElements = collidableElements(snapshot, longSlide.id);
    const body = slideElements.find((element) => element.role === 'body');
    const bullets = slideElements
      .filter((element) => element.role === 'bullet')
      .sort((left, right) => left.bbox.y - right.bbox.y);
    if (!body || bullets.length !== 3) throw new Error('Missing body or bullet fixtures.');
    expect(bullets[0]?.bbox.y ?? 0).toBeGreaterThanOrEqual(body.bbox.y + body.bbox.height);
    for (let index = 1; index < bullets.length; index += 1) {
      const previous = bullets[index - 1];
      const current = bullets[index];
      if (!previous || !current) throw new Error('Missing bullet fixture.');
      expect(current.bbox.y).toBeGreaterThanOrEqual(previous.bbox.y + previous.bbox.height);
    }
    // Everything stays above the bottom edge, clear of the footer band start.
    for (const element of [body, ...bullets]) {
      expect(element.bbox.y).toBeLessThanOrEqual(0.9);
      expect(element.bbox.y + element.bbox.height).toBeLessThanOrEqual(1);
    }
  });

  it('regression: opening slide with a visual no longer collides body and bullets (shipped bug)', () => {
    // The shipped bug: opening slides with a visual used a fixed body height
    // that overlapped the fixed bullet stack by ~33%. The narrow patch pinned
    // body height to 0.13; measured stacking is the root fix.
    const longOpeningBody = Array.from({ length: 50 }, () => 'structure').join(' ');
    const rawSpec = {
      title: 'Opening visual regression',
      narrative: ['Regression coverage.'],
      slides: [
        {
          ...baseSlide(0),
          body: longOpeningBody,
          metric: '3 gates',
          metricLabel: 'independent validation signals',
        },
        baseSlide(1),
        baseSlide(2),
        baseSlide(3),
        baseSlide(4),
        baseSlide(5),
      ],
    };

    const snapshot = buildBriefNodeSlide({
      deckId: 'deck-opening-visual-regression',
      projectId: 'project-opening-visual-regression',
      title: 'Opening visual regression',
      brief: BRIEF,
      themeId: 'editorial-signal',
      rawSpec,
      now: 1_000,
    }).snapshot;

    expectZeroCollisions(snapshot);
    const opening = snapshot.slides[0];
    if (!opening) throw new Error('Missing opening slide.');
    const slideElements = collidableElements(snapshot, opening.id);
    const body = slideElements.find((element) => element.role === 'body');
    const firstBullet = slideElements
      .filter((element) => element.role === 'bullet')
      .sort((left, right) => left.bbox.y - right.bbox.y)[0];
    if (!body || !firstBullet) throw new Error('Missing body or bullet fixture.');
    // The body height derives from its content instead of the 0.13 patch...
    expect(body.bbox.height).toBeGreaterThanOrEqual(0.17);
    // ...and the bullet stack starts below the measured body block.
    expect(firstBullet.bbox.y).toBeGreaterThanOrEqual(body.bbox.y + body.bbox.height);
  });

  it('keeps the golden deck collision-free under the stricter 8% geometry gate', () => {
    const snapshot = buildGoldenNodeSlide('layout-scenario-golden', 1_000).snapshot;
    expectZeroCollisions(snapshot);
    expect(validateNodeSlideSnapshot(snapshot, 1_000).issues).toEqual([]);
  });
});
