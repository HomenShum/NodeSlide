import { describe, expect, it } from 'vitest';
import { NODESLIDE_COMPOSITION_REFERENCES, buildNodeSlideDesignPlans } from './nodeslideDesignPlan';
import { deterministicBriefSpec } from './nodeslideSeed';

describe('NodeSlide reference-bound design plans', () => {
  it('provides four annotated references for every supported archetype', () => {
    for (const archetype of [
      'statement',
      'split',
      'comparison',
      'stat-dominant',
      'chart-dominant',
      'diagram-dominant',
      'media-dominant',
    ] as const) {
      const references = NODESLIDE_COMPOSITION_REFERENCES.filter(
        (reference) => reference.archetype === archetype,
      );
      expect(references).toHaveLength(4);
      expect(references.every((reference) => reference.useWhen && reference.avoidWhen)).toBe(true);
    }
  });

  it('persists one semantic plan per slide with material and forbidden-pattern bindings', () => {
    const spec = deterministicBriefSpec('Launch decision', {
      prompt:
        'Create a seven-slide launch decision with a revenue chart, architecture diagram, formula, and product image.',
      audience: 'product leaders',
      purpose: 'Choose the rollout path',
      successCriteria: ['Keep evidence explicit'],
    });

    expect(spec.designPlans).toHaveLength(spec.slides.length);
    expect(spec.designPlans?.every((plan) => plan.referenceIds.length === 4)).toBe(true);
    expect(spec.designPlans?.every((plan) => plan.narrativeJob && plan.compositionIntent)).toBe(
      true,
    );
    expect(
      spec.designPlans?.every((plan) =>
        plan.forbiddenPatterns.includes('repeated card-grid silhouette'),
      ),
    ).toBe(true);
    expect(spec.designPlans?.find((plan) => plan.dominantVisualCenter === 'diagram')).toMatchObject(
      {
        semanticArchetype: 'diagram-dominant',
        requiredArtifacts: ['diagram'],
      },
    );
  });

  it('rebuilds plans from normalized slides instead of accepting provider-selected references', () => {
    const spec = deterministicBriefSpec('Reference honesty', {
      prompt: 'Explain a process with an architecture diagram.',
      audience: 'reviewers',
      purpose: 'Choose a system boundary',
      successCriteria: ['Make dependencies visible'],
    });
    const plans = buildNodeSlideDesignPlans({ slides: spec.slides, storySpec: spec.storySpec });

    expect(plans.some((plan) => plan.referenceIds.includes('provider/fabricated-reference'))).toBe(
      false,
    );
    expect(
      plans.every((plan) => plan.referenceIds.every((id) => id.startsWith('nodeslide-ref/'))),
    ).toBe(true);
  });
});
