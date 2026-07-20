import { describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_OPENROUTER_EDIT_CONSENT,
  type NodeSlideWorkspace,
  type SlideElement,
} from '../../shared/nodeslide';
import { buildGoldenNodeSlide } from './nodeslideSeed';

/**
 * B4 edit-path tool loop: the proposeEdit action emits REAL per-step tool
 * messages (read context, planner, executor, verify, repair) whose content
 * reflects work that actually ran. The provider module is mocked at the
 * module boundary so the planner/executor/repair calls are deterministic.
 */

const providerMock = vi.hoisted(() => ({
  callNodeSlideFreeJson: vi.fn(),
}));

vi.mock('./nodeslideProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./nodeslideProvider')>()),
  callNodeSlideFreeJson: providerMock.callNodeSlideFreeJson,
}));

import { proposeEdit } from '../nodeslideAgent';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const NOW = 1_700_000_000_000;

type ProposeEditHandler = (
  context: { runQuery: ReturnType<typeof vi.fn>; runMutation: ReturnType<typeof vi.fn> },
  args: Record<string, unknown>,
) => Promise<unknown>;

const proposeEditHandler = (proposeEdit as unknown as { _handler: ProposeEditHandler })._handler;

interface RecordedStep {
  status?: string;
  message?: string;
  toolName?: string;
  spanModel?: string;
}

function workspace(): NodeSlideWorkspace {
  const snapshot = buildGoldenNodeSlide('edit-verify-action-tests', NOW).snapshot;
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
  };
}

function harness(current: NodeSlideWorkspace) {
  const steps: RecordedStep[] = [];
  const proposals: Array<Record<string, unknown>> = [];
  const runQuery = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
    if ('runId' in args) return { status: 'planning' };
    return current;
  });
  const runMutation = vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
    if ('buckets' in args) return { ok: true };
    if ('idempotencyKey' in args) return { created: true, run: { id: 'run-b4-test' } };
    if ('runId' in args) {
      steps.push({
        status: args.status as string | undefined,
        message: args.message as string | undefined,
        toolName: args.toolName as string | undefined,
        spanModel: args.spanModel as string | undefined,
      });
      return {};
    }
    if ('operations' in args) {
      proposals.push(args);
      return { patch: { id: args.id, summary: args.summary }, workspace: current };
    }
    return {};
  });
  return { context: { runQuery, runMutation }, steps, proposals };
}

function unlockedTextElements(current: NodeSlideWorkspace, count: number): SlideElement[] {
  const targets = current.elements
    .filter((element) => element.kind === 'text' && !element.locked)
    .slice(0, count);
  if (targets.length < count) throw new Error(`Expected ${count} unlocked text fixtures.`);
  return targets;
}

function baseArgs(current: NodeSlideWorkspace, targets: SlideElement[]) {
  const slideIds = [...new Set(targets.map((target) => target.slideId))];
  return {
    deckId: current.deck.id,
    ownerAccessKey: OWNER_ACCESS_KEY,
    instruction: 'Rewrite the selected copy.',
    baseDeckVersion: current.deck.version,
    baseSlideVersions: Object.fromEntries(
      current.slides
        .filter((slide) => slideIds.includes(slide.id))
        .map((slide) => [slide.id, slide.version]),
    ),
    baseElementVersions: Object.fromEntries(targets.map((target) => [target.id, target.version])),
    scope: {
      kind: 'elements' as const,
      deckId: current.deck.id,
      slideIds,
      elementIds: targets.map((target) => target.id),
      operationMode: 'copy' as const,
    },
    providerMode: 'openrouter_free' as const,
    providerConsent: NODESLIDE_OPENROUTER_EDIT_CONSENT,
  };
}

