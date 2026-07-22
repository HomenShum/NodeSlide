import { createHash } from 'node:crypto';

export const NODE_GYM_TASK_FIXTURE_SCHEMA = 'nodekit.gym-task-fixture/v1';

export const NODE_GYM_TASK_POOLS = [
  'public-development',
  'hidden-validation',
  'rotating-challenge',
  'live-shadow',
];

const PROTECTED_POOLS = new Set(['hidden-validation', 'rotating-challenge', 'live-shadow']);
const MAX_SERIALIZED_BYTES = 256_000;
const MAX_STRING_LENGTH = 16_000;
const MAX_ARRAY_LENGTH = 500;
const PROTECTED_DESCRIPTOR_KEYS = new Set(['mode', 'payloadEnv', 'digestEnv']);
const PROTECTED_CONFIG_FORBIDDEN_KEYS = new Set([
  'payload',
  'brief',
  'claims',
  'sources',
  'numericfacts',
  'repaircase',
  'sanitizedegress',
  'sourceurl',
  'content',
]);

/**
 * Loads a bounded task fixture without placing protected evaluation material in
 * repository configuration. Protected pools must arrive through a runtime
 * value and a separately supplied digest.
 */
export function loadNodeGymTaskFixture({ task, runtime = process.env, payload } = {}) {
  const descriptor = task?.fixture;
  if (!descriptor || typeof descriptor !== 'object')
    throw new Error(`Task ${task?.id ?? '<unknown>'} has no fixture descriptor.`);

  let rawPayload = payload;
  let expectedDigest = null;
  if (descriptor.mode === 'inline') {
    if (PROTECTED_POOLS.has(task.pool))
      throw new Error(`Protected task ${task.id} cannot use an inline fixture.`);
    rawPayload ??= descriptor.payload;
  } else if (descriptor.mode === 'runtime-sealed') {
    if (!PROTECTED_POOLS.has(task.pool))
      throw new Error(`Public task ${task.id} must use an inline fixture.`);
    if (!safeEnvironmentName(descriptor.payloadEnv) || !safeEnvironmentName(descriptor.digestEnv))
      throw new Error(`Task ${task.id} has an invalid runtime fixture descriptor.`);
    const serialized = rawPayload ?? runtime?.[descriptor.payloadEnv];
    expectedDigest = runtime?.[descriptor.digestEnv];
    if (serialized === undefined || serialized === null || serialized === '')
      throw new Error(`Protected task ${task.id} requires ${descriptor.payloadEnv} at runtime.`);
    if (!expectedDigest)
      throw new Error(`Protected task ${task.id} requires ${descriptor.digestEnv} at runtime.`);
    rawPayload =
      typeof serialized === 'string' ? parseRuntimePayload(serialized, task.id) : serialized;
  } else {
    throw new Error(`Task ${task.id} has an unsupported fixture mode.`);
  }

  const validation = validateNodeGymTaskFixture(task, rawPayload);
  if (!validation.ok)
    throw new Error(`Task fixture ${task.id} is invalid: ${validation.issueCodes.join(', ')}`);
  if (expectedDigest && normalizeSha256(expectedDigest) !== validation.fixtureDigest)
    throw new Error(`Task fixture ${task.id} failed its runtime digest check.`);

  return deepFreeze({
    fixture: canonicalClone(rawPayload),
    fixtureDigest: validation.fixtureDigest,
    taskDigest: digestJson(rawPayload.brief),
    evidenceDigest: digestJson(rawPayload.evidence),
    referenceDigest: digestJson(rawPayload.reference),
    protected: PROTECTED_POOLS.has(task.pool),
  });
}

