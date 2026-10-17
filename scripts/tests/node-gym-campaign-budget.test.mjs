/**
 * Node-gym campaign accounting (SPEC Part A section A.2.8, Codex v4-new-1).
 *
 * Situation: someone starts a keyed node-gym campaign with a 100,000 micro-USD cap and walks away.
 * The old runner checked the cap against the gym plan's own projection (200,000) but charged the
 * executor's self-reported figure afterwards: 0 when the executor crashed or timed out, 0 in its
 * failure result, and a number scraped from the Trace inspector text otherwise. Codex replayed it:
 * cap 100,000, 180,000 really charged by the backend before a crash, meter 0, second run admitted.
 *
 * These tests run the REAL charge rule (`chargeNodeGymAttempt`, `nodeGymRunCharge`) and the REAL
 * stop rule (`shouldStopCampaign`) in campaign order against a fake backend ledger.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NODESLIDE_RUN_BUDGET_LEDGER_RECEIPT_VERSION,
  normalizeNodeSlideRunBudget,
} from '../../shared/nodeslideRunBudget.ts';
import { acquireDeckGymCampaignLock } from '../lib/deck-gym-campaign.mjs';
import {
  NODE_GYM_BACKEND_RUN_RESERVATION_MICRO_USD,
  NODE_GYM_LEDGER_RECEIPT_VERSION,
  chargeNodeGymAttempt,
  createNodeGymChildGuard,
  loadNodeGymOrphanCharges,
  nodeGymRunReservationMicroUsd,
  setAsideNodeGymOrphanAttempts,
  shouldStopCampaign,
  summarizeNodeGymAttemptHistory,
} from '../lib/node-gym-runner-core.mjs';

const paidPlan = (runId) => ({
  runId,
  comparisonKey: 'c',
  harnessPairingKey: 'p',
  pairingKey: 'p',
  repetition: 1,
  model: { id: 'moonshotai/kimi-k3', route: 'moonshotai/kimi-k3', provider: 'openrouter' },
  // The gym plan's own cap: what the old runner reserved, and which the backend never sees.
  budget: { maxCostMicroUsd: 200_000 },
});

function ledgerReceipt(actual, { reserved = 0, unreconciled = 0 } = {}) {
  return {
    version: NODE_GYM_LEDGER_RECEIPT_VERSION,
    budgetId: 'nsbudget_x',
    status: 'finalized',
    spend: {
      actualMicroUsd: actual,
      reservedMicroUsd: reserved,
      unreconciledMicroUsd: unreconciled,
    },
  };
}

/** The campaign loop of `scripts/run-node-gym.mjs`, with a fake executor and a fake backend ledger. */
async function runCampaign({ plans, maxTotalCostMicroUsd, execute, ledger }) {
  let spentCostMicroUsd = 0;
  let reservedUnknownMicroUsd = 0;
  let stoppedBy = null;
  const dispatched = [];
  for (const plan of plans) {
    const reservationMicroUsd = nodeGymRunReservationMicroUsd(plan);
    const circuit = shouldStopCampaign({
      spentCostMicroUsd,
      maxTotalCostMicroUsd,
      failures: 0,
      maxFailures: 2,
      nextRunMaxCostMicroUsd: reservationMicroUsd,
    });
    if (circuit.stop) {
      stoppedBy = circuit.issueCode;
      break;
    }
    dispatched.push(plan.runId);
    const result = await execute(plan).catch(() => ({
      status: 'failed',
      issueCodes: ['executor_process_failed'],
    }));
    const charge = await chargeNodeGymAttempt({
      reservationMicroUsd,
      result,
      readLedger: async (ids) => new Map(ids.map((id) => [id, ledger.get(id) ?? null])),
    });
    spentCostMicroUsd += charge.chargedMicroUsd;
    if (charge.source === 'reservation') reservedUnknownMicroUsd += charge.chargedMicroUsd;
  }
  return { spentCostMicroUsd, reservedUnknownMicroUsd, stoppedBy, dispatched };
}

