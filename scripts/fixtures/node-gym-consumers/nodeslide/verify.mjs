import assert from 'node:assert/strict';
import {
  NODE_GYM_CORE_PACKAGE_VERSION,
  assertPairedHarnessRuns,
  buildNodeGymMatrix,
  diagnoseNodeGymRun,
} from '@nodekit/gym-core';

const task = {
  id: 'nodeslide-equation-semantics',
  taskClass: 'artifact-spec-equation',
  curriculumLevel: 3,
  pool: 'public-development',
  taskDigest: 'sha256:nodeslide-task',
  evidenceDigest: 'sha256:nodeslide-evidence',
  referenceDigest: 'sha256:nodeslide-reference',
};
const model = {
  id: 'deterministic-control',
  provider: 'local',
  route: 'artifact-compiler',
  returnedModelRequired: false,
  cohort: 'control',
};
const harnesses = ['direct', 'typed-repair'].map((id) => ({
  id,
  version: '1',
  weight: id === 'direct' ? 'light' : 'repair',
  role: 'artifact-compiler',
  contextStrategy: 'bounded-artifact-spec',
  toolIds: ['compile-equation'],
  repairPolicy: id === 'direct' ? 'none' : 'typed-semantic-repair',
}));
const plans = buildNodeGymMatrix({
  tasks: [task],
  models: [model],
  harnesses,
  budget: { maxTokens: 500, maxLatencyMs: 10_000, maxCostMicroUsd: 0, maxRepairs: 1 },
  repetitions: 3,
});

assert.equal(NODE_GYM_CORE_PACKAGE_VERSION, '0.1.0');
assert.equal(plans.length, 6);
assertPairedHarnessRuns(plans[0], plans[3]);
const receipt = {
  runId: plans[0].runId,
  pairingKey: plans[0].pairingKey,
  repetition: plans[0].repetition,
  status: 'failed',
  scores: {
    briefAdherence: 1,
    storyQuality: 0.9,
    visualPreference: 0.8,
    factualAccuracy: 0.2,
    toolReliability: 1,
    exportFidelity: 1,
    repairSuccess: 0.4,
    editability: 1,
  },
  hardGatesPassed: false,
  semanticIssueCodes: ['equation_evaluation_mismatch'],
  repairCount: 2,
  latencyMs: 100,
  inputTokens: 0,
  outputTokens: 0,
  costMicroUsd: 0,
  humanInterventions: 0,
};
assert.deepEqual(
  diagnoseNodeGymRun(plans[0], receipt).sort(),
  ['repair', 'semantic-reasoning'].sort(),
);
process.stdout.write(
  `${JSON.stringify({ product: 'NodeSlide', plans: plans.length, domainEvaluator: 'equation-semantics', paired: true })}\n`,
);
