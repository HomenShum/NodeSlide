/**
 * Budgeted provider adapter — COMPLETE. This is the reserve-before-dispatch
 * engine, and it is the only caller of `nodeslideBudgets.reserve`.
 *
 * `callNodeSlideBudgetedJson` was withheld while the model price table was; both
 * landed together, deliberately, because either one alone is a lie. A price
 * table nothing quotes against is dead weight; a `reserve` mutation nothing
 * calls makes `nodeSlideBudgetEnforcementPosture()` report `'enforced'` over a
 * deployment where no dispatch is ever metered — which is precisely the false
 * claim that derivation exists to prevent.
 *
 * THE ORDER MATTERS, and every step of it fails closed:
 *   1. create the durable budget row (idempotent; even a route that is about to
 *      be denied owns a zero-usage budget the job can finalize),
 *   2. refuse unpriceable routes BEFORE reserving, with the route's own stated
 *      reason — dynamic and unknown never become a zero quote,
 *   3. replay: a call id that already has a terminal record is never dispatched
 *      twice,
 *   4. reserve the WORST case against the cap; a refusal returns a coded result,
 *   5. dispatch under the reservation's own output ceiling and timeout,
 *   6. settle against the receipt, and only if the receipt fits inside what was
 *      authorized. A receipt that exceeds its authorization, a provider that
 *      returned no telemetry, an ambiguous attempt, or a route mismatch all
 *      convert the reservation to UNRECONCILED rather than releasing it —
 *      unresolved exposure stays inside the cap instead of being handed back.
 *
 * There is no branch that reaches the provider without a reservation, and no
 * branch that ends in a bare throw: every failure is `{ ok: false, code, reason }`.
 */
import {
  NODESLIDE_DEFAULT_AGENT_MODEL,
  type NodeSlideAgentModelId,
  nodeSlideAgentModel,
} from '../../shared/nodeslide';
import {
  type NodeSlideRunBudget,
  type NodeSlideRunBudgetInput,
  isNodeSlideScoredPricing,
  nodeSlideModelPricing,
  nodeSlidePricingRefusalReason,
  normalizeNodeSlideRunBudget,
  scoreNodeSlideWorstCaseCost,
} from '../../shared/nodeslideRunBudget';
import { nodeslideStableId } from './nodeslideIds';
import {
  type NodeSlideDispatchPolicy,
  type NodeSlideProviderResult,
  callNodeSlideFreeJson,
} from './nodeslideProvider';

const MAX_PROVIDER_ATTEMPTS = 2;
const PROVIDER_HARD_MAX_OUTPUT_TOKENS = 2_200;
const PROVIDER_HARD_TIMEOUT_MS = 30_000;

/**
 * The per-attempt hard ceilings a budgeted dispatch imposes on the wire.
 *
 * These are workload shape, not policy: they bound ONE provider attempt so a
 * runaway completion cannot outrun its reservation. They are deliberately NOT
 * the run budget — the cap on spend is `NodeSlideRunBudgetInput`, and these
 * ceilings only ever tighten what a single attempt may ask for.
 *
 * They are parameterized because the two metered paths have genuinely different
 * shapes, and a single set of numbers silently broke one of them. An edit patch
 * is a small JSON delta that finishes inside 30s; a full deck is a ~5k-token
 * completion that the create path already gives 240s. Feeding create the edit
 * ceilings does not "enforce a budget" on it — `resolveDispatchPolicy` TIGHTENS
 * (takes the min), so it would have silently cut create's completion to 2_200
 * tokens and its deadline to 30s, guaranteeing a truncated spec and a
 * deterministic fallback on every provider-backed create. A budget wire that
 * disables the feature it meters is not enforcement, it is an outage.
 */
export interface NodeSlideProviderHardCeilings {
  readonly maxOutputTokensPerAttempt: number;
  readonly timeoutMs: number;
}

/** The historical ceilings. Every existing caller keeps exactly these. */
export const NODESLIDE_EDIT_PROVIDER_CEILINGS: NodeSlideProviderHardCeilings = {
  maxOutputTokensPerAttempt: PROVIDER_HARD_MAX_OUTPUT_TOKENS,
  timeoutMs: PROVIDER_HARD_TIMEOUT_MS,
};