describe('the mirrored backend per-run cap cannot drift from the backend', () => {
  it('reserves exactly what the ledger binds to a default run', () => {
    expect(NODE_GYM_BACKEND_RUN_RESERVATION_MICRO_USD).toBe(
      normalizeNodeSlideRunBudget({}).maxCostMicroUsd,
    );
    expect(NODE_GYM_LEDGER_RECEIPT_VERSION).toBe(NODESLIDE_RUN_BUDGET_LEDGER_RECEIPT_VERSION);
  });

  it('keeps local, :free and openrouter/free routes at a zero reservation, and charges paid routes the backend cap', () => {
    const free = (route, provider = 'openrouter') => ({ model: { route, provider } });
    expect(nodeGymRunReservationMicroUsd(free('google/gemma:free'))).toBe(0);
    expect(nodeGymRunReservationMicroUsd(free('openrouter/free'))).toBe(0);
    expect(nodeGymRunReservationMicroUsd(free('deterministic', 'local'))).toBe(0);
    expect(nodeGymRunReservationMicroUsd(paidPlan('r'))).toBe(1_000_000);
    // No override exists: a reservation below the enforced cap cannot be requested.
    expect(nodeGymRunReservationMicroUsd(paidPlan('r'), 0)).toBe(1_000_000);
  });
});

describe('a run is charged what the backend ledger recorded, or its full reservation', () => {
  it('(a) a crashed run with no readable receipt leaves its full reservation in the meter', async () => {
    const outcome = await runCampaign({
      plans: [paidPlan('run-crash')],
      maxTotalCostMicroUsd: 1_000_000,
      execute: async () => {
        throw new Error('executor process killed at its timeout');
      },
      ledger: new Map(),
    });
    expect(outcome.spentCostMicroUsd).toBe(1_000_000);
    expect(outcome.reservedUnknownMicroUsd).toBe(1_000_000);
  });

  it('(b) the same failure with a readable ledger receipt is charged the ledger figure', async () => {
    // The page started two backend jobs and then the export failed: the failure result names the
    // runs it had already started, so the ledger (not the whole reservation) is the charge.
    const outcome = await runCampaign({
      plans: [paidPlan('run-ledger')],
      maxTotalCostMicroUsd: 1_000_000,
      execute: async () => ({ status: 'failed', backendRunIds: ['job-1', 'job-2'] }),
      ledger: new Map([
        ['job-1', ledgerReceipt(40_000)],
        ['job-2', ledgerReceipt(25_000, { unreconciled: 5_000 })],
      ]),
    });
    expect(outcome.spentCostMicroUsd).toBe(70_000);
    expect(outcome.reservedUnknownMicroUsd).toBe(0);
  });

  it.each([
    [
      'an executor failure result that names no backend run',
      { status: 'failed', issueCodes: ['ui_executor_failed'] },
    ],
    ['a missing result', undefined],
    ['a completed result naming no backend run', { status: 'completed', backendRunIds: [] }],
    ['a completed result with malformed run ids', { status: 'completed', backendRunIds: [7] }],
    [
      'a completed result whose receipt is unreadable',
      { status: 'completed', backendRunIds: ['ghost'] },
    ],
  ])('keeps the full reservation for %s', async (_label, result) => {
    const charge = await chargeNodeGymAttempt({
      reservationMicroUsd: 180_000,
      result,
      readLedger: async (ids) => new Map(ids.map((id) => [id, null])),
    });
    expect(charge).toEqual({ chargedMicroUsd: 180_000, source: 'reservation' });
  });

  it('never trusts the executor-reported cost: a cheap claim does not lower the charge', async () => {
    const charge = await chargeNodeGymAttempt({
      reservationMicroUsd: 180_000,
      result: { status: 'failed', usage: { costMicroUsd: 0 } },
      readLedger: async () => new Map(),
    });
    expect(charge.chargedMicroUsd).toBe(180_000);
  });

  it('counts reserved and unreconciled exposure: a dispatch whose outcome never came back may be billed', async () => {
    const charge = await chargeNodeGymAttempt({
      reservationMicroUsd: 1_000_000,
      result: { status: 'completed', backendRunIds: ['job-1'] },
      readLedger: async () =>
        new Map([['job-1', ledgerReceipt(10_000, { reserved: 20_000, unreconciled: 30_000 })]]),
    });
    expect(charge).toEqual({ chargedMicroUsd: 60_000, source: 'ledger' });
  });

  it('keeps the full reservation while the ledger row is still open: a job outlives a UI timeout', async () => {
    // The browser gave up (export timed out) but the backend job is still running and still billing.
    const open = { ...ledgerReceipt(0), status: 'open' };
    const charge = await chargeNodeGymAttempt({
      reservationMicroUsd: 1_000_000,
      result: { status: 'failed', issueCodes: ['pptx_export_timeout'], backendRunIds: ['job-1'] },
      readLedger: async () => new Map([['job-1', open]]),
    });
    expect(charge).toEqual({ chargedMicroUsd: 1_000_000, source: 'reservation' });
  });

  it('keeps the reservation when any one of several named ledger rows is not finalized', async () => {
    const charge = await chargeNodeGymAttempt({
      reservationMicroUsd: 1_000_000,
      result: { status: 'completed', backendRunIds: ['job-1', 'job-2'] },
      readLedger: async () =>
        new Map([
          ['job-1', ledgerReceipt(10_000)],
          ['job-2', { ...ledgerReceipt(10_000), status: 'open' }],
        ]),
    });
    expect(charge).toEqual({ chargedMicroUsd: 1_000_000, source: 'reservation' });
  });

  it('charges a zero reservation for a free route even when its result is a failure', async () => {
    const charge = await chargeNodeGymAttempt({
      reservationMicroUsd: 0,
      result: { status: 'failed' },
      readLedger: async () => new Map(),
    });
    expect(charge).toEqual({ chargedMicroUsd: 0, source: 'reservation' });
  });
});

