import { describe, expect, it } from 'vitest';
import {
  ATLAS_V2_ARTIFACTS,
  ATLAS_V2_DOMAIN_PACKS,
  ATLAS_V2_SHOWCASE_IDS,
  ATLAS_V2_THEMES,
  ATLAS_V2_THEME_VARIANTS,
  ATLAS_V2_THEME_VARIANT_IDS,
} from './lib/artifact-atlas-v2-definition.mjs';
import { validateArtifactSpec } from './lib/artifact-spec-core.mjs';

describe('NodeSlide Artifact Atlas V2', () => {
  it('freezes the complete 38-artifact museum and 14-slide public narrative', () => {
    expect(ATLAS_V2_ARTIFACTS).toHaveLength(38);
    expect(new Set(ATLAS_V2_ARTIFACTS.map((artifact) => artifact.id)).size).toBe(38);
    expect(ATLAS_V2_SHOWCASE_IDS).toHaveLength(14);
    expect(new Set(ATLAS_V2_SHOWCASE_IDS).size).toBe(14);
    expect(
      ATLAS_V2_SHOWCASE_IDS.every((id) =>
        ATLAS_V2_ARTIFACTS.some((artifact) => artifact.id === id),
      ),
    ).toBe(true);
  });

  it('covers all requested chapters and advanced visual families', () => {
    expect(new Set(ATLAS_V2_ARTIFACTS.map((artifact) => artifact.chapter))).toEqual(
      new Set([
        'narrative-foundations',
        'data',
        'systems',
        'progression',
        'product-media',
        'evidence-technical-proof',
        'decision-evaluation',
      ]),
    );
    for (const id of [
      'waterfall',
      'dense-dashboard-funnel',
      'source-allocation-sankey',
      'quality-cost-scatter',
      'roadmap-gantt',
      'causal-loop',
      'routing-decision-tree',
      'ecosystem-geography',
      'interaction-clip',
      'harness-compare',
      'model-compare',
    ]) {
      expect(ATLAS_V2_ARTIFACTS.some((artifact) => artifact.id === id)).toBe(true);
    }
  });

  it('attaches a reusable recipe, export behavior, and accessibility contract to every artifact', () => {
    for (const artifact of ATLAS_V2_ARTIFACTS) {
      expect(artifact.recipe.recipeId).toContain(artifact.id);
      expect(artifact.recipe.requiredInputs.length).toBeGreaterThan(0);
      expect(artifact.behavior).toMatchObject({
        web: expect.any(String),
        powerpoint: expect.any(String),
        pdf: expect.any(String),
        reducedMotion: expect.any(String),
      });
      expect(artifact.accessibility).toMatchObject({
        altText: expect.any(String),
        highContrast: true,
        reducedMotion: true,
      });
      expect(artifact.evidence.length).toBeGreaterThan(0);
      expect(artifact.allowedClaims.length).toBeGreaterThan(0);
      expect(validateArtifactSpec(artifact.artifactSpec).ok).toBe(true);
    }
  });

  it('uses artifact-specific inputs and rules instead of one generic recipe', () => {
    const inputSignatures = new Set(
      ATLAS_V2_ARTIFACTS.map((artifact) => artifact.recipe.requiredInputs.join('|')),
    );
    const ruleSignatures = new Set(
      ATLAS_V2_ARTIFACTS.map((artifact) => artifact.recipe.designRules.join('|')),
    );
    expect(inputSignatures.size).toBeGreaterThanOrEqual(6);
    expect(ruleSignatures.size).toBeGreaterThanOrEqual(10);
  });

  it('expands theme intelligence and domain coverage without multiplying fixtures', () => {
    expect(Object.keys(ATLAS_V2_THEMES)).toHaveLength(7);
    expect(ATLAS_V2_THEME_VARIANT_IDS).toHaveLength(4);
    expect(ATLAS_V2_THEME_VARIANTS).toHaveLength(3);
    expect(ATLAS_V2_THEME_VARIANT_IDS.length * ATLAS_V2_THEME_VARIANTS.length).toBe(12);
    expect(ATLAS_V2_DOMAIN_PACKS).toHaveLength(6);
    expect(new Set(ATLAS_V2_DOMAIN_PACKS.map((pack) => pack.id))).toEqual(
      new Set([
        'founder-roadshow',
        'research-talk',
        'board-operating-review',
        'technical-architecture-review',
        'investment-finance',
        'product-launch',
      ]),
    );
  });
});