/** Matches the unbudgeted create call this seam replaced: 5k tokens, 240s. */
export const NODESLIDE_CREATE_PROVIDER_CEILINGS: NodeSlideProviderHardCeilings = {
  maxOutputTokensPerAttempt: 5_000,
  timeoutMs: 240_000,
};
const MAX_REPAIR_CONTEXT_UTF8_BYTES = 24_000 * 4;
const PROVIDER_MESSAGE_OVERHEAD_TOKENS_PER_ATTEMPT = 4_096;
const MAX_STATE_RETRIES = 2;

export type NodeSlideBudgetedJsonRequest = Parameters<typeof callNodeSlideFreeJson>[0];

export interface NodeSlideBudgetLedgerView {
  budget: {
    id: string;
    status: 'open' | 'finalized';
    revision: number;
    stateDigest: string;
    actualMicroUsd: number;
    reservedMicroUsd: number;
    unreconciledMicroUsd: number;
  };
  call?: {
    callId: string;
    status: 'reserved' | 'unreconciled' | 'settled' | 'released';
    quoteMicroUsd: number;
    providerSafeOutputTokenCeiling: number;
    providerTimeoutMs: number;
  };
}

/** A review candidate cannot be persisted while a paid dispatch is still active. */
export function nodeSlideBudgetHasActiveReservation(
  state: NodeSlideBudgetLedgerView | null | undefined,
): boolean {
  return Boolean(state && state.budget.reservedMicroUsd > 0);
}

/**
 * Structural client for convex/nodeslideBudgets.ts. An action binds these
 * methods to ctx.runMutation/internal.nodeslideBudgets and ctx.runQuery.
 */
export interface NodeSlideBudgetLedgerClient {
  create(args: {
    budgetId: string;
    budget: NodeSlideRunBudgetInput;
  }): Promise<NodeSlideBudgetLedgerView>;
  reserve(args: {
    budgetId: string;
    callId: string;
    model: string;
    estimatedInputTokens: number;
    requestedMaxOutputTokens: number;
    expectedRevision: number;
    expectedStateDigest: string;
  }): Promise<NodeSlideBudgetLedgerView>;
  settle(args: {
    budgetId: string;
    callId: string;
    inputTokens: number;
    outputTokens: number;
    actualMicroUsd: number;
    elapsedMs: number;
    iterations: number;
    toolCalls: number;
    expectedRevision: number;
    expectedStateDigest: string;
  }): Promise<NodeSlideBudgetLedgerView>;
  captureTimeout(args: {
    budgetId: string;
    callId: string;
    expectedRevision: number;
    expectedStateDigest: string;
  }): Promise<NodeSlideBudgetLedgerView>;
  release(args: {
    budgetId: string;
    callId: string;
    expectedRevision: number;
    expectedStateDigest: string;
  }): Promise<NodeSlideBudgetLedgerView>;
  replay(args: {
    budgetId: string;
    callId?: string;
  }): Promise<NodeSlideBudgetLedgerView | null>;
}

/**
 * Binds the six ledger mutations an action can call, from the generated
 * `internal.nodeslideBudgets` reference.
 *
 * This lives here rather than inline in the calling action for one reason: the
 * binding is where `reserve` becomes reachable, and a binding that quietly
 * dropped `reserve` would leave `nodeSlideBudgetEnforcementPosture()` reporting
 * `'enforced'` over a deployment that never authorizes anything. Here it is
 * exported, and `nodeslideBudgetEnforcement.test.ts` asserts every method
 * resolves to the mutation it names.
 */
export function bindNodeSlideBudgetLedgerClient(
  ctx: {
    // biome-ignore lint/suspicious/noExplicitAny: generated Convex function-reference boundary
    runMutation: (reference: any, args: any) => Promise<any>;
    // biome-ignore lint/suspicious/noExplicitAny: generated Convex function-reference boundary
    runQuery: (reference: any, args: any) => Promise<any>;
  },
  budgets: {
    create: unknown;
    reserve: unknown;
    settle: unknown;
    captureTimeout: unknown;
    release: unknown;
    replay: unknown;
  },
): NodeSlideBudgetLedgerClient {
  return {
    create: (args) => ctx.runMutation(budgets.create, args),
    reserve: (args) => ctx.runMutation(budgets.reserve, args),
    settle: (args) => ctx.runMutation(budgets.settle, args),
    captureTimeout: (args) => ctx.runMutation(budgets.captureTimeout, args),
    release: (args) => ctx.runMutation(budgets.release, args),
    replay: (args) => ctx.runQuery(budgets.replay, args),
  };
}

