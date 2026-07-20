import { describe, expect, it, vi } from 'vitest';
import { NODESLIDE_OPENROUTER_EDIT_CONSENT, type NodeSlideWorkspace } from '../../shared/nodeslide';
import { proposeEdit } from '../nodeslideAgent';
import { NODESLIDE_ROUTING_EXECUTOR_MODEL } from './nodeslideRoutingPolicy';
import { buildGoldenNodeSlide } from './nodeslideSeed';

vi.mock('./nodeslideProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nodeslideProvider')>();
  return {
    ...actual,
    callNodeSlideFreeJson: vi.fn(async (args: { model?: string }) => {
      if (args.model === NODESLIDE_ROUTING_EXECUTOR_MODEL) {
        return {
          ok: true,
          value: { copy: mockExecutorCopy },
          telemetry: {
            provider: 'openrouter',
            model: NODESLIDE_ROUTING_EXECUTOR_MODEL,
            costMicroUsd: 1,
            inputTokens: 40,
            outputTokens: 20,
          },
        };
      }
      return {
        ok: true,
        value: mockPlannerValue,
        telemetry: {
          provider: 'openrouter',
          model: 'moonshotai/kimi-k3',
          costMicroUsd: 20,
          inputTokens: 200,
          outputTokens: 80,
        },
      };
    }),
  };
});

// Mutable holders so the hoisted vi.mock factory sees per-test fixture data.
let mockPlannerValue: unknown;
let mockExecutorCopy: unknown;

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const NOW = 1_700_000_000_000;

type ProposeEditHandler = (
  context: { runQuery: ReturnType<typeof vi.fn>; runMutation: ReturnType<typeof vi.fn> },
  args: Record<string, unknown>,
) => Promise<unknown>;

const proposeEditHandler = (proposeEdit as unknown as { _handler: ProposeEditHandler })._handler;

function workspace(snapshot: ReturnType<typeof buildGoldenNodeSlide>['snapshot']) {
  return {
    ...snapshot,
    comments: [],
    patches: [],
    versions: [],
    traces: [],
    validations: [],
    exports: [],
    presence: [],
    publication: null,
  } as unknown as NodeSlideWorkspace;
}

describe('proposeEdit routed attribution (B2)', () => {
  it('writes per-model planner/executor rows through the span write path', async () => {
    const snapshot = buildGoldenNodeSlide('routed-propose-edit-tests', NOW).snapshot;
    const bySlide = new Map<string, typeof snapshot.elements>();
    for (const element of snapshot.elements) {
      if (element.kind !== 'text' || element.locked) continue;
      bySlide.set(element.slideId, [...(bySlide.get(element.slideId) ?? []), element]);
    }
    const pair = [...bySlide.values()].find((elements) => elements.length >= 2);
    if (!pair) throw new Error('Expected a slide with two unlocked text fixtures.');
    const [first, second] = pair as [(typeof pair)[number], (typeof pair)[number]];
    mockPlannerValue = {
      summary: 'Rewrite both text blocks.',
      operations: [
        { op: 'replace_text', slideId: first.slideId, elementId: first.id, text: 'Planner one' },
        { op: 'replace_text', slideId: second.slideId, elementId: second.id, text: 'Planner two' },
      ],
      copyBriefs: [
        { slideId: first.slideId, elementId: first.id, brief: 'Opening statement.' },
        { slideId: second.slideId, elementId: second.id, brief: 'Proof point.' },
      ],
    };
    mockExecutorCopy = [
      { elementId: first.id, text: 'Executor one' },
      { elementId: second.id, text: 'Executor two' },
    ];

    const current = workspace(snapshot);
    const runQuery = vi.fn(async (_reference: unknown, args: Record<string, unknown>) =>
      'runId' in args ? { status: 'planning' } : current,
    );
    const mutations: Record<string, unknown>[] = [];
    const runMutation = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if ('buckets' in args) return undefined;
      if ('idempotencyKey' in args && 'provider' in args) {
        return {
          created: true,
          run: { id: 'run-routed-1', status: 'queued', provider: 'openrouter' },
        };
      }
      if ('operations' in args) return { patch: { id: args['id'] }, workspace: current };
      return 'run-routed-1';
    });

    const result = await proposeEditHandler(
      { runQuery, runMutation },
      {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        instruction: 'Rewrite both text blocks with sharper copy.',
        baseDeckVersion: snapshot.deck.version,
        baseSlideVersions: {
          [first.slideId]: snapshot.slides.find((slide) => slide.id === first.slideId)?.version,
        },
        baseElementVersions: {
          [first.id]: first.version,
          [second.id]: second.version,
        },
        scope: {
          kind: 'elements',
          deckId: snapshot.deck.id,
          slideIds: [first.slideId],
          elementIds: [first.id, second.id],
          operationMode: 'copy',
        },
        providerMode: 'openrouter_free',
        providerModel: 'moonshotai/kimi-k3',
        providerEffort: 'high',
        providerConsent: NODESLIDE_OPENROUTER_EDIT_CONSENT,
      },
    );

    expect(result).toBeDefined();
    const plannerRow = mutations.find((args) => args['toolName'] === 'planner');
    const executorRow = mutations.find((args) => args['toolName'] === 'executor');
    expect(plannerRow).toMatchObject({
      spanProvider: 'openrouter',
      spanModel: 'moonshotai/kimi-k3',
      role: 'tool',
    });
    expect(String(plannerRow?.['message'])).toContain('Planner · Kimi K3');
    expect(executorRow).toMatchObject({
      spanProvider: 'openrouter',
      spanModel: NODESLIDE_ROUTING_EXECUTOR_MODEL,
      role: 'tool',
    });
    expect(String(executorRow?.['message'])).toContain('Executor · Gemini 3.5 Flash');

    const proposal = mutations.find((args) => 'operations' in args && 'traceContext' in args);
    expect(proposal).toBeDefined();
    const traceContext = proposal?.['traceContext'] as string[];
    expect(
      traceContext.some(
        (line) =>
          line.includes('nodeslide.model-routing/v1') &&
          line.includes('moonshotai/kimi-k3') &&
          line.includes(NODESLIDE_ROUTING_EXECUTOR_MODEL) &&
          line.includes('applied'),
      ),
    ).toBe(true);
    const operations = proposal?.['operations'] as { op: string; text?: string }[];
    expect(operations.map((operation) => operation.text)).toEqual(['Executor one', 'Executor two']);
  });
});
