import { createHash } from 'node:crypto';

export const NODE_SLIDE_OFFERED_ROUTE_CATALOG = [
  ['moonshotai/kimi-k3', 'openrouter', 'moonshotai/kimi-k3'],
  ['z-ai/glm-5.2', 'openrouter', 'z-ai/glm-5.2'],
  ['anthropic/claude-sonnet-5', 'openrouter', 'anthropic/claude-sonnet-5'],
  ['anthropic/claude-fable-5', 'openrouter', 'anthropic/claude-fable-5'],
  ['anthropic/claude-sonnet-5.5', 'openrouter', 'anthropic/claude-sonnet-5.5'],
  ['anthropic/claude-opus-5.5', 'openrouter', 'anthropic/claude-opus-5.5'],
  // google/gemini-3.5-flash left the offered set: Google deprecated it on 2026-10-08.
  ['google/gemini-3.8-flash', 'openrouter', 'google/gemini-3.8-flash'],
  ['google/gemini-3.1-pro-preview', 'openrouter', 'google/gemini-3.1-pro-preview'],
  ['openai/gpt-5.6-sol', 'openrouter', 'openai/gpt-5.6-sol'],
  ['openai/gpt-5.6-terra', 'openrouter', 'openai/gpt-5.6-terra'],
  ['openai/gpt-6.1-sol', 'openrouter', 'openai/gpt-6.1-sol'],
].map(([id, provider, upstreamId]) => ({ id, provider, upstreamId }));

export const NODE_SLIDE_FREE_ROUTE_CATALOG = [
  ['openrouter/free', 'openrouter', 'openrouter/free'],
  ['google/gemma-4-26b-a4b-it:free', 'openrouter', 'google/gemma-4-26b-a4b-it:free'],
  ['google/gemma-4-31b-it:free', 'openrouter', 'google/gemma-4-31b-it:free'],
  [
    'nvidia/nemotron-3-super-120b-a12b:free',
    'openrouter',
    'nvidia/nemotron-3-super-120b-a12b:free',
  ],
  // openai/gpt-oss-20b:free dropped: absent from the OpenRouter catalog (GET /api/v1/models, 2026-10-10).
].map(([id, provider, upstreamId]) => ({ id, provider, upstreamId }));

export const EXECUTOR_SPLIT_RECEIPT_SCHEMA = 'nodeslide.executor-split-probe/v1';
// SPEC D2 (Homen 2026-10-16): the newest :free model with structured outputs on the public OpenRouter
// list. live-unverified (no key). The run-budget ledger denies zero-priced :free routes, so no real
// receipt can be accepted until the executor has a priced route.
const EXECUTOR_SPLIT_EXECUTOR_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
const EXECUTOR_SPLIT_PLANNER_MODEL = 'moonshotai/kimi-k3';
const EXECUTOR_SPLIT_COMMAND = 'npx convex run nodeslideModelProbe:runExecutorSplit';
/** Pre-flight ceiling: one planner call and one executor call. A third is a retry or repair call. */
const EXECUTOR_SPLIT_MAX_REQUESTS = 2;

const CATALOG_BY_SCHEMA = new Map([
  ['nodeslide.model-fleet-probe/v1', NODE_SLIDE_OFFERED_ROUTE_CATALOG],
  ['nodeslide.free-router-fleet-probe/v1', NODE_SLIDE_FREE_ROUTE_CATALOG],
  ['nodeslide.free-router-structured-probe/v1', NODE_SLIDE_FREE_ROUTE_CATALOG],
]);