/**
 * The dispatch seam a budgeted call hands to the provider. The policy is
 * required, not optional: a budgeted dispatch that forgot to carry its ceiling
 * would be indistinguishable from an unbudgeted one at the call site.
 */
export type NodeSlideBudgetedProviderCall = (
  request: NodeSlideBudgetedJsonRequest,
  dependencies: {
    dispatchPolicy: Required<Pick<NodeSlideDispatchPolicy, 'maxOutputTokens' | 'timeoutMs'>> &
      Pick<
        NodeSlideDispatchPolicy,
        'maxInputMicroUsdPerMillionTokens' | 'maxOutputMicroUsdPerMillionTokens'
      >;
  },
) => Promise<NodeSlideProviderResult>;

export interface NodeSlideBudgetedProviderDependencies {
  ledger: NodeSlideBudgetLedgerClient;
  provider?: NodeSlideBudgetedProviderCall;
  now?: () => number;
}

export interface NodeSlideBudgetedProviderRequest {
  /**
   * Stable durable run/session key. Changing a budget for this key is rejected.
   * The caller must hold the run's exclusive durable dispatch lease.
   */
  runId: string;
  /** Stable semantic slot within the run, such as edit-planner or repair-2. */
  callKey: string;
  budget?: NodeSlideRunBudgetInput;
  providerRequest: NodeSlideBudgetedJsonRequest;
  /** Per-attempt wire ceilings. Defaults to the edit path's historical values. */
  ceilings?: NodeSlideProviderHardCeilings;
}

export type NodeSlideBudgetDisposition =
  | 'settled'
  | 'unreconciled'
  | 'released'
  | 'denied'
  | 'replayed'
  | 'accounting_error';

export interface NodeSlideBudgetAccounting {
  budgetId: string;
  callId: string;
  disposition: NodeSlideBudgetDisposition;
  ledger?: NodeSlideBudgetLedgerView;
}

export type NodeSlideBudgetedProviderResult =
  | ({ accounting: NodeSlideBudgetAccounting } & NodeSlideProviderResult)
  | {
      ok: false;
      reason: string;
      code:
        | 'pricing_unknown'
        | 'budget_denied'
        | 'ambiguous_provider_call'
        | 'idempotent_replay'
        | 'accounting_failed';
      accounting: NodeSlideBudgetAccounting;
    };

/** Deterministic and opaque: durable IDs never expose the caller's run key. */
export function nodeSlideProviderBudgetId(runId: string): string {
  assertStableKey('runId', runId);
  return nodeslideStableId('nsbudget', runId);
}

/**
 * The request digest is part of the call ID so a changed prompt cannot replay a
 * reservation that happened to have the same token estimate.
 */
export function nodeSlideProviderCallId(args: {
  runId: string;
  callKey: string;
  providerRequest: NodeSlideBudgetedJsonRequest;
}): string {
  assertStableKey('runId', args.runId);
  assertStableKey('callKey', args.callKey);
  return nodeslideStableId(
    'nscall',
    args.runId,
    args.callKey,
    canonicalJson(providerRequestIdentity(args.providerRequest)),
  );
}

/**
 * Conservative tokenizer-independent bound. A byte cannot require more than
 * one byte-level token; role/message overhead and the maximum repair excerpt
 * are then added explicitly for both possible provider attempts.
 */
export function estimateNodeSlideProviderInputTokens(
  request: NodeSlideBudgetedJsonRequest,
): number {
  const encoder = new TextEncoder();
  const requestBytes =
    encoder.encode(request.systemPrompt).byteLength +
    encoder.encode(request.userText).byteLength +
    encoder.encode(canonicalJson(request.jsonSchema ?? null)).byteLength;
  return (
    requestBytes * MAX_PROVIDER_ATTEMPTS +
    MAX_REPAIR_CONTEXT_UTF8_BYTES +
    PROVIDER_MESSAGE_OVERHEAD_TOKENS_PER_ATTEMPT * MAX_PROVIDER_ATTEMPTS
  );
}

/**
 * Trusted reserve-before-dispatch adapter. It deliberately returns an honest
 * failure for a prior terminal call because the budget ledger stores accounting
 * receipts, not the provider's JSON value; the durable job journal owns result
 * replay. No replay path dispatches the provider twice.
 */
