import { describe, expect, it } from 'vitest';
import {
  nodeSlideArtifactArenaJsonSchema,
  nodeSlideArtifactArenaSystemPrompt,
  parseNodeSlideArtifactArenaCandidate,
  validateNodeSlideArtifactArenaBatch,
} from './nodeslideArtifactArena';

describe('NodeSlide Artifact Arena planner boundary', () => {
  it('accepts a bounded model candidate and pins its artifact type and operations', () => {
    const candidate = parseNodeSlideArtifactArenaCandidate(JSON.stringify(fixtureCandidate()));
    const schema = nodeSlideArtifactArenaJsonSchema(candidate).schema;
    expect(candidate.model).toBe('google/gemma-4-26b-a4b-it:free');
    expect(JSON.stringify(schema)).toContain('risk-matrix');
    expect(JSON.stringify(schema)).toContain('draw-labeled-axes');
    expect(nodeSlideArtifactArenaSystemPrompt(candidate)).toContain(
      'substituting another primitive fails the benchmark',
    );
  });

  it('rejects deterministic controls at the external-model action boundary', () => {
    expect(() =>
      parseNodeSlideArtifactArenaCandidate(
        JSON.stringify({ ...fixtureCandidate(), model: 'nodeslide-artifact-builder-v1' }),
      ),
    ).toThrow('model is unsupported');
  });

  it('bounds operator batches to three candidates', () => {
    const value = JSON.stringify(fixtureCandidate());
    expect(() => validateNodeSlideArtifactArenaBatch([value, value, value])).not.toThrow();
    expect(() => validateNodeSlideArtifactArenaBatch([value, value, value, value])).toThrow(
      'require 1-3 candidates',
    );
  });

  it('rejects missing evidence and required operations', () => {
    expect(() =>
      parseNodeSlideArtifactArenaCandidate(JSON.stringify({ ...fixtureCandidate(), evidence: [] })),
    ).toThrow('evidence is invalid');
    expect(() =>
      parseNodeSlideArtifactArenaCandidate(
        JSON.stringify({
          ...fixtureCandidate(),
          artifactContract: { ...fixtureCandidate().artifactContract, requiredOperations: [] },
        }),
      ),
    ).toThrow('required operations are missing');
  });
});

function fixtureCandidate() {
  return {
    schemaVersion: 'nodeslide.artifact-arena-candidate/v1',
    candidateId: 'risk-matrix__evidence-editorial__gemma-free',
    candidateDigest: `sha256:${'a'.repeat(64)}`,
    fixtureId: 'risk-matrix',
    artifactType: 'risk-matrix',
    slideArchetype: 'decision-risk-matrix',
    narrativeJob: 'Prioritize supplied risks by likelihood and impact.',
    model: 'google/gemma-4-26b-a4b-it:free',
    modelLabel: 'Gemma 4 26B Free',
    modelRole: 'zero-cost-bounded-generator-candidate',
    provider: 'openrouter',
    reasoningEffort: 'low',
    directionId: 'evidence-editorial',
    prompt: 'Create one honest and editable risk matrix using only the supplied evidence.',
    evidence: [
      {
        sourceId: 'q2-risks',
        label: 'Q2 risk register',
        content: 'pipeline coverage likelihood 4 impact 5',
      },
    ],
    sourceIds: ['q2-risks'],
    sourceDigest: `sha256:${'b'.repeat(64)}`,
    allowedClaims: ['pipeline coverage is highest priority'],
    forbiddenClaims: ['risk eliminated'],
    referenceIds: ['decisions-labeled-risk-matrix'],
    referenceDigest: `sha256:${'c'.repeat(64)}`,
    artifactContract: {
      readingDirection: 'focal',
      requiredOperations: ['draw-labeled-axes', 'place-editable-markers'],
      editability: { web: 'native', pptx: 'native' },
      fallbackPolicy: 'Use editable axes and markers.',
    },
    artifactRequirementDigest: `sha256:${'d'.repeat(64)}`,
    budgetDigest: `sha256:${'e'.repeat(64)}`,
  };
}
