/**
 * A test double for the NodeSlide run-budget ledger, for suites that drive a
 * Convex action through a hand-rolled `ctx` rather than a database.
 *
 * WHY THIS EXISTS. The edit planner now reserves against a hard cap before it
 * dispatches, so `proposeEdit` calls `nodeslideBudgets.create` and
 * `nodeslideBudgets.reserve` on its way to the provider. A `ctx.runMutation`
 * stub that answers every unrecognised call with `true` therefore hands the
 * budgeted adapter a shapeless reservation, the adapter fails CLOSED, and the
 * run degrades to the deterministic fallback — which looks, from the outside,
 * exactly like a planner regression. It is not one; it is the enforcement
 * working on a ctx that does not model the ledger.
 *
 * These suites are not about budget accounting, so this double stays deliberately
 * dumb: it always authorizes, and it returns the smallest shape the adapter
 * needs. Real reservation arithmetic — quoting, refusing, settling, capturing an
 * ambiguous call — is proven against the ACTUAL mutations in
 * `convex/nodeslideBudgetEnforcement.test.ts`. Do not grow assertions here that
 * belong there; a permissive double that starts being treated as a source of
 * truth is how a suite ends up proving nothing.
 */

const STUB_STATE_DIGEST = `sha256:${'0'.repeat(64)}` as const;

/** Generous but finite, so a stubbed dispatch still receives a real ceiling. */
const STUB_QUOTE_MICRO_USD = 1_000_000;
const STUB_OUTPUT_TOKEN_CEILING = 8_192;
const STUB_TIMEOUT_MS = 30_000;

function stubBudget(budgetId: string, revision: number) {
  return {
    id: budgetId,
    status: 'open' as const,
    revision,
    stateDigest: STUB_STATE_DIGEST,
    actualMicroUsd: 0,
    reservedMicroUsd: 0,
    unreconciledMicroUsd: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Answers a budget-ledger mutation from its argument shape, or returns
 * `undefined` when the call is not one — so a caller can fall through to its
 * own stub logic. Shape discrimination is used because `internal.*` references
 * carry no identity a plain `vi.fn` stub can read.
 */
export function nodeSlideBudgetLedgerStubResponse(args: unknown): unknown | undefined {
  if (!isRecord(args)) return undefined;
  const budgetId = args['budgetId'];
  if (typeof budgetId !== 'string') return undefined;

  // create({ budgetId, budget })
  if ('budget' in args && !('callId' in args)) {
    return { budget: stubBudget(budgetId, 0) };
  }

  const callId = args['callId'];
  if (typeof callId !== 'string') {
    // replay({ budgetId }) — no prior call to recover.
    return { budget: stubBudget(budgetId, 0) };
  }

  // reserve({ budgetId, callId, model, estimatedInputTokens, ... })
  if ('model' in args || 'estimatedInputTokens' in args) {
    return {
      budget: stubBudget(budgetId, 1),
      call: {
        callId,
        status: 'reserved' as const,
        quoteMicroUsd: STUB_QUOTE_MICRO_USD,
        providerSafeOutputTokenCeiling: STUB_OUTPUT_TOKEN_CEILING,
        providerTimeoutMs: STUB_TIMEOUT_MS,
      },
    };
  }

  // settle / captureTimeout / release — the call reaches a terminal state and
  // the double does not model which one, because no suite using it asserts on it.
  return {
    budget: stubBudget(budgetId, 2),
    call: {
      callId,
      status: 'settled' as const,
      quoteMicroUsd: STUB_QUOTE_MICRO_USD,
      providerSafeOutputTokenCeiling: STUB_OUTPUT_TOKEN_CEILING,
      providerTimeoutMs: STUB_TIMEOUT_MS,
    },
  };
}