export async function callNodeSlideBudgetedJson(
  args: NodeSlideBudgetedProviderRequest,
  dependencies: NodeSlideBudgetedProviderDependencies,
): Promise<NodeSlideBudgetedProviderResult> {
  const provider = dependencies.provider ?? defaultProviderCall;
  const now = dependencies.now ?? Date.now;
  const selectedModel = args.providerRequest.model ?? NODESLIDE_DEFAULT_AGENT_MODEL;
  const budgetId = nodeSlideProviderBudgetId(args.runId);
  const callId = nodeSlideProviderCallId(args);
  const baseAccounting = { budgetId, callId };

  let canonicalBudget: NodeSlideRunBudget;
  try {
    canonicalBudget = normalizeNodeSlideRunBudget(args.budget ?? {});
  } catch {
    return budgetDenied(
      baseAccounting,
      'The run budget is invalid, so provider dispatch was denied.',
    );
  }

  let created: NodeSlideBudgetLedgerView;
  try {
    created = await dependencies.ledger.create({
      budgetId,
      budget: budgetInput(canonicalBudget),
    });
  } catch {
    return budgetDenied(
      baseAccounting,
      'The durable run budget could not be created or replayed, so provider dispatch was denied.',
    );
  }

  // Even a denied provider route owns a durable zero-usage budget, so job
  // completion can finalize an accounting record instead of failing after the
  // deterministic fallback has already been persisted. The refusal below states
  // the route's own reason; a dynamic zero-priced route is never quoted at zero.
  const pricing = nodeSlideModelPricing(selectedModel);
  if (!isNodeSlideScoredPricing(pricing)) {
    return {
      ok: false,
      reason: nodeSlidePricingRefusalReason(pricing),
      code: 'pricing_unknown',
      accounting: { ...baseAccounting, disposition: 'denied' },
    };
  }

  let prior: NodeSlideBudgetLedgerView | null;
  try {
    prior = await dependencies.ledger.replay({ budgetId, callId });
  } catch {
    return accountingFailure(
      baseAccounting,
      'The durable budget ledger could not be read, so provider dispatch was denied.',
    );
  }
  if (prior?.call) {
    return recoverPriorCall(prior, dependencies.ledger, baseAccounting);
  }

  const ceilings = args.ceilings ?? NODESLIDE_EDIT_PROVIDER_CEILINGS;
  const estimatedInputTokens = estimateNodeSlideProviderInputTokens(args.providerRequest);
  const perAttemptRequestedOutput = providerRequestedOutputTokens(
    args.providerRequest.maxTokens,
    ceilings.maxOutputTokensPerAttempt,
  );
  const requestedMaxOutputTokens = perAttemptRequestedOutput * MAX_PROVIDER_ATTEMPTS;
  let reservation: NodeSlideBudgetLedgerView;
  try {
    reservation = await reserveWithStateRetry(dependencies.ledger, {
      budgetId,
      callId,
      model: selectedModel,
      estimatedInputTokens,
      requestedMaxOutputTokens,
      state: created,
    });
  } catch (error) {
    return budgetDenied(baseAccounting, reservationRefusalText(error));
  }
  const reservedCall = reservation.call;
  if (!reservedCall || reservedCall.status !== 'reserved') {
    return replayedFailure(
      baseAccounting,
      reservation,
      'The provider call was already accounted for; replay its durable job result.',
    );
  }

  const perAttemptOutputCeiling = Math.floor(
    reservedCall.providerSafeOutputTokenCeiling / MAX_PROVIDER_ATTEMPTS,
  );
  if (perAttemptOutputCeiling < 1) {
    return releaseWithoutDispatch(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The remaining budget cannot authorize both the initial completion and its repair attempt.',
    );
  }

  const startedAt = now();
  let providerResult: NodeSlideProviderResult;
  try {
    providerResult = await provider(
      { ...args.providerRequest, maxTokens: perAttemptOutputCeiling },
      {
        dispatchPolicy: {
          maxOutputTokens: perAttemptOutputCeiling,
          timeoutMs: Math.min(reservedCall.providerTimeoutMs, ceilings.timeoutMs),
          ...(nodeSlideAgentModel(selectedModel as NodeSlideAgentModelId).provider === 'openrouter'
            ? {
                maxInputMicroUsdPerMillionTokens: pricing.inputMicroUsdPerMillionTokens,
                maxOutputMicroUsdPerMillionTokens: pricing.outputMicroUsdPerMillionTokens,
              }
            : {}),
        },
      },
    );
  } catch {
    return captureAmbiguous(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The provider call ended ambiguously; its full reservation remains unreconciled.',
    );
  }

  if (!providerResult.telemetry) {
    return releaseWithoutDispatch(
      dependencies.ledger,
      baseAccounting,
      reservation,
      providerResult.ok === false
        ? providerResult.reason
        : 'The provider omitted its required accounting telemetry.',
      providerResult,
    );
  }
  if (!hasProvenSettledAttempts(providerResult)) {
    return captureAmbiguous(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The provider call ended ambiguously; its full reservation remains unreconciled.',
      providerResult,
    );
  }

  const telemetry = providerResult.telemetry;
  const selectedRoute = nodeSlideAgentModel(selectedModel as NodeSlideAgentModelId);
  if (
    telemetry.provider !== selectedRoute.provider ||
    telemetry.model !== selectedRoute.upstreamId
  ) {
    return captureAmbiguous(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The provider receipt did not match its authorized route; the full reservation remains unreconciled.',
      providerResult,
    );
  }
  const receipt = conservativeReceipt({
    model: selectedModel as NodeSlideAgentModelId,
    telemetry,
    elapsedMs: Math.max(0, Math.ceil(now() - startedAt)),
  });
  if (
    !receipt ||
    receipt.inputTokens > estimatedInputTokens ||
    receipt.outputTokens > reservedCall.providerSafeOutputTokenCeiling ||
    receipt.actualMicroUsd > reservedCall.quoteMicroUsd
  ) {
    return captureAmbiguous(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The provider receipt exceeded its authorization; the full reservation remains unreconciled.',
      providerResult,
    );
  }

  try {
    const settled = await terminalWithStateRetry(
      dependencies.ledger,
      'settle',
      {
        budgetId,
        callId,
        inputTokens: receipt.inputTokens,
        outputTokens: receipt.outputTokens,
        actualMicroUsd: receipt.actualMicroUsd,
        elapsedMs: receipt.elapsedMs,
        iterations: receipt.iterations,
        toolCalls: 0,
      },
      reservation,
    );
    return {
      ...providerResult,
      accounting: { ...baseAccounting, disposition: 'settled', ledger: settled },
    };
  } catch {
    return captureAmbiguous(
      dependencies.ledger,
      baseAccounting,
      reservation,
      'The provider receipt could not be settled; the full reservation remains unreconciled.',
      providerResult,
    );
  }
}

