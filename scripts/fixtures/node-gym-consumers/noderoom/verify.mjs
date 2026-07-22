import assert from 'node:assert/strict';
import * as gym from '@nodekit/gym-core';

const phase = process.argv[2];
const task = {
  id: 'noderoom-frame-evidence',
  taskClass: 'nodeagent-frame-verification',
  curriculumLevel: 2,
  pool: 'public-development',
  taskDigest: 'sha256:noderoom-frame-task',
  evidenceDigest: 'sha256:noderoom-frame-evidence',
  referenceDigest: 'sha256:noderoom-frame-reference',
};
const model = {
  id: 'nodeagent-control',
  provider: 'local',
  route: 'frame-runner',
  returnedModelRequired: false,
  cohort: 'control',
};
const harnesses = ['frame-direct', 'frame-verified'].map((id) => ({
  id,
  version: '1',
  weight: id === 'frame-direct' ? 'light' : 'structured',
  role: id === 'frame-direct' ? 'frame-runner' : 'frame-verifier',
  contextStrategy: 'trace-bound-context-pack',
  toolIds: ['room-tools', 'frame-verifier'],
  repairPolicy: id === 'frame-direct' ? 'none' : 'review-required',
}));
const budget = { maxTokens: 1_000, maxLatencyMs: 15_000, maxCostMicroUsd: 0, maxRepairs: 1 };

if (phase === 'baseline') {
  assert.equal(gym.NODE_GYM_CORE_PACKAGE_VERSION, '0.0.1');
  assert.equal(typeof gym.selectNodeGymShadowRoute, 'undefined');
  const baselinePlans = gym.buildNodeGymMatrix({
    tasks: [task],
    models: [model],
    harnesses: [harnesses[0]],
    budget,
    repetitions: 1,
  });
  assert.equal(baselinePlans.length, 1);
  process.stdout.write(
    `${JSON.stringify({ product: 'NodeRoom', phase, version: '0.0.1', pairingKey: baselinePlans[0].pairingKey })}\n`,
  );
  process.exit(0);
}

assert.equal(phase, 'candidate');
assert.equal(gym.NODE_GYM_CORE_PACKAGE_VERSION, '0.1.0');
const plans = gym.buildNodeGymMatrix({
  tasks: [task],
  models: [model],
  harnesses,
  budget,
  repetitions: 3,
});
assert.equal(plans.length, 6);
gym.assertPairedHarnessRuns(plans[0], plans[3]);

function evaluateFrameEvidence(frame) {
  const evidenceComplete = Boolean(frame.traceId && frame.verifierReceipt && frame.mutationReview);
  return {
    status: evidenceComplete ? 'passed' : 'failed',
    hardGatesPassed: evidenceComplete,
    domain: 'NodeAgent frame evidence',
  };
}

assert.deepEqual(
  evaluateFrameEvidence({ traceId: 'trace-1', verifierReceipt: 'receipt-1', mutationReview: true }),
  { status: 'passed', hardGatesPassed: true, domain: 'NodeAgent frame evidence' },
);
assert.deepEqual(
  gym.selectNodeGymShadowRoute({
    taskClass: task.taskClass,
    champions: [
      {
        taskClass: task.taskClass,
        model: 'nodeagent-control',
        harness: 'frame-verified',
        eligible: true,
      },
    ],
    fallback: { model: 'frontier', harness: 'frame-direct' },
  }),
  { mode: 'shadow', model: 'nodeagent-control', harness: 'frame-verified', userVisible: false },
);
process.stdout.write(
  `${JSON.stringify({ product: 'NodeRoom', phase, version: '0.1.0', plans: plans.length, domainEvaluator: 'NodeAgent frame evidence', paired: true, pairingKey: plans[0].pairingKey })}\n`,
);
