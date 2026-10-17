/**
 * Deck Gym campaign budget (SPEC Part A section A.2.8; Codex N1).
 *
 * Situation: someone points `npm run deck-gym:run` at production with two concurrent browsers and
 * leaves. Before this change nothing counted dollars. These tests drive the REAL worker loop
 * (`deckGymWorker`, the same function `scripts/run-deck-gym.mjs` runs) with fake runs standing in for
 * the browser page and a fake backend budget ledger, and assert the queue stops before the cap even
 * when two runs are in flight, each reserved at its worst case.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DECK_GYM_CHARGES_FILE,
  DECK_GYM_LOCK_FILE,
  acquireDeckGymCampaignLock,
  createDeckGymCampaignBudget,
  deckGymBudgetSummary,
  deckGymWorker,
  recordDeckGymCharge,
  recordDeckGymReservation,
  resolveDeckGymMaxTotalCostMicroUsd,
  restoreDeckGymSpend,
} from '../lib/deck-gym-campaign.mjs';
import { NODE_GYM_LEDGER_RECEIPT_VERSION } from '../lib/node-gym-runner-core.mjs';

// Lets one test kill the publish step of an atomic write, the way a killed process would.
const publish = vi.hoisted(() => ({ failNext: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    rename: async (...args) => {
      if (publish.failNext) {
        publish.failNext = false;
        throw new Error('simulated kill while publishing the charge history');
      }
      return actual.rename(...args);
    },
  };
});

const ledger = (actual) => ({
  version: NODE_GYM_LEDGER_RECEIPT_VERSION,
  status: 'finalized',
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
      }),
    ).toBe(12_000_000);
    expect(() =>
      resolveDeckGymMaxTotalCostMicroUsd({
        explicit: undefined,
        limit: 13,
      }),
    ).toThrow(/--max-total-cost-micro-usd is required/u);
    expect(() =>
      resolveDeckGymMaxTotalCostMicroUsd({
        explicit: undefined,
        limit: undefined,
      }),
    ).toThrow(/required/u);
    expect(
      resolveDeckGymMaxTotalCostMicroUsd({
        explicit: '2500000',
        limit: 72,
      }),
    ).toBe(2_500_000);
    expect(() =>
      resolveDeckGymMaxTotalCostMicroUsd({
        explicit: '-1',
        limit: 1,
      }),
    ).toThrow(/non-negative integer/u);
  });
});

/**
 * Situation (round 1, Codex): a person runs `deck-gym:run` with a 2 USD cap, it spends 1 USD, they
 * stop it and run it again to finish. Each process used to start its meter at 0, so the second one
 * spent another 2 USD under the same cap. These tests run the real restore and the real worker over
 * real run directories.
 */
