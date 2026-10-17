import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { validateNodeGymConfig } from './node-gym-config-core.mjs';

export const NODE_GYM_EXECUTOR_RESULT_SCHEMA = 'nodekit.gym-executor-result/v1';
export const NODE_GYM_RUN_RECEIPT_SCHEMA = 'nodekit.gym-run-receipt/v2';

const REQUIRED_ARTIFACTS = ['browser', 'pptx', 'pdf'];
const TERMINAL_EXECUTOR_STATUSES = new Set([
  'completed',
  'failed',
  'provider-error',
  'budget-exhausted',
  'artifact-failure',
]);
const TERMINAL_RECEIPT_STATUSES = new Set([
  'passed',
  'failed',
  'provider-error',
  'budget-exhausted',
  'artifact-failure',
  'degraded',
]);

/** Hashes the exact bytes supplied by the caller; no JSON normalization occurs. */
export function digestNodeGymBytes(value) {
  if (!(typeof value === 'string' || value instanceof Uint8Array))
    throw new Error('NodeGym source bytes must be a string or Uint8Array.');
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/**
 * Fails closed unless a persisted matrix is the exact ordered regeneration of
 * the raw-byte-bound config. Comparing both canonical structure and ordered
 * JSON prevents stale or reordered identity fields from being accepted and
 * later silently replaced by runtime fixture binding.
 */
export function assertNodeGymMatrixBoundToConfig({ configBytes, config, matrix, regeneratedRuns }) {
  const validation = validateNodeGymConfig(config);
  if (validation.failures.length)
    throw new Error(`NodeGym config policy is invalid: ${validation.failures.join(' ')}`);
  if (config?.schemaVersion !== 'nodekit.gym-config/v1')
    throw new Error('NodeGym config schema is invalid.');
  if (matrix?.schemaVersion !== 'nodekit.gym-matrix/v1' || !Array.isArray(matrix?.runs))
    throw new Error('NodeGym matrix schema is invalid.');
  const configDigest = digestNodeGymBytes(configBytes);
  if (matrix.configDigest !== configDigest)
    throw new Error('NodeGym matrix config digest does not match the exact config bytes.');
  if (!cleanString(config.gymVersion) || matrix.gymVersion !== config.gymVersion)
    throw new Error('NodeGym matrix gymVersion does not match its bound config.');
  if (!Array.isArray(regeneratedRuns)) throw new Error('NodeGym regenerated runs are required.');
  if (!Number.isSafeInteger(config.expectedMatrixSize) || config.expectedMatrixSize < 1)
    throw new Error('NodeGym config expectedMatrixSize is invalid.');
  if (config.expectedMatrixSize !== regeneratedRuns.length)
    throw new Error('NodeGym config expectedMatrixSize does not match regenerated runs.');
  if (!Number.isSafeInteger(matrix.runCount) || matrix.runCount !== matrix.runs.length)
    throw new Error('NodeGym matrix runCount does not match its persisted runs.');
  if (matrix.runCount !== regeneratedRuns.length)
    throw new Error('NodeGym matrix runCount does not match regenerated runs.');
  if (matrix.pairedComparisonReady !== true || matrix.promotionAutoApply !== false)
    throw new Error('NodeGym matrix safety metadata is invalid.');

  const runIds = new Set();
  for (const run of regeneratedRuns) {
    if (!cleanString(run?.runId) || runIds.has(run.runId))
      throw new Error('NodeGym regenerated run ids must be non-empty and unique.');
    runIds.add(run.runId);
    if (
      !cleanString(run?.comparisonKey) ||
      !cleanString(run?.harnessPairingKey) ||
      run.pairingKey !== run.harnessPairingKey
    )
      throw new Error(`NodeGym regenerated identity is invalid for ${run.runId}.`);
  }

  if (digestJson(matrix.runs) !== digestJson(regeneratedRuns))
    throw new Error('NodeGym matrix run structure does not match its bound config regeneration.');
  if (JSON.stringify(matrix.runs) !== JSON.stringify(regeneratedRuns))
    throw new Error('NodeGym matrix run bytes/order do not match its bound config regeneration.');
  return { configDigest, runCount: regeneratedRuns.length };
}

/**
 * Validates and accounts every immutable attempt receipt for one bound run.
 * Costs and failures are returned once for campaign-wide pre-scheduling sums.
 */
export function summarizeNodeGymAttemptHistory({
  plan,
  receipts,
  executor,
  reservationMicroUsd = nodeGymRunReservationMicroUsd(plan),
  orphanCharges = [],
}) {
  if (!plan?.runId) throw new Error('NodeGym history requires a bound run plan.');
  if (!Array.isArray(receipts))
    throw new Error(`NodeGym attempt history is invalid for ${plan.runId}.`);
  const ordered = [...receipts].sort(
    (left, right) => Number(left?.attempt) - Number(right?.attempt),
  );
  const planDigest = digestJson(plan);
  let spentCostMicroUsd = 0;
  let reservedUnknownMicroUsd = 0;
  let failures = 0;
  let passedReceipt = null;

  for (const [index, receipt] of ordered.entries()) {
    const expectedAttempt = index + 1;
    const prefix = `NodeGym attempt ${expectedAttempt} for ${plan.runId}`;
    if (receipt?.schemaVersion !== NODE_GYM_RUN_RECEIPT_SCHEMA)
      throw new Error(`${prefix} has an invalid receipt schema.`);
    if (receipt.attempt !== expectedAttempt)
      throw new Error(`${prefix} is missing, duplicated, or out of sequence.`);
    if (
      receipt.runId !== plan.runId ||
      receipt.planDigest !== planDigest ||
      receipt.comparisonKey !== plan.comparisonKey ||
      receipt.harnessPairingKey !== plan.harnessPairingKey ||
      receipt.pairingKey !== plan.pairingKey ||
      receipt.repetition !== plan.repetition
    )
      throw new Error(`${prefix} does not match the immutable run identity.`);
    if (executor !== undefined && receipt.executor !== executor)
      throw new Error(`${prefix} does not match the campaign executor.`);
    if (!TERMINAL_RECEIPT_STATUSES.has(receipt.status))
      throw new Error(`${prefix} has an invalid terminal status.`);
    if (!isSha256(receipt.executorResultDigest) || !isSha256(receipt.semanticEvaluationDigest))
      throw new Error(`${prefix} has an invalid evidence digest.`);
    if (!Array.isArray(receipt.issueCodes) || receipt.issueCodes.some((code) => !cleanString(code)))
      throw new Error(`${prefix} has invalid issue codes.`);
    for (const field of ['latencyMs', 'inputTokens', 'outputTokens', 'repairCount']) {
      if (nonNegativeNumber(receipt.usage?.[field]) === null)
        throw new Error(`${prefix} has invalid ${field} usage.`);
    }
    const usageCost = Number(receipt.usage?.costMicroUsd);
    if (!Number.isSafeInteger(usageCost) || usageCost < 0)
      throw new Error(`${prefix} has invalid costMicroUsd usage.`);
    // The campaign meter is the recorded charge, never the executor's own usage figure. A receipt
    // written before charges were recorded has no `budget` and is charged the run's full reservation.
    const charge = nodeGymReceiptCharge(receipt, reservationMicroUsd, prefix);
    const cost = charge.chargedMicroUsd;
    if (charge.source === 'reservation') reservedUnknownMicroUsd += cost;
    if (receipt.status === 'passed') {
      if (
        receipt.automatedHardGatesPassed !== true ||
        receipt.issueCodes.length !== 0 ||
        passedReceipt !== null
      )
        throw new Error(`${prefix} has an inconsistent passed state.`);
      passedReceipt = receipt;
    } else if (receipt.automatedHardGatesPassed !== false) {
      throw new Error(`${prefix} has an inconsistent failed state.`);
    }
    if (passedReceipt && receipt !== passedReceipt)
      throw new Error(`${prefix} appears after a terminal passed receipt.`);
    spentCostMicroUsd += cost;
    if (!Number.isSafeInteger(spentCostMicroUsd))
      throw new Error(`NodeGym cumulative cost is unsafe for ${plan.runId}.`);
    if (receipt.status !== 'passed') failures += 1;
  }

  // An attempt directory found without its receipt (the runner itself died mid-attempt) was charged
  // its reservation when it was set aside; those durable charges belong to the run's spend.
  for (const orphan of orphanCharges) {
    spentCostMicroUsd += orphan.budget.chargedMicroUsd;
    reservedUnknownMicroUsd += orphan.budget.chargedMicroUsd;
  }
  if (!Number.isSafeInteger(spentCostMicroUsd))
    throw new Error(`NodeGym cumulative cost is unsafe for ${plan.runId}.`);

  return {
    receipts: ordered,
    spentCostMicroUsd,
    reservedUnknownMicroUsd,
    failures,
    latestAttempt: ordered.length,
    latestReceipt: ordered.at(-1) ?? null,
    passedReceipt,
  };
}

export function assertNodeGymLatestReceipt(history, latest) {
  if (!history?.latestReceipt) {
    if (latest !== null && latest !== undefined)
      throw new Error('NodeGym latest receipt exists without immutable attempt history.');
    return;
  }
  if (!latest || digestJson(latest) !== digestJson(history.latestReceipt))
    throw new Error('NodeGym latest receipt does not match the final immutable attempt receipt.');
}

export function assertNodeGymPassedSemanticEvaluation(plan, receipt, semanticEvaluation) {
  if (receipt?.status !== 'passed')
    throw new Error(
      `NodeGym passed semantic validation requires a passed receipt for ${plan?.runId}.`,
    );
  if (
    semanticEvaluation?.schemaVersion !== 'nodekit.gym-semantic-evaluation/v1' ||
    semanticEvaluation.runId !== plan.runId ||
    semanticEvaluation.comparisonKey !== plan.comparisonKey ||
    semanticEvaluation.harnessPairingKey !== plan.harnessPairingKey ||
    semanticEvaluation.hardGatesPassed !== true ||
    receipt.semanticEvaluationDigest !== digestJson(semanticEvaluation)
  )
    throw new Error(`NodeGym passed semantic evaluation is invalid for ${plan.runId}.`);
}

export function nodeGymReceiptArtifactBindings(artifacts) {
  const bindings = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.path === 'string') {
      if (!isSha256(value.digest) || !Number.isSafeInteger(value.bytes) || value.bytes < 1)
        throw new Error(`NodeGym artifact binding is invalid: ${value.path}.`);
      bindings.push({ path: value.path, digest: value.digest, bytes: value.bytes });
      return;
    }
    for (const entry of Object.values(value)) visit(entry);
  };
  visit(artifacts);
  bindings.sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(bindings.map((binding) => binding.path)).size !== bindings.length)
    throw new Error('NodeGym artifact paths must be unique within an attempt.');
  return bindings;
}

