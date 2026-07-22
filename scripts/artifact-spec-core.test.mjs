import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_SPEC_SCHEMA_VERSION,
  artifactSpecEnvelope,
  buildArtifactReceipt,
  evaluateExpression,
  validateArtifactSpec,
} from './lib/artifact-spec-core.mjs';

const artifact = {
  id: 'fixture',
  narrativeJob: 'Prove the typed boundary.',
  allowedClaims: ['bounded claim'],
  evidence: [{ sourceId: 'source:1', content: 'Observed fixture.' }],
  accessibility: { altText: 'Fixture', readingOrder: 'title, visual, source' },
};

describe('typed ArtifactSpec semantic gates', () => {
  it('fails closed instead of throwing when an executor omits the spec', () => {
    const validation = validateArtifactSpec(undefined);
    expect(validation.ok).toBe(false);
    expect(validation.specDigest).toBeNull();
    expect(validation.issues.map((entry) => entry.code)).toContain('artifact_shape');
  });

  it('evaluates the quality-cost expression rather than substituting Q/C', () => {
    const expression = {
      op: 'divide',
      args: [
        { op: 'value', name: 'Q' },
        {
          op: 'add',
          args: [
            { op: 'value', name: 'one' },
            {
              op: 'multiply',
              args: [
                { op: 'value', name: 'alpha' },
                { op: 'value', name: 'C' },
              ],
            },
            {
              op: 'multiply',
              args: [
                { op: 'value', name: 'beta' },
                { op: 'value', name: 'L' },
              ],
            },
          ],
        },
      ],
    };
    expect(
      evaluateExpression(expression, { Q: 0.75, one: 1, alpha: 0.4, C: 0.038, beta: 0.1, L: 1.04 }),
    ).toBeCloseTo(0.6701, 4);
    const spec = artifactSpecEnvelope(artifact, 'equation', {
      expression,
      values: { Q: 0.75, one: 1, alpha: 0.4, C: 0.038, beta: 0.1, L: 1.04 },
      result: 19.74,
    });
    expect(validateArtifactSpec(spec).issues.map((entry) => entry.code)).toContain(
      'equation_evaluation_mismatch',
    );
  });

  it('catches waterfall totals, Sankey conservation, graph polarity, Gantt precedence, and unobserved comparisons', () => {
    const cases = [
      artifactSpecEnvelope(artifact, 'waterfall', {
        baseline: 62,
        deltas: [{ label: 'Plan', value: 8 }],
        final: 99,
        unit: 'quality points',
      }),
      artifactSpecEnvelope(artifact, 'sankey', {
        unit: 'claims',
        nodes: [
          { id: 'a', layer: 'source' },
          { id: 'b', layer: 'middle' },
          { id: 'c', layer: 'sink' },
        ],
        links: [
          { source: 'a', target: 'b', value: 4 },
          { source: 'b', target: 'c', value: 2 },
        ],
      }),
      artifactSpecEnvelope(artifact, 'causal-loop', {
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [{ id: 'e', from: 'a', to: 'b', directed: true, polarity: 'R+' }],
        loops: [{ id: 'r', type: 'reinforcing', edgeIds: ['e'] }],
      }),
      artifactSpecEnvelope(artifact, 'gantt', {
        unit: 'week',
        tasks: [
          { id: 'source', start: 1, end: 4, confidence: 0.9, dependsOn: [] },
          { id: 'dependent', start: 3, end: 5, confidence: 0.8, dependsOn: ['source'] },
        ],
      }),
      artifactSpecEnvelope(artifact, 'comparison', {
        metrics: [{ id: 'quality', unit: 'score' }],
        cohorts: [{ id: 'pilot', status: 'pilot', plotted: true, values: {} }],
      }),
    ];
    expect(cases.map((spec) => validateArtifactSpec(spec).ok)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('never promotes from file/render existence alone', () => {
    const spec = {
      ...artifactSpecEnvelope(artifact, 'generic', { label: 'fixture' }),
      schemaVersion: ARTIFACT_SPEC_SCHEMA_VERSION,
    };
    const validation = validateArtifactSpec(spec);
    const receipt = buildArtifactReceipt({
      spec,
      validation,
      stages: { browser: { status: 'passed', issues: [] }, pptx: { status: 'passed', issues: [] } },
    });
    expect(receipt.status).toBe('provisional');
    expect(receipt.stages.semantic.status).toBe('not_run');
    expect(receipt.humanPreference.status).toBe('pending');
  });
});
