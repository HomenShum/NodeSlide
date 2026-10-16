import { createHash } from 'node:crypto';
import {
  type DeckSnapshot,
  type NodeSlideAgentModelId,
  type PatchScope,
  nodeSlideAgentModel,
} from '../../shared/nodeslide';
import { NODESLIDE_RUN_BUDGET_BOUNDS } from '../../shared/nodeslideRunBudget';
import {
  type NodeSlideBudgetLedgerClient,
  createNodeSlideBudgetedEditDispatch,
  nodeSlideProviderBudgetId,
} from './nodeslideBudgetedProvider';
import { type NodeSlideEditPlanningRequest, planNodeSlideEditRouted } from './nodeslideEditPlanner';
import { nodeslideStableId } from './nodeslideIds';
import {
  type NodeSlideProviderResult,
  type NodeSlideProviderTelemetry,
  callNodeSlideFreeJson,
} from './nodeslideProvider';
import { NODESLIDE_ROUTING_EXECUTOR_MODEL } from './nodeslideRoutingPolicy';
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
 * The receipt is data only. Whether it counts as evidence is decided by `executorSplitReceiptFailures`
 * (scripts/lib/model-fleet-receipt-core.mjs), which also compares the build identity with the tested
 * commit, because only the caller knows which commit was tested. It carries the fields Part A rule 3
 * asks of every receipt (candidate, echoed models, one row per span, revision, constant hash, ledger
 * accounting, dispatch policy) so that review can reject it on the same grounds as any other.
 *
 * The probe turns the provider's second completion off (`maxRetries: 0` reaches
 * `callNodeSlideFreeJson`, which then makes exactly one request per span: no JSON-repair call, no
 * schema-compatibility retry) and no code path in the edit planner re-dispatches to another model
 * (its only fallback is deterministic and issues no request). `dispatchPolicy` in the receipt is
 * therefore the policy that was enforced, a constant, not a count of what happened; each row's
 * `dispatches` is the observed count and must be exactly 1 (`executorSplitReceiptFailures`).
 * Every dispatch is recorded as it returns, so a failed run still reports the requests it made.
 */
export const NODESLIDE_EXECUTOR_SPLIT_PROBE_SCHEMA = 'nodeslide.executor-split-probe/v1' as const;

/** Premium per PREMIUM_PLANNER_PATTERNS (nodeslideRoutingPolicy.ts), so the split is granted. */
export const NODESLIDE_EXECUTOR_SPLIT_PLANNER_MODEL = 'moonshotai/kimi-k3' as const;

export const NODESLIDE_EXECUTOR_SPLIT_PROBE_COMMAND =
  'npx convex run nodeslideModelProbe:runExecutorSplit' as const;

/**
 * The cap must cover what the ledger reserves BEFORE the first dispatch: the kimi-k3 planner at
 * 3 / 15 USD per million tokens (about 114,000 input / 4,400 output estimated tokens, 0.408756 USD)
 * plus the gemini-3.8-flash executor (0.095258 USD), 0.504014 USD together. The earlier 0.25 USD
 * default refused the planner's reservation, so the probe never dispatched (SPEC D3, Homen 2026-10-16:
 * 0.55 USD on dev and on the nightly probe). `convex/nodeslideExecutorSplitProbeBudget.test.ts` checks
 * this number against the real ledger.
 */
export const NODESLIDE_EXECUTOR_SPLIT_DEFAULT_BUDGET_USD = 0.55 as const;

/** SPEC A.0.3: paid dispatches without a retry or a cross-model fallback. Enforced, then recorded. */
export const NODESLIDE_EXECUTOR_SPLIT_DISPATCH_POLICY = {
  maxRetries: 0,
  crossModelFallback: false,
} as const;

export interface NodeSlideExecutorSplitSpan {
  toolName: 'planner' | 'executor';
  spanModel: string;
  /** The model string the provider returned, never the one requested. */
  responseModel: string | null;
  usage: { inputTokens: number; outputTokens: number };
  costMicroUsd: number;
}