export function assertNodeGymAttemptEvidence({
  plan,
  receipt,
  parsedPlan,
  executorResult,
  semanticEvaluation,
  files,
  artifacts,
}) {
  const attempt = receipt?.attempt;
  if (!Number.isSafeInteger(attempt) || attempt < 1)
    throw new Error('NodeGym attempt evidence requires a positive attempt number.');
  const stem = `attempts/attempt-${String(attempt).padStart(3, '0')}`;
  const expectedPaths = {
    plan: `${stem}/plan.json`,
    executorResult: `${stem}/executor-result.json`,
    semanticEvaluation: `${stem}/semantic-evaluation.json`,
  };
  if (
    digestJson(parsedPlan) !== digestJson(plan) ||
    digestJson(executorResult) !== receipt.executorResultDigest ||
    digestJson(semanticEvaluation) !== receipt.semanticEvaluationDigest ||
    digestJson(executorResult?.artifacts ?? {}) !== digestJson(receipt.artifacts ?? {})
  )
    throw new Error(`NodeGym attempt ${attempt} parsed evidence does not match its receipt.`);
  if (receipt.attemptEvidence?.schemaVersion !== 'nodekit.gym-attempt-evidence/v1')
    throw new Error(`NodeGym attempt ${attempt} evidence schema is invalid.`);
  if (receipt.attemptEvidence.artifactRoot !== `${stem}/work`)
    throw new Error(`NodeGym attempt ${attempt} artifact root is invalid.`);
  for (const key of Object.keys(expectedPaths)) {
    const declared = receipt.attemptEvidence.files?.[key];
    const actual = files?.[key];
    if (
      declared?.path !== expectedPaths[key] ||
      actual?.path !== expectedPaths[key] ||
      !isSha256(declared?.digest) ||
      declared.digest !== actual?.digest ||
      !Number.isSafeInteger(declared?.bytes) ||
      declared.bytes < 1 ||
      declared.bytes !== actual?.bytes
    )
      throw new Error(`NodeGym attempt ${attempt} ${key} file binding is invalid.`);
  }
  const declaredArtifacts = nodeGymReceiptArtifactBindings(receipt.artifacts ?? {});
  const actualArtifacts = [...(artifacts ?? [])].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  if (
    digestJson(declaredArtifacts) !== digestJson(actualArtifacts) ||
    receipt.attemptEvidence.artifactSetDigest !== digestJson(actualArtifacts)
  )
    throw new Error(`NodeGym attempt ${attempt} artifact bytes do not match its receipt.`);
  return { artifactCount: actualArtifacts.length, artifactSetDigest: digestJson(actualArtifacts) };
}