export function validateNodeGymTaskFixture(task, fixture) {
  const issues = [];
  if (!task || typeof task !== 'object') issues.push('task_descriptor_missing');
  if (fixture?.schemaVersion !== NODE_GYM_TASK_FIXTURE_SCHEMA)
    issues.push('fixture_schema_invalid');
  if (fixture?.taskId !== task?.id) issues.push('fixture_task_id_mismatch');
  if (fixture?.taskClass !== task?.taskClass) issues.push('fixture_task_class_mismatch');
  if (fixture?.pool !== task?.pool) issues.push('fixture_pool_mismatch');
  if (!NODE_GYM_TASK_POOLS.includes(fixture?.pool)) issues.push('fixture_pool_invalid');
  if (!nonEmpty(fixture?.brief)) issues.push('fixture_brief_missing');
  if (!fixture?.evidence || typeof fixture.evidence !== 'object')
    issues.push('fixture_evidence_missing');
  if (!fixture?.reference || typeof fixture.reference !== 'object')
    issues.push('fixture_reference_missing');
  if (!nonEmpty(fixture?.reference?.artifactKind)) issues.push('fixture_artifact_kind_missing');
  if (!nonEmpty(fixture?.reference?.validator)) issues.push('fixture_validator_missing');

  const sources = Array.isArray(fixture?.evidence?.sources) ? fixture.evidence.sources : [];
  const claims = Array.isArray(fixture?.evidence?.claims) ? fixture.evidence.claims : [];
  if (sources.length === 0) issues.push('fixture_sources_missing');
  if (claims.length === 0) issues.push('fixture_claims_missing');
  const sourceIds = new Set();
  for (const source of sources) {
    if (!nonEmpty(source?.id) || sourceIds.has(source.id)) issues.push('fixture_source_id_invalid');
    else sourceIds.add(source.id);
    if (!isSha256(source?.digest)) issues.push('fixture_source_digest_invalid');
    if (!nonEmpty(source?.title)) issues.push('fixture_source_title_missing');
    if (!Array.isArray(source?.claimIds)) issues.push('fixture_source_claim_bindings_missing');
  }

  const claimIds = new Set();
  for (const claim of claims) {
    if (!nonEmpty(claim?.id) || claimIds.has(claim.id)) issues.push('fixture_claim_id_invalid');
    else claimIds.add(claim.id);
    if (!nonEmpty(claim?.text)) issues.push('fixture_claim_text_missing');
    if (!Array.isArray(claim?.sourceIds) || claim.sourceIds.length === 0)
      issues.push('fixture_claim_source_binding_missing');
    else if (claim.sourceIds.some((sourceId) => !sourceIds.has(sourceId)))
      issues.push('fixture_claim_source_unknown');
    for (const fact of claim?.numericFacts ?? []) {
      if (!nonEmpty(fact?.id) || !Number.isFinite(fact?.value) || !nonEmpty(fact?.unit))
        issues.push('fixture_numeric_fact_invalid');
      if (
        fact?.tolerance !== undefined &&
        !(Number.isFinite(fact.tolerance) && fact.tolerance >= 0)
      )
        issues.push('fixture_numeric_tolerance_invalid');
    }
  }
  for (const source of sources) {
    if ((source.claimIds ?? []).some((claimId) => !claimIds.has(claimId)))
      issues.push('fixture_source_claim_unknown');
  }

  const governance = fixture?.governance;
  if (!governance || typeof governance !== 'object') issues.push('fixture_governance_missing');
  if (PROTECTED_POOLS.has(task?.pool)) {
    if (task?.trainingEligible !== false || governance?.trainingEligible !== false)
      issues.push('protected_fixture_training_eligible');
    if (governance?.consentScope !== 'evaluation-only')
      issues.push('protected_fixture_consent_invalid');
    if (governance?.retention !== 'ephemeral') issues.push('protected_fixture_retention_invalid');
    if (governance?.containsPersonalData !== false)
      issues.push('protected_fixture_personal_data_present');
  } else {
    if (governance?.trainingEligible !== Boolean(task?.trainingEligible))
      issues.push('public_fixture_training_flag_mismatch');
    if (!['training-approved', 'evaluation-only'].includes(governance?.consentScope))
      issues.push('public_fixture_consent_invalid');
  }

  let serializedBytes = 0;
  try {
    serializedBytes = Buffer.byteLength(stableJson(fixture), 'utf8');
  } catch {
    issues.push('fixture_not_serializable');
  }
  if (serializedBytes > MAX_SERIALIZED_BYTES) issues.push('fixture_too_large');
  inspectBounds(fixture, issues);

  return {
    ok: issues.length === 0,
    issueCodes: [...new Set(issues)].sort(),
    fixtureDigest: digestJson(fixture),
    serializedBytes,
  };
}

