/**
 * Campaign cost control for `scripts/run-deck-gym.mjs`.
 *
 * Situation: a person starts a keyed Deck Gym campaign of dozens of production runs and walks away.
 * Nothing in the runner used to count dollars, so the only brake was how long it took. This module
 * is that brake. Before a worker dequeues a run it asks `shouldStopCampaign` whether the money
 * already spent, plus a worst-case reservation for this run and for every run still in flight,
 * would cross the campaign cap. After a run it charges the backend budget ledger's figure (never the
 * Trace inspector text, which is attribution), or the full reservation when that figure cannot be
 * read. It is a separate module so the production worker and its test are the same function.
 */
import {
  combineNodeGymLedgerReceipts,
  nodeGymRunCharge,
  shouldStopCampaign,
} from './node-gym-runner-core.mjs';

export const DECK_GYM_DEFAULT_LIMIT_FOR_UNCAPPED = 12;

/**
 * The campaign cap. An explicit value always wins. Without one the run count itself must bound the
 * spend: a campaign of at most 12 runs is capped at its own worst case (limit x per-run cap), the
 * same shape as node-gym's default cap for a bounded subset; a larger campaign must say how much it
 * may spend.
 */
export function resolveDeckGymMaxTotalCostMicroUsd({ explicit, limit, perRunMaxCostMicroUsd }) {
  if (explicit !== undefined) {
    const parsed = Number(explicit);
    if (!Number.isSafeInteger(parsed) || parsed < 0)
      throw new Error('--max-total-cost-micro-usd must be a non-negative integer.');
    return parsed;
  }
  if (Number.isSafeInteger(limit) && limit >= 1 && limit <= DECK_GYM_DEFAULT_LIMIT_FOR_UNCAPPED)
    return limit * perRunMaxCostMicroUsd;
  throw new Error(
    `--max-total-cost-micro-usd is required unless --limit is at most ${DECK_GYM_DEFAULT_LIMIT_FOR_UNCAPPED}.`,
  );
}

export function createDeckGymCampaignBudget({ maxTotalCostMicroUsd, perRunMaxCostMicroUsd }) {
  if (!Number.isSafeInteger(maxTotalCostMicroUsd) || maxTotalCostMicroUsd < 0)
    throw new Error('Deck Gym campaign cap must be a non-negative integer.');
  if (!Number.isSafeInteger(perRunMaxCostMicroUsd) || perRunMaxCostMicroUsd < 0)
    throw new Error('Deck Gym per-run cap must be a non-negative integer.');
  return {
    maxTotalCostMicroUsd,
    perRunMaxCostMicroUsd,
    spentCostMicroUsd: 0,
    inFlight: 0,
    stoppedBy: null,
  };
}

export function deckGymBudgetSummary(budget) {
  return {
    maxTotalCostMicroUsd: budget.maxTotalCostMicroUsd,
    spentCostMicroUsd: budget.spentCostMicroUsd,
    reservedInFlightMicroUsd: budget.inFlight * budget.perRunMaxCostMicroUsd,
    stoppedBy: budget.stoppedBy,
  };
}

/**
 * One worker. `executeRun(run)` drives the browser and resolves to a receipt that may carry
 * `backendRunIds`; `readLedger(ids)` resolves to a Map of run id -> backend ledger receipt (null when
 * unreadable). Both are injected so a test drives this exact loop with a fake page and ledger.
 */
export async function deckGymWorker({
  queue,
  budget,
  receipts,
  isResumable,
  executeRun,
  readLedger,
  onSkip = () => undefined,
  onStop = () => undefined,
}) {
  while (queue.length && budget.stoppedBy === null) {
    const run = queue.shift();
    if (!run) return;
    if (await isResumable(run)) {
      receipts.push({ runId: run.runId, status: 'skipped', reason: 'resume_artifact_exists' });
      onSkip(run);
      continue;
    }
    // Check and reserve with no await in between: two workers must not both see the same headroom.
    const decision = shouldStopCampaign({
      spentCostMicroUsd: budget.spentCostMicroUsd,
      maxTotalCostMicroUsd: budget.maxTotalCostMicroUsd,
      failures: 0,
      maxFailures: Number.POSITIVE_INFINITY,
      nextRunMaxCostMicroUsd: (budget.inFlight + 1) * budget.perRunMaxCostMicroUsd,
    });
    if (decision.stop) {
      queue.unshift(run);
      budget.stoppedBy = decision.issueCode;
      onStop(decision.issueCode, run);
      return;
    }
    budget.inFlight += 1;
    let receipt;
    try {
      receipt = await executeRun(run);
    } catch (error) {
      receipt = {
        runId: run.runId,
        status: 'failed',
        failure: String(error instanceof Error ? error.message : error).slice(0, 300),
      };
    }
    let ledgerReceipt = null;
    try {
      const ids = Array.isArray(receipt?.backendRunIds) ? receipt.backendRunIds : [];
      ledgerReceipt = combineNodeGymLedgerReceipts(ids, await readLedger(ids));
    } catch {
      ledgerReceipt = null;
    }
    const charge = nodeGymRunCharge({
      reservationMicroUsd: budget.perRunMaxCostMicroUsd,
      ledgerReceipt,
    });
    budget.spentCostMicroUsd += charge.chargedMicroUsd;
    budget.inFlight -= 1;
    // Backend run ids are working data for the ledger lookup, not part of the published summary.
    const { backendRunIds, ...publicReceipt } = receipt ?? {};
    receipts.push({
      ...publicReceipt,
      backendRunCount: Array.isArray(backendRunIds) ? backendRunIds.length : 0,
      budget: charge,
    });
  }
}