/**
 * The default campaign is deliberately small: every model cohort is represented,
 * two harnesses are paired on the same task/model/repetition, and the eight
 * curriculum levels are rotated across model pairs. The full 720-run matrix is never the
 * implicit default.
 */
export function selectNodeGymSubset(matrix, mode = 'bounded') {
  const runs = matrix?.runs ?? [];
  if (mode === 'all') return [...runs];
  const models = uniqueBy(
    runs.map((run) => run.model),
    (model) => model.id,
  );
  const tasks = uniqueBy(
    runs.map((run) => run.task),
    (task) => task.id,
  );
  const harnessIds = uniqueBy(
    runs.map((run) => run.harness),
    (harness) => harness.id,
  )
    .slice(0, 2)
    .map((harness) => harness.id);
  if (harnessIds.length < 2) throw new Error('A paired subset requires at least two harnesses.');
  const targetRepetition = runs.map((run) => run.repetition).sort((left, right) => left - right)[0];

  const selectedModels =
    mode === 'deterministic'
      ? models.filter((model) => model.provider === 'local')
      : mode === 'live-smoke'
        ? models.filter((model) => ['pinned-free', 'random-router'].includes(model.cohort))
        : models;
  const selected = [];
  for (const [index, model] of selectedModels.entries()) {
    const task = tasks[index % tasks.length];
    for (const harnessId of harnessIds) {
      const run = runs.find(
        (candidate) =>
          candidate.model.id === model.id &&
          candidate.task.id === task.id &&
          candidate.harness.id === harnessId &&
          candidate.repetition === targetRepetition,
      );
      if (!run) {
        throw new Error(
          `Missing paired run for ${model.id}, ${task.id}, ${harnessId}, repetition ${targetRepetition}.`,
        );
      }
      selected.push(run);
    }
  }
  assertSubsetPairing(selected);
  return selected;
}