export function assertNoProtectedFixturePlaintext(config) {
  const issues = [];
  for (const task of config?.tasks ?? []) {
    if (!PROTECTED_POOLS.has(task.pool)) continue;
    if (task.fixture?.mode !== 'runtime-sealed')
      issues.push(`${task.id}:fixture_not_runtime_sealed`);
    for (const path of recursiveKeyPaths(task.fixture ?? {})) {
      const key = path.split('/').at(-1)?.toLowerCase() ?? '';
      if (PROTECTED_CONFIG_FORBIDDEN_KEYS.has(key))
        issues.push(`${task.id}:protected_plaintext_key:${path}`);
    }
    for (const key of Object.keys(task.fixture ?? {})) {
      if (!PROTECTED_DESCRIPTOR_KEYS.has(key))
        issues.push(`${task.id}:protected_descriptor_key_not_allowed:${key}`);
    }
    if (typeof task.evidence === 'object') issues.push(`${task.id}:protected_evidence_committed`);
    for (const [field, value] of [
      ['task', task.task],
      ['evidence', task.evidence],
      ['reference', task.reference],
    ]) {
      if (!nonEmpty(value) || value.length > 500 || /(?:https?:\/\/|\{\s*"|\[\s*\{)/iu.test(value))
        issues.push(`${task.id}:protected_${field}_placeholder_invalid`);
    }
    if (
      !safeEnvironmentName(task.fixture?.payloadEnv) ||
      !safeEnvironmentName(task.fixture?.digestEnv)
    )
      issues.push(`${task.id}:runtime_binding_invalid`);
  }
  return { ok: issues.length === 0, issueCodes: issues };
}

export function isProtectedNodeGymTask(task) {
  return PROTECTED_POOLS.has(task?.pool);
}

export function hasNodeGymRuntimeFixture(task, runtime = process.env) {
  if (!isProtectedNodeGymTask(task)) return true;
  return Boolean(
    safeEnvironmentName(task?.fixture?.payloadEnv) &&
      safeEnvironmentName(task?.fixture?.digestEnv) &&
      runtime?.[task.fixture.payloadEnv] &&
      runtime?.[task.fixture.digestEnv],
  );
}

export function filterNodeGymRunsForRuntime({
  runs,
  tasks,
  runtime = process.env,
  explicitTaskIds = [],
}) {
  if (explicitTaskIds.length) return [...(runs ?? [])];
  const taskById = new Map((tasks ?? []).map((task) => [task.id, task]));
  return (runs ?? []).filter((run) => {
    const task = taskById.get(run?.task?.id);
    if (!task) return false;
    return !isProtectedNodeGymTask(task) || hasNodeGymRuntimeFixture(task, runtime);
  });
}

/**
 * Protected content may egress only through an explicitly digest-bound,
 * sanitized projection. Absence or any raw-fixture overlap fails closed.
 */
export function projectNodeGymProtectedFixtureForEgress(loadedFixture) {
  if (!loadedFixture?.protected) return loadedFixture?.fixture;
  const fixture = loadedFixture.fixture;
  const projection = fixture?.sanitizedEgress;
  if (
    fixture?.governance?.uiEgressAllowed !== true ||
    fixture?.governance?.egressPolicy !== 'sanitized-projection-only' ||
    projection?.schemaVersion !== 'nodekit.gym-sanitized-egress/v1' ||
    normalizeSha256(fixture?.governance?.sanitizedEgressDigest) !== digestJson(projection)
  )
    throw new Error(
      'Protected fixture has no authorized digest-bound sanitized egress projection.',
    );
  if (!nonEmpty(projection.brief) || !Array.isArray(projection.claims) || !projection.claims.length)
    throw new Error('Protected fixture sanitized egress projection is incomplete.');
  const leakage = assertNoProtectedFixtureLeakage(projection, loadedFixture);
  if (!leakage.ok)
    throw new Error(
      'Protected fixture sanitized egress projection overlaps raw protected context.',
    );
  if (containsSensitiveText(stableJson(projection)))
    throw new Error('Protected fixture sanitized egress projection contains sensitive text.');
  return deepFreeze({
    schemaVersion: NODE_GYM_TASK_FIXTURE_SCHEMA,
    taskId: fixture.taskId,
    taskClass: fixture.taskClass,
    pool: fixture.pool,
    brief: projection.brief,
    evidence: {
      sources: projection.sources ?? [],
      claims: projection.claims,
    },
    reference: projection.reference,
    constraints: projection.constraints ?? {},
    ...(projection.repairCase ? { repairCase: projection.repairCase } : {}),
    governance: {
      consentScope: 'evaluation-only',
      trainingEligible: false,
      retention: 'ephemeral',
      containsPersonalData: false,
      egressProjectionDigest: digestJson(projection),
    },
  });
}

export function assertNoProtectedFixtureLeakage(value, loadedFixture) {
  if (!loadedFixture?.protected) return { ok: true, issueCodes: [] };
  const serialized = stableJson(value);
  const sensitive = protectedSensitiveStrings(loadedFixture.fixture);
  const issues = sensitive
    .filter((entry) => serialized.includes(JSON.stringify(entry.value).slice(1, -1)))
    .map((entry) => `protected_fixture_leak:${entry.path}`);
  return { ok: issues.length === 0, issueCodes: [...new Set(issues)].sort() };
}

/** Rebinds a planned run to the exact runtime fixture digests before execution. */
export function bindNodeGymRunPlanToFixture(plan, loadedFixture) {
  if (!plan?.task || !loadedFixture?.fixture)
    throw new Error('Run plan and loaded fixture are required for runtime binding.');
  if (plan.task.id !== loadedFixture.fixture.taskId)
    throw new Error('Runtime fixture cannot be bound to a different task plan.');
  const task = {
    ...plan.task,
    taskDigest: loadedFixture.taskDigest,
    evidenceDigest: loadedFixture.evidenceDigest,
    referenceDigest: loadedFixture.referenceDigest,
  };
  const comparisonKey = [
    task.taskDigest,
    task.evidenceDigest,
    task.referenceDigest,
    plan.repetition,
    [
      plan.budget.maxTokens,
      plan.budget.maxLatencyMs,
      plan.budget.maxCostMicroUsd,
      plan.budget.maxRepairs,
    ].join(':'),
  ].join('::');
  const harnessPairingKey = [
    task.taskDigest,
    task.evidenceDigest,
    task.referenceDigest,
    plan.model.id,
    plan.repetition,
    [
      plan.budget.maxTokens,
      plan.budget.maxLatencyMs,
      plan.budget.maxCostMicroUsd,
      plan.budget.maxRepairs,
    ].join(':'),
  ].join('::');
  return deepFreeze({
    ...plan,
    task,
    comparisonKey,
    harnessPairingKey,
    pairingKey: harnessPairingKey,
    runtimeFixtureDigest: loadedFixture.fixtureDigest,
  });
}

export function digestJson(value) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function parseRuntimePayload(serialized, taskId) {
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_BYTES)
    throw new Error(`Task fixture ${taskId} exceeds the runtime size bound.`);
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error(`Task fixture ${taskId} is not valid JSON.`);
  }
}

function inspectBounds(value, issues, seen = new Set()) {
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) issues.push('fixture_string_too_long');
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) issues.push('fixture_array_too_long');
    for (const entry of value) inspectBounds(entry, issues, seen);
    return;
  }
  for (const entry of Object.values(value)) inspectBounds(entry, issues, seen);
}

