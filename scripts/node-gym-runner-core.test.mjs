import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNodeGymMatrix as buildPortableNodeGymMatrix } from '../packages/gym-core/src/index.ts';
import { buildNodeGymMatrixInput } from './lib/node-gym-config-core.mjs';
import { buildNodeGymMatrix as buildRuntimeNodeGymMatrix } from './lib/node-gym-matrix-core.mjs';
import {
  NODE_GYM_EXECUTOR_RESULT_SCHEMA,
  applyPairSafeLimit,
  assertNodeGymAttemptEvidence,
  assertNodeGymContainedPath,
  assertNodeGymLatestReceipt,
  assertNodeGymMatrixBoundToConfig,
  assertNodeGymRealPathContained,
  digestJson,
  digestNodeGymBytes,
  selectNodeGymSubset,
  shouldStopCampaign,
  summarizeNodeGymAttemptHistory,
  validateNodeGymExecutorResult,
  writeNodeGymFileAtomic,
} from './lib/node-gym-runner-core.mjs';

const budget = {
  maxTokens: 1000,
  maxLatencyMs: 60000,
  maxCostMicroUsd: 1000,
  maxRepairs: 1,
};
const task = {
  id: 'public-equation',
  pool: 'public-development',
  taskDigest: 'task',
  evidenceDigest: 'evidence',
  referenceDigest: 'reference',
};
const model = {
  id: 'google/gemma:free',
  route: 'google/gemma:free',
  provider: 'openrouter',
  cohort: 'pinned-free',
  returnedModelRequired: true,
};
const light = { id: 'light-director', version: '2.0.0' };
const structured = { id: 'structured-planner', version: '2.0.0' };
const runs = [light, structured].map((harness) => ({
  runId: `run-${harness.id}`,
  comparisonKey: 'comparison',
  harnessPairingKey: 'pair',
  pairingKey: 'pair',
  repetition: 1,
  task,
  model,
  harness,
  budget,
}));
const repositoryConfigBytes = await readFile('benchmarks/deck-gym/v2/gym.json');
const repositoryConfig = JSON.parse(repositoryConfigBytes.toString('utf8'));

function repositoryMatrixFixture(config = repositoryConfig, configBytes = repositoryConfigBytes) {
  const regeneratedRuns = buildRuntimeNodeGymMatrix(buildNodeGymMatrixInput(config));
  return {
    config,
    configBytes,
    regeneratedRuns,
    matrix: {
      schemaVersion: 'nodekit.gym-matrix/v1',
      gymVersion: config.gymVersion,
      configDigest: digestNodeGymBytes(configBytes),
      runCount: regeneratedRuns.length,
      pairedComparisonReady: true,
      promotionAutoApply: false,
      runs: regeneratedRuns,
    },
  };
}

function artifact(path) {
  return {
    path,
    digest: `sha256:${'a'.repeat(64)}`,
    bytes: 100,
    validation: { status: 'passed' },
  };
}

function result(overrides = {}) {
  return {
    schemaVersion: NODE_GYM_EXECUTOR_RESULT_SCHEMA,
    runId: runs[0].runId,
    pairingKey: 'pair',
    status: 'completed',
    route: {
      mode: 'live',
      actualProvider: model.provider,
      actualModel: model.route,
      responseId: 'provider-response-1',
    },
    usage: {
      latencyMs: 1000,
      inputTokens: 10,
      outputTokens: 20,
      costMicroUsd: 0,
      repairCount: 0,
    },
    artifacts: {
      browser: artifact('browser.png'),
      pptx: artifact('deck.pptx'),
      pdf: artifact('deck.pdf'),
    },
    diagnostics: { claimAudit: { status: 'passed' } },
    ...overrides,
  };
}

function immutableReceipt(plan, attempt, status, costMicroUsd) {
  const passed = validateNodeGymExecutorResult(plan, result({ runId: plan.runId }), {
    executor: 'deterministic',
    semanticEvaluation: { runId: plan.runId, attempt },
  });
  return {
    ...passed,
    status,
    automatedHardGatesPassed: status === 'passed',
    issueCodes: status === 'passed' ? [] : ['provider_error'],
    usage: { ...passed.usage, costMicroUsd },
    attempt,
    recordedAt: `2026-07-22T00:00:0${attempt}.000Z`,
  };
}

