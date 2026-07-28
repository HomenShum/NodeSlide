/**
 * Budgeted provider adapter — IDENTITY AND ESTIMATION ONLY. The dispatch engine
 * itself is withheld.
 *
 * Landed here, verbatim from parity: the durable ID derivation
 * (`nodeSlideProviderBudgetId`, `nodeSlideProviderCallId`), the conservative
 * input-token estimator, the structural ledger-client interface, and the whole
 * request/result/accounting type surface. None of it needs a model price.
 *
 * WITHHELD — three exports, for TWO independent reasons:
 *
 *   1. `callNodeSlideBudgetedJson` — PRICING. It is the reserve-before-dispatch
 *      engine: it calls `nodeSlideModelPricing()` to quote the reservation and
 *      `scoreNodeSlideWorstCaseCost()` to check the settled receipt against that
 *      quote. Both are withheld from `shared/nodeslideRunBudget.ts` pending an
 *      owner pricing decision; see that file's header.
 *
 *   2. `NodeSlideBudgetedProviderCall` and `NodeSlideBudgetedProviderDependencies`
 *      — MODULE DIVERGENCE, not pricing. Both are typed in terms of
 *      `NodeSlideDispatchPolicy`, which this repository's `./nodeslideProvider`
 *      does not export (TS2305). That type could be copied across in one
 *      additive block with no name collision — and doing so would be a lie.
 *      `NodeSlideDispatchPolicy` is not a payload, it is the enforcement channel:
 *      parity's `callNodeSlideFreeJson` reads `dependencies.dispatchPolicy` and
 *      clamps `maxOutputTokens` and `timeoutMs` with it, which is precisely how a
 *      budget-derived ceiling reaches the wire. This repository's
 *      `NodeSlideProviderDependencies` has no `dispatchPolicy` member at all — it
 *      honours a bare `timeoutMs`. Landing the type alone would compile, run, and
 *      silently drop every budget-derived output and timeout ceiling on the
 *      floor: the same failure class as an invented price, reached from the other
 *      direction. Making it true means teaching this repository's 862-line
 *      `callNodeSlideFreeJson` a new dispatch contract, i.e. editing a
 *      destination module to accept parity's shape. Refused on both counts.
 */
import { NODESLIDE_DEFAULT_AGENT_MODEL } from '../../shared/nodeslide';
import type { NodeSlideRunBudgetInput } from '../../shared/nodeslideRunBudget';
import { nodeslideStableId } from './nodeslideIds';
import type { NodeSlideProviderResult, callNodeSlideFreeJson } from './nodeslideProvider';

const MAX_PROVIDER_ATTEMPTS = 2;
const MAX_REPAIR_CONTEXT_UTF8_BYTES = 24_000 * 4;
const PROVIDER_MESSAGE_OVERHEAD_TOKENS_PER_ATTEMPT = 4_096;

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