export function validateModelFleetReceipt(receipt, schemaVersion) {
  const catalog = CATALOG_BY_SCHEMA.get(schemaVersion);
  const requiresZeroCost = schemaVersion.startsWith('nodeslide.free-router-');
  if (!catalog || !receipt || receipt.schemaVersion !== schemaVersion) {
    throw new Error('Fleet receipt schema is not an allowed production probe schema.');
  }
  if (
    typeof receipt.passed !== 'boolean' ||
    !Number.isInteger(receipt.catalogModelCount) ||
    !Number.isInteger(receipt.probedModelCount) ||
    !Number.isInteger(receipt.failedModelCount) ||
    !Array.isArray(receipt.receipts) ||
    receipt.catalogModelCount !== catalog.length ||
    receipt.probedModelCount !== catalog.length ||
    receipt.receipts.length !== catalog.length
  ) {
    throw new Error('Fleet receipt counts do not match the exact configured route catalog.');
  }

  const expected = new Map(catalog.map((route) => [route.id, route]));
  const observed = new Set();
  let failedCount = 0;
  for (const entry of receipt.receipts) {
    if (!entry || typeof entry !== 'object' || typeof entry.model !== 'string') {
      throw new Error('Fleet receipt contains an invalid route entry.');
    }
    const route = expected.get(entry.model);
    if (!route || observed.has(entry.model)) {
      throw new Error('Fleet receipt contains an unknown or duplicate route.');
    }
    observed.add(entry.model);
    if (entry.provider !== route.provider || entry.upstreamModel !== route.upstreamId) {
      throw new Error('Fleet receipt requested-route attribution does not match the catalog.');
    }
    if (!['passed', 'failed'].includes(entry.status)) {
      throw new Error('Fleet receipt contains an invalid route status.');
    }
    if (entry.status === 'failed') failedCount += 1;
    for (const field of ['latencyMs', 'costMicroUsd', 'inputTokens', 'outputTokens']) {
      if (!Number.isSafeInteger(entry[field]) || entry[field] < 0) {
        throw new Error(`Fleet receipt contains invalid ${field}.`);
      }
    }
    if (
      entry.status === 'passed' &&
      (typeof entry.actualProvider !== 'string' ||
        entry.actualProvider.length === 0 ||
        typeof entry.actualModel !== 'string' ||
        entry.actualModel.length === 0)
    ) {
      throw new Error('Passing fleet entries require actual provider/model attribution.');
    }
    if (entry.status === 'passed' && entry.actualProvider !== route.provider) {
      throw new Error('Passing fleet entries require exact provider attribution.');
    }
    if (entry.status === 'passed' && !isNormalizedModelIdentity(entry.actualModel)) {
      throw new Error('Passing fleet entries require a normalized resolved-model identity.');
    }
    if (
      entry.status === 'passed' &&
      ((route.id === 'openrouter/free' && entry.actualModel === route.upstreamId) ||
        (route.id !== 'openrouter/free' && entry.actualModel !== route.upstreamId))
    ) {
      throw new Error('Passing fleet entries require exact resolved-model attribution.');
    }
    if (entry.status === 'passed' && requiresZeroCost && entry.costMicroUsd !== 0) {
      throw new Error('Passing free-router entries require exact zero-cost telemetry.');
    }
    if (
      !entry.response ||
      typeof entry.response.present !== 'boolean' ||
      !Number.isSafeInteger(entry.response.bytes) ||
      entry.response.bytes < 0 ||
      (entry.status === 'passed' && (!entry.response.present || entry.response.bytes === 0))
    ) {
      throw new Error('Fleet route response-presence evidence is inconsistent.');
    }
  }
  if (observed.size !== catalog.length || failedCount !== receipt.failedModelCount) {
    throw new Error('Fleet receipt failed-route count is inconsistent.');
  }
  if (receipt.passed !== (failedCount === 0)) {
    throw new Error('Fleet receipt aggregate passed status is inconsistent.');
  }
  const serialized = JSON.stringify(receipt);
  if (/"(?:text|errorMessage|accumulatedText)"\s*:/u.test(serialized)) {
    throw new Error('Fleet receipt contained a forbidden provider-content field.');
  }
  return { catalog, failedCount };
}

function isNormalizedModelIdentity(value) {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 3 &&
    value.length <= 256 &&
    /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/u.test(value)
  );
}

/**
 * Acceptance rule for the routed-executor receipt (SPEC Part A, sections A.0.3 and A.2.8). Accepted
 * only when the turn really split to the new executor, the provider echoed that exact model with
 * non-zero usage, the executor's copy was applied, the ledger shows spend and no refusal, no call was
 * retried or fell back to another model, and the deployment names the tested commit. Returns the
 * failures; an empty list means accepted. Never throws on a bad receipt. A rejected receipt is re-run,
 * never edited.
 */
