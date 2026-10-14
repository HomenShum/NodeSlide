import type { DeckSnapshot, PatchScope } from '../../shared/nodeslide';
import { NODESLIDE_RUN_BUDGET_BOUNDS } from '../../shared/nodeslideRunBudget';
import {
  type NodeSlideBudgetLedgerClient,
  createNodeSlideBudgetedEditDispatch,
} from './nodeslideBudgetedProvider';
import { type NodeSlideEditPlanningRequest, planNodeSlideEditRouted } from './nodeslideEditPlanner';
import { nodeslideStableId } from './nodeslideIds';
import { type NodeSlideProviderTelemetry, callNodeSlideFreeJson } from './nodeslideProvider';
import { buildGoldenNodeSlide } from './nodeslideSeed';

/**
 * Candidate-bound executor receipt for the routed copy executor (SPEC Part A, section A.2.8).
 *
 * Situation: NodeSlide's edit planner is a premium model; when its plan rewrites two or more text
 * elements it hands the wording to a cheap "executor" model. Google retired the executor
 * (Gemini 3.5 Flash) on 2026-10-08, so the executor id changed. The only honest proof that the new
 * executor really runs is one edit turn that is split exactly that way, through the same
 * reserve-before-dispatch provider production uses, with the model name the provider echoed back
 * (not the one we asked for) written into the receipt. Create-and-export journeys never reach the
 * executor, so they cannot stand in for this.
 *
 * The receipt is data only. Whether it counts as evidence is decided by `validateExecutorSplitReceipt`
 * (scripts/lib/model-fleet-receipt-core.mjs), which also compares the build identity with the tested
 * commit, because only the caller knows which commit was tested.
 */
export const NODESLIDE_EXECUTOR_SPLIT_PROBE_SCHEMA = 'nodeslide.executor-split-probe/v1' as const;

/** Premium per PREMIUM_PLANNER_PATTERNS (nodeslideRoutingPolicy.ts), so the split is granted. */
export const NODESLIDE_EXECUTOR_SPLIT_PLANNER_MODEL = 'moonshotai/kimi-k3' as const;

export const NODESLIDE_EXECUTOR_SPLIT_DEFAULT_BUDGET_USD = 0.25 as const;

export interface NodeSlideExecutorSplitSpan {
  toolName: 'planner' | 'executor';
  spanModel: string;
  /** The model string the provider returned, never the one requested. */
  responseModel: string | null;
  usage: { inputTokens: number; outputTokens: number };
  costMicroUsd: number;
}

export interface NodeSlideExecutorSplitProbeReceipt {
  schemaVersion: typeof NODESLIDE_EXECUTOR_SPLIT_PROBE_SCHEMA;
  routing: {
    plannerModel: string;
    executorModel: string | null;
    reason: string;
    executorOutcome: string | null;
  };
  spans: NodeSlideExecutorSplitSpan[];
  budget: {
    maxCostUsd: number;
    plannedOperations: number;
    refusals: string[];
  };
  buildIdentity: { schemaVersion: string; commitSha: string | null } | null;
}

export function executorSplitProbeBudgetUsd(env: Record<string, string | undefined>): number {
  const raw = env['NODESLIDE_PROBE_BUDGET_USD'];
  if (raw === undefined || raw === '') return NODESLIDE_EXECUTOR_SPLIT_DEFAULT_BUDGET_USD;
  const parsed = Number(raw);
  // An unparsable or non-positive ceiling is refused, never silently replaced by a larger one.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('NODESLIDE_PROBE_BUDGET_USD must be a positive number of US dollars.');
  }
  return Math.min(NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.default, parsed);
}

function probeFixture(): { snapshot: DeckSnapshot; scope: PatchScope; slideId: string } {
  const snapshot = buildGoldenNodeSlide('executor-split-probe', 1_700_000_000_000).snapshot;
  const bySlide = new Map<string, DeckSnapshot['elements']>();
  for (const element of snapshot.elements) {
    if (element.kind !== 'text' || element.locked) continue;
    bySlide.set(element.slideId, [...(bySlide.get(element.slideId) ?? []), element]);
  }
  const pair = [...bySlide.values()].find((elements) => elements.length >= 2);
  if (!pair) throw new Error('The probe deck fixture needs a slide with two unlocked text blocks.');
  const targets = pair.slice(0, 2);
  const slideId = targets[0]?.slideId as string;
  return {
    snapshot,
    slideId,
    scope: {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [slideId],
      elementIds: targets.map((element) => element.id),
      operationMode: 'copy',
    },
  };
}

