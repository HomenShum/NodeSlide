import { describe, expect, it, vi } from 'vitest';
import type { DeckComment, DeckSnapshot, PatchScope, SlideElement } from '../../shared/nodeslide';
import {
  type NodeSlideEditPlanningRequest,
  type NodeSlideEditProvider,
  planNodeSlideEditRouted,
} from './nodeslideEditPlanner';
import { NODESLIDE_ROUTING_EXECUTOR_MODEL } from './nodeslideRoutingPolicy';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_700_000_000_000;

function fixture(): {
  snapshot: DeckSnapshot;
  first: SlideElement;
  second: SlideElement;
  scope: PatchScope;
} {
  const snapshot = buildGoldenNodeSlide('routed-edit-planner-tests', NOW).snapshot;
  const bySlide = new Map<string, SlideElement[]>();
  for (const element of snapshot.elements) {
    if (element.kind !== 'text' || element.locked) continue;
    bySlide.set(element.slideId, [...(bySlide.get(element.slideId) ?? []), element]);
  }
  const pair = [...bySlide.values()].find((elements) => elements.length >= 2);
  if (!pair) throw new Error('Expected a slide with two unlocked text fixtures.');
  const [first, second] = pair as [SlideElement, SlideElement];
  first.content = 'Before one';
  second.content = 'Before two';
  return {
    snapshot,
    first,
    second,
    scope: {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [first.slideId],
      elementIds: [first.id, second.id],
      operationMode: 'copy',
    },
  };
}

function input(
  snapshot: DeckSnapshot,
  elements: readonly SlideElement[],
  scope: PatchScope,
): {
  snapshot: DeckSnapshot;
  scopedComment: DeckComment | null;
  request: NodeSlideEditPlanningRequest;
} {
  const slideId = elements[0]?.slideId;
  const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new Error('Expected target slide fixture.');
  return {
    snapshot,
    scopedComment: null,
    request: {
      deckId: snapshot.deck.id,
      instruction: 'Rewrite both text blocks with sharper copy.',
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: { [slide.id]: slide.version },
      baseElementVersions: Object.fromEntries(
        elements.map((element) => [element.id, element.version]),
      ),
      scope,
      designBehavior: 'preserve' as const,
      referenceUse: 'context_only' as const,
      providerMode: 'openrouter_free' as const,
      providerModel: 'moonshotai/kimi-k3' as const,
      providerEffort: 'high' as const,
    },
  };
}

function plannerValue(first: SlideElement, second: SlideElement, withBriefs: boolean) {
  return {
    summary: 'Rewrite both text blocks.',
    operations: [
      { op: 'replace_text', slideId: first.slideId, elementId: first.id, text: 'Planner one' },
      { op: 'replace_text', slideId: second.slideId, elementId: second.id, text: 'Planner two' },
    ],
    ...(withBriefs
      ? {
          copyBriefs: [
            { slideId: first.slideId, elementId: first.id, brief: 'Punchy opening statement.' },
            { slideId: second.slideId, elementId: second.id, brief: 'Supporting proof point.' },
          ],
        }
      : {}),
  };
}

function telemetry(model: string) {
  return {
    provider: 'openrouter',
    model,
    costMicroUsd: 10,
    inputTokens: 100,
    outputTokens: 50,
  };
}

