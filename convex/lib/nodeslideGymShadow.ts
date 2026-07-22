import type { NodeSlideArtifactCompilationReceipt } from '../../shared/nodeslideArtifactSpec';
import { selectNodeGymShadowRoute } from '../../shared/nodeslideGym';
import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_GYM_SHADOW_ROUTE_RECEIPT_VERSION =
  'nodeslide.node-gym-shadow-route-receipt/v1' as const;

export interface NodeSlideGymApprovedChampion {
  taskClass: string;
  model: string;
  harness: string;
  eligible: boolean;
}

/**
 * Pure advisory adapter. It never calls a model, changes routing, or exposes
 * deck/task content. The production query intentionally supplies no champion
 * until a separate approved registry exists, so fallback remains fail closed.
 */
export function buildNodeSlideGymShadowRouteReceipt(input: {
  taskClass: string;
  artifactCompilation: NodeSlideArtifactCompilationReceipt;
  approvedChampions?: NodeSlideGymApprovedChampion[];
}) {
  const taskClass = input.taskClass.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!taskClass) throw new Error('NodeGym shadow task class is required.');
  const approvedChampions = (input.approvedChampions ?? []).filter(
    (champion) =>
      champion.eligible &&
      champion.taskClass === taskClass &&
      champion.model.trim() &&
      champion.harness.trim(),
  );
  const eligibleInput = input.artifactCompilation.status === 'passed';
  const selected = selectNodeGymShadowRoute({
    taskClass,
    champions: eligibleInput ? approvedChampions : [],
    fallback: {
      model: 'deterministic-control/v1',
      harness: 'bounded-executor@1',
    },
  });
  const unsigned = {
    schemaVersion: NODESLIDE_GYM_SHADOW_ROUTE_RECEIPT_VERSION,
    userVisible: false as const,
    mutationApplied: false as const,
    autoApply: false as const,
    anonymized: true as const,
    eligibleInput,
    taskClassDigest: nodeslideContentDigest(taskClass),
    artifactCompilationReceiptDigest: input.artifactCompilation.receiptDigest,
    artifactSpecSetDigest: input.artifactCompilation.specSetDigest,
    approvedChampionCount: approvedChampions.length,
    route: selected,
  };
  return {
    ...unsigned,
    receiptDigest: nodeslideContentDigest(canonicalJson(unsigned)),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