// Codex's v4 figures were a 100,000 cap against a run whose binding backend cap was 180,000. The
// binding cap cannot be chosen (round 1: the per-run flag was removed), so the same scenario now runs
// at the real 1,000,000 cap; the cap stays 100,000. The refusal is the same and the margin larger.
describe('(c) cap 100,000 micro-USD against the binding backend cap of 1,000,000', () => {
  it('refuses the first run before dispatch, because its reservation alone exceeds the cap', async () => {
    const outcome = await runCampaign({
      plans: [paidPlan('run-1'), paidPlan('run-2')],
      maxTotalCostMicroUsd: 100_000,
      execute: async () => {
        throw new Error('must never be dispatched');
      },
      ledger: new Map(),
    });
    expect(outcome.stoppedBy).toBe('campaign_projected_cost_limit_reached');
    expect(outcome.dispatched).toEqual([]);
    expect(outcome.spentCostMicroUsd).toBe(0);
  });

  it('the old runner admitted a second run (the defect): reservation 200,000 / meter 0 after a crash', () => {
    // What the old campaign loop computed for the same inputs, kept as the knockout reference:
    // a crash charged 0 and the gym plan's 200,000 projection was compared to a cap it never bound.
    const oldMeterAfterCrash = 0;
    expect(
      shouldStopCampaign({
        spentCostMicroUsd: oldMeterAfterCrash,
        maxTotalCostMicroUsd: 100_000,
        failures: 1,
        maxFailures: 2,
        nextRunMaxCostMicroUsd: 0,
      }).stop,
    ).toBe(false);
    // Under the new rule the crash is charged its reservation and the campaign is over.
    expect(
      shouldStopCampaign({
        spentCostMicroUsd: 1_000_000,
        maxTotalCostMicroUsd: 100_000,
        failures: 1,
        maxFailures: 2,
        nextRunMaxCostMicroUsd: 1_000_000,
      }),
    ).toEqual({ stop: true, issueCode: 'campaign_cost_limit_reached' });
  });

  it('a campaign that can afford one run admits it, charges the ledger, and refuses the next on projection', async () => {
    const outcome = await runCampaign({
      plans: [paidPlan('run-1'), paidPlan('run-2'), paidPlan('run-3')],
      maxTotalCostMicroUsd: 1_200_000,
      execute: async (plan) => ({ status: 'completed', backendRunIds: [`job-${plan.runId}`] }),
      ledger: new Map([
        ['job-run-1', ledgerReceipt(150_000)],
        ['job-run-2', ledgerReceipt(150_000)],
      ]),
    });
    expect(outcome.dispatched).toEqual(['run-1', 'run-2']);
    expect(outcome.spentCostMicroUsd).toBe(300_000);
    // 300,000 spent + 1,000,000 reserved for run-3 > 1,200,000.
    expect(outcome.stoppedBy).toBe('campaign_projected_cost_limit_reached');
  });
});