describe('deck-gym campaign cap binds the whole campaign across invocations', () => {
  let runsDir;
  beforeEach(async () => {
    runsDir = await mkdtemp(path.join(os.tmpdir(), 'deck-gym-budget-'));
  });
  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  const charges = async (runId) =>
    JSON.parse(await readFile(path.join(runsDir, runId, DECK_GYM_CHARGES_FILE), 'utf8')).charges;

  /** One invocation of the runner: restore, then drain the queue with the real worker. */
  async function invocation({ runs, maxTotalCostMicroUsd, ledgerMicroUsd, resumable = new Set() }) {
    const budget = createDeckGymCampaignBudget({
      maxTotalCostMicroUsd,
      spentCostMicroUsd: await restoreDeckGymSpend({ runsDir }),
    });
    const queue = [...runs];
    const executed = [];
    await deckGymWorker({
      queue,
      budget,
      receipts: [],
      isResumable: async (run) => resumable.has(run.runId),
      executeRun: async (run) => {
        executed.push(run.runId);
        return { runId: run.runId, status: 'completed', backendRunIds: [`job-${run.runId}`] };
      },
      readLedger: async (ids) => new Map(ids.map((id) => [id, ledger(ledgerMicroUsd)])),
      recordReservation: (run, reservation) =>
        recordDeckGymReservation(path.join(runsDir, run.runId), reservation),
      recordCharge: (run, charge) => recordDeckGymCharge(path.join(runsDir, run.runId), charge),
    });
    return { budget, executed };
  }

  const runIds = (...ids) => ids.map((runId) => ({ runId }));

  it('does not let a second invocation spend a fresh cap: 1,000,000 before plus 2,000,000 after against 2,000,000', async () => {
    const first = await invocation({
      runs: runIds('run-1'),
      maxTotalCostMicroUsd: 2_000_000,
      ledgerMicroUsd: 1_000_000,
    });
    expect(first.budget.spentCostMicroUsd).toBe(1_000_000);

    const second = await invocation({
      runs: runIds('run-1', 'run-2', 'run-3'),
      maxTotalCostMicroUsd: 2_000_000,
      ledgerMicroUsd: 1_000_000,
      resumable: new Set(['run-1']),
    });
    // run-1 was skipped, yet its 1,000,000 counts; run-2 spends the other 1,000,000; run-3 is refused.
    expect(second.executed).toEqual(['run-2']);
    expect(second.budget.spentCostMicroUsd).toBe(2_000_000);
    expect(second.budget.stoppedBy).toBe('campaign_projected_cost_limit_reached');
  });

  it('keeps the spend of a failed run that is re-run on resume', async () => {
    await invocation({
      runs: runIds('run-1'),
      maxTotalCostMicroUsd: 5_000_000,
      ledgerMicroUsd: 300_000,
    });
    await invocation({
      runs: runIds('run-1'),
      maxTotalCostMicroUsd: 5_000_000,
      ledgerMicroUsd: 400_000,
    });
    expect((await charges('run-1')).map((entry) => entry.chargedMicroUsd)).toEqual([
      300_000, 400_000,
    ]);
    expect(await restoreDeckGymSpend({ runsDir })).toBe(700_000);
  });

  it('charges an attempt whose process died before it was charged its full reservation', async () => {
    await recordDeckGymReservation(path.join(runsDir, 'run-1'), 1_000_000);
    expect(await restoreDeckGymSpend({ runsDir })).toBe(1_000_000);
    // The re-run adds its own charge on top of the dead attempt's reservation.
    await invocation({
      runs: runIds('run-1'),
      maxTotalCostMicroUsd: 5_000_000,
      ledgerMicroUsd: 200_000,
    });
    expect(await restoreDeckGymSpend({ runsDir })).toBe(1_200_000);
  });

  it('charges a run directory from before charge records one reservation, and writes it down', async () => {
    const legacyDir = path.join(runsDir, 'run-1');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(path.join(legacyDir, 'run.json'), '{}');
    expect(await restoreDeckGymSpend({ runsDir })).toBe(1_000_000);
    expect(await charges('run-1')).toEqual([{ chargedMicroUsd: 1_000_000, source: 'reservation' }]);
    // Idempotent: a second restore does not charge it again, and a re-run cannot erase it.
    expect(await restoreDeckGymSpend({ runsDir })).toBe(1_000_000);
  });

  // Before: an unreadable charges file was restored as ONE reservation, so a two-attempt history
  // (2,000,000 micro-USD) came back as 1,000,000 and, against a 2,000,000 cap, one more paid run was
  // dispatched (true exposure 3,000,000). The history is unknown, so the campaign refuses instead.
  describe.each([
    ['is not valid JSON', (dir) => writeFile(path.join(dir, DECK_GYM_CHARGES_FILE), '{not json')],
    [
      'fails the schema',
      (dir) =>
        writeFile(
          path.join(dir, DECK_GYM_CHARGES_FILE),
          JSON.stringify({ schemaVersion: 'other/v9', charges: [] }),
        ),
    ],
    [
      'has a negative charge',
      (dir) =>
        writeFile(
          path.join(dir, DECK_GYM_CHARGES_FILE),
          JSON.stringify({
            schemaVersion: 'nodeslide.deck-gym-run-charges/v1',
            charges: [{ chargedMicroUsd: -1, source: 'ledger' }],
          }),
        ),
    ],
    // Stands in for EACCES / EBUSY: any read error other than ENOENT (here EISDIR).
    ['cannot be read (not ENOENT)', (dir) => mkdir(path.join(dir, DECK_GYM_CHARGES_FILE))],
  ])('a charges file that %s', (_name, corrupt) => {
    it('stops the campaign instead of counting one reservation, and keeps the file', async () => {
      const dir = path.join(runsDir, 'run-1');
      await recordDeckGymReservation(dir, 1_000_000);
      await recordDeckGymReservation(dir, 1_000_000);
      expect(await restoreDeckGymSpend({ runsDir })).toBe(2_000_000);
      await rm(path.join(dir, DECK_GYM_CHARGES_FILE));
      await corrupt(dir);

      await expect(restoreDeckGymSpend({ runsDir })).rejects.toThrow(/spend is unknown/u);
      // The lost history is not overwritten by a new reservation or charge either.
      await expect(recordDeckGymReservation(dir, 1_000_000)).rejects.toThrow(/spend is unknown/u);
      await expect(
        recordDeckGymCharge(dir, { chargedMicroUsd: 1, source: 'ledger' }),
      ).rejects.toThrow(/spend is unknown/u);
    });
  });

  it('counts the spend of runs this invocation did not select (a narrower --limit re-run)', async () => {
    // First invocation: two runs, 1,000,000 each, against a 2,000,000 cap.
    await invocation({
      runs: runIds('run-1', 'run-2'),
      maxTotalCostMicroUsd: 2_000_000,
      ledgerMicroUsd: 1_000_000,
    });
    // Second invocation selects only run-3 (a smaller --limit or a narrower matrix). The earlier
    // 2,000,000 still counts, so run-3 is refused instead of being admitted under a fresh cap.
    const narrower = await invocation({
      runs: runIds('run-3'),
      maxTotalCostMicroUsd: 2_000_000,
      ledgerMicroUsd: 1_000_000,
    });
    expect(narrower.budget.spentCostMicroUsd).toBe(2_000_000);
    expect(narrower.executed).toEqual([]);
    expect(narrower.budget.stoppedBy).toBe('campaign_projected_cost_limit_reached');
  });

  it('keeps the previous history intact when the rewrite is killed before it is published', async () => {
    const dir = path.join(runsDir, 'run-1');
    await recordDeckGymReservation(dir, 1_000_000);
    await recordDeckGymReservation(dir, 1_000_000);
    expect(await restoreDeckGymSpend({ runsDir })).toBe(2_000_000);

    publish.failNext = true;
    await expect(recordDeckGymReservation(dir, 1_000_000)).rejects.toThrow(/simulated kill/u);

    // Before: a truncating write that died here left an unreadable file, restored as ONE
    // reservation (1,000,000 for a 2,000,000 history). Now the old history survives whole and no
    // temporary file is left behind.
    expect(await restoreDeckGymSpend({ runsDir })).toBe(2_000_000);
    expect(await charges('run-1')).toHaveLength(2);
    expect(await readdir(dir)).toEqual([DECK_GYM_CHARGES_FILE]);
  });

  it('charges nothing for a run that has never been started', async () => {
    expect(await restoreDeckGymSpend({ runsDir })).toBe(0);
  });
});