export function assertSubsetPairing(runs) {
  const groups = new Map();
  for (const run of runs) {
    const current = groups.get(run.pairingKey) ?? [];
    current.push(run);
    groups.set(run.pairingKey, current);
  }
  for (const [pairingKey, group] of groups) {
    if (group.length < 2) throw new Error(`Unpaired subset entry: ${pairingKey}.`);
    if (new Set(group.map((run) => `${run.harness.id}@${run.harness.version}`)).size < 2)
      throw new Error(`Pairing key ${pairingKey} does not compare distinct harnesses.`);
  }
}

export function applyPairSafeLimit(runs, limit = Number.POSITIVE_INFINITY) {
  if (limit === Number.POSITIVE_INFINITY) return [...runs];
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('Pair-safe limit must be a positive integer.');
  const groups = [];
  const byKey = new Map();
  for (const run of runs) {
    const group = byKey.get(run.pairingKey);
    if (group) group.push(run);
    else {
      const next = [run];
      byKey.set(run.pairingKey, next);
      groups.push(next);
    }
  }
  const selected = [];
  for (const group of groups) {
    if (group.length < 2)
      throw new Error(`Pair-safe limit encountered unpaired group ${group[0]?.pairingKey}.`);
    if (selected.length + group.length > limit) break;
    selected.push(...group);
  }
  if (!selected.length)
    throw new Error(`Pair-safe limit ${limit} is smaller than the first complete pair.`);
  assertSubsetPairing(selected);
  return selected;
}