function defaultProviderCall(
  request: NodeSlideBudgetedJsonRequest,
  dependencies: Parameters<NodeSlideBudgetedProviderCall>[1],
): Promise<NodeSlideProviderResult> {
  return callNodeSlideFreeJson(request, { dispatchPolicy: dependencies.dispatchPolicy });
}

/**
 * The planner seam, as one function instead of an inline closure.
 *
 * It exists so the sentence "every metered planner dispatch is reserved before
 * it is issued" can be TESTED rather than asserted. An earlier version of this
 * lived inline in `convex/nodeslideAgent.ts` and the only available check was a
 * grep for the adapter's name in the module source — which a knockout test
 * defeated in one line, by leaving the name in place and returning before it.
 * A seam that cannot be driven cannot be proven, so the seam moved here.
 *
 * `metered: false` is the deterministic route: it issues no provider request, so
 * there is nothing to reserve and a reservation would be accounting theatre.
 * That branch is the ONLY unbudgeted path, and the test suite pins it.
 *
 * Each invocation gets its own `callKey`, because the router may dispatch more
 * than once per run (initial plan, then a repair) and two calls sharing a key
 * would collide on the ledger's idempotency check.
 */
export interface NodeSlideBudgetedDispatchArgs {
  runId: string;
  budget: NodeSlideRunBudgetInput;
  metered: boolean;
  ledger: NodeSlideBudgetLedgerClient;
  dispatch: (
    request: NodeSlideBudgetedJsonRequest,
    dependencies?: { dispatchPolicy?: NodeSlideDispatchPolicy },
  ) => Promise<NodeSlideProviderResult>;
}

