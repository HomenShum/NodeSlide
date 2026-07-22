import {
  NODE_SLIDE_CAPABILITY_PATTERN_SOURCE,
  isSensitiveCredentialKey,
} from './node-gym-redaction-core.mjs';
import { digestJson } from './node-gym-task-core.mjs';

export const NODE_GYM_TRAINING_EXPORT_SCHEMA = 'nodekit.gym-training-export/v2';

const FORBIDDEN_REASONING_KEYS = new Set([
  'chainofthought',
  'chain_of_thought',
  'hiddenreasoning',
  'hidden_reasoning',
  'scratchpad',
  'internalmonologue',
  'internal_monologue',
  'reasoningtokens',
  'reasoning_tokens',
]);
const SECRET_PATTERNS = [
  /\b(?:sk|rk|pk)_[a-z0-9_-]{16,}\b/giu,
  /\b(?:sk-|xox[baprs]-|gh[pousr]_)[a-z0-9_-]{16,}\b/giu,
  /\b(?:api[_-]?key|authorization|bearer)\s*[:=]\s*[^\s,;]{12,}/giu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  new RegExp(NODE_SLIDE_CAPABILITY_PATTERN_SOURCE, 'gu'),
];
const PERSONAL_DATA_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gu,
  /\b\d{3}-\d{2}-\d{4}\b/gu,
  /\b(?:\d[ -]*?){13,19}\b/gu,
];

/**
 * Produces a public-development-only training row after redaction, consent,
 * provenance, deletion-lineage, and contamination gates all pass.
 */
export function buildNodeGymTrainingExport({
  plan,
  fixture,
  receipt,
  episode,
  redactionTokens = [],
  holdoutDigests = [],
  existingTrainingDigests = [],
  deletedSourceDigests = [],
}) {
  if (redactionTokens.some((token) => !nonEmpty(token)))
    throw new Error('Training redaction tokens must be non-empty strings.');
  const redaction = redactNodeGymTrainingEpisode(episode, {
    tokens: redactionTokens,
  });
  const sourceLineage = (fixture?.evidence?.sources ?? []).map((source) => source.digest).sort();
  const candidate = {
    schemaVersion: NODE_GYM_TRAINING_EXPORT_SCHEMA,
    taskId: plan?.task?.id,
    taskClass: plan?.task?.taskClass,
    model: receipt?.actualRoute?.actualModel ?? receipt?.returnedModel ?? plan?.model?.id,
    requestedModel: plan?.model?.id,
    harness: `${plan?.harness?.id}@${plan?.harness?.version}`,
    harnessId: plan?.harness?.id,
    harnessVersion: plan?.harness?.version,
    role: plan?.harness?.role,
    immutableRun: {
      runId: plan?.runId,
      comparisonKey: plan?.comparisonKey,
      harnessPairingKey: plan?.harnessPairingKey ?? plan?.pairingKey,
      repetition: plan?.repetition,
    },
    taskState: redaction.value?.taskState,
    boundedContext: redaction.value?.boundedContext,
    selectedSkill: redaction.value?.selectedSkill,
    toolCalls: redaction.value?.toolCalls ?? [],
    validationFeedback: redaction.value?.validationFeedback ?? [],
    repairs: redaction.value?.repairs ?? [],
    acceptedArtifact: redaction.value?.acceptedArtifact,
    provenance: (fixture?.evidence?.sources ?? []).map((source) => ({
      sourceId: source.id,
      sourceDigest: source.digest,
      license: source.license,
      consentScope: source.consentScope,
      trainingUseAllowed: source.trainingUseAllowed,
    })),
    sourceLineage,
    governance: {
      consentScope: fixture?.governance?.consentScope,
      privacyReview: 'automated-redaction-and-strict-validation',
      redactionCount: redaction.redactions.length,
      deletionLineage: sourceLineage.map((sourceDigest) => ({
        sourceDigest,
        status: 'active',
        deletionRequestId: null,
      })),
      excludesHiddenReasoning: true,
      pool: plan?.task?.pool,
    },
  };
  const episodeDigest = digestJson(candidate);
  const validation = validateNodeGymTrainingExport({
    plan,
    fixture,
    receipt,
    candidate,
    episodeDigest,
    holdoutDigests,
    existingTrainingDigests,
    deletedSourceDigests,
  });
  if (!validation.ok)
    throw new Error(`Training export rejected: ${validation.issueCodes.join(', ')}`);
  return {
    ...candidate,
    episodeDigest,
    validation: {
      status: 'passed',
      policyVersion: 'nodekit.gym-training-policy/v2',
      redactions: redaction.redactions,
      provenanceDigest: digestJson(candidate.provenance),
      consentDigest: digestJson({
        fixture: fixture.governance,
        sources: candidate.provenance.map(({ sourceId, consentScope, trainingUseAllowed }) => ({
          sourceId,
          consentScope,
          trainingUseAllowed,
        })),
      }),
      contaminationDigest: digestJson({
        holdoutDigests: [...holdoutDigests].sort(),
      }),
    },
  };
}