/** Part A rule 3 row: one per span, in the same order as `spans`. */
export interface NodeSlideExecutorSplitRow {
  toolName: 'planner' | 'executor';
  requestedModel: string;
  /** What the repo's resolver chose for the request. */
  resolvedModel: string;
  /** The model string the provider returned; null when it returned none. */
  echoedModel: string | null;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  /** True when the provider served a model other than the one requested. */
  fallbackUsed: boolean;
  /** Model calls issued for this span; the receipt is rejected unless exactly 1. */
  dispatches: number;
}

export interface NodeSlideExecutorSplitProbeReceipt {
  schemaVersion: typeof NODESLIDE_EXECUTOR_SPLIT_PROBE_SCHEMA;
  command: typeof NODESLIDE_EXECUTOR_SPLIT_PROBE_COMMAND;
  /** The model under test: the routed copy executor. The planner is a fixture. */
  candidateIds: string[];
  echoedModels: string[];
  rows: NodeSlideExecutorSplitRow[];
  routing: {
    plannerModel: string;
    executorModel: string | null;
    reason: string;
    executorOutcome: string | null;
  };
  spans: NodeSlideExecutorSplitSpan[];
  /** The deployment's stamped commit, as the tested revision (the caller compares it to its own). */
  testedCommit: string | null;
  /** sha256 of the executor constant (`NODESLIDE_ROUTING_EXECUTOR_MODEL`) this build routes to. */
  constantSha256: string;
  budget: {
    maxUsd: number;
    /** Sum of the ledger's reservation quotes: the worst case the ledger authorized. */
    estimateUsd: number;
    /** The ledger's settled actual spend for the probe's budget. */
    spentUsd: number;
    /** Model calls issued across both spans. */
    requests: number;
    /** The first ledger refusal, or null; a stop is an incomplete run, never a pass. */
    stoppedBy: string | null;
    plannedOperations: number;
    refusals: string[];
  };
  /** The policy enforced on every dispatch (not an observed count); rejected unless it is {0, false}. */
  dispatchPolicy: { maxRetries: number; crossModelFallback: boolean };
  buildIdentity: { schemaVersion: string; commitSha: string | null } | null;
  startedAt: string;
  environment: { runtime: string; node: string };
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

function probeFixture(): {
  snapshot: DeckSnapshot;
  scope: PatchScope;
  slideId: string;
} {
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

/**
 * Wraps the ledger so the probe can report what the ledger authorized: each reservation's quote is
 * the worst case it admitted for that call. The wrapper adds nothing to the dispatch.
 */
function recordingLedger(ledger: NodeSlideBudgetLedgerClient) {
  const quotesMicroUsd: number[] = [];
  const client: NodeSlideBudgetLedgerClient = {
    ...ledger,
    reserve: async (args) => {
      const view = await ledger.reserve(args);
      if (view.call) quotesMicroUsd.push(view.call.quoteMicroUsd);
      return view;
    },
  };
  return { client, quotesMicroUsd };
}

const usd = (microUsd: number) => microUsd / 1_000_000;

export async function runNodeSlideExecutorSplitProbe(args: {
  ledger: NodeSlideBudgetLedgerClient;
  buildIdentity: { schemaVersion: string; commitSha: string | null } | null;
  budgetUsd: number;
  now?: () => number;
}): Promise<NodeSlideExecutorSplitProbeReceipt> {
  const now = args.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();
  const { snapshot, scope, slideId } = probeFixture();
  const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new Error('The probe deck fixture lost its slide.');
  const budget = { maxCostUsd: args.budgetUsd };
  // A fresh run id per invocation: a replayed id would return the recorded result without spending.
  const runId = nodeslideStableId(
    'nsrun_probe_executor_split',
    String(now()),
    NODESLIDE_EXECUTOR_SPLIT_PLANNER_MODEL,
  );
  const refusals: string[] = [];
  // Every dispatch, recorded as it returns: a failed planner that still made requests is on the books.
  const dispatched: {
    toolName: 'planner' | 'executor';
    telemetry: NodeSlideProviderTelemetry;
  }[] = [];
  const ledger = recordingLedger(args.ledger);
  const dispatch = createNodeSlideBudgetedEditDispatch({
    runId,
    budget,
    metered: true,
    ledger: ledger.client,
    dispatch: (request, dependencies) =>
      callNodeSlideFreeJson(request, {
        dispatchPolicy: {
          ...dependencies?.dispatchPolicy,
          maxRetries: NODESLIDE_EXECUTOR_SPLIT_DISPATCH_POLICY.maxRetries,
        },
      }),
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
        const result: NodeSlideProviderResult = await dispatch(providerRequest);
        if (!result.ok) refusals.push(result.reason);
        if (result.telemetry) {
          dispatched.push({
            toolName:
              providerRequest.jsonSchema?.name === 'nodeslide_copy_execution'
                ? 'executor'
                : 'planner',
            telemetry: result.telemetry,
          });
        }
        return result;
      },
    },
  );
  const routing = outcome.ok ? outcome.routing : undefined;
  const spans = dispatched.map((entry) => span(entry.toolName, entry.telemetry));
  const rows = dispatched.map((entry) => row(entry.toolName, entry.telemetry));
  // The ledger's own books for this probe's budget: what it settled, not what the rows say.
  const books = await args.ledger.replay({ budgetId: nodeSlideProviderBudgetId(runId) });
  const requests = rows.reduce((total, entry) => total + entry.dispatches, 0);
  const echoedModels = [
    ...new Set(rows.map((entry) => entry.echoedModel).filter((model) => model !== null)),
  ] as string[];
  return {
    schemaVersion: NODESLIDE_EXECUTOR_SPLIT_PROBE_SCHEMA,
    command: NODESLIDE_EXECUTOR_SPLIT_PROBE_COMMAND,
    candidateIds: [NODESLIDE_ROUTING_EXECUTOR_MODEL],
    echoedModels,
    rows,
    routing: outcome.ok
      ? {
          plannerModel: routing?.plannerModel ?? NODESLIDE_EXECUTOR_SPLIT_PLANNER_MODEL,
          executorModel: routing?.executorModel ?? null,
          reason: routing?.reason ?? 'not_routed',
          executorOutcome: routing?.executorOutcome ?? null,
        }
      : {
          plannerModel: NODESLIDE_EXECUTOR_SPLIT_PLANNER_MODEL,
          executorModel: null,
          reason: 'planner_failed',
          executorOutcome: null,
        },
    spans,
    testedCommit: args.buildIdentity?.commitSha ?? null,
    constantSha256: `sha256:${createHash('sha256').update(NODESLIDE_ROUTING_EXECUTOR_MODEL).digest('hex')}`,
    budget: {
      maxUsd: args.budgetUsd,
      estimateUsd: usd(ledger.quotesMicroUsd.reduce((total, quote) => total + quote, 0)),
      spentUsd: usd(books?.budget.actualMicroUsd ?? 0),
      requests,
      stoppedBy: refusals[0] ?? null,
      plannedOperations: outcome.ok ? outcome.operations.length : 0,
      refusals,
    },
    dispatchPolicy: { ...NODESLIDE_EXECUTOR_SPLIT_DISPATCH_POLICY },
    buildIdentity: args.buildIdentity,
    startedAt,
    environment: { runtime: 'convex-node-action', node: process.version },
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

function row(
  toolName: 'planner' | 'executor',
  telemetry: NodeSlideProviderTelemetry,
): NodeSlideExecutorSplitRow {
  const requestedModel = telemetry.requestedModel ?? telemetry.model;
  const echoedModel = telemetry.actualModel ?? null;
  return {
    toolName,
    requestedModel,
    // `telemetry.model` becomes the echoed model after a call; the resolver's choice is the catalog
    // row's upstream id for the requested route.
    resolvedModel: nodeSlideAgentModel(requestedModel as NodeSlideAgentModelId).upstreamId,
    echoedModel,
    usage: { inputTokens: telemetry.inputTokens, outputTokens: telemetry.outputTokens },
    costUsd: usd(telemetry.costMicroUsd),
    fallbackUsed: echoedModel !== null && echoedModel !== requestedModel,
    dispatches: telemetry.attempts?.length ?? 1,
  };
}