describe('NodeGym executable runner core', () => {
  it('keeps the clean-checkout CLI matrix compiler identical to the portable package', () => {
    const input = {
      tasks: [task],
      models: [model],
      harnesses: [light, structured],
      budget,
      repetitions: 2,
    };
    const runtime = buildRuntimeNodeGymMatrix(input);
    expect(runtime).toEqual(buildPortableNodeGymMatrix(input));
    expect(runtime[0].harnessPairingKey).toBe(
      `${task.taskDigest}::${task.evidenceDigest}::${task.referenceDigest}::${model.id}::1::1000:60000:1000:1`,
    );
  });

  it('selects a paired bounded subset instead of the full matrix', () => {
    expect(selectNodeGymSubset({ runs }, 'bounded')).toHaveLength(2);
  });

  it('never splits a harness pair when applying a final limit', () => {
    const secondPair = runs.map((run) => ({
      ...run,
      runId: `${run.runId}-2`,
      pairingKey: 'pair-2',
    }));
    expect(applyPairSafeLimit([...runs, ...secondPair], 3)).toEqual(runs);
    expect(() => applyPairSafeLimit(runs, 1)).toThrow(/smaller than the first complete pair/u);
  });

  it('rejects artifact paths that escape their run directory', () => {
    expect(() =>
      assertNodeGymContainedPath('D:/safe/run', 'D:/safe/elsewhere/secret.json', 'artifact'),
    ).toThrow(/artifact root/u);
    expect(() =>
      assertNodeGymContainedPath('D:/safe/run', 'D:/safe/run/slides/1.png', 'artifact'),
    ).not.toThrow();
    expect(() =>
      assertNodeGymContainedPath('D:/safe/run', 'D:/safe/run/./slides/1.png', 'artifact'),
    ).toThrow(/dot segments/u);
  });

  it('rejects symlink or junction escapes and publishes outputs atomically', async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'node-gym-runner-'));
    const root = path.join(sandbox, 'root');
    const outside = path.join(sandbox, 'outside');
    await Promise.all([mkdir(root), mkdir(outside)]);
    const escapePath = path.join(root, 'escape');
    await symlink(outside, escapePath, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      assertNodeGymRealPathContained(root, path.join(escapePath, 'secret.json'), 'artifact'),
    ).rejects.toThrow(/symlink or junction/u);

    const output = path.join(root, 'runs', 'receipt.json');
    await writeNodeGymFileAtomic(root, output, '{"status":"passed"}\n');
    expect(await readFile(output, 'utf8')).toBe('{"status":"passed"}\n');
    await writeNodeGymFileAtomic(root, output, '{"status":"replaced"}\n');
    expect(await readFile(output, 'utf8')).toBe('{"status":"replaced"}\n');
    await expect(
      writeNodeGymFileAtomic(root, output, '{"status":"forbidden"}\n', { exclusive: true }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(output, 'utf8')).toBe('{"status":"replaced"}\n');
    await rm(sandbox, { recursive: true, force: true });
  });

  it('passes only an attributed, artifact-complete, in-budget result', () => {
    expect(validateNodeGymExecutorResult(runs[0], result())).toMatchObject({
      status: 'passed',
      automatedHardGatesPassed: true,
      promotionEligible: false,
    });
  });

  it('diagnoses the known baseline failures and fails closed', () => {
    const receipt = validateNodeGymExecutorResult(
      runs[0],
      result({
        route: { mode: 'degraded' },
        diagnostics: {
          estimatedTextOverflowCount: 2,
          exportTimedOut: true,
          unsupportedClaimCount: 1,
          freeModelClaimUnattributed: true,
        },
      }),
    );
    expect(receipt.automatedHardGatesPassed).toBe(false);
    expect(receipt.issueCodes).toEqual(
      expect.arrayContaining([
        'degraded_route',
        'returned_model_attribution_missing',
        'pptx_text_overflow',
        'pptx_export_timeout',
        'unsupported_claim',
        'free_model_claim_unattributed',
      ]),
    );
  });

  it('never promotes free-form executor diagnostics into committed issue codes', () => {
    const receipt = validateNodeGymExecutorResult(
      runs[0],
      result({
        issueCodes: [
          'ui_executor_failed',
          'Traceback (most recent call last): File "C:\\Users\\developer\\secret.py"',
        ],
      }),
    );
    expect(receipt.issueCodes).toContain('ui_executor_failed');
    expect(receipt.issueCodes).toContain('executor_diagnostic_unclassified');
    expect(JSON.stringify(receipt)).not.toContain('C:\\Users\\developer');
  });

  it('requires an anonymized non-mutating ArtifactSpec shadow receipt from the UI executor', () => {
    const missing = validateNodeGymExecutorResult(runs[0], result(), {
      executor: 'ui',
    });
    expect(missing.issueCodes).toContain('typed_artifact_spec_not_observed');
    const passed = validateNodeGymExecutorResult(
      runs[0],
      result({
        artifactSpecShadow: {
          status: 'passed',
          userVisible: false,
          mutationApplied: false,
          anonymized: true,
          receiptDigest: `sha256:${'b'.repeat(64)}`,
          specSetDigest: `sha256:${'c'.repeat(64)}`,
        },
      }),
      { executor: 'ui' },
    );
    expect(passed.issueCodes).not.toContain('typed_artifact_spec_not_observed');
  });

  it('stops at aggregate cost or failure limits', () => {
    expect(
      shouldStopCampaign({
        spentCostMicroUsd: 90,
        nextRunMaxCostMicroUsd: 20,
        maxTotalCostMicroUsd: 100,
        failures: 0,
        maxFailures: 2,
      }),
    ).toMatchObject({
      stop: true,
      issueCode: 'campaign_projected_cost_limit_reached',
    });
    expect(
      shouldStopCampaign({
        spentCostMicroUsd: 101,
        maxTotalCostMicroUsd: 100,
        failures: 0,
        maxFailures: 2,
      }),
    ).toMatchObject({ stop: true, issueCode: 'campaign_cost_limit_reached' });
    expect(
      shouldStopCampaign({
        spentCostMicroUsd: 0,
        maxTotalCostMicroUsd: 100,
        failures: 2,
        maxFailures: 2,
      }),
    ).toMatchObject({
      stop: true,
      issueCode: 'campaign_failure_limit_reached',
    });
  });

  it('cannot pass shallow acceptance when required semantic evidence fails', () => {
    const receipt = validateNodeGymExecutorResult(runs[0], result(), {
      requireSemanticEvidence: true,
      semanticEvaluation: {
        schemaVersion: 'nodekit.gym-semantic-evaluation/v1',
        runId: runs[0].runId,
        hardGatesPassed: false,
        issueCodes: ['harness_behavior_not_observed'],
      },
    });
    expect(receipt.status).not.toBe('passed');
    expect(receipt.issueCodes).toEqual(
      expect.arrayContaining(['semantic_hard_gate_failure', 'harness_behavior_not_observed']),
    );
  });

  it('binds a matrix to the exact raw config bytes and exact regenerated run order', () => {
    const { config, configBytes, matrix, regeneratedRuns } = repositoryMatrixFixture();
    expect(
      assertNodeGymMatrixBoundToConfig({ configBytes, config, matrix, regeneratedRuns }),
    ).toMatchObject({ configDigest: matrix.configDigest, runCount: 720 });

    expect(() =>
      assertNodeGymMatrixBoundToConfig({
        configBytes: Buffer.concat([configBytes, Buffer.from(' ')]),
        config,
        matrix,
        regeneratedRuns,
      }),
    ).toThrow(/exact config bytes/u);
    expect(() =>
      assertNodeGymMatrixBoundToConfig({
        configBytes,
        config,
        matrix: { ...matrix, gymVersion: 'gym-v2' },
        regeneratedRuns,
      }),
    ).toThrow(/gymVersion/u);
    expect(() =>
      assertNodeGymMatrixBoundToConfig({
        configBytes,
        config,
        matrix: { ...matrix, runCount: 1 },
        regeneratedRuns,
      }),
    ).toThrow(/runCount/u);
  });

  it('rejects a stale model-last pairing key instead of silently rebinding it', () => {
    const { config, configBytes, matrix, regeneratedRuns } = repositoryMatrixFixture();
    const staleRuns = regeneratedRuns.map((run) => ({
      ...run,
      harnessPairingKey: `${run.task.taskDigest}::${run.repetition}::${run.model.id}`,
      pairingKey: `${run.task.taskDigest}::${run.repetition}::${run.model.id}`,
    }));
    expect(() =>
      assertNodeGymMatrixBoundToConfig({
        configBytes,
        config,
        matrix: { ...matrix, runs: staleRuns },
        regeneratedRuns,
      }),
    ).toThrow(/bound config regeneration/u);
  });

  it('rejects policy-invalid config even when its raw digest and regenerated matrix agree', () => {
    const config = structuredClone(repositoryConfig);
    config.promotion.autoApply = true;
    const configBytes = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
    const fixture = repositoryMatrixFixture(config, configBytes);
    expect(() => assertNodeGymMatrixBoundToConfig(fixture)).toThrow(/autoApply must remain false/u);
  });

  it('pre-accounts a paid failed resume receipt before the next campaign schedule', () => {
    const failed = immutableReceipt(runs[0], 1, 'provider-error', 125);
    const history = summarizeNodeGymAttemptHistory({
      plan: runs[0],
      receipts: [failed],
      executor: 'deterministic',
    });
    expect(history).toMatchObject({ spentCostMicroUsd: 125, failures: 1, latestAttempt: 1 });
    expect(
      shouldStopCampaign({
        spentCostMicroUsd: history.spentCostMicroUsd,
        nextRunMaxCostMicroUsd: 0,
        maxTotalCostMicroUsd: 100,
        failures: history.failures,
        maxFailures: 2,
      }),
    ).toMatchObject({ stop: true, issueCode: 'campaign_cost_limit_reached' });
  });

  it('sums failed then passed attempt costs and failures exactly once', () => {
    const failed = immutableReceipt(runs[0], 1, 'failed', 45);
    const passed = immutableReceipt(runs[0], 2, 'passed', 30);
    const history = summarizeNodeGymAttemptHistory({
      plan: runs[0],
      receipts: [passed, failed],
      executor: 'deterministic',
    });
    expect(history).toMatchObject({
      spentCostMicroUsd: 75,
      failures: 1,
      latestAttempt: 2,
      latestReceipt: passed,
      passedReceipt: passed,
    });
    expect(() => assertNodeGymLatestReceipt(history, failed)).toThrow(/final immutable/u);
    expect(() =>
      summarizeNodeGymAttemptHistory({
        plan: runs[0],
        receipts: [failed, { ...passed, attempt: 3 }],
        executor: 'deterministic',
      }),
    ).toThrow(/missing, duplicated, or out of sequence/u);
  });

  it('rejects resumed attempts whose executor, semantic, or artifact bytes were tampered', () => {
    const plan = runs[0];
    const attempt = 1;
    const executorResult = result({ runId: plan.runId });
    const semanticEvaluation = { runId: plan.runId, attempt };
    const receipt = immutableReceipt(plan, attempt, 'passed', 0);
    const stem = 'attempts/attempt-001';
    const files = {
      plan: { path: `${stem}/plan.json`, digest: `sha256:${'1'.repeat(64)}`, bytes: 100 },
      executorResult: {
        path: `${stem}/executor-result.json`,
        digest: `sha256:${'2'.repeat(64)}`,
        bytes: 200,
      },
      semanticEvaluation: {
        path: `${stem}/semantic-evaluation.json`,
        digest: `sha256:${'3'.repeat(64)}`,
        bytes: 300,
      },
    };
    const artifacts = [
      { path: 'browser.png', digest: `sha256:${'a'.repeat(64)}`, bytes: 100 },
      { path: 'deck.pdf', digest: `sha256:${'a'.repeat(64)}`, bytes: 100 },
      { path: 'deck.pptx', digest: `sha256:${'a'.repeat(64)}`, bytes: 100 },
    ];
    receipt.attemptEvidence = {
      schemaVersion: 'nodekit.gym-attempt-evidence/v1',
      artifactRoot: `${stem}/work`,
      files,
      artifactSetDigest: digestJson(artifacts),
    };
    expect(() =>
      assertNodeGymAttemptEvidence({
        plan,
        receipt,
        parsedPlan: plan,
        executorResult,
        semanticEvaluation,
        files,
        artifacts,
      }),
    ).not.toThrow();
    expect(() =>
      assertNodeGymAttemptEvidence({
        plan,
        receipt,
        parsedPlan: plan,
        executorResult: { ...executorResult, status: 'provider-error' },
        semanticEvaluation,
        files,
        artifacts,
      }),
    ).toThrow(/parsed evidence/u);
    expect(() =>
      assertNodeGymAttemptEvidence({
        plan,
        receipt,
        parsedPlan: plan,
        executorResult,
        semanticEvaluation,
        files,
        artifacts: [{ ...artifacts[0], bytes: 101 }, ...artifacts.slice(1)],
      }),
    ).toThrow(/artifact bytes/u);
  });
});