export function validateNodeGymTrainingExport({
  plan,
  fixture,
  receipt,
  candidate,
  episodeDigest = digestJson(candidate),
  holdoutDigests = [],
  existingTrainingDigests = [],
  deletedSourceDigests = [],
}) {
  const issues = [];
  if (candidate?.schemaVersion !== NODE_GYM_TRAINING_EXPORT_SCHEMA)
    issues.push('training_candidate_schema_invalid');
  if (plan?.task?.pool !== 'public-development') issues.push('training_pool_not_public');
  if (plan?.task?.id !== fixture?.taskId) issues.push('training_fixture_plan_mismatch');
  if (fixture?.governance?.trainingEligible !== true) issues.push('training_consent_not_eligible');
  if (fixture?.governance?.consentScope !== 'training-approved')
    issues.push('training_consent_scope_invalid');
  if (fixture?.governance?.containsPersonalData !== false)
    issues.push('training_fixture_personal_data_present');
  if (receipt?.status !== 'passed' || receipt?.hardGatesPassed !== true)
    issues.push('training_receipt_not_accepted');
  if (receipt?.promotionReady !== true) issues.push('training_human_review_incomplete');
  if (
    receipt?.runId !== plan?.runId ||
    receipt?.comparisonKey !== plan?.comparisonKey ||
    receipt?.harnessPairingKey !== (plan?.harnessPairingKey ?? plan?.pairingKey)
  )
    issues.push('training_receipt_identity_mismatch');
  const expectedModel =
    receipt?.actualRoute?.actualModel ?? receipt?.returnedModel ?? plan?.model?.id;
  if (
    candidate?.taskId !== plan?.task?.id ||
    candidate?.taskClass !== plan?.task?.taskClass ||
    candidate?.requestedModel !== plan?.model?.id ||
    candidate?.model !== expectedModel ||
    candidate?.harnessId !== plan?.harness?.id ||
    candidate?.harnessVersion !== plan?.harness?.version ||
    candidate?.harness !== `${plan?.harness?.id}@${plan?.harness?.version}` ||
    candidate?.role !== plan?.harness?.role
  )
    issues.push('training_candidate_identity_mismatch');
  if (
    candidate?.immutableRun?.runId !== plan?.runId ||
    candidate?.immutableRun?.comparisonKey !== plan?.comparisonKey ||
    candidate?.immutableRun?.harnessPairingKey !== (plan?.harnessPairingKey ?? plan?.pairingKey) ||
    candidate?.immutableRun?.repetition !== plan?.repetition
  )
    issues.push('training_candidate_run_lineage_mismatch');
  if (episodeDigest !== digestJson(candidate)) issues.push('training_episode_digest_mismatch');

  const sourceDigests = new Set();
  for (const source of fixture?.evidence?.sources ?? []) {
    if (!isSha256(source?.digest)) issues.push('training_source_digest_invalid');
    else sourceDigests.add(source.digest);
    if (!nonEmpty(source?.license)) issues.push('training_source_license_missing');
    if (source?.trainingUseAllowed !== true) issues.push('training_source_consent_missing');
    if (source?.consentScope !== 'training-approved')
      issues.push('training_source_consent_scope_invalid');
  }
  const provenance = candidate?.provenance ?? [];
  if (provenance.length !== sourceDigests.size) issues.push('training_provenance_incomplete');
  if (provenance.some((entry) => !sourceDigests.has(entry.sourceDigest)))
    issues.push('training_provenance_unbound');
  if (
    provenance.some(
      (entry) =>
        !nonEmpty(entry?.sourceId) ||
        !isSha256(entry?.sourceDigest) ||
        !nonEmpty(entry?.license) ||
        entry?.consentScope !== 'training-approved' ||
        entry?.trainingUseAllowed !== true,
    )
  )
    issues.push('training_provenance_schema_invalid');

  const forbiddenKeys = findForbiddenReasoningKeys(candidate);
  if (forbiddenKeys.length) issues.push('hidden_reasoning_present');
  if (findUnredactedCredentialPaths(candidate).length)
    issues.push('training_credential_field_present');
  const serialized = stableJson(candidate);
  if (SECRET_PATTERNS.some((pattern) => testPattern(pattern, serialized)))
    issues.push('training_secret_present');
  if (PERSONAL_DATA_PATTERNS.some((pattern) => testPattern(pattern, serialized)))
    issues.push('training_personal_data_present');

  if (holdoutDigests.some((value) => normalizeDigest(value) === null))
    issues.push('training_holdout_digest_invalid');
  if (existingTrainingDigests.some((value) => normalizeDigest(value) === null))
    issues.push('training_existing_digest_invalid');
  if (deletedSourceDigests.some((value) => normalizeDigest(value) === null))
    issues.push('training_deleted_digest_invalid');
  const holdouts = new Set(holdoutDigests.map(normalizeDigest).filter(Boolean));
  if ([...sourceDigests].some((value) => holdouts.has(normalizeDigest(value))))
    issues.push('training_holdout_source_contamination');
  if (
    [...holdouts].some((value) => serialized.toLowerCase().includes(value.replace(/^sha256:/u, '')))
  )
    issues.push('training_holdout_digest_leak');
  if (existingTrainingDigests.map(normalizeDigest).includes(normalizeDigest(episodeDigest)))
    issues.push('training_duplicate_episode');
  const deleted = new Set(deletedSourceDigests.map(normalizeDigest).filter(Boolean));
  if ([...sourceDigests].some((value) => deleted.has(normalizeDigest(value))))
    issues.push('training_deleted_source_present');

  const sourceLineage = candidate?.sourceLineage ?? [];
  if (
    sourceLineage.length !== sourceDigests.size ||
    sourceLineage.some((value) => !sourceDigests.has(value))
  )
    issues.push('training_source_lineage_incomplete');
  const deletionLineage = candidate?.governance?.deletionLineage ?? [];
  if (
    deletionLineage.length !== sourceDigests.size ||
    deletionLineage.some(
      (entry) =>
        !sourceDigests.has(entry?.sourceDigest) ||
        entry?.status !== 'active' ||
        entry?.deletionRequestId !== null,
    )
  )
    issues.push('training_deletion_lineage_invalid');
  if (
    candidate?.governance?.consentScope !== fixture?.governance?.consentScope ||
    candidate?.governance?.pool !== plan?.task?.pool ||
    candidate?.governance?.excludesHiddenReasoning !== true
  )
    issues.push('training_governance_identity_mismatch');
  if (candidate?.governance?.excludesHiddenReasoning !== true)
    issues.push('training_hidden_reasoning_policy_missing');
  return {
    ok: issues.length === 0,
    issueCodes: [...new Set(issues)].sort(),
    episodeDigest,
  };
}

