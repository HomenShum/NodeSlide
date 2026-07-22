import {
  NODE_GYM_CORE_PACKAGE_VERSION,
  type NodeGymRunPlan,
  buildNodeGymMatrix,
} from '@nodekit/gym-core';

const plans: NodeGymRunPlan[] = buildNodeGymMatrix({
  tasks: [],
  models: [],
  harnesses: [],
  budget: { maxTokens: 1, maxLatencyMs: 1, maxCostMicroUsd: 0, maxRepairs: 0 },
  repetitions: 1,
});
const version: '0.1.0' = NODE_GYM_CORE_PACKAGE_VERSION;
void plans;
void version;
