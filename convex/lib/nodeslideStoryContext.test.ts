import { describe, expect, it } from 'vitest';
import { coerceBriefSpec, deterministicBriefSpec } from './nodeslideSeed';
import { buildNodeSlideStoryContext } from './nodeslideStoryContext';

const BRIEF = {
  prompt:
    'Create a 7-slide launch review with a revenue chart, an architecture diagram, a product screenshot, a code sample, and an execution trace.',
  audience: 'engineering and product leaders',
  purpose: 'Decide whether the launch is ready to expand',
  successCriteria: ['Make the evidence boundary obvious', 'Name the rollout owner'],
};

describe('NodeSlide StorySpec and visual-material inventory', () => {
  it('classifies supplied, constructible, placeholder, and missing material before composition', () => {
    const context = buildNodeSlideStoryContext({
      title: 'Launch review',
      brief: BRIEF,
      attachments: [
        { title: 'revenue.csv', format: 'csv', content: 'quarter,revenue\nQ1,120\nQ2,180' },
        { title: 'renderer.ts', format: 'txt', content: 'export function render() {}' },
      ],
    });

    expect(context.materialInventory.availableKinds).toEqual(
      expect.arrayContaining(['brief', 'dataset', 'code']),
    );
    expect(context.materialInventory.constructibleKinds).toEqual(
      expect.arrayContaining(['numeric-series', 'diagram']),
    );
    expect(context.materialInventory.blockedKinds).toEqual(
      expect.arrayContaining(['screenshot', 'execution-trace']),
    );
    expect(
      context.materialInventory.materials.find((material) => material.kind === 'screenshot'),
    ).toMatchObject({ status: 'placeholder' });
    expect(
      context.storySpec.proofObligations.find(
        (obligation) => obligation.requiredMaterialKinds[0] === 'screenshot',
      ),
    ).toMatchObject({ fulfillment: 'blocked' });
    expect(
      context.storySpec.proofObligations.find(
        (obligation) => obligation.requiredMaterialKinds[0] === 'numeric-series',
      ),
    ).toMatchObject({ fulfillment: 'constructible' });
    expect(context.storySpec.pacing.reduce((sum, phase) => sum + phase.slideCount, 0)).toBe(7);
    expect(context.storySpec.sceneContinuity.progression).toHaveLength(7);
    expect(context.storySpec.sceneStates).toHaveLength(7);
    expect(context.storySpec.sceneStates.map(({ stage }) => stage)).toEqual([
      'establish',
      'pressure',
      'approach',
      'crossing',
      'proof',
      'release',
      'release',
    ]);
    expect(
      new Set(context.storySpec.sceneStates.map(({ subjectState }) => subjectState)).size,
    ).toBe(6);
    expect(context.storySpec.visualMetaphor.kind).toBe('bridge');
    expect(context.storySpec.revealPacing.map(({ beat }) => beat)).toEqual([
      'orient',
      'tension',
      'hint',
      'reveal',
      'prove',
      'resolve',
      'resolve',
    ]);
    expect(Math.max(...context.storySpec.emotionalArc.intensity)).toBe(100);
    expect(context.storySpec.emotionalArc.intensity.at(-1)).toBeLessThan(100);
    expect(new Set(context.storySpec.compositionPlan).size).toBeGreaterThanOrEqual(6);
  });

  it('does not turn explicit visual prohibitions into proof obligations', () => {
    const context = buildNodeSlideStoryContext({
      title: 'Investor briefing',
      brief: {
        prompt:
          'Use two charts, but no fake screenshots, without stock photos, and never include a code sample.',
        audience: 'board directors',
        purpose: 'Choose the operating plan',
        successCriteria: ['Label forward-looking assumptions'],
      },
    });
    const requiredKinds = context.storySpec.proofObligations.flatMap(
      (obligation) => obligation.requiredMaterialKinds,
    );

    expect(requiredKinds).toContain('numeric-series');
    expect(requiredKinds).not.toContain('screenshot');
    expect(requiredKinds).not.toContain('image');
    expect(requiredKinds).not.toContain('code');
    expect(context.materialInventory.blockedKinds).not.toEqual(
      expect.arrayContaining(['screenshot', 'image', 'code']),
    );
  });

  it('keeps cinematic direction bounded and deterministic under a sustained 300-brief agent run', () => {
    const receipts = Array.from(
      { length: 300 },
      (_, index) =>
        buildNodeSlideStoryContext({
          title: `Agent review ${index}`,
          brief: {
            ...BRIEF,
            prompt: `Create a ${6 + (index % 3)}-slide security decision with evidence ${index}.`,
          },
        }).storySpec,
    );

    for (const receipt of receipts) {
      expect(receipt.revealPacing.length).toBeGreaterThanOrEqual(6);
      expect(receipt.revealPacing.length).toBeLessThanOrEqual(8);
      expect(receipt.sceneContinuity.progression).toHaveLength(receipt.revealPacing.length);
      expect(receipt.sceneStates).toHaveLength(receipt.revealPacing.length);
      expect(
        receipt.sceneStates.every((state, index) => state.progress > 0 && state.index === index),
      ).toBe(true);
      expect(receipt.compositionPlan).toHaveLength(receipt.revealPacing.length);
      expect(new Set(receipt.compositionPlan).size).toBeGreaterThanOrEqual(6);
      expect(receipt.emotionalArc.intensity.every((value) => value >= 0 && value <= 100)).toBe(
        true,
      );
    }
    expect(buildNodeSlideStoryContext({ title: 'Repeat', brief: BRIEF }).storySpec).toEqual(
      buildNodeSlideStoryContext({ title: 'Repeat', brief: BRIEF }).storySpec,
    );
  });

  it('blocks a requested chart when no numeric evidence is supplied', () => {
    const context = buildNodeSlideStoryContext({
      title: 'Qualitative review',
      brief: {
        ...BRIEF,
        prompt: 'Create a chart of customer outcomes, but no values are available yet.',
      },
    });

    expect(
      context.materialInventory.materials.find((material) => material.kind === 'numeric-series'),
    ).toMatchObject({ status: 'missing' });
    expect(context.storySpec.proofObligations[0]).toMatchObject({ fulfillment: 'blocked' });
  });

  it('carries a 12-slide governance request through pacing, continuity, and reveal contracts', () => {
    const context = buildNodeSlideStoryContext({
      title: 'AI governance release decision',
      brief: {
        ...BRIEF,
        prompt:
          'Create a 12-slide governance deck that moves from inventory through evidence to a release decision.',
      },
    });

    expect(context.storySpec.pacing.reduce((sum, phase) => sum + phase.slideCount, 0)).toBe(12);
    expect(context.storySpec.sceneContinuity.progression).toHaveLength(12);
    expect(context.storySpec.sceneStates).toHaveLength(12);
    expect(context.storySpec.sceneStates.at(-1)).toMatchObject({
      stage: 'release',
      progress: 1,
    });
    expect(context.storySpec.revealPacing).toHaveLength(12);
    expect(context.storySpec.compositionPlan).toHaveLength(12);
    expect(Math.max(...context.storySpec.emotionalArc.intensity)).toBe(100);
  });

  it('recomputes the authoritative context instead of trusting provider material claims', () => {
    const providerSpec = deterministicBriefSpec('Screenshot review', {
      ...BRIEF,
      prompt: 'Include a product screenshot as proof.',
    });
    const coerced = coerceBriefSpec(
      {
        ...providerSpec,
        materialInventory: {
          materials: [
            {
              id: 'provider-lie',
              kind: 'screenshot',
              status: 'available',
              title: 'Captured UI',
              provenance: 'derived',
              detail: 'Not actually captured.',
            },
          ],
          availableKinds: ['screenshot'],
          constructibleKinds: [],
          blockedKinds: [],
        },
      },
      'Screenshot review',
      { ...BRIEF, prompt: 'Include a product screenshot as proof.' },
    );

    expect(coerced.materialInventory?.availableKinds).not.toContain('screenshot');
    expect(coerced.materialInventory?.blockedKinds).toContain('screenshot');
    expect(coerced.materialInventory?.materials).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'provider-lie' })]),
    );
  });
});
