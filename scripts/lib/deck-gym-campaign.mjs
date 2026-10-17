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
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  NODE_GYM_BACKEND_RUN_RESERVATION_MICRO_USD,
  combineNodeGymLedgerReceipts,
  nodeGymRunCharge,
  shouldStopCampaign,
  writeNodeGymFileAtomic,
} from './node-gym-runner-core.mjs';

export const DECK_GYM_DEFAULT_LIMIT_FOR_UNCAPPED = 12;

/**
 * The campaign cap. An explicit value always wins. Without one the run count itself must bound the
 * spend: a campaign of at most 12 runs is capped at its own worst case (limit x per-run cap), the
 * same shape as node-gym's default cap for a bounded subset; a larger campaign must say how much it
 * may spend.
 */
export function resolveDeckGymMaxTotalCostMicroUsd({ explicit, limit }) {
  if (explicit !== undefined) {
    const parsed = Number(explicit);
    if (!Number.isSafeInteger(parsed) || parsed < 0)
      throw new Error('--max-total-cost-micro-usd must be a non-negative integer.');
    return parsed;
  }
  if (Number.isSafeInteger(limit) && limit >= 1 && limit <= DECK_GYM_DEFAULT_LIMIT_FOR_UNCAPPED)
    return limit * NODE_GYM_BACKEND_RUN_RESERVATION_MICRO_USD;
  throw new Error(
    `--max-total-cost-micro-usd is required unless --limit is at most ${DECK_GYM_DEFAULT_LIMIT_FOR_UNCAPPED}.`,
  );
}

/**
 * `spentCostMicroUsd` starts from what earlier invocations of this campaign already cost
 * (`restoreDeckGymSpend`): the cap binds the whole campaign, not one process. Every run reserves the
 * backend ledger cap that binds it; that cap is not an option, because a reservation below it lets a
 * campaign dispatch paid work it has not budgeted for.
 */
export function createDeckGymCampaignBudget({ maxTotalCostMicroUsd, spentCostMicroUsd = 0 }) {
  if (!Number.isSafeInteger(maxTotalCostMicroUsd) || maxTotalCostMicroUsd < 0)
    throw new Error('Deck Gym campaign cap must be a non-negative integer.');
  if (!Number.isSafeInteger(spentCostMicroUsd) || spentCostMicroUsd < 0)
    throw new Error('Deck Gym restored spend must be a non-negative integer.');
  return {
    maxTotalCostMicroUsd,
    perRunMaxCostMicroUsd: NODE_GYM_BACKEND_RUN_RESERVATION_MICRO_USD,
    spentCostMicroUsd,
    inFlight: 0,
    stoppedBy: null,
  };
}

export const DECK_GYM_LOCK_FILE = 'campaign.lock';

/**
 * One invocation at a time per runs directory. Spend is restored from disk once at start and then
 * tracked in memory, and each charge rewrites a run's whole history, so two invocations on the same
 * directory each see an empty balance, can dispatch the same run, and overwrite each other's
 * charges: replayed, two runs finalized 1,600,000 micro-USD against a 1,000,000 cap and only 800,000
 * was persisted. The cap cannot hold unless a second invocation never starts. `O_EXCL` creation is
 * the test-and-set; the file names its holder. Synchronous so an exit or signal handler can release.
 * A crashed holder leaves the file behind and the next start refuses, naming it: remove it once the
 * recorded pid is confirmed dead (no liveness probe on purpose: a wrong guess would admit a second
 * invocation, which is the failure this exists to stop). Release unlinks only a file that still
 * carries this holder's token: if the lock was deleted by hand and another invocation took it, the
 * first holder exiting must not delete the second holder's lock. That narrows the race rather than closing it: a pathname lock has no atomic compare-and-unlink, so a hand deletion plus a new acquire inside the read-to-unlink window (well under a millisecond) can still lose a lock. `label` names the campaign kind in
 * the refusal; node-gym takes the same lock on its campaign directory.
 */
export function acquireDeckGymCampaignLock(runsDir, label = 'Deck Gym') {
  const file = path.join(runsDir, DECK_GYM_LOCK_FILE);
  let fd;
  try {
    fd = openSync(file, 'wx');
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let holder = 'unknown holder';
    try {
      holder = readFileSync(file, 'utf8').trim() || holder;
    } catch {}
    throw new Error(
      `${label} campaign in ${runsDir} is already running (${holder}); a second invocation would restore the same balance and overspend the cap. If that process is dead, delete ${file} and start again.`,
      { cause: error },
    );
  }
  const token = randomUUID();
  writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token }));
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    closeSync(fd);
    let ownsFile = false;
    try {
      ownsFile = JSON.parse(readFileSync(file, 'utf8'))?.token === token;
    } catch {}
    if (ownsFile) unlinkSync(file);
  };
}

export const DECK_GYM_CHARGES_FILE = 'budget-charges.json';
const DECK_GYM_CHARGES_SCHEMA = 'nodeslide.deck-gym-run-charges/v1';