function createNodeSlideBudgetedDispatch(
  args: NodeSlideBudgetedDispatchArgs,
  seam: { callKeyPrefix: string; ceilings: NodeSlideProviderHardCeilings },
): (request: NodeSlideBudgetedJsonRequest) => Promise<NodeSlideProviderResult> {
  let ordinal = 0;
  return async (request) => {
    if (!args.metered) return await args.dispatch(request);
    ordinal += 1;
    return await callNodeSlideBudgetedJson(
      {
        runId: args.runId,
        callKey: `${seam.callKeyPrefix}-${ordinal}`,
        budget: args.budget,
        providerRequest: request,
        ceilings: seam.ceilings,
      },
      {
        ledger: args.ledger,
        provider: (budgetedRequest, dependencies) =>
          args.dispatch(budgetedRequest, { dispatchPolicy: dependencies.dispatchPolicy }),
      },
    );
  };
}

export function createNodeSlideBudgetedEditDispatch(
  args: NodeSlideBudgetedDispatchArgs,
): (request: NodeSlideBudgetedJsonRequest) => Promise<NodeSlideProviderResult> {
  return createNodeSlideBudgetedDispatch(args, {
    callKeyPrefix: 'edit-planner',
    ceilings: NODESLIDE_EDIT_PROVIDER_CEILINGS,
  });
}

/**
 * The create seam, and the reason `enforcementPosture` may say 'enforced' about
 * a create receipt.
 *
 * Deck creation was the last unmetered provider call in the product: the edit
 * path reserved before dispatch while `createDeckFromBrief` called the provider
 * directly, so a global `enforced` posture was describing a half-metered system.
 * This is the same reserve -> call -> settle discipline the edit path uses, and
 * it fails closed the same way — a reservation that cannot be computed or
 * afforded returns a coded `{ ok: false }`, the create router treats it as an
 * unusable provider response, and the run produces a deterministic deck without
 * spending rather than spending without a ceiling.
 *
 * It is a separate exported symbol from the edit seam ON PURPOSE.
 * `nodeSlideBudgetEnforcementPosture` in `convex/nodeslideJobs.ts` derives a
 * PER-PATH posture from the presence of these two names, so deleting this one
 * cannot leave create receipts still claiming a ceiling nothing applies.
 */
export function createNodeSlideBudgetedCreateDispatch(
  args: NodeSlideBudgetedDispatchArgs,
): (request: NodeSlideBudgetedJsonRequest) => Promise<NodeSlideProviderResult> {
  return createNodeSlideBudgetedDispatch(args, {
    callKeyPrefix: 'brief-to-deck',
    ceilings: NODESLIDE_CREATE_PROVIDER_CEILINGS,
  });
}

/**
 * `reserve` throws a coded `NodeSlideBudgetLedgerError` whose message already
 * names the limit that refused the run. Forwarding it keeps the refusal human
 * readable at the call site instead of flattening every denial into one string.
 */
function reservationRefusalText(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0 && message.length <= 1_000) {
      return message;
    }
  }
  return 'The hard run budget could not authorize this provider call.';
}

function providerRequestIdentity(request: NodeSlideBudgetedJsonRequest) {
  return {
    systemPrompt: request.systemPrompt,
    userText: request.userText,
    maxTokens: request.maxTokens,
    model: request.model ?? NODESLIDE_DEFAULT_AGENT_MODEL,
    reasoningEffort: request.reasoningEffort ?? null,
    jsonSchema: request.jsonSchema ?? null,
  };
}

function providerRequestedOutputTokens(value: number, ceiling: number): number {
  const hardCeiling = Number.isFinite(ceiling)
    ? Math.max(1, Math.floor(ceiling))
    : PROVIDER_HARD_MAX_OUTPUT_TOKENS;
  if (!Number.isFinite(value)) return hardCeiling;
  return Math.min(hardCeiling, Math.max(1, Math.floor(value)));
}

function budgetInput(budget: NodeSlideRunBudget): NodeSlideRunBudgetInput {
  return {
    maxCostUsd: budget.maxCostUsd,
    maxInputTokens: budget.maxInputTokens,
    maxOutputTokens: budget.maxOutputTokens,
    maxDurationMs: budget.maxDurationMs,
    maxIterations: budget.maxIterations,
    maxToolCalls: budget.maxToolCalls,
  };
}