describe('NodeSlide routed edit planning (B2 orchestrator/worker)', () => {
  it('splits: planner briefs + executor copy merge, and both models are attributed', async () => {
    const { snapshot, first, second, scope } = fixture();
    const provider = vi.fn<NodeSlideEditProvider>(async (args) => {
      if (args.model === NODESLIDE_ROUTING_EXECUTOR_MODEL) {
        expect(args.jsonSchema?.name).toBe('nodeslide_copy_execution');
        expect(args.reasoningEffort).toBe('low');
        expect(args.userText).toContain('Punchy opening statement.');
        return {
          ok: true,
          value: {
            copy: [
              { elementId: first.id, text: 'Executor one' },
              { elementId: second.id, text: 'Executor two' },
            ],
          },
          telemetry: telemetry(NODESLIDE_ROUTING_EXECUTOR_MODEL),
        };
      }
      return {
        ok: true,
        value: plannerValue(first, second, true),
        telemetry: telemetry('moonshotai/kimi-k3'),
      };
    });

    const outcome = await planNodeSlideEditRouted(input(snapshot, [first, second], scope), {
      callProvider: provider,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider.mock.calls[1]?.[0]?.model).toBe(NODESLIDE_ROUTING_EXECUTOR_MODEL);
    expect(outcome.operations.map((op) => (op.op === 'replace_text' ? op.text : ''))).toEqual([
      'Executor one',
      'Executor two',
    ]);
    expect(outcome.routing).toMatchObject({
      task: 'edit_plan',
      plannerModel: 'moonshotai/kimi-k3',
      executorModel: NODESLIDE_ROUTING_EXECUTOR_MODEL,
      reason: 'split_premium_planner_bulk_copy',
      executorOutcome: 'applied',
      executorAppliedOps: 2,
    });
    expect(outcome.routing?.executorTelemetry?.model).toBe(NODESLIDE_ROUTING_EXECUTOR_MODEL);
    expect(outcome.receipt.providerOutcome).toBe('accepted');
  });

  it('executor failure never blocks: the planner copy stands with honest attribution', async () => {
    const { snapshot, first, second, scope } = fixture();
    const provider = vi.fn<NodeSlideEditProvider>(async (args) => {
      if (args.model === NODESLIDE_ROUTING_EXECUTOR_MODEL) {
        throw new Error('executor timeout');
      }
      return {
        ok: true,
        value: plannerValue(first, second, true),
        telemetry: telemetry('moonshotai/kimi-k3'),
      };
    });

    const outcome = await planNodeSlideEditRouted(input(snapshot, [first, second], scope), {
      callProvider: provider,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.operations.map((op) => (op.op === 'replace_text' ? op.text : ''))).toEqual([
      'Planner one',
      'Planner two',
    ]);
    expect(outcome.routing?.executorOutcome).toBe('failed');
    expect(outcome.routing?.executorModel).toBe(NODESLIDE_ROUTING_EXECUTOR_MODEL);
  });

  it('rejects executor copy that names an unlisted element and keeps the planner copy', async () => {
    const { snapshot, first, second, scope } = fixture();
    const provider = vi.fn<NodeSlideEditProvider>(async (args) => {
      if (args.model === NODESLIDE_ROUTING_EXECUTOR_MODEL) {
        return {
          ok: true,
          value: { copy: [{ elementId: 'element-outside-plan', text: 'Hijacked' }] },
          telemetry: telemetry(NODESLIDE_ROUTING_EXECUTOR_MODEL),
        };
      }
      return {
        ok: true,
        value: plannerValue(first, second, true),
        telemetry: telemetry('moonshotai/kimi-k3'),
      };
    });

    const outcome = await planNodeSlideEditRouted(input(snapshot, [first, second], scope), {
      callProvider: provider,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.operations.map((op) => (op.op === 'replace_text' ? op.text : ''))).toEqual([
      'Planner one',
      'Planner two',
    ]);
    expect(outcome.routing?.executorOutcome).toBe('invalid');
  });

  it('does not split when the planner returned no copy briefs', async () => {
    const { snapshot, first, second, scope } = fixture();
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: true,
      value: plannerValue(first, second, false),
      telemetry: telemetry('moonshotai/kimi-k3'),
    }));

    const outcome = await planNodeSlideEditRouted(input(snapshot, [first, second], scope), {
      callProvider: provider,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(provider).toHaveBeenCalledTimes(1);
    expect(outcome.routing?.executorOutcome).toBe('no_briefs');
    expect(outcome.operations.map((op) => (op.op === 'replace_text' ? op.text : ''))).toEqual([
      'Planner one',
      'Planner two',
    ]);
  });

  it('does not split for a non-premium planner model', async () => {
    const { snapshot, first, second, scope } = fixture();
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: true,
      value: plannerValue(first, second, true),
      telemetry: telemetry('z-ai/glm-5.2'),
    }));
    const base = input(snapshot, [first, second], scope);
    const outcome = await planNodeSlideEditRouted(
      { ...base, request: { ...base.request, providerModel: 'z-ai/glm-5.2' as const } },
      { callProvider: provider },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(provider).toHaveBeenCalledTimes(1);
    expect(outcome.routing?.executorModel).toBeNull();
    expect(outcome.routing?.reason).toBe('no_split_planner_not_premium');
  });

  it('does not split below the two-replace_text threshold', async () => {
    const { snapshot, first, second, scope } = fixture();
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: true,
      value: {
        summary: 'Rewrite one block.',
        operations: [
          { op: 'replace_text', slideId: first.slideId, elementId: first.id, text: 'Planner one' },
        ],
        copyBriefs: [
          { slideId: first.slideId, elementId: first.id, brief: 'Punchy opening statement.' },
        ],
      },
      telemetry: telemetry('moonshotai/kimi-k3'),
    }));

    const outcome = await planNodeSlideEditRouted(input(snapshot, [first, second], scope), {
      callProvider: provider,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(provider).toHaveBeenCalledTimes(1);
    expect(outcome.routing?.executorModel).toBeNull();
    expect(outcome.routing?.reason).toBe('no_split_below_copy_threshold');
  });

  it('deterministic requests carry no routing receipt at all', async () => {
    const { snapshot, first, second } = fixture();
    const base = input(snapshot, [first, second], {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [first.slideId],
      elementIds: [first.id],
      operationMode: 'copy',
    });
    const outcome = await planNodeSlideEditRouted(
      {
        ...base,
        request: {
          deckId: base.request.deckId,
          instruction: 'Replace "Before one" with "After one".',
          baseDeckVersion: base.request.baseDeckVersion,
          baseSlideVersions: base.request.baseSlideVersions,
          baseElementVersions: { [first.id]: first.version },
          scope: {
            kind: 'elements',
            deckId: snapshot.deck.id,
            slideIds: [first.slideId],
            elementIds: [first.id],
            operationMode: 'copy',
          },
          designBehavior: 'preserve',
          referenceUse: 'context_only',
          providerMode: 'deterministic',
        },
      },
      { callProvider: vi.fn<NodeSlideEditProvider>() },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.routing).toBeUndefined();
  });
});
