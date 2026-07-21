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
