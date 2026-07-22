import { createHash } from 'node:crypto';
import {
  NODESLIDE_ARTIFACT_SPEC_VERSION,
  NODESLIDE_CANONICAL_ARTIFACT_KINDS,
  evaluateNodeSlideArtifactExpression,
  validateNodeSlideCanonicalArtifactSpec,
} from '../../shared/nodeslideArtifactRegistry.js';

export const ARTIFACT_SPEC_SCHEMA_VERSION = NODESLIDE_ARTIFACT_SPEC_VERSION;
export const ARTIFACT_RECEIPT_SCHEMA_VERSION = 'nodeslide.artifact-receipt/v2';
export const ARTIFACT_SPEC_KINDS = NODESLIDE_CANONICAL_ARTIFACT_KINDS;

export function artifactSpecEnvelope(artifact, kind, payload) {
  const spec = {
    schemaVersion: ARTIFACT_SPEC_SCHEMA_VERSION,
    id: artifact.id,
    kind,
    narrativeJob: artifact.narrativeJob,
    claimIds: artifact.allowedClaims.map((_, index) => `${artifact.id}:claim:${index + 1}`),
    sourceIds: artifact.evidence.map((source) => source.sourceId),
    provenance: {
      truthState: 'derived',
      rationale: 'Artifact is deterministically derived from its declared evidence.',
      sourceRefs: artifact.evidence.map((source) => source.sourceId),
      // Retained for consumers created before the shared runtime registry.
      status: 'derived',
      sourceDigest: `sha256:${digest(artifact.evidence)}`,
      assumptions: [],
    },
    browserContract: 'semantic-and-visual',
    pptxContract: 'editable-or-declared-fallback',
    accessibility: artifact.accessibility,
    payload,
  };
  return { ...spec, specDigest: digest(spec) };
}

/**
 * Atlas and NodeGym use the same runtime validator as production authoring.
 * The digest remains an offline receipt concern and is intentionally layered
 * on top of the shared, environment-neutral validation result.
 */
export function validateArtifactSpec(spec) {
  const validation = validateNodeSlideCanonicalArtifactSpec(spec);
  return {
    ...validation,
    specDigest: spec?.specDigest ?? (spec === undefined ? null : digest(spec)),
  };
}

export const evaluateExpression = evaluateNodeSlideArtifactExpression;

export function buildArtifactReceipt({ spec, validation, stages = {}, metadata = {} }) {
  const hardStages = ['spec', 'semantic', 'evidence', 'browser', 'pptx', 'accessibility'];
  const normalizedStages = Object.fromEntries(
    hardStages.map((stage) => [stage, stages[stage] ?? { status: 'not_run', issues: [] }]),
  );
  const eligible =
    validation.ok && hardStages.every((stage) => normalizedStages[stage].status === 'passed');
  const receipt = {
    schemaVersion: ARTIFACT_RECEIPT_SCHEMA_VERSION,
    artifactId: spec.id,
    specDigest: spec.specDigest,
    stages: normalizedStages,
    humanPreference: stages.humanPreference ?? { status: 'pending' },
    status: eligible ? 'eligible' : 'provisional',
    metadata,
  };
  return { ...receipt, receiptDigest: digest(receipt) };
}

export function digest(value) {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function stableSerialize(value) {
  return JSON.stringify(canonical(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}