/**
 * Scenario: someone starts `deck-gym:run` twice on the same runs directory (a second terminal, a
 * retry while the first still runs). Each would restore the same balance, create its own in-memory
 * budget and rewrite the same charge files; replayed, two dispatched runs finalized 1,600,000
 * micro-USD against a 1,000,000 cap while 800,000 was persisted and both stopped with no cap hit. The
 * second invocation must be refused before it restores or spends anything.
 */
describe('deck-gym campaign lock', () => {
  let runsDir;
  beforeEach(async () => {
    runsDir = await mkdtemp(path.join(os.tmpdir(), 'deck-gym-lock-'));
  });
  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it('refuses the second of two racing invocations and admits one again after the first exits', async () => {
    const start = async () => {
      const release = acquireDeckGymCampaignLock(runsDir);
      await restoreDeckGymSpend({ runsDir });
      return release;
    };
    const outcomes = await Promise.allSettled([start(), start()]);
    const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason.message).toMatch(/already running .*"pid":\d+/u);
    // The lock file is not a run directory: it adds no spend.
    expect(await restoreDeckGymSpend({ runsDir })).toBe(0);

    winners[0].value();
    winners[0].value(); // releasing twice is harmless
    expect(await readdir(runsDir)).not.toContain(DECK_GYM_LOCK_FILE);
    acquireDeckGymCampaignLock(runsDir)();
  });

  it('does not delete a lock another invocation took after the first one lost its file', async () => {
    const releaseA = acquireDeckGymCampaignLock(runsDir);
    await rm(path.join(runsDir, DECK_GYM_LOCK_FILE)); // an operator deleted it while A is alive
    const releaseB = acquireDeckGymCampaignLock(runsDir);
    releaseA();
    expect(await readdir(runsDir)).toContain(DECK_GYM_LOCK_FILE);
    expect(() => acquireDeckGymCampaignLock(runsDir)).toThrow(/already running/u);
    releaseB();
    expect(await readdir(runsDir)).not.toContain(DECK_GYM_LOCK_FILE);
  });
});
