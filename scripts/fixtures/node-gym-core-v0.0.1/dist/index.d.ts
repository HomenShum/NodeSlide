export declare const NODE_GYM_CORE_PACKAGE_VERSION: '0.0.1';
export declare const NODE_GYM_SCHEMA_VERSION: 'nodekit.gym/v1';

export interface NodeGymRunPlan {
  schemaVersion: typeof NODE_GYM_SCHEMA_VERSION;
  runId: string;
  task: {
    id: string;
    taskDigest: string;
    evidenceDigest: string;
    referenceDigest: string;
    [key: string]: unknown;
  };
  model: { id: string; [key: string]: unknown };
  harness: { id: string; [key: string]: unknown };
  budget: {
    maxTokens: number;
    maxLatencyMs: number;
    maxCostMicroUsd: number;
    maxRepairs: number;
  };
  repetition: number;
  pairingKey: string;
}

export declare function buildNodeGymMatrix(input: {
  tasks: NodeGymRunPlan['task'][];
  models: NodeGymRunPlan['model'][];
  harnesses: NodeGymRunPlan['harness'][];
  budget: NodeGymRunPlan['budget'];
  repetitions: number;
}): NodeGymRunPlan[];
