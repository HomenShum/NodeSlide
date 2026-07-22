import {
  type NodeSlideAgentModelId,
  type NodeSlideReasoningEffort,
  isNodeSlideAgentModelId,
  isNodeSlideReasoningEffort,
  nodeSlideModelSupportsReasoningEffort,
} from '../../shared/nodeslide';

const MAX_CANDIDATE_JSON_BYTES = 48_000;
const MAX_BATCH_SIZE = 3;

export interface NodeSlideArtifactArenaCandidateInput {
  schemaVersion: 'nodeslide.artifact-arena-candidate/v1';
  candidateId: string;
  candidateDigest: string;
  fixtureId: string;
  artifactType: string;
  slideArchetype: string;
  narrativeJob: string;
  model: NodeSlideAgentModelId;
  modelLabel: string;
  modelRole: string;
  provider: 'openrouter' | 'nebius';
  reasoningEffort: NodeSlideReasoningEffort;
  directionId: string;
  prompt: string;
  evidence: Array<{ sourceId: string; label: string; content: string }>;
  sourceIds: string[];
  sourceDigest: string;
  allowedClaims: string[];
  forbiddenClaims: string[];
  referenceIds: string[];
  referenceDigest: string;
  artifactContract: {
    readingDirection: 'left-to-right' | 'top-to-bottom' | 'radial' | 'focal';
    requiredOperations: string[];
    editability: {
      web: 'native' | 'grouped-editable' | 'static-fallback';
      pptx: 'native' | 'grouped-editable' | 'static-fallback';
    };
    fallbackPolicy: string;
  };
  artifactRequirementDigest: string;
  budgetDigest: string;
}

export interface NodeSlideArtifactArenaPlan {
  artifactType: string;
  title: string;
  takeaway: string;
  annotation: string;
  composition: 'focal' | 'split' | 'diagonal' | 'radial' | 'progressive';
  emphasis: 'scale' | 'position' | 'contrast';
  density: 'sparse' | 'balanced';
  operations: Array<{
    operationId: string;
    label: string;
    value: string;
    sourceId: string;
  }>;
  sourceLabels: Array<{ sourceId: string; label: string }>;
  pptxFallback: string;
}

export function parseNodeSlideArtifactArenaCandidate(
  candidateJson: string,
): NodeSlideArtifactArenaCandidateInput {
  if (new TextEncoder().encode(candidateJson).byteLength > MAX_CANDIDATE_JSON_BYTES) {
    throw new Error('Artifact Arena candidate exceeds the bounded input size.');
  }
  let value: unknown;
  try {
    value = JSON.parse(candidateJson);
  } catch {
    throw new Error('Artifact Arena candidate JSON is invalid.');
  }
  if (!isRecord(value) || value['schemaVersion'] !== 'nodeslide.artifact-arena-candidate/v1') {
    throw new Error('Artifact Arena candidate schema is invalid.');
  }
  const model = value['model'];
  const reasoningEffort = value['reasoningEffort'];
  if (!isNodeSlideAgentModelId(model)) throw new Error('Artifact Arena model is unsupported.');
  if (!isNodeSlideReasoningEffort(reasoningEffort)) {
    throw new Error('Artifact Arena reasoning effort is invalid.');
  }
  if (!nodeSlideModelSupportsReasoningEffort(model, reasoningEffort)) {
    throw new Error('Artifact Arena model does not support the selected reasoning effort.');
  }
  const contract = value['artifactContract'];
  const evidence = value['evidence'];
  if (!isRecord(contract) || !Array.isArray(evidence)) {
    throw new Error('Artifact Arena contract or evidence is missing.');
  }
  if (!Array.isArray(contract['requiredOperations']) || contract['requiredOperations'].length < 2) {
    throw new Error('Artifact Arena required operations are missing.');
  }
  const requiredOperations = contract['requiredOperations'].filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
  if (requiredOperations.length !== contract['requiredOperations'].length) {
    throw new Error('Artifact Arena required operations are invalid.');
  }
  if (!evidence.length || evidence.some((entry) => !validEvidence(entry))) {
    throw new Error('Artifact Arena evidence is invalid.');
  }
  for (const name of [
    'candidateId',
    'candidateDigest',
    'fixtureId',
    'artifactType',
    'slideArchetype',
    'narrativeJob',
    'modelLabel',
    'modelRole',
    'directionId',
    'prompt',
    'sourceDigest',
    'referenceDigest',
    'artifactRequirementDigest',
    'budgetDigest',
  ]) {
    if (!nonEmpty(value[name])) throw new Error(`Artifact Arena ${name} is missing.`);
  }
  return value as unknown as NodeSlideArtifactArenaCandidateInput;
}

