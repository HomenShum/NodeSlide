import {
  NODE_GYM_CORE_PACKAGE_VERSION,
  type NodeGymRunPlan,
  selectNodeGymShadowRoute,
} from '@nodekit/gym-core';

declare const plan: NodeGymRunPlan;
const version: '0.1.0' = NODE_GYM_CORE_PACKAGE_VERSION;
const route = selectNodeGymShadowRoute({
  taskClass: plan.task.taskClass,
  champions: [],
  fallback: { model: plan.model.id, harness: plan.harness.id },
});
const hidden: false = route.userVisible;
void version;
void hidden;