export function redactNodeGymTrainingEpisode(value, { tokens = [] } = {}) {
  const redactions = [];
  const exactTokens = tokens.filter(nonEmpty).sort((left, right) => right.length - left.length);
  function visit(entry, path) {
    if (typeof entry === 'string') {
      let next = entry;
      for (const token of exactTokens) {
        if (!next.includes(token)) continue;
        next = next.replaceAll(token, '[REDACTED_SECRET]');
        redactions.push({ path, kind: 'configured-secret' });
      }
      for (const [kind, patterns] of [
        ['secret', SECRET_PATTERNS],
        ['personal-data', PERSONAL_DATA_PATTERNS],
      ]) {
        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          if (!pattern.test(next)) continue;
          pattern.lastIndex = 0;
          next = next.replace(pattern, kind === 'secret' ? '[REDACTED_SECRET]' : '[REDACTED_PII]');
          redactions.push({ path, kind });
        }
      }
      return next;
    }
    if (Array.isArray(entry)) return entry.map((item, index) => visit(item, `${path}/${index}`));
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(
      Object.entries(entry).map(([key, item]) => {
        const nextPath = `${path}/${escapePointer(key)}`;
        if (isSensitiveCredentialKey(key)) {
          redactions.push({ path: nextPath, kind: 'credential-key' });
          return [key, '[REDACTED_SECRET]'];
        }
        return [key, visit(item, nextPath)];
      }),
    );
  }
  return { value: visit(value, ''), redactions };
}

function findUnredactedCredentialPaths(value, path = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}/${escapePointer(key)}`;
    if (isSensitiveCredentialKey(key) && entry !== '[REDACTED_SECRET]') found.push(nextPath);
    else findUnredactedCredentialPaths(entry, nextPath, found);
  }
  return found;
}

function findForbiddenReasoningKeys(value, path = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll('-', '_');
    const nextPath = `${path}/${escapePointer(key)}`;
    if (
      FORBIDDEN_REASONING_KEYS.has(normalized.replaceAll('_', '')) ||
      FORBIDDEN_REASONING_KEYS.has(normalized)
    )
      found.push(nextPath);
    findForbiddenReasoningKeys(entry, nextPath, found);
  }
  return found;
}

function testPattern(pattern, value) {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

function normalizeDigest(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (/^[a-f0-9]{64}$/u.test(normalized)) return `sha256:${normalized}`;
  return /^sha256:[a-f0-9]{64}$/u.test(normalized) ? normalized : null;
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function escapePointer(value) {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
