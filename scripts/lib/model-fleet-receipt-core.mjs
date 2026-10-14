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
const EXECUTOR_SPLIT_EXECUTOR_MODEL = 'google/gemini-3.8-flash';

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
 * Acceptance rule for the routed-executor receipt (SPEC Part A, section A.2.8). Accepted only when
 * the turn really split to the new executor, the provider echoed that exact model with non-zero
 * usage, the executor's copy was applied, no budget refusal occurred and the deployment names the
 * tested commit. Returns the failures; an empty list means accepted. Never throws on a bad receipt.
 */
export function executorSplitReceiptFailures(receipt, testedCommit) {
  const failures = [];
  if (!receipt || receipt.schemaVersion !== EXECUTOR_SPLIT_RECEIPT_SCHEMA)
    return ['receipt schema is not nodeslide.executor-split-probe/v1'];
  const routing = receipt.routing ?? {};
  if (routing.reason !== 'split_premium_planner_bulk_copy')
    failures.push(`routing.reason is ${routing.reason}`);
  if (routing.executorModel !== EXECUTOR_SPLIT_EXECUTOR_MODEL)
    failures.push(`routing.executorModel is ${routing.executorModel}`);
  if (routing.executorOutcome !== 'applied')
    failures.push(`routing.executorOutcome is ${routing.executorOutcome}`);
  const executor = (receipt.spans ?? []).find((entry) => entry?.toolName === 'executor');
  if (!executor) failures.push('no executor span');
  else {
    if (executor.responseModel !== EXECUTOR_SPLIT_EXECUTOR_MODEL)
      failures.push(`executor responseModel is ${executor.responseModel}`);
    const { inputTokens, outputTokens } = executor.usage ?? {};
    if (!(inputTokens > 0 || outputTokens > 0)) failures.push('executor usage is zero');
  }
  if ((receipt.budget?.refusals ?? ['missing']).length > 0)
    failures.push('the budget refused a dispatch or is missing');
  if (!testedCommit || receipt.buildIdentity?.commitSha !== testedCommit)
    failures.push(`buildIdentity.commitSha is ${receipt.buildIdentity?.commitSha ?? null}`);
  return failures;
}