export function validateNodeGymExecutorResult(plan, result, options = {}) {
  const issues = [];
  if (result?.schemaVersion !== NODE_GYM_EXECUTOR_RESULT_SCHEMA)
    issues.push('executor_result_schema_invalid');
  if (result?.runId !== plan.runId) issues.push('run_id_mismatch');
  if (result?.pairingKey !== plan.pairingKey) issues.push('pairing_key_mismatch');
  if (!TERMINAL_EXECUTOR_STATUSES.has(result?.status)) issues.push('executor_status_invalid');

  const latencyMs = nonNegativeNumber(result?.usage?.latencyMs);
  const inputTokens = nonNegativeNumber(result?.usage?.inputTokens);
  const outputTokens = nonNegativeNumber(result?.usage?.outputTokens);
  const costMicroUsd = nonNegativeNumber(result?.usage?.costMicroUsd);
  const repairCount = nonNegativeNumber(result?.usage?.repairCount);
  if (latencyMs === null) issues.push('latency_missing');
  if (inputTokens === null || outputTokens === null) issues.push('token_usage_missing');
  if (costMicroUsd === null) issues.push('cost_missing');
  if (repairCount === null) issues.push('repair_count_missing');
  if (latencyMs !== null && latencyMs > plan.budget.maxLatencyMs)
    issues.push('latency_budget_exceeded');
  if (outputTokens !== null && outputTokens > plan.budget.maxTokens)
    issues.push('output_token_budget_exceeded');
  if (costMicroUsd !== null && costMicroUsd > plan.budget.maxCostMicroUsd)
    issues.push('cost_budget_exceeded');
  if (repairCount !== null && repairCount > plan.budget.maxRepairs)
    issues.push('repair_budget_exceeded');

  const routeMode = result?.route?.mode;
  const returnedModel =
    cleanString(result?.route?.actualModel) ?? cleanString(result?.route?.returnedModel);
  const actualProvider = cleanString(result?.route?.actualProvider);
  const routeAttributionId =
    cleanString(result?.route?.responseId) ?? cleanString(result?.route?.traceId);
  if (!['live', 'deterministic', 'degraded'].includes(routeMode))
    issues.push('route_classification_missing');
  if (routeMode === 'degraded') issues.push('degraded_route');
  if (plan.model.returnedModelRequired && !returnedModel)
    issues.push('returned_model_attribution_missing');
  if (plan.model.provider !== 'local' && !actualProvider)
    issues.push('actual_upstream_provider_missing');
  if (plan.model.provider !== 'local' && !routeAttributionId)
    issues.push('route_attribution_id_missing');
  if (
    returnedModel &&
    plan.model.cohort !== 'random-router' &&
    plan.model.provider !== 'local' &&
    returnedModel !== plan.model.route
  )
    issues.push('returned_model_route_mismatch');
  if (plan.model.cohort === 'random-router' && returnedModel && returnedModel === plan.model.route)
    issues.push('random_router_upstream_unresolved');

  const artifacts = result?.artifacts ?? {};
  for (const kind of REQUIRED_ARTIFACTS) {
    const artifact = artifacts[kind];
    if (!artifact) {
      issues.push(`${kind}_artifact_missing`);
      continue;
    }
    if (!cleanString(artifact.path)) issues.push(`${kind}_artifact_path_missing`);
    if (!isSha256(artifact.digest)) issues.push(`${kind}_artifact_digest_invalid`);
    if (!(Number(artifact.bytes) > 0)) issues.push(`${kind}_artifact_empty`);
    if (artifact.validation?.status !== 'passed')
      issues.push(`${kind}_${artifact.validation?.issueCode ?? 'validation_failed'}`);
  }

  for (const issue of result?.issueCodes ?? []) {
    if (typeof issue !== 'string' || !issue) continue;
    if (/^[a-z][a-z0-9_]{0,95}$/u.test(issue)) issues.push(issue);
    else issues.push('executor_diagnostic_unclassified');
  }
  if (result?.status === 'provider-error') issues.push('provider_error');
  if (result?.status === 'budget-exhausted') issues.push('budget_exhausted');
  if (result?.status === 'artifact-failure') issues.push('artifact_generation_failed');
  if (result?.status === 'failed') issues.push('execution_failed');

  // The prior 70-deck baseline exposed these recurring failure families. They
  // remain explicit stable diagnoses instead of collapsing into "deck failed".
  if (result?.diagnostics?.estimatedTextOverflowCount > 0) issues.push('pptx_text_overflow');
  if (result?.diagnostics?.exportTimedOut === true) issues.push('pptx_export_timeout');
  if (result?.diagnostics?.unsupportedClaimCount > 0) issues.push('unsupported_claim');
  if (result?.diagnostics?.freeModelClaimUnattributed === true)
    issues.push('free_model_claim_unattributed');
  if (result?.diagnostics?.claimAudit?.status !== 'passed') issues.push('claim_audit_not_run');
  if (
    options.executor === 'ui' &&
    !(
      result?.artifactSpecShadow?.status === 'passed' &&
      result.artifactSpecShadow.userVisible === false &&
      result.artifactSpecShadow.mutationApplied === false &&
      result.artifactSpecShadow.anonymized === true &&
      isSha256(result.artifactSpecShadow.receiptDigest) &&
      isSha256(result.artifactSpecShadow.specSetDigest)
    )
  )
    issues.push('typed_artifact_spec_not_observed');
  if (options.requireSemanticEvidence === true) {
    const semantic = options.semanticEvaluation;
    if (
      semantic?.schemaVersion !== 'nodekit.gym-semantic-evaluation/v1' ||
      semantic?.runId !== plan.runId
    )
      issues.push('semantic_evaluation_missing');
    else {
      if (semantic.hardGatesPassed !== true) issues.push('semantic_hard_gate_failure');
      for (const code of semantic.issueCodes ?? []) issues.push(code);
    }
  }

  const uniqueIssues = [...new Set(issues)].sort();
  const automatedHardGatesPassed = result?.status === 'completed' && uniqueIssues.length === 0;
  return {
    schemaVersion: NODE_GYM_RUN_RECEIPT_SCHEMA,
    runId: plan.runId,
    comparisonKey: plan.comparisonKey ?? comparisonKeyFromPlan(plan),
    harnessPairingKey: plan.harnessPairingKey ?? plan.pairingKey,
    pairingKey: plan.pairingKey,
    repetition: plan.repetition,
    planDigest: digestJson(plan),
    executorResultDigest: digestJson(result),
    semanticEvaluationDigest: options.semanticEvaluation
      ? digestJson(options.semanticEvaluation)
      : null,
    status: automatedHardGatesPassed ? 'passed' : classifyReceiptStatus(result, uniqueIssues),
    returnedModel: returnedModel ?? null,
    actualRoute: {
      requestedProvider: plan.model.provider,
      requestedRoute: plan.model.route,
      actualProvider,
      actualModel: returnedModel ?? null,
      attributionId: routeAttributionId,
      attributionIdKind: result?.route?.responseId ? 'provider-response' : 'nodeslide-trace',
    },
    routeMode: routeMode ?? 'unknown',
    automatedHardGatesPassed,
    promotionEligible: false,
    humanPreference: { status: 'not_run' },
    issueCodes: uniqueIssues,
    usage: {
      latencyMs: latencyMs ?? 0,
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      costMicroUsd: costMicroUsd ?? 0,
      repairCount: repairCount ?? 0,
    },
    artifacts,
    executor: options.executor ?? 'unknown',
  };
}

/**
 * The most a single gym run can cost the backend ledger, in micro-USD. This is the per-run hard cap
 * the production backend binds to every run it meters (`normalizeNodeSlideRunBudget({})` ->
 * `maxCostMicroUsd`, `shared/nodeslideRunBudget.ts`), mirrored here because this module runs under
 * plain `node`, which cannot load that TypeScript. `scripts/tests/node-gym-campaign-budget.test.mjs`
 * fails when the two differ.
 */
