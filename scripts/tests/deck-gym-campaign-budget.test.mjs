/**
 * Deck Gym campaign budget (SPEC Part A section A.2.8; Codex N1).
 *
 * Situation: someone points `npm run deck-gym:run` at production with two concurrent browsers and
 * leaves. Before this change nothing counted dollars. These tests drive the REAL worker loop
 * (`deckGymWorker`, the same function `scripts/run-deck-gym.mjs` runs) with fake runs standing in for
 * the browser page and a fake backend budget ledger, and assert the queue stops before the cap even
 * when two runs are in flight, each reserved at its worst case.
 */
import { describe, expect, it } from 'vitest';
import {
  createDeckGymCampaignBudget,
  deckGymBudgetSummary,
  deckGymWorker,
  resolveDeckGymMaxTotalCostMicroUsd,
} from '../lib/deck-gym-campaign.mjs';
import { NODE_GYM_LEDGER_RECEIPT_VERSION } from '../lib/node-gym-runner-core.mjs';

const ledger = (actual) => ({
  version: NODE_GYM_LEDGER_RECEIPT_VERSION,
  spend: { actualMicroUsd: actual, reservedMicroUsd: 0, unreconciledMicroUsd: 0 },
});

/** A gate the test opens by hand, so runs stay "in flight" for as long as the scenario needs. */
function gate() {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('deck-gym campaign cap', () => {
  it('stops the queue before the cap with two in-flight runs reserved at their worst case', async () => {
    const PER_RUN = 1_000_000;
    const budget = createDeckGymCampaignBudget({
      maxTotalCostMicroUsd: 2_500_000,
      perRunMaxCostMicroUsd: PER_RUN,
    });
    const queue = Array.from({ length: 6 }, (_, index) => ({ runId: `run-${index + 1}` }));
    const receipts = [];
    const gates = new Map(queue.map((run) => [run.runId, gate()]));
    const exposureAtDispatch = [];
    const started = [];
    const outcomes = new Map([
      ['run-1', { status: 'completed', backendRunIds: ['job-1'] }],
      ['run-2', { status: 'failed' }], // crash: names no backend run
      ['run-3', { status: 'completed', backendRunIds: ['job-3'] }],
    ]);
    const ledgerByJob = new Map([
      ['job-1', ledger(300_000)],
      ['job-3', ledger(200_000)],
    ]);
    const common = {
      queue,
      budget,
      receipts,
      isResumable: async () => false,
      executeRun: async (run) => {
        // What the campaign has already committed, plus every run now in flight at its worst case.
        exposureAtDispatch.push(budget.spentCostMicroUsd + budget.inFlight * PER_RUN);
        started.push(run.runId);
        await gates.get(run.runId).promise;
        return { runId: run.runId, ...outcomes.get(run.runId) };
      },
      readLedger: async (ids) => new Map(ids.map((id) => [id, ledgerByJob.get(id) ?? null])),
    };

    const workers = [deckGymWorker(common), deckGymWorker(common)];
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Two runs are in flight, each reserved at 1,000,000.
    expect(started).toEqual(['run-1', 'run-2']);
    expect(budget.inFlight).toBe(2);
    expect(deckGymBudgetSummary(budget).reservedInFlightMicroUsd).toBe(2_000_000);

    // run-1 finishes with a readable ledger receipt: 300,000 charged, headroom for one more.
    gates.get('run-1').open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(budget.spentCostMicroUsd).toBe(300_000);
    expect(started).toEqual(['run-1', 'run-2', 'run-3']);

    // run-2 crashes with no readable receipt: its full 1,000,000 reservation is charged. Spent
    // 1,300,000 + (1 in flight + 1 new) x 1,000,000 = 3,300,000 > 2,500,000, so the queue stops.
    gates.get('run-2').open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(budget.spentCostMicroUsd).toBe(1_300_000);
    expect(budget.stoppedBy).toBe('campaign_projected_cost_limit_reached');

    gates.get('run-3').open();
    await Promise.all(workers);

    expect(started).toEqual(['run-1', 'run-2', 'run-3']);
    expect(queue.map((run) => run.runId)).toEqual(['run-4', 'run-5', 'run-6']);
    expect(budget.spentCostMicroUsd).toBe(1_500_000);
    expect(budget.inFlight).toBe(0);
    // The invariant the cap exists for: committed spend plus in-flight worst cases never crossed it.
    expect(Math.max(...exposureAtDispatch)).toBeLessThanOrEqual(2_500_000);
    expect(receipts.map((entry) => [entry.runId, entry.budget])).toEqual([
      ['run-1', { chargedMicroUsd: 300_000, source: 'ledger' }],
      ['run-2', { chargedMicroUsd: 1_000_000, source: 'reservation' }],
      ['run-3', { chargedMicroUsd: 200_000, source: 'ledger' }],
    ]);
    expect(deckGymBudgetSummary(budget)).toEqual({
      maxTotalCostMicroUsd: 2_500_000,
      spentCostMicroUsd: 1_500_000,
      reservedInFlightMicroUsd: 0,
      stoppedBy: 'campaign_projected_cost_limit_reached',
    });
  });

  it('keeps the full reservation when the ledger lookup itself throws', async () => {
    const budget = createDeckGymCampaignBudget({
      maxTotalCostMicroUsd: 5_000_000,
      perRunMaxCostMicroUsd: 1_000_000,
    });
    const receipts = [];
    await deckGymWorker({
      queue: [{ runId: 'run-1' }],
      budget,
      receipts,
      isResumable: async () => false,
      executeRun: async () => ({ runId: 'run-1', status: 'completed', backendRunIds: ['job-1'] }),
      readLedger: async () => {
        throw new Error('convex unreachable');
      },
    });
    expect(budget.spentCostMicroUsd).toBe(1_000_000);
    expect(receipts[0].budget.source).toBe('reservation');
  });

  it('charges a run whose execution throws outright its full reservation', async () => {
    const budget = createDeckGymCampaignBudget({
      maxTotalCostMicroUsd: 5_000_000,
      perRunMaxCostMicroUsd: 1_000_000,
    });
    const receipts = [];
    await deckGymWorker({
      queue: [{ runId: 'run-1' }],
      budget,
      receipts,
      isResumable: async () => false,
      executeRun: async () => {
        throw new Error('browser crashed');
      },
      readLedger: async () => new Map(),
    });
    expect(budget.spentCostMicroUsd).toBe(1_000_000);
    expect(receipts[0]).toMatchObject({ runId: 'run-1', status: 'failed' });
  });

  it('never charges a resumed (skipped) run and never reserves for it', async () => {
    const budget = createDeckGymCampaignBudget({
      maxTotalCostMicroUsd: 1_000_000,
      perRunMaxCostMicroUsd: 1_000_000,
    });
    const receipts = [];
    const executed = [];
    await deckGymWorker({
      queue: [{ runId: 'done-1' }, { runId: 'done-2' }, { runId: 'fresh' }],
      budget,
      receipts,
      isResumable: async (run) => run.runId.startsWith('done'),
      executeRun: async (run) => {
        executed.push(run.runId);
        return { runId: run.runId, status: 'completed', backendRunIds: ['job'] };
      },
      readLedger: async () => new Map([['job', ledger(10)]]),
    });
    expect(executed).toEqual(['fresh']);
    expect(receipts.filter((entry) => entry.status === 'skipped')).toHaveLength(2);
    expect(budget.spentCostMicroUsd).toBe(10);
    expect(budget.stoppedBy).toBeNull();
  });

  it('refuses to start any run when even one worst case exceeds the cap', async () => {
    const budget = createDeckGymCampaignBudget({
      maxTotalCostMicroUsd: 999_999,
      perRunMaxCostMicroUsd: 1_000_000,
    });
    const queue = [{ runId: 'run-1' }];
    await deckGymWorker({
      queue,
      budget,
      receipts: [],
      isResumable: async () => false,
      executeRun: async () => {
        throw new Error('must not dispatch');
      },
      readLedger: async () => new Map(),
    });
    expect(budget.stoppedBy).toBe('campaign_projected_cost_limit_reached');
    expect(queue).toHaveLength(1);
  });
});

describe('deck-gym cap resolution mirrors node-gym', () => {
  it('requires an explicit cap unless the run count itself bounds the spend', () => {
    expect(
      resolveDeckGymMaxTotalCostMicroUsd({
        explicit: undefined,
        limit: 12,
        perRunMaxCostMicroUsd: 1_000_000,
      }),
    ).toBe(12_000_000);
    expect(() =>
      resolveDeckGymMaxTotalCostMicroUsd({
        explicit: undefined,
        limit: 13,
        perRunMaxCostMicroUsd: 1_000_000,
      }),
    ).toThrow(/--max-total-cost-micro-usd is required/u);
    expect(() =>
      resolveDeckGymMaxTotalCostMicroUsd({
        explicit: undefined,
        limit: undefined,
        perRunMaxCostMicroUsd: 1_000_000,
      }),
    ).toThrow(/required/u);
    expect(
      resolveDeckGymMaxTotalCostMicroUsd({
        explicit: '2500000',
        limit: 72,
        perRunMaxCostMicroUsd: 1_000_000,
      }),
    ).toBe(2_500_000);
    expect(() =>
      resolveDeckGymMaxTotalCostMicroUsd({
        explicit: '-1',
        limit: 1,
        perRunMaxCostMicroUsd: 1_000_000,
      }),
    ).toThrow(/non-negative integer/u);
  });
});