export async function runNodeSlideExecutorSplitProbe(args: {
  ledger: NodeSlideBudgetLedgerClient;
  buildIdentity: { schemaVersion: string; commitSha: string | null } | null;
  budgetUsd: number;
  now?: () => number;
}): Promise<NodeSlideExecutorSplitProbeReceipt> {
  const { snapshot, scope, slideId } = probeFixture();
  const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new Error('The probe deck fixture lost its slide.');
  const budget = { maxCostUsd: args.budgetUsd };
  // A fresh run id per invocation: a replayed id would return the recorded result without spending.
  const runId = nodeslideStableId(
    'nsrun_probe_executor_split',
    String((args.now ?? Date.now)()),
    NODESLIDE_EXECUTOR_SPLIT_PLANNER_MODEL,
  );
  const refusals: string[] = [];
  const dispatch = createNodeSlideBudgetedEditDispatch({
    runId,
    budget,
    metered: true,
    ledger: args.ledger,
    dispatch: (request, dependencies) =>
      callNodeSlideFreeJson(
        request,
        ...(dependencies?.dispatchPolicy ? [{ dispatchPolicy: dependencies.dispatchPolicy }] : []),
      ),
  });
  const request: NodeSlideEditPlanningRequest = {
    deckId: snapshot.deck.id,
    instruction:
      'Rewrite both listed text elements as crisp one-sentence executive statements. Emit one replace_text per element and a copyBriefs entry for each.',
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: { [slideId]: slide.version },
    baseElementVersions: Object.fromEntries(
      snapshot.elements
        .filter((element) => element.slideId === slideId)
        .map((element) => [element.id, element.version]),
    ),
    scope,
    designBehavior: 'preserve',
    referenceUse: 'context_only',
    providerMode: 'openrouter_free',
    providerModel: NODESLIDE_EXECUTOR_SPLIT_PLANNER_MODEL,
    providerEffort: 'low',
  };
  const outcome = await planNodeSlideEditRouted(
    { snapshot, scopedComment: null, request },
    {
      callProvider: async (providerRequest) => {
        const result = await dispatch(providerRequest);
        if (!result.ok) refusals.push(result.reason);
        return result;
      },
    },
  );
  if (!outcome.ok) {
    return {
      schemaVersion: NODESLIDE_EXECUTOR_SPLIT_PROBE_SCHEMA,
      routing: {
        plannerModel: NODESLIDE_EXECUTOR_SPLIT_PLANNER_MODEL,
        executorModel: null,
        reason: 'planner_failed',
        executorOutcome: null,
      },
      spans: [],
      budget: { maxCostUsd: args.budgetUsd, plannedOperations: 0, refusals },
      buildIdentity: args.buildIdentity,
    };
  }
  const routing = outcome.routing;
  const spans: NodeSlideExecutorSplitSpan[] = [];
  const plannerTelemetry = outcome.receipt.providerTelemetry;
  if (plannerTelemetry) spans.push(span('planner', plannerTelemetry));
  if (routing?.executorTelemetry) spans.push(span('executor', routing.executorTelemetry));
  return {
    schemaVersion: NODESLIDE_EXECUTOR_SPLIT_PROBE_SCHEMA,
    routing: {
      plannerModel: routing?.plannerModel ?? NODESLIDE_EXECUTOR_SPLIT_PLANNER_MODEL,
      executorModel: routing?.executorModel ?? null,
      reason: routing?.reason ?? 'not_routed',
      executorOutcome: routing?.executorOutcome ?? null,
    },
    spans,
    budget: { maxCostUsd: args.budgetUsd, plannedOperations: outcome.operations.length, refusals },
    buildIdentity: args.buildIdentity,
  };
}

function span(
  toolName: 'planner' | 'executor',
  telemetry: NodeSlideProviderTelemetry,
): NodeSlideExecutorSplitSpan {
  return {
    toolName,
    spanModel: telemetry.requestedModel ?? telemetry.model,
    responseModel: telemetry.actualModel ?? null,
    usage: { inputTokens: telemetry.inputTokens, outputTokens: telemetry.outputTokens },
    costMicroUsd: telemetry.costMicroUsd,
  };
}