export function executorSplitReceiptFailures(receipt, testedCommit) {
  if (!receipt || receipt.schemaVersion !== EXECUTOR_SPLIT_RECEIPT_SCHEMA)
    return ['receipt schema is not nodeslide.executor-split-probe/v1'];
  const failures = [];
  const fail = (message) => failures.push(message);

  if (receipt.command !== EXECUTOR_SPLIT_COMMAND) fail(`command is ${receipt.command}`);
  if (
    !Array.isArray(receipt.candidateIds) ||
    !receipt.candidateIds.includes(EXECUTOR_SPLIT_EXECUTOR_MODEL)
  )
    fail('candidateIds does not name the executor under test');
  if (receipt.constantSha256 !== sha256(EXECUTOR_SPLIT_EXECUTOR_MODEL))
    fail('constantSha256 does not match the executor constant');
  if (!testedCommit || receipt.testedCommit !== testedCommit)
    fail(`testedCommit is ${receipt.testedCommit ?? null}`);
  if (!testedCommit || receipt.buildIdentity?.commitSha !== testedCommit)
    fail(`buildIdentity.commitSha is ${receipt.buildIdentity?.commitSha ?? null}`);
  if (typeof receipt.startedAt !== 'string' || Number.isNaN(Date.parse(receipt.startedAt)))
    fail('startedAt is not a timestamp');
  if (!receipt.environment || typeof receipt.environment !== 'object')
    fail('environment is missing');

  const routing = receipt.routing ?? {};
  if (routing.reason !== 'split_premium_planner_bulk_copy')
    fail(`routing.reason is ${routing.reason}`);
  if (routing.plannerModel !== EXECUTOR_SPLIT_PLANNER_MODEL)
    fail(`routing.plannerModel is ${routing.plannerModel}`);
  if (routing.executorModel !== EXECUTOR_SPLIT_EXECUTOR_MODEL)
    fail(`routing.executorModel is ${routing.executorModel}`);
  if (routing.executorOutcome !== 'applied')
    fail(`routing.executorOutcome is ${routing.executorOutcome}`);

  const spans = Array.isArray(receipt.spans) ? receipt.spans : [];
  const rows = Array.isArray(receipt.rows) ? receipt.rows : [];
  const expected = [
    ['planner', EXECUTOR_SPLIT_PLANNER_MODEL],
    ['executor', EXECUTOR_SPLIT_EXECUTOR_MODEL],
  ];
  const microUsd = (usd) => Math.round(usd * 1_000_000);
  const isCount = (value) => Number.isFinite(value) && value >= 0;
  for (const [toolName, model] of expected) {
    const span = spans.find((entry) => entry?.toolName === toolName);
    const row = rows.find((entry) => entry?.toolName === toolName);
    if (!span) fail(`no ${toolName} span`);
    else {
      if (span.spanModel !== model) fail(`${toolName} spanModel is ${span.spanModel}`);
      if (span.responseModel !== model) fail(`${toolName} responseModel is ${span.responseModel}`);
      const { inputTokens, outputTokens } = span.usage ?? {};
      if (!(inputTokens > 0 || outputTokens > 0)) fail(`${toolName} usage is zero`);
    }
    if (!row) fail(`no ${toolName} row`);
    else {
      if (row.requestedModel !== model)
        fail(`${toolName} row requestedModel is ${row.requestedModel}`);
      if (row.resolvedModel !== row.requestedModel)
        fail(`${toolName} row resolvedModel ${row.resolvedModel} differs from requestedModel`);
      if (row.echoedModel !== model) fail(`${toolName} row echoedModel is ${row.echoedModel}`);
      if (row.fallbackUsed !== false) fail(`${toolName} row used a fallback`);
      if (span && row.echoedModel !== span.responseModel) fail(`${toolName} row and span disagree`);
      // The row is the accounting line for the span: its usage, cost and call count must be present
      // and must reconcile with the span, otherwise a row stripped of them would pass unseen.
      const rowUsage = row.usage ?? {};
      if (!(isCount(rowUsage.inputTokens) && isCount(rowUsage.outputTokens)))
        fail(`${toolName} row usage is missing`);
      else if (!(rowUsage.inputTokens > 0 || rowUsage.outputTokens > 0))
        fail(`${toolName} row usage is zero`);
      if (!isCount(row.costUsd)) fail(`${toolName} row costUsd is missing`);
      if (row.dispatches !== 1)
        fail(`${toolName} row dispatched ${row.dispatches ?? null} times, not exactly once`);
      if (span) {
        if (row.requestedModel !== span.spanModel)
          fail(`${toolName} row requestedModel and span spanModel disagree`);
        if (
          rowUsage.inputTokens !== span.usage?.inputTokens ||
          rowUsage.outputTokens !== span.usage?.outputTokens
        )
          fail(`${toolName} row usage and span usage disagree`);
        if (!isCount(span.costMicroUsd) || microUsd(row.costUsd) !== span.costMicroUsd)
          fail(`${toolName} row costUsd and span costMicroUsd disagree`);
      }
    }
  }
  const toolNames = (entries) =>
    entries
      .map((entry) => entry?.toolName)
      .sort()
      .join(',');
  if (toolNames(spans) !== 'executor,planner' || toolNames(rows) !== 'executor,planner')
    fail('spans and rows are not exactly one planner and one executor');
  if (spans.length !== expected.length || rows.length !== expected.length)
    fail(`receipt has ${spans.length} spans and ${rows.length} rows, not ${expected.length}`);
  const echoed = [...new Set(rows.map((row) => row?.echoedModel).filter(Boolean))].sort();
  const reported = Array.isArray(receipt.echoedModels) ? [...receipt.echoedModels].sort() : [];
  if (JSON.stringify(echoed) !== JSON.stringify(reported))
    fail('echoedModels does not list the models the rows echoed');
  if (!reported.includes(EXECUTOR_SPLIT_EXECUTOR_MODEL))
    fail('echoedModels does not include the executor');

  // A.0.3: `dispatchPolicy` absent or not {maxRetries: 0, crossModelFallback: false} is rejected, and
  // so is a request count above the pre-flight ceiling. The policy is the one the probe enforced
  // (retries are switched off in the provider call); each row separately must show one dispatch.
  const policy = receipt.dispatchPolicy;
  if (!policy || policy.maxRetries !== 0 || policy.crossModelFallback !== false)
    fail(
      `dispatchPolicy is ${JSON.stringify(policy ?? null)}, not maxRetries 0 and no cross-model fallback`,
    );
  const dispatches = rows.reduce(
    (total, row) => total + (Number.isInteger(row?.dispatches) ? row.dispatches : 0),
    0,
  );

  // `budget` is the ledger's accounting for the probe: what it authorized, what it settled, and
  // whether it refused anything.
  const budget = receipt.budget;
  if (!budget) fail('budget is missing');
  else {
    if (!(Number.isFinite(budget.maxUsd) && budget.maxUsd > 0))
      fail('budget.maxUsd is not a positive number');
    if (!(Number.isFinite(budget.estimateUsd) && budget.estimateUsd > 0))
      fail('budget.estimateUsd shows no reservation');
    else if (
      Number.isFinite(budget.maxUsd) &&
      microUsd(budget.estimateUsd) > microUsd(budget.maxUsd)
    )
      fail('budget.estimateUsd exceeds budget.maxUsd');
    if (!(Number.isFinite(budget.spentUsd) && budget.spentUsd > 0))
      fail('budget.spentUsd shows no spend');
    else {
      if (budget.spentUsd > budget.maxUsd) fail('budget.spentUsd exceeds budget.maxUsd');
      // The ledger settles the larger of the provider's cost and a token-based recomputation, so it
      // can exceed the rows, never undercut them.
      const spansMicroUsd = spans.reduce((total, span) => total + (span?.costMicroUsd ?? 0), 0);
      const rowsMicroUsd = rows.reduce(
        (total, row) => total + (isCount(row?.costUsd) ? microUsd(row.costUsd) : 0),
        0,
      );
      const spentMicroUsd = microUsd(budget.spentUsd);
      if (spentMicroUsd < Math.max(spansMicroUsd, rowsMicroUsd))
        fail('budget.spentUsd is below the cost the rows report');
      // A reservation quote is the worst case the ledger authorized for a call, so settled spend
      // above the summed quotes means the books and the reservations do not reconcile.
      if (Number.isFinite(budget.estimateUsd) && spentMicroUsd > microUsd(budget.estimateUsd))
        fail('budget.spentUsd exceeds budget.estimateUsd');
    }
    if (budget.requests !== dispatches)
      fail(`budget.requests is ${budget.requests}, rows dispatched ${dispatches}`);
    if (budget.requests !== EXECUTOR_SPLIT_MAX_REQUESTS)
      fail(
        `budget.requests is ${budget.requests}, not the ${EXECUTOR_SPLIT_MAX_REQUESTS} one planner and one executor request make`,
      );
    if (!(budget.requests <= EXECUTOR_SPLIT_MAX_REQUESTS))
      fail(
        `budget.requests is ${budget.requests}, above the pre-flight ceiling of ${EXECUTOR_SPLIT_MAX_REQUESTS}`,
      );
    if (budget.stoppedBy !== null) fail(`budget.stoppedBy is ${budget.stoppedBy}`);
    if (!Array.isArray(budget.refusals) || budget.refusals.length > 0)
      fail('the budget refused a dispatch or the refusal list is missing');
  }
  return failures;
}

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}