/**
 * The settled cost is the GREATER of what the provider reported and what this
 * deployment's own price table says the tokens cost. A provider that under-
 * reports its own bill cannot use that to slip past the cap.
 */
function conservativeReceipt(args: {
  model: NodeSlideAgentModelId;
  telemetry: NonNullable<NodeSlideProviderResult['telemetry']>;
  elapsedMs: number;
}) {
  const inputTokens = accountingInteger(args.telemetry.inputTokens);
  const outputTokens = accountingInteger(args.telemetry.outputTokens);
  const providerCostMicroUsd = accountingInteger(args.telemetry.costMicroUsd);
  if (inputTokens === null || outputTokens === null || providerCostMicroUsd === null) return null;
  const recomputed = scoreNodeSlideWorstCaseCost({
    model: args.model,
    inputTokens,
    outputTokens,
  });
  if (recomputed.kind !== 'scored') return null;
  const attempts = args.telemetry.attempts ?? [];
  const attemptElapsedMs = attempts.reduce(
    (total, attempt) => total + Math.max(0, Math.ceil(attempt.elapsedMs)),
    0,
  );
  return {
    inputTokens,
    outputTokens,
    actualMicroUsd: Math.max(providerCostMicroUsd, recomputed.totalCostMicroUsd),
    elapsedMs: Math.max(args.elapsedMs, attemptElapsedMs),
    iterations: attempts.length,
  };
}

function hasProvenSettledAttempts(result: NodeSlideProviderResult): boolean {
  const attempts = result.telemetry?.attempts;
  return Boolean(
    attempts?.length &&
      attempts.every(
        (attempt) =>
          attempt.attempted && attempt.settled && !attempt.ambiguous && !attempt.unreconciled,
      ),
  );
}