describe('attempt history: legacy receipts and orphaned attempts', () => {
  let campaignRoot;
  let attemptsDir;
  beforeEach(async () => {
    campaignRoot = await mkdtemp(path.join(os.tmpdir(), 'node-gym-budget-'));
    attemptsDir = path.join(campaignRoot, 'runs', 'run-1', 'attempts');
    await mkdir(attemptsDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(campaignRoot, { recursive: true, force: true });
  });

  const plan = paidPlan('run-1');

  function receipt(attempt, overrides = {}) {
    return {
      schemaVersion: 'nodekit.gym-run-receipt/v2',
      attempt,
      runId: 'run-1',
      comparisonKey: 'c',
      harnessPairingKey: 'p',
      pairingKey: 'p',
      repetition: 1,
      executor: 'ui',
      status: 'failed',
      automatedHardGatesPassed: false,
      issueCodes: ['execution_failed'],
      planDigest: undefined,
      executorResultDigest: `sha256:${'1'.repeat(64)}`,
      semanticEvaluationDigest: `sha256:${'2'.repeat(64)}`,
      usage: { latencyMs: 1, inputTokens: 1, outputTokens: 1, repairCount: 0, costMicroUsd: 0 },
      ...overrides,
    };
  }

  async function digestedPlan() {
    const { digestJson } = await import('../lib/node-gym-runner-core.mjs');
    return { plan, planDigest: digestJson(plan) };
  }

  it('charges a receipt written before charges were recorded the run full reservation, not its own usage figure', async () => {
    const { planDigest } = await digestedPlan();
    const legacy = receipt(1, { planDigest });
    expect(legacy.budget).toBeUndefined();
    const history = summarizeNodeGymAttemptHistory({
      plan,
      receipts: [legacy],
      executor: 'ui',
      reservationMicroUsd: 180_000,
    });
    expect(history.spentCostMicroUsd).toBe(180_000);
    expect(history.reservedUnknownMicroUsd).toBe(180_000);
  });

  it('sums the recorded charge of a current receipt and ignores its usage figure', async () => {
    const { planDigest } = await digestedPlan();
    const current = receipt(1, {
      planDigest,
      usage: {
        latencyMs: 1,
        inputTokens: 1,
        outputTokens: 1,
        repairCount: 0,
        costMicroUsd: 999_999,
      },
      budget: { chargedMicroUsd: 42_000, source: 'ledger' },
    });
    const history = summarizeNodeGymAttemptHistory({
      plan,
      receipts: [current],
      executor: 'ui',
      reservationMicroUsd: 180_000,
    });
    expect(history.spentCostMicroUsd).toBe(42_000);
    expect(history.reservedUnknownMicroUsd).toBe(0);
  });

  it('rejects a malformed recorded charge instead of reading it as zero', async () => {
    const { planDigest } = await digestedPlan();
    expect(() =>
      summarizeNodeGymAttemptHistory({
        plan,
        receipts: [receipt(1, { planDigest, budget: { chargedMicroUsd: -1, source: 'ledger' } })],
        executor: 'ui',
        reservationMicroUsd: 180_000,
      }),
    ).toThrow(/invalid budget charge/u);
  });

  it('(d) a resume over an attempt directory without its receipt charges that reservation, once', async () => {
    await mkdir(path.join(attemptsDir, 'attempt-001', 'work'), { recursive: true });
    await writeFile(path.join(attemptsDir, 'attempt-001', 'plan.json'), '{}\n');

    // First resume: the directory has no attempt-001.json receipt (the runner died).
    await setAsideNodeGymOrphanAttempts({
      campaignRoot,
      attemptsDir,
      runId: 'run-1',
      orphanAttempts: [1],
      reservationMicroUsd: 180_000,
    });
    let charges = await loadNodeGymOrphanCharges({ attemptsDir, runId: 'run-1' });
    expect(charges).toHaveLength(1);
    expect(charges[0].budget).toEqual({ chargedMicroUsd: 180_000, source: 'reservation' });
    // The evidence is kept, under a name the attempt scanner ignores, and attempt 1 can be re-issued.
    const names = await readdir(attemptsDir);
    expect(names).toContain('orphaned-attempt-001-1');
    expect(names).not.toContain('attempt-001');

    const history = summarizeNodeGymAttemptHistory({
      plan,
      receipts: [],
      executor: 'ui',
      reservationMicroUsd: 180_000,
      orphanCharges: charges,
    });
    expect(history).toMatchObject({
      spentCostMicroUsd: 180_000,
      reservedUnknownMicroUsd: 180_000,
      latestAttempt: 0,
    });

    // A second resume must not charge the same directory again.
    charges = await loadNodeGymOrphanCharges({ attemptsDir, runId: 'run-1' });
    expect(charges).toHaveLength(1);

    // The re-issued attempt dies too: a second orphan, a second (distinct) charge.
    await mkdir(path.join(attemptsDir, 'attempt-001'), { recursive: true });
    await setAsideNodeGymOrphanAttempts({
      campaignRoot,
      attemptsDir,
      runId: 'run-1',
      orphanAttempts: [1],
      reservationMicroUsd: 180_000,
    });
    charges = await loadNodeGymOrphanCharges({ attemptsDir, runId: 'run-1' });
    expect(charges).toHaveLength(2);
    expect((await readdir(attemptsDir)).sort()).toEqual(
      [
        'orphaned-attempt-001-1',
        'orphaned-attempt-001-1.charge.json',
        'orphaned-attempt-001-2',
        'orphaned-attempt-001-2.charge.json',
      ].sort(),
    );
  });

  it('does not double-charge a directory whose charge was written but whose rename never ran', async () => {
    await mkdir(path.join(attemptsDir, 'attempt-002'), { recursive: true });
    // The runner died between writing the charge and renaming the directory.
    await writeFile(
      path.join(attemptsDir, 'orphaned-attempt-002-1.charge.json'),
      `${JSON.stringify({
        schemaVersion: 'nodekit.gym-orphan-attempt-charge/v1',
        runId: 'run-1',
        attempt: 2,
        budget: { chargedMicroUsd: 180_000, source: 'reservation' },
      })}\n`,
    );
    await setAsideNodeGymOrphanAttempts({
      campaignRoot,
      attemptsDir,
      runId: 'run-1',
      orphanAttempts: [2],
      reservationMicroUsd: 180_000,
    });
    expect(await loadNodeGymOrphanCharges({ attemptsDir, runId: 'run-1' })).toHaveLength(1);
    expect(await readdir(attemptsDir)).toContain('orphaned-attempt-002-1');
  });

  it('rejects a tampered orphan charge', async () => {
    await writeFile(
      path.join(attemptsDir, 'orphaned-attempt-001-1.charge.json'),
      `${JSON.stringify({
        schemaVersion: 'nodekit.gym-orphan-attempt-charge/v1',
        runId: 'run-1',
        attempt: 1,
        budget: { chargedMicroUsd: 0, source: 'ledger' },
      })}\n`,
    );
    await expect(loadNodeGymOrphanCharges({ attemptsDir, runId: 'run-1' })).rejects.toThrow(
      /orphan charge/u,
    );
  });
});

/**
 * Scenario: someone starts `node-gym:run` while an earlier launch of the same campaign is still
 * running (the default campaign id is the same for every launch). The live attempt has no receipt
 * yet, exactly like a dead one, so a second run used to set its workspace aside, restore its
 * reservation and re-issue the attempt: replayed, 3,000,000 micro-USD dispatched against a 2,000,000
 * cap. The second launch must be refused before it reads or writes anything in the campaign.
 */
describe('two invocations on one campaign', () => {
  const campaignDir = path.join(
    'artifacts',
    'node-gym',
    'nodeslide-deck-gym-v2',
    'campaigns',
    `lock-test-${process.pid}`,
  );
  const launch = () =>
    spawnSync(
      process.execPath,
      ['scripts/run-node-gym.mjs', '--artifact-dir', campaignDir, '--limit', '2'],
      { encoding: 'utf8' },
    );
  afterEach(async () => {
    await rm(campaignDir, { recursive: true, force: true });
  });

  it('refuses a launch while the campaign is held, touching nothing, and runs again once it is released', async () => {
    await mkdir(campaignDir, { recursive: true });
    const release = acquireDeckGymCampaignLock(campaignDir, 'NodeGym');
    const refused = launch();
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/NodeGym campaign .* is already running/u);
    expect(await readdir(campaignDir)).toEqual(['campaign.lock']);

    release();
    const admitted = launch();
    expect(admitted.stderr).not.toMatch(/already running/u);
    expect(await readdir(campaignDir)).toContain('campaign-plan.json');
    expect(await readdir(campaignDir)).not.toContain('campaign.lock');
  });
});