describe('proposeEdit B4 tool loop messages', () => {
  it('emits Verify + Repair steps when the candidate fails shadow verification', async () => {
    const current = workspace();
    const [target] = unlockedTextElements(current, 1);
    if (!target) throw new Error('Expected a text fixture.');
    // Force overflow on long replacement copy.
    target.bbox = { x: 0.05, y: 0.05, width: 0.12, height: 0.04 };
    target.content = 'Before';
    const longText = 'lorem ipsum dolor sit amet '.repeat(60).trim();
    providerMock.callNodeSlideFreeJson.mockReset();
    providerMock.callNodeSlideFreeJson.mockImplementation(
      async (request: { jsonSchema?: { name: string } }) => {
        const telemetry = {
          provider: 'openrouter',
          model: 'z-ai/glm-5.2',
          inputTokens: 10,
          outputTokens: 5,
          costMicroUsd: 1,
        };
        if (request.jsonSchema?.name === 'nodeslide_edit_patch_repair') {
          return {
            ok: true,
            value: {
              summary: 'Repaired copy',
              operations: [
                {
                  op: 'replace_text',
                  slideId: target.slideId,
                  elementId: target.id,
                  text: 'Short.',
                },
              ],
            },
            telemetry,
          };
        }
        return {
          ok: true,
          value: {
            summary: 'Overflowing copy',
            operations: [
              {
                op: 'replace_text',
                slideId: target.slideId,
                elementId: target.id,
                text: longText,
              },
            ],
          },
          telemetry,
        };
      },
    );

    const { context, steps, proposals } = harness(current);
    await proposeEditHandler(context, {
      ...baseArgs(current, [target]),
      providerModel: 'z-ai/glm-5.2',
    });

    const toolNames = steps.map((step) => step.toolName).filter(Boolean);
    expect(toolNames).toContain('read_context');
    expect(toolNames).toContain('planner');
    expect(toolNames).toContain('verify');
    expect(toolNames).toContain('repair');
    const verifyStep = steps.find((step) => step.toolName === 'verify');
    expect(verifyStep?.message).toContain('shadow snapshot');
    expect(verifyStep?.message).toContain('repairing');
    const repairStep = steps.find((step) => step.toolName === 'repair');
    expect(repairStep?.message).toContain('Repair ·');
    expect(repairStep?.message).toContain('revised 1 operation');
    // The adopted repair actually replaced the persisted operations.
    const persistedOps = proposals[0]?.operations as Array<{ text?: string }>;
    expect(persistedOps?.[0]?.text).toBe('Short.');
    // Planner + repair = exactly two provider calls (ONE bounded repair).
    expect(providerMock.callNodeSlideFreeJson).toHaveBeenCalledTimes(2);
  });

  it('emits a clean Verify step and no Repair step for a clean candidate', async () => {
    const current = workspace();
    const [target] = unlockedTextElements(current, 1);
    if (!target) throw new Error('Expected a text fixture.');
    providerMock.callNodeSlideFreeJson.mockReset();
    providerMock.callNodeSlideFreeJson.mockResolvedValue({
      ok: true,
      value: {
        summary: 'Concise copy',
        operations: [
          { op: 'replace_text', slideId: target.slideId, elementId: target.id, text: 'After.' },
        ],
      },
      telemetry: {
        provider: 'openrouter',
        model: 'z-ai/glm-5.2',
        inputTokens: 10,
        outputTokens: 5,
        costMicroUsd: 1,
      },
    });

    const { context, steps } = harness(current);
    await proposeEditHandler(context, {
      ...baseArgs(current, [target]),
      providerModel: 'z-ai/glm-5.2',
    });

    const toolNames = steps.map((step) => step.toolName).filter(Boolean);
    expect(toolNames).toContain('verify');
    expect(toolNames).not.toContain('repair');
    const verifyStep = steps.find((step) => step.toolName === 'verify');
    expect(verifyStep?.message).toContain('clean');
    expect(providerMock.callNodeSlideFreeJson).toHaveBeenCalledTimes(1);
  });

  it('keeps planner + executor attributions AND the Verify step on an executor-lane run', async () => {
    const current = workspace();
    const targets = unlockedTextElements(current, 2);
    providerMock.callNodeSlideFreeJson.mockReset();
    providerMock.callNodeSlideFreeJson.mockImplementation(
      async (request: { jsonSchema?: { name: string } }) => {
        if (request.jsonSchema?.name === 'nodeslide_copy_execution') {
          return {
            ok: true,
            value: {
              copy: targets.map((target, index) => ({
                elementId: target.id,
                text: `Refined copy ${index + 1}.`,
              })),
            },
            telemetry: {
              provider: 'openrouter',
              model: 'google/gemini-3.5-flash',
              inputTokens: 5,
              outputTokens: 3,
              costMicroUsd: 1,
            },
          };
        }
        return {
          ok: true,
          value: {
            summary: 'Two-element rewrite',
            operations: targets.map((target, index) => ({
              op: 'replace_text',
              slideId: target.slideId,
              elementId: target.id,
              text: `Planner copy ${index + 1}.`,
            })),
            copyBriefs: targets.map((target) => ({
              slideId: target.slideId,
              elementId: target.id,
              brief: 'Concise factual copy for this element.',
            })),
          },
          telemetry: {
            provider: 'openrouter',
            model: 'moonshotai/kimi-k3',
            inputTokens: 10,
            outputTokens: 5,
            costMicroUsd: 2,
          },
        };
      },
    );

    const { context, steps } = harness(current);
    await proposeEditHandler(context, {
      ...baseArgs(current, targets),
      providerModel: 'moonshotai/kimi-k3',
    });

    const plannerStep = steps.find((step) => step.toolName === 'planner');
    const executorStep = steps.find((step) => step.toolName === 'executor');
    const verifyStep = steps.find((step) => step.toolName === 'verify');
    expect(plannerStep?.spanModel).toBe('moonshotai/kimi-k3');
    expect(executorStep?.spanModel).toBe('google/gemini-3.5-flash');
    expect(verifyStep?.message).toContain('shadow snapshot');
  });
});