function accountingInteger(value: number): number | null {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

async function reserveWithStateRetry(
  ledger: NodeSlideBudgetLedgerClient,
  args: {
    budgetId: string;
    callId: string;
    model: string;
    estimatedInputTokens: number;
    requestedMaxOutputTokens: number;
    state: NodeSlideBudgetLedgerView;
  },
): Promise<NodeSlideBudgetLedgerView> {
  let state = args.state;
  for (let attempt = 0; attempt < MAX_STATE_RETRIES; attempt += 1) {
    try {
      return await ledger.reserve({
        budgetId: args.budgetId,
        callId: args.callId,
        model: args.model,
        estimatedInputTokens: args.estimatedInputTokens,
        requestedMaxOutputTokens: args.requestedMaxOutputTokens,
        expectedRevision: state.budget.revision,
        expectedStateDigest: state.budget.stateDigest,
      });
    } catch (error) {
      if (!isStaleStateError(error) || attempt + 1 >= MAX_STATE_RETRIES) throw error;
      const replay = await ledger.replay({ budgetId: args.budgetId, callId: args.callId });
      if (!replay) throw error;
      if (replay.call) return replay;
      state = replay;
    }
  }
  throw new Error('nodeslide_budget_reservation_unreachable');
}

async function terminalWithStateRetry(
  ledger: NodeSlideBudgetLedgerClient,
  operation: 'settle' | 'captureTimeout' | 'release',
  args: Record<string, unknown> & { budgetId: string; callId: string },
  initial: NodeSlideBudgetLedgerView,
): Promise<NodeSlideBudgetLedgerView> {
  let state = initial;
  for (let attempt = 0; attempt < MAX_STATE_RETRIES; attempt += 1) {
    try {
      const expected = {
        ...args,
        expectedRevision: state.budget.revision,
        expectedStateDigest: state.budget.stateDigest,
      };
      if (operation === 'settle') {
        return await ledger.settle(
          expected as Parameters<NodeSlideBudgetLedgerClient['settle']>[0],
        );
      }
      if (operation === 'captureTimeout') {
        return await ledger.captureTimeout(
          expected as Parameters<NodeSlideBudgetLedgerClient['captureTimeout']>[0],
        );
      }
      return await ledger.release(
        expected as Parameters<NodeSlideBudgetLedgerClient['release']>[0],
      );
    } catch (error) {
      if (!isStaleStateError(error) || attempt + 1 >= MAX_STATE_RETRIES) throw error;
      const replay = await ledger.replay({ budgetId: args.budgetId, callId: args.callId });
      if (!replay) throw error;
      state = replay;
    }
  }
  throw new Error('nodeslide_budget_transition_unreachable');
}

async function recoverPriorCall(
  prior: NodeSlideBudgetLedgerView,
  ledger: NodeSlideBudgetLedgerClient,
  accounting: { budgetId: string; callId: string },
): Promise<NodeSlideBudgetedProviderResult> {
  if (prior.call?.status === 'reserved') {
    return captureAmbiguous(
      ledger,
      accounting,
      prior,
      'A prior dispatch may have started; its full reservation remains unreconciled.',
    );
  }
  return replayedFailure(
    accounting,
    prior,
    prior.call?.status === 'unreconciled'
      ? 'The prior provider call remains unreconciled; replay its durable ambiguous result without dispatching again.'
      : 'The provider call was already accounted for; replay its durable job result.',
  );
}

async function captureAmbiguous(
  ledger: NodeSlideBudgetLedgerClient,
  accounting: { budgetId: string; callId: string },
  state: NodeSlideBudgetLedgerView,
  reason: string,
  providerResult?: NodeSlideProviderResult,
): Promise<NodeSlideBudgetedProviderResult> {
  try {
    const captured = await terminalWithStateRetry(
      ledger,
      'captureTimeout',
      { budgetId: accounting.budgetId, callId: accounting.callId },
      state,
    );
    return {
      ok: false,
      // The provider's own failure reason is kept in front of the accounting
      // note. Replacing it would erase the attribution a caller needs — the
      // deck's trace would say "ambiguous" where the truth is "the route
      // returned invalid JSON, AND its reservation is still held".
      reason:
        providerResult?.ok === false && providerResult.reason
          ? `${providerResult.reason} ${reason}`
          : reason,
      code: 'ambiguous_provider_call',
      accounting: { ...accounting, disposition: 'unreconciled', ledger: captured },
      ...(providerResult?.telemetry ? { telemetry: providerResult.telemetry } : {}),
    };
  } catch {
    return accountingFailure(
      accounting,
      'The provider call may be billable and its durable accounting could not be reconciled.',
      state,
    );
  }
}

async function releaseWithoutDispatch(
  ledger: NodeSlideBudgetLedgerClient,
  accounting: { budgetId: string; callId: string },
  state: NodeSlideBudgetLedgerView,
  reason: string,
  providerResult?: NodeSlideProviderResult,
): Promise<NodeSlideBudgetedProviderResult> {
  try {
    const released = await terminalWithStateRetry(
      ledger,
      'release',
      { budgetId: accounting.budgetId, callId: accounting.callId },
      state,
    );
    return providerResult
      ? {
          ...providerResult,
          accounting: { ...accounting, disposition: 'released', ledger: released },
        }
      : {
          ok: false,
          reason,
          code: 'budget_denied',
          accounting: { ...accounting, disposition: 'released', ledger: released },
        };
  } catch {
    return accountingFailure(
      accounting,
      'The undispatched provider reservation could not be released.',
      state,
    );
  }
}

function replayedFailure(
  accounting: { budgetId: string; callId: string },
  ledger: NodeSlideBudgetLedgerView,
  reason: string,
): NodeSlideBudgetedProviderResult {
  return {
    ok: false,
    reason,
    code: 'idempotent_replay',
    accounting: { ...accounting, disposition: 'replayed', ledger },
  };
}

function budgetDenied(
  accounting: { budgetId: string; callId: string },
  reason: string,
): NodeSlideBudgetedProviderResult {
  return {
    ok: false,
    reason,
    code: 'budget_denied',
    accounting: { ...accounting, disposition: 'denied' },
  };
}

function accountingFailure(
  accounting: { budgetId: string; callId: string },
  reason: string,
  ledger?: NodeSlideBudgetLedgerView,
): NodeSlideBudgetedProviderResult {
  return {
    ok: false,
    reason,
    code: 'accounting_failed',
    accounting: { ...accounting, disposition: 'accounting_error', ...(ledger ? { ledger } : {}) },
  };
}

function isStaleStateError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 'stale_budget_state' ||
    (typeof candidate.message === 'string' && candidate.message.includes('stale_budget_state'))
  );
}

function assertStableKey(field: string, value: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
    throw new Error(`Invalid NodeSlide budgeted provider ${field}.`);
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}