/**
 * Scenario: a supervisor (`kill <pid>`, `docker stop` on PID 1) sends SIGTERM to the campaign parent
 * only, while a paid executor child is mid-attempt. On POSIX the child outlives the parent, and the
 * parent's exit handler used to release `campaign.lock` immediately, so a second launch could take the
 * lock, treat the live workspace as an orphan and re-issue the attempt path the survivor still writes.
 * The signal path must not release the lock until the child has closed.
 */
describe('stopping the executor before the lock is released', () => {
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const sleeper = (script) => spawn(process.execPath, ['-e', script], { stdio: 'ignore' });

  it('resolves only after a running child is dead, and does nothing when none runs', async () => {
    const guard = createNodeGymChildGuard();
    await guard.stop();
    const child = sleeper('setInterval(() => {}, 1000)');
    guard.track(child);
    await new Promise((resolve) => child.once('spawn', resolve));
    await guard.stop();
    expect(alive(child.pid)).toBe(false);
  });

  it('escalates to SIGKILL for a child that ignores the first signal', async () => {
    const guard = createNodeGymChildGuard({ graceMs: 200 });
    const child = sleeper(
      "process.on('SIGTERM', () => {}); console.log('x'); setInterval(() => {}, 1000)",
    );
    guard.track(child);
    await new Promise((resolve) => child.once('spawn', resolve));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await guard.stop();
    expect(alive(child.pid)).toBe(false);
  });
});
