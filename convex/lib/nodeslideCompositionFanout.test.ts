import { describe, expect, it } from 'vitest';
import {
  fanOutNodeSlideComposition,
  observeNodeSlideCompositionBounds,
  proposeNodeSlideCompositionBoundsRepair,
} from './nodeslideCompositionFanout';
import { runNodeSlideRenderRepairLoop } from './nodeslideRenderRepairLoop';
import { buildBriefNodeSlide, deterministicBriefSpec } from './nodeslideSeed';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

const NOW = 1_700_000_000_000;

function fixture() {
  const brief = {
    prompt: 'Create a seven-slide review with a chart and architecture diagram.',
    audience: 'product leaders',
    purpose: 'Choose the rollout path',
    successCriteria: ['Keep evidence explicit'],
  };
  const spec = deterministicBriefSpec('Composition fan-out', brief);
  return buildBriefNodeSlide({
    deckId: 'deck-composition-fanout',
    projectId: 'project-composition-fanout',
    title: spec.title,
    brief,
    themeId: 'editorial-signal',
    rawSpec: spec,
    now: NOW,
  });
}

describe('NodeSlide rendered composition fan-out', () => {
  it('generates three geometry-distinct candidates and selects a clean winner', () => {
    const built = fixture();
    const plan = built.spec.designPlans?.find((candidate) => candidate.requiredArtifacts.length);
    if (!plan) throw new Error('Expected a visually important slide plan.');
    const slide = built.snapshot.slides[plan.slideIndex];
    if (!slide) throw new Error('Expected a planned slide.');
    const elements = built.snapshot.elements.filter((element) => element.slideId === slide.id);
    const result = fanOutNodeSlideComposition({ elements, plan });

    expect(result.candidates.map((candidate) => candidate.variant)).toEqual([
      'canonical',
      'mirrored',
      'visual-focus',
    ]);
    expect(new Set(result.candidates.map((candidate) => candidate.referenceId)).size).toBe(3);
    expect(result.candidates.filter((candidate) => candidate.selected)).toHaveLength(1);
    expect(result.candidates.find((candidate) => candidate.selected)?.outOfBoundsCount).toBe(0);
  });

  it('persists fan-out receipts for every visually important materialized slide', () => {
    const built = fixture();
    const importantCount = built.spec.designPlans?.length ?? 0;

    expect(importantCount).toBeGreaterThan(0);
    expect(built.spec.compositionFanout).toHaveLength(importantCount * 3);
    expect(built.spec.compositionFanout?.filter((candidate) => candidate.selected)).toHaveLength(
      importantCount,
    );
    expect(validateNodeSlideSnapshot(built.snapshot, NOW).publishOk).toBe(true);
  });

  it('refuses to mirror a horizontal numbered sequence into right-to-left reading order', () => {
    const built = fixture();
    const slide = built.snapshot.slides.find((candidate) => {
      const bullets = built.snapshot.elements.filter(
        (element) => element.slideId === candidate.id && element.role === 'bullet',
      );
      return bullets.length >= 2;
    });
    const basePlan = built.spec.designPlans?.[0];
    if (!slide || !basePlan) throw new Error('Expected a bullet slide and plan.');
    let bulletIndex = 0;
    const elements = built.snapshot.elements
      .filter((element) => element.slideId === slide.id)
      .map((element) => {
        if (element.role !== 'bullet') return element;
        const horizontal = {
          ...element,
          bbox: { ...element.bbox, x: 0.07 + bulletIndex * 0.28, y: 0.72 },
        };
        bulletIndex += 1;
        return horizontal;
      });
    const result = fanOutNodeSlideComposition({
      elements,
      plan: { ...basePlan, slideIndex: 2 },
    });

    expect(
      result.candidates.find((candidate) => candidate.variant === 'mirrored')?.score,
    ).toBeLessThan(0);
    expect(result.candidates.find((candidate) => candidate.selected)?.variant).not.toBe('mirrored');
  });

  it('keeps a risk-committee process diagram in semantic reading order across sustained fan-out', () => {
    const built = fixture();
    const slideIndex = built.snapshot.slides.findIndex((candidate) =>
      built.snapshot.elements.some(
        (element) => element.slideId === candidate.id && element.role?.startsWith('diagram_'),
      ),
    );
    const slide = built.snapshot.slides[slideIndex];
    const plan = built.spec.designPlans?.find((candidate) => candidate.slideIndex === slideIndex);
    if (!slide || !plan) throw new Error('Expected a diagram slide and plan.');
    const elements = built.snapshot.elements.filter((element) => element.slideId === slide.id);

    for (let iteration = 0; iteration < 100; iteration += 1) {
      const result = fanOutNodeSlideComposition({ elements, plan });
      expect(
        result.candidates.find((candidate) => candidate.variant === 'mirrored')?.score,
      ).toBeLessThan(0);
      expect(result.candidates.find((candidate) => candidate.selected)?.variant).not.toBe(
        'mirrored',
      );
    }
  });

  it('mirrors connector direction with its geometry instead of leaving a reversed arrow', () => {
    const built = fixture();
    const connector = built.snapshot.elements.find((element) => element.kind === 'connector');
    if (!connector) throw new Error('Expected a connector.');
    const slideIndex = built.snapshot.slides.findIndex(
      (candidate) => candidate.id === connector.slideId,
    );
    const plan = built.spec.designPlans?.find((candidate) => candidate.slideIndex === slideIndex);
    if (!plan) throw new Error('Expected the connector slide plan.');
    const result = fanOutNodeSlideComposition({ elements: [connector], plan });
    const mirrored = result.renderCandidates
      .find((candidate) => candidate.variant === 'mirrored')
      ?.elements.find((element) => element.id === connector.id);

    expect(mirrored?.rotation).toBe(
      Number((((180 - connector.rotation) % 360) + 360).toFixed(6)) % 360,
    );
  });

  it('feeds pixel-adapter observations into the bounded loop and emits a concrete move repair', () => {
    const built = fixture();
    const dirty = structuredClone(built.snapshot);
    const target = dirty.elements.find((element) => !element.locked && element.kind === 'text');
    if (!target) throw new Error('Expected an editable text element.');
    target.bbox.x = -0.04;

    const result = runNodeSlideRenderRepairLoop({
      base: dirty,
      callbacks: {
        validate: (snapshot) => ({
          clean: observeNodeSlideCompositionBounds(snapshot, target.slideId).length === 0,
          safetyPassed: true,
          issues: [],
        }),
        render: ({ snapshotDigest }) => ({
          artifact: { kind: 'pixel-candidate', snapshotDigest },
          bytes: 128,
        }),
        observe: () => ({
          clean: false,
          observations: observeNodeSlideCompositionBounds(dirty, target.slideId),
        }),
        proposeRepair: ({ snapshot }) =>
          proposeNodeSlideCompositionBoundsRepair(snapshot as typeof dirty, target.slideId),
      },
      now: () => NOW,
    });

    expect(result.terminalReason).toBe('clean');
    expect(result.operations).toEqual([
      expect.objectContaining({ op: 'move', elementId: target.id, x: 0 }),
    ]);
    expect(dirty.elements.find((element) => element.id === target.id)?.bbox.x).toBe(-0.04);
    expect(result.candidate.elements.find((element) => element.id === target.id)?.bbox.x).toBe(0);
  });
});