export const NODE_GYM_BACKEND_RUN_RESERVATION_MICRO_USD = 1_000_000;
export const NODE_GYM_LEDGER_RECEIPT_VERSION = 'nodeslide.run-budget-ledger-receipt/v1';
export const NODE_GYM_ORPHAN_CHARGE_SCHEMA = 'nodekit.gym-orphan-attempt-charge/v1';

/**
 * What one run reserves against the campaign before it is dispatched: the backend ledger cap that
 * binds it, not the gym plan's own `budget.maxCostMicroUsd` (which the UI executor never hands to the
 * backend). It takes no override: a reservation below the enforced cap would let a campaign dispatch
 * paid work it has not budgeted for. Local, `:free` and `openrouter/free` routes issue no metered
 * request and reserve 0.
 */
export function nodeGymRunReservationMicroUsd(plan) {
  const model = plan?.model;
  if (
    model?.provider === 'local' ||
    model?.route === 'openrouter/free' ||
    String(model?.route ?? '').endsWith(':free')
  )
    return 0;
  return NODE_GYM_BACKEND_RUN_RESERVATION_MICRO_USD;
}

/**
 * Micro-USD one backend ledger receipt (`nodeslideBudgets.receiptForRun`) says a run cost. Only a
 * finalized ledger row is a final figure: a row still `open` belongs to a job that may be running
 * (a UI timeout does not stop it), so its counters are a floor, not the cost. Exposure that is
 * reserved or unreconciled (a dispatch whose outcome never came back) counts: it may still have been
 * billed. Returns null when the receipt is not a readable, finalized ledger receipt; the caller then
 * keeps the run's full reservation.
 */
export function nodeGymLedgerReceiptMicroUsd(receipt) {
  if (receipt?.version !== NODE_GYM_LEDGER_RECEIPT_VERSION) return null;
  if (receipt.status !== 'finalized') return null;
  const spend = receipt.spend;
  const parts = [spend?.actualMicroUsd, spend?.reservedMicroUsd, spend?.unreconciledMicroUsd];
  if (!parts.every((part) => Number.isSafeInteger(part) && part >= 0)) return null;
  const total = parts[0] + parts[1] + parts[2];
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * Combines the ledger receipts of every backend run one gym attempt caused. Any run that is named but
 * unreadable (or no run named at all) makes the whole attempt's usage unknown: returns null.
 */
export function combineNodeGymLedgerReceipts(backendRunIds, receiptsByRunId) {
  if (!Array.isArray(backendRunIds) || backendRunIds.length === 0) return null;
  let total = 0;
  for (const runId of new Set(backendRunIds)) {
    const charged = nodeGymLedgerReceiptMicroUsd(receiptsByRunId?.get?.(runId) ?? null);
    if (charged === null) return null;
    total += charged;
  }
  return Number.isSafeInteger(total) ? { chargedMicroUsd: total } : null;
}

/**
 * The one charge rule for a finished run. A readable backend ledger receipt is the charge. Anything
 * else — a crash, a timeout, a failure result, a missing or invalid result, no backend run ids, an
 * unreadable receipt — keeps the run's full reservation: an unknown spend is never a zero.
 */
export function nodeGymRunCharge({ reservationMicroUsd, ledgerReceipt }) {
  if (!Number.isSafeInteger(reservationMicroUsd) || reservationMicroUsd < 0)
    throw new Error('NodeGym run charge requires a non-negative integer reservation.');
  const ledger = ledgerReceipt?.chargedMicroUsd;
  if (Number.isSafeInteger(ledger) && ledger >= 0)
    return { chargedMicroUsd: ledger, source: 'ledger' };
  return { chargedMicroUsd: reservationMicroUsd, source: 'reservation' };
}

/**
 * Charges one finished attempt. The backend ledger is the meter: a completed executor result names
 * the backend runs it caused (`backendRunIds`) and `readLedger(ids)` resolves their ledger receipts
 * (Map of run id -> receipt). A crash, timeout, missing or invalid result, no run ids or any
 * unreadable receipt keeps the full reservation; a failure result is charged the ledger only when it
 * names the backend runs the executor had already started. The executor's own `usage.costMicroUsd` and
 * the Trace inspector text are attribution and never reach this function.
 */
export async function chargeNodeGymAttempt({ reservationMicroUsd, result, readLedger }) {
  const ids = result?.backendRunIds;
  const named =
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= 64 &&
    ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 512);
  let ledgerReceipt = null;
  if (reservationMicroUsd > 0 && named) {
    try {
      ledgerReceipt = combineNodeGymLedgerReceipts(ids, await readLedger(ids));
    } catch {
      ledgerReceipt = null;
    }
  }
  return nodeGymRunCharge({ reservationMicroUsd, ledgerReceipt });
}

