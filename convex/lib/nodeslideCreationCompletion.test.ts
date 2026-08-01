import { describe, expect, it } from 'vitest';
import { canonicalArtifactFixture } from '../../shared/nodeslideArtifactRegistry.fixtures';
import { assertNodeSlideArtifactCompilation } from '../../shared/nodeslideArtifactSpec';
import { publicRenderInput } from '../../src/domains/nodeslide/publicSurface/shareProjection';
import { sanitizeNodeSlideSnapshot } from './nodeslideData';
import { buildBriefNodeSlide, deterministicBriefSpec } from './nodeslideSeed';

const brief = {
  prompt: 'Create a 7-slide production decision with an equation and an architecture diagram.',
  audience: 'engineering leaders',
  purpose: 'Approve a controlled release',
  successCriteria: ['Keep invalid provider enrichment from aborting the whole deck'],
};

describe('NodeSlide creation completion boundary', () => {
  it('quarantines a mathematically invalid provider artifact and still completes the deck', () => {
    const rawSpec = structuredClone(deterministicBriefSpec('Completion boundary', brief));
    const artifactSlide = rawSpec.slides[3];
    expect(artifactSlide).toBeDefined();
    if (!artifactSlide) return;
    artifactSlide.artifactSpec = canonicalArtifactFixture('equation');
    const artifact = artifactSlide.artifactSpec as { payload?: { result?: number } };
    if (artifact?.payload) artifact.payload.result = 999;

    const built = buildBriefNodeSlide({
      deckId: 'deck-completion-boundary',
      projectId: 'project-completion-boundary',
      title: 'Completion boundary',
      brief,
      themeId: 'editorial-signal',
      rawSpec,
      now: 1_700_000_000_000,
    });

    expect(built.snapshot.slides).toHaveLength(7);
    // The provider's invalid equation is quarantined. The fallback must not
    // fabricate a replacement equation merely because the brief asked for one.
    expect(built.snapshot.elements.some((element) => element.kind === 'math')).toBe(false);
    expect(
      built.snapshot.elements.some(
        (element) => element.authoredArtifactBinding?.kind === 'equation',
      ),
    ).toBe(false);
  });

  it('turns a misaligned risk chart into an explicit evidence gap instead of aborting creation', () => {
    const rawSpec = structuredClone(deterministicBriefSpec('Risk release gate', brief));
    const artifactSlide = rawSpec.slides[4];
    expect(artifactSlide).toBeDefined();
    if (!artifactSlide) return;
    artifactSlide.artifactSpec = canonicalArtifactFixture('chart');
    const artifact = artifactSlide.artifactSpec as {
      payload?: { series?: Array<{ values?: number[] }> };
    };
    artifact.payload?.series?.[0]?.values?.pop();

    const built = buildBriefNodeSlide({
      deckId: 'deck-risk-chart-boundary',
      projectId: 'project-risk-chart-boundary',
      title: 'Risk release gate',
      brief,
      themeId: 'editorial-signal',
      rawSpec,
      now: 1_700_000_000_000,
    });

    expect(built.snapshot.slides).toHaveLength(7);
    expect(
      built.snapshot.elements.some(
        (element) =>
          element.kind === 'text' &&
          typeof element.content === 'string' &&
          element.content.includes('The release gate stays closed until the evidence is verified'),
      ),
    ).toBe(true);
    expect(
      built.snapshot.elements.some((element) => element.authoredArtifactBinding?.kind === 'chart'),
    ).toBe(false);
  });

  it('quarantines a risk matrix with missing axis anchors instead of aborting creation', () => {
    const rawSpec = structuredClone(deterministicBriefSpec('Risk matrix boundary', brief));
    const artifactSlide = rawSpec.slides[5];
    expect(artifactSlide).toBeDefined();
    if (!artifactSlide) return;
    artifactSlide.artifactSpec = canonicalArtifactFixture('risk-matrix');
    const artifact = artifactSlide.artifactSpec as {
      payload?: { likelihoodAxis?: { high?: string }; risks?: unknown[] };
    };
    if (artifact.payload?.likelihoodAxis) {
      artifact.payload.likelihoodAxis.high = undefined;
    }
    if (artifact.payload) artifact.payload.risks = [];

    const built = buildBriefNodeSlide({
      deckId: 'deck-risk-axis-boundary',
      projectId: 'project-risk-axis-boundary',
      title: 'Risk matrix boundary',
      brief,
      themeId: 'editorial-signal',
      rawSpec,
      now: 1_700_000_000_000,
    });

    expect(built.snapshot.slides).toHaveLength(7);
    expect(
      built.snapshot.elements.some(
        (element) => element.authoredArtifactBinding?.kind === 'risk-matrix',
      ),
    ).toBe(false);
    expect(
      built.snapshot.elements.some(
        (element) =>
          element.kind === 'text' &&
          element.role === 'headline' &&
          element.content === artifactSlide.headline,
      ),
    ).toBe(true);
  });

  it('lets an owner publish a chart without exposing the private evidence record', () => {
    const built = buildBriefNodeSlide({
      deckId: 'deck-public-chart',
      projectId: 'project-public-chart',
      title: 'Public chart',
      brief,
      themeId: 'editorial-signal',
      now: 1_700_000_000_000,
    });
    const privateSources = built.snapshot.sources.filter((source) => source.sourceType !== 'url');
    expect(privateSources.length).toBeGreaterThan(0);

    const published = sanitizeNodeSlideSnapshot(built.snapshot);

    expect(() =>
      assertNodeSlideArtifactCompilation(
        publicRenderInput({
          publication: {
            id: 'publication-public-chart',
            deckId: published.deck.id,
            shareSlug: 'share-public-chart',
            revision: 1,
            deckVersion: published.deck.version,
            validationId: 'validation-public-chart',
            status: 'active',
            publishedAt: 1_700_000_000_000,
          },
          snapshot: published,
        }),
      ),
    ).not.toThrow();
    expect(published.slides.map((slide) => slide.archetype)).toEqual(
      built.snapshot.slides.map((slide) => slide.archetype),
    );
    expect(published.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Private evidence',
          sourceType: 'note',
          retention: 'public_snapshot',
        }),
      ]),
    );
    expect(JSON.stringify(published.sources)).not.toContain(privateSources[0]?.title);
    expect(JSON.stringify(published.sources)).not.toContain(brief.prompt);
  });
});