/**
 * Every charge one run directory has incurred, oldest first. Append-only in spirit: an attempt writes
 * its reservation before it dispatches and replaces that entry with the ledger figure when it ends,
 * so an attempt whose process died stays charged at its reservation and a re-run adds to it.
 * A file that cannot be read back throws: the history it held is unknown, any figure made up for it
 * (zero, or one reservation) can be lower than what it held, and every caller either restores spend
 * or appends to the history, so a made-up figure would admit paid runs past the cap or overwrite the
 * lost history for good. Only a missing file (`null`) is a run with no charges yet.
 */
export async function readDeckGymRunCharges(runDir) {
  const file = path.join(runDir, DECK_GYM_CHARGES_FILE);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(
      `Deck Gym charge history ${file} cannot be read (${error?.code ?? error?.message}); spend is unknown, so the campaign stops. Restore the file or remove the run directory deliberately.`,
      { cause: error },
    );
  }
  const unreadable = (why) =>
    new Error(
      `Deck Gym charge history ${file} is ${why}; spend is unknown, so the campaign stops. Restore the file or remove the run directory deliberately.`,
    );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unreadable('not valid JSON');
  }
  const charges = parsed?.charges;
  if (
    parsed?.schemaVersion !== DECK_GYM_CHARGES_SCHEMA ||
    !Array.isArray(charges) ||
    !charges.every(
      (charge) =>
        Number.isSafeInteger(charge?.chargedMicroUsd) &&
        charge.chargedMicroUsd >= 0 &&
        ['ledger', 'reservation'].includes(charge.source),
    )
  )
    throw unreadable('not a valid charge history');
  return charges.map(({ chargedMicroUsd, source }) => ({ chargedMicroUsd, source }));
}

/**
 * The whole history is rewritten on every change, so the rewrite must be atomic: a plain truncating
 * write interrupted partway leaves a file that cannot be read back, and an unreadable history stops
 * the campaign (it used to come back as ONE reservation, so 2,000,000 micro-USD of history became
 * 1,000,000 and the next run was admitted under the cap). Temp file plus rename leaves either the old
 * history or the new one, never a torn file.
 */
export async function writeDeckGymRunCharges(runDir, charges) {
  await mkdir(runDir, { recursive: true });
  await writeNodeGymFileAtomic(
    runDir,
    path.join(runDir, DECK_GYM_CHARGES_FILE),
    `${JSON.stringify({ schemaVersion: DECK_GYM_CHARGES_SCHEMA, charges }, null, 2)}
`,
    { label: 'Deck Gym charge history' },
  );
}

/** Persist the reservation of an attempt about to be dispatched. */
export async function recordDeckGymReservation(runDir, reservationMicroUsd) {
  const charges = (await readDeckGymRunCharges(runDir)) ?? [];
  await writeDeckGymRunCharges(runDir, [
    ...charges,
    { chargedMicroUsd: reservationMicroUsd, source: 'reservation' },
  ]);
}

/** Replace the attempt's reservation entry (the last one) with what the attempt was charged. */
export async function recordDeckGymCharge(runDir, charge) {
  const charges = (await readDeckGymRunCharges(runDir)) ?? [];
  charges.splice(Math.max(charges.length - 1, 0), 1, {
    chargedMicroUsd: charge.chargedMicroUsd,
    source: charge.source,
  });
  await writeDeckGymRunCharges(runDir, charges);
}

/**
 * What every earlier invocation already spent in this runs directory, whatever this invocation
 * selected: `--limit` or a narrower matrix must not make earlier spend disappear, because the cap
 * binds the whole campaign. A run directory with a charges file contributes its charges. A directory
 * without one but with anything in it is from an invocation that predates charge records, or from a
 * process that died before writing one: its spend is unknown, so it is charged one reservation,
 * written down now so that re-running the run cannot erase it. Only a missing runs directory means
 * nothing was spent; any other read failure is unknown spend and stops the campaign.
 */
export async function restoreDeckGymSpend({ runsDir }) {
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const runDir = path.join(runsDir, entry.name);
    let charges = await readDeckGymRunCharges(runDir);
    if (charges === null) {
      const present = await readdir(runDir).catch(() => []);
      if (present.length === 0) continue;
      charges = [
        { chargedMicroUsd: NODE_GYM_BACKEND_RUN_RESERVATION_MICRO_USD, source: 'reservation' },
      ];
      await writeDeckGymRunCharges(runDir, charges);
    }
    for (const charge of charges) total += charge.chargedMicroUsd;
    if (!Number.isSafeInteger(total))
      throw new Error('Deck Gym campaign cumulative cost exceeds the safe integer range.');
  }
  return total;
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
  recordReservation = async () => undefined,
  recordCharge = async () => undefined,
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
    // Written before dispatch: if this process dies mid-run, the next invocation finds the reservation.
    // A write that fails is not swallowed: a run that cannot be recorded must not be started.
    await recordReservation(run, budget.perRunMaxCostMicroUsd);
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
    await recordCharge(run, charge);
    // Backend run ids are working data for the ledger lookup, not part of the published summary.
    const { backendRunIds, ...publicReceipt } = receipt ?? {};
    receipts.push({
      ...publicReceipt,
      backendRunCount: Array.isArray(backendRunIds) ? backendRunIds.length : 0,
      budget: charge,
    });
  }
}