export function validateNodeSlideArtifactArenaBatch(candidateJsons: string[]): void {
  if (candidateJsons.length < 1 || candidateJsons.length > MAX_BATCH_SIZE) {
    throw new Error(`Artifact Arena batches require 1-${MAX_BATCH_SIZE} candidates.`);
  }
  for (const candidateJson of candidateJsons) parseNodeSlideArtifactArenaCandidate(candidateJson);
}

export function nodeSlideArtifactArenaJsonSchema(candidate: NodeSlideArtifactArenaCandidateInput): {
  name: string;
  schema: Record<string, unknown>;
} {
  return {
    name: 'nodeslide_artifact_arena_plan',
    schema: {
      type: 'object',
      required: [
        'artifactType',
        'title',
        'takeaway',
        'annotation',
        'composition',
        'emphasis',
        'density',
        'operations',
        'sourceLabels',
        'pptxFallback',
      ],
      properties: {
        artifactType: { const: candidate.artifactType },
        title: { type: 'string' },
        takeaway: { type: 'string' },
        annotation: { type: 'string' },
        composition: { enum: ['focal', 'split', 'diagonal', 'radial', 'progressive'] },
        emphasis: { enum: ['scale', 'position', 'contrast'] },
        density: { enum: ['sparse', 'balanced'] },
        operations: {
          type: 'array',
          minItems: candidate.artifactContract.requiredOperations.length,
          maxItems: candidate.artifactContract.requiredOperations.length,
          items: {
            type: 'object',
            required: ['operationId', 'label', 'value', 'sourceId'],
            properties: {
              operationId: { enum: candidate.artifactContract.requiredOperations },
              label: { type: 'string' },
              value: { type: 'string' },
              sourceId: { enum: candidate.sourceIds },
            },
          },
        },
        sourceLabels: {
          type: 'array',
          minItems: 1,
          maxItems: candidate.sourceIds.length,
          items: {
            type: 'object',
            required: ['sourceId', 'label'],
            properties: {
              sourceId: { enum: candidate.sourceIds },
              label: { type: 'string' },
            },
          },
        },
        pptxFallback: { type: 'string' },
      },
    },
  };
}

export function nodeSlideArtifactArenaSystemPrompt(
  candidate: NodeSlideArtifactArenaCandidateInput,
): string {
  return [
    "You are NodeSlide's slide-level artifact director.",
    'Return JSON only and follow the supplied schema exactly.',
    `Produce exactly one ${candidate.artifactType}; substituting another primitive fails the benchmark.`,
    'Use only supplied evidence and allowed claims. Never repeat or soften a forbidden claim.',
    'Map every required operation exactly once and bind it to one supplied sourceId.',
    'Choose a composition that makes the artifact legible at thumbnail scale and materially reflects the requested direction.',
    'Keep visible copy concise, audience-facing, and presentation-ready.',
    'The deterministic builder owns geometry, rendering, and export. Do not emit coordinates, HTML, SVG, or code.',
    'Describe the honest PowerPoint fallback; never claim native editability beyond the supplied contract.',
  ].join(' ');
}

export function nodeSlideArtifactArenaUserPayload(
  candidate: NodeSlideArtifactArenaCandidateInput,
): string {
  return JSON.stringify({
    fixtureId: candidate.fixtureId,
    artifactType: candidate.artifactType,
    narrativeJob: candidate.narrativeJob,
    prompt: candidate.prompt,
    evidence: candidate.evidence,
    allowedClaims: candidate.allowedClaims,
    forbiddenClaims: candidate.forbiddenClaims,
    referenceIds: candidate.referenceIds,
    artifactContract: candidate.artifactContract,
  });
}

function validEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonEmpty(value['sourceId']) &&
    nonEmpty(value['label']) &&
    nonEmpty(value['content'])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