function protectedSensitiveStrings(fixture) {
  const values = [];
  const visit = (entry, path) => {
    if (path.startsWith('/sanitizedEgress')) return;
    if (typeof entry === 'string') {
      if (
        entry.length >= 6 &&
        ![
          NODE_GYM_TASK_FIXTURE_SCHEMA,
          fixture.taskId,
          fixture.taskClass,
          fixture.pool,
          fixture.reference?.artifactKind,
          fixture.reference?.validator,
          'evaluation-only',
          'ephemeral',
          'sanitized-projection-only',
        ].includes(entry)
      )
        values.push({ path, value: entry });
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${path}/${index}`));
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    for (const [key, item] of Object.entries(entry)) visit(item, `${path}/${key}`);
  };
  for (const key of ['brief', 'evidence', 'reference', 'repairCase'])
    visit(fixture?.[key], `/${key}`);
  return values;
}

function recursiveKeyPaths(value, path = '') {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    const next = `${path}/${key}`;
    return [next, ...recursiveKeyPaths(entry, next)];
  });
}

function containsSensitiveText(value) {
  return [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/u,
    /\b(?:sk-|xox[baprs]-|gh[pousr]_)[a-z0-9_-]{16,}\b/iu,
    /\b(?:api[_-]?key|authorization|bearer)\s*[:=]\s*[^\s,;]{12,}/iu,
  ].some((pattern) => pattern.test(value));
}

function normalizeSha256(value) {
  const normalized = String(value).trim().toLowerCase();
  return normalized.startsWith('sha256:') ? normalized : `sha256:${normalized}`;
}

function safeEnvironmentName(value) {
  return typeof value === 'string' && /^NODE_GYM_[A-Z0-9_]+$/u.test(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stableJson(value) {
  return JSON.stringify(canonicalClone(value));
}

function canonicalClone(value) {
  if (Array.isArray(value)) return value.map(canonicalClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalClone(value[key])]),
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}
