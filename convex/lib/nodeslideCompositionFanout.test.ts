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