/** The charge a stored attempt receipt carries; a receipt from before charges were recorded owes the reservation. */
export function nodeGymReceiptCharge(receipt, reservationMicroUsd, label = 'NodeGym receipt') {
  const budget = receipt?.budget;
  if (budget === undefined) return { chargedMicroUsd: reservationMicroUsd, source: 'reservation' };
  if (
    !budget ||
    !Number.isSafeInteger(budget.chargedMicroUsd) ||
    budget.chargedMicroUsd < 0 ||
    !['ledger', 'reservation'].includes(budget.source)
  )
    throw new Error(`${label} has an invalid budget charge.`);
  return { chargedMicroUsd: budget.chargedMicroUsd, source: budget.source };
}

/** Durable record for an attempt directory that never produced a receipt: it is charged its reservation. */
export function nodeGymOrphanAttemptCharge({ runId, attempt, reservationMicroUsd }) {
  return {
    schemaVersion: NODE_GYM_ORPHAN_CHARGE_SCHEMA,
    runId,
    attempt,
    budget: { chargedMicroUsd: reservationMicroUsd, source: 'reservation' },
  };
}

export function assertNodeGymOrphanCharge(value, runId, label = 'NodeGym orphan charge') {
  if (
    value?.schemaVersion !== NODE_GYM_ORPHAN_CHARGE_SCHEMA ||
    value.runId !== runId ||
    !Number.isSafeInteger(value.attempt) ||
    value.attempt < 1 ||
    value.budget?.source !== 'reservation' ||
    !Number.isSafeInteger(value.budget?.chargedMicroUsd) ||
    value.budget.chargedMicroUsd < 0
  )
    throw new Error(`${label} is invalid for ${runId}.`);
  return value;
}

const ORPHAN_ATTEMPT_DIR = /^orphaned-attempt-(\d{3,})-(\d+)$/u;
const ORPHAN_CHARGE_FILE = /^orphaned-attempt-(\d{3,})-(\d+)\.charge\.json$/u;

/**
 * The runner itself died mid-attempt: `attempts/attempt-NNN/` exists but no `attempt-NNN.json`
 * receipt was ever written, so what that attempt spent is unknown. Each such directory is charged the
 * run's full reservation, durably, and set aside so the attempt number can be re-issued. The charge
 * file is written first (a crash between the two steps over-charges once, never under-charges) and
 * a pending charge whose directory has not been renamed yet is reused, so a repeated resume does not
 * charge the same directory twice.
 */
export async function setAsideNodeGymOrphanAttempts({
  campaignRoot,
  attemptsDir,
  runId,
  orphanAttempts,
  reservationMicroUsd,
}) {
  for (const attempt of [...orphanAttempts].sort((left, right) => left - right)) {
    const stem = String(attempt).padStart(3, '0');
    const names = await readdir(attemptsDir);
    const pending = names
      .map((name) => ORPHAN_CHARGE_FILE.exec(name))
      .filter((match) => match && match[1] === stem)
      .map((match) => Number(match[2]))
      .find((k) => !names.includes(`orphaned-attempt-${stem}-${k}`));
    const used = names
      .flatMap((name) => [ORPHAN_CHARGE_FILE.exec(name), ORPHAN_ATTEMPT_DIR.exec(name)])
      .filter((match) => match && match[1] === stem)
      .map((match) => Number(match[2]));
    const k = pending ?? Math.max(0, ...used) + 1;
    const chargePath = path.join(attemptsDir, `orphaned-attempt-${stem}-${k}.charge.json`);
    if (pending === undefined) {
      const charge = nodeGymOrphanAttemptCharge({ runId, attempt, reservationMicroUsd });
      await writeNodeGymFileAtomic(
        campaignRoot,
        chargePath,
        `${JSON.stringify(charge, null, 2)}\n`,
        {
          exclusive: true,
          label: 'orphaned attempt charge',
        },
      );
    }
    await rename(
      path.join(attemptsDir, `attempt-${stem}`),
      path.join(attemptsDir, `orphaned-attempt-${stem}-${k}`),
    );
  }
}

/** Every durable orphan charge recorded for one run, validated. */
export async function loadNodeGymOrphanCharges({ attemptsDir, runId }) {
  const charges = [];
  for (const name of await readdir(attemptsDir)) {
    if (!ORPHAN_CHARGE_FILE.test(name)) continue;
    const raw = JSON.parse(await readFile(path.join(attemptsDir, name), 'utf8'));
    charges.push(assertNodeGymOrphanCharge(raw, runId, `NodeGym orphan charge ${name}`));
  }
  return charges;
}

export function shouldStopCampaign(input) {
  // Equality is allowed so zero-cost controls/free routes can run under a zero
  // aggregate cap. Any positive metered cost then trips the next boundary.
  if (input.spentCostMicroUsd > input.maxTotalCostMicroUsd)
    return { stop: true, issueCode: 'campaign_cost_limit_reached' };
  if (
    Number.isFinite(input.nextRunMaxCostMicroUsd) &&
    input.nextRunMaxCostMicroUsd >= 0 &&
    input.spentCostMicroUsd + input.nextRunMaxCostMicroUsd > input.maxTotalCostMicroUsd
  )
    return { stop: true, issueCode: 'campaign_projected_cost_limit_reached' };
  if (input.failures >= input.maxFailures)
    return { stop: true, issueCode: 'campaign_failure_limit_reached' };
  return { stop: false, issueCode: null };
}

export function assertNodeGymContainedPath(parent, candidate, label = 'NodeGym path') {
  assertNodeGymSafePathSyntax(candidate, label);
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw new Error(`${label} must remain inside the configured artifact root.`);
}

export function assertNodeGymSafePathSyntax(candidate, label = 'NodeGym path') {
  const value = String(candidate);
  if (
    value.includes('\0') ||
    value.split(/[\\/]+/u).some((segment) => segment === '.' || segment === '..')
  )
    throw new Error(`${label} must not contain dot segments or NUL bytes.`);
}

/**
 * Verifies both lexical containment and the on-disk path chain. Existing
 * symlinks and Windows junctions below the configured root are rejected, and
 * the nearest existing ancestor must resolve beneath the root's real path.
 */
export async function assertNodeGymRealPathContained(parent, candidate, label = 'NodeGym path') {
  assertNodeGymContainedPath(parent, candidate, label);
  const parentPath = path.resolve(parent);
  const candidatePath = path.resolve(candidate);
  const parentInfo = await lstat(parentPath).catch(() => null);
  if (!parentInfo) throw new Error(`${label} configured artifact root does not exist.`);
  if (parentInfo.isSymbolicLink())
    throw new Error(`${label} configured artifact root must not be a symlink or junction.`);
  const parentRealPath = await realpath(parentPath);

  const relative = path.relative(parentPath, candidatePath);
  let cursor = parentPath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error(`${label} must not traverse a symlink or junction.`);
  }

  let ancestor = candidatePath;
  while (true) {
    try {
      const ancestorRealPath = await realpath(ancestor);
      assertNodeGymContainedPath(parentRealPath, ancestorRealPath, label);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const next = path.dirname(ancestor);
      if (next === ancestor)
        throw new Error(`${label} has no existing ancestor beneath its configured root.`);
      ancestor = next;
    }
  }
}

/** Writes through a same-directory exclusive temporary file, then publishes atomically. */
export async function writeNodeGymFileAtomic(
  parent,
  candidate,
  content,
  { exclusive = false, label = 'NodeGym output file', mode = 0o600 } = {},
) {
  const filePath = path.resolve(candidate);
  const directory = path.dirname(filePath);
  await assertNodeGymRealPathContained(parent, directory, label);
  await mkdir(directory, { recursive: true });
  await assertNodeGymRealPathContained(parent, directory, label);
  await assertNodeGymRealPathContained(parent, filePath, label);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  assertNodeGymContainedPath(parent, temporary, `${label} temporary file`);
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
    await assertNodeGymRealPathContained(parent, temporary, `${label} temporary file`);
    if (exclusive) await link(temporary, filePath);
    else await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  await assertNodeGymRealPathContained(parent, filePath, label);
}

export function digestJson(value) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
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

function classifyReceiptStatus(result, issues) {
  if (
    issues.includes('budget_exhausted') ||
    issues.some((issue) => issue.endsWith('_budget_exceeded'))
  )
    return 'budget-exhausted';
  if (issues.includes('provider_error')) return 'provider-error';
  if (issues.includes('degraded_route')) return 'degraded';
  if (
    issues.some(
      (issue) =>
        issue.includes('artifact') ||
        issue.includes('overflow') ||
        issue.includes('export_timeout'),
    )
  )
    return 'artifact-failure';
  return result?.status === 'completed' ? 'failed' : (result?.status ?? 'failed');
}

function uniqueBy(values, key) {
  const seen = new Set();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function comparisonKeyFromPlan(plan) {
  return [
    plan.task.taskDigest,
    plan.task.evidenceDigest,
    plan.task.referenceDigest,
    plan.repetition,
    [
      plan.budget.maxTokens,
      plan.budget.maxLatencyMs,
      plan.budget.maxCostMicroUsd,
      plan.budget.maxRepairs,
    ].join(':'),
  ].join('::');
}

/**
 * Tracks the one executor child a campaign has running so the campaign lock is never released while
 * it lives. On POSIX a child outlives a parent that exits, so a signal that only reached the parent
 * used to free `campaign.lock` while the executor kept writing its attempt workspace; the next launch
 * then took the lock, treated that live workspace as an orphan, set it aside and re-issued the same
 * attempt path. `stop()` signals the child and resolves only once it has closed, escalating to
 * SIGKILL after `graceMs`; `killNow()` is the synchronous last resort for an exit path.
 */
export function createNodeGymChildGuard({ graceMs = 10_000 } = {}) {
  let active = null;
  return {
    track(child) {
      active = child;
      const clear = () => {
        if (active === child) active = null;
      };
      child.once('close', clear);
      child.once('error', clear);
    },
    async stop() {
      const child = active;
      if (!child) return;
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill();
      const escalate = setTimeout(() => child.kill('SIGKILL'), graceMs);
      await closed;
      clearTimeout(escalate);
    },
    killNow() {
      active?.kill('SIGKILL');
    },
  };
}
