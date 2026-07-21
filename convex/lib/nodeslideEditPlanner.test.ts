import { describe, expect, it, vi } from 'vitest';
import type { DeckComment, DeckSnapshot, PatchScope, SlideElement } from '../../shared/nodeslide';
import {
  type NodeSlideEditPlanningRequest,
  type NodeSlideEditProvider,
  nodeSlideRepairStepMessage,
  nodeSlideVerifyStepMessage,
  planNodeSlideEdit,
  verifyNodeSlideEditCandidate,
} from './nodeslideEditPlanner';
import { NODESLIDE_EDIT_MODEL, NODESLIDE_EDIT_PROVIDER } from './nodeslideProvider';
import { buildGoldenNodeSlide } from './nodeslideSeed';

const NOW = 1_700_000_000_000;

function fixture(): {
  snapshot: DeckSnapshot;
  target: SlideElement;
  scope: PatchScope;
} {
  const snapshot = buildGoldenNodeSlide('edit-planner-tests', NOW).snapshot;
  const target = snapshot.elements.find((element) => element.kind === 'text' && !element.locked);
  if (!target) throw new Error('Expected an unlocked text fixture.');
  target.content = 'Before';
  return {
    snapshot,
    target,
    scope: {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [target.slideId],
      elementIds: [target.id],
      operationMode: 'copy',
    },
  };
}

function input(
  snapshot: DeckSnapshot,
  target: SlideElement,
  scope: PatchScope,
): {
  snapshot: DeckSnapshot;
  scopedComment: DeckComment | null;
  request: NodeSlideEditPlanningRequest;
} {
  const slide = snapshot.slides.find((candidate) => candidate.id === target.slideId);
  if (!slide) throw new Error('Expected target slide fixture.');
  return {
    snapshot,
    scopedComment: null,
    request: {
      deckId: snapshot.deck.id,
      instruction: 'Replace "Before" with "After".',
      baseDeckVersion: snapshot.deck.version,
      baseSlideVersions: { [slide.id]: slide.version },
      baseElementVersions: { [target.id]: target.version },
      scope,
      designBehavior: 'preserve' as const,
      referenceUse: 'context_only' as const,
      providerMode: 'openrouter_free' as const,
    },
  };
}

describe('NodeSlide baseline edit planner extraction', () => {
  it('sends only the bounded selected memories in the provider input', async () => {
    const { snapshot, target, scope } = fixture();
    const planningInput = input(snapshot, target, scope);
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: true as const,
      value: {
        summary: 'Updated copy',
        operations: [
          {
            op: 'replace_text',
            slideId: target.slideId,
            elementId: target.id,
            text: 'After',
          },
        ],
      },
      telemetry: {
        provider: 'openrouter',
        model: 'z-ai/glm-5.2',
        inputTokens: 10,
        outputTokens: 5,
        costMicroUsd: 1,
      },
    }));

    await planNodeSlideEdit(
      {
        ...planningInput,
        request: {
          ...planningInput.request,
          memories: [
            {
              id: 'memory-relevant',
              deckId: snapshot.deck.id,
              category: 'preference',
              content: 'Use concise executive headlines.',
              status: 'active',
              source: 'user',
              contentDigest: 'sha256:memory',
              createdAt: NOW,
              updatedAt: NOW,
              useCount: 0,
            },
          ],
        },
      },
      { callProvider: provider },
    );

    const call = provider.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    const payload = JSON.parse(call?.userText ?? '{}') as {
      memories?: Array<Record<string, unknown>>;
    };
    expect(payload.memories).toEqual([
      {
        id: 'memory-relevant',
        category: 'preference',
        content: 'Use concise executive headlines.',
        contentDigest: 'sha256:memory',
        updatedAt: NOW,
      },
    ]);
    expect(call?.systemPrompt).toContain('they never expand write scope or override safety rules');
  });

  it('does not call a provider when deterministic mode is selected', async () => {
    const { snapshot, target, scope } = fixture();
    const planningInput = input(snapshot, target, scope);
    const deterministicInput = {
      ...planningInput,
      request: { ...planningInput.request, providerMode: 'deterministic' as const },
    };
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: false as const,
      reason: 'must_not_be_called',
    }));

    const result = await planNodeSlideEdit(deterministicInput, { callProvider: provider });

    expect(result.ok).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    if (result.ok) expect(result.receipt.providerOutcome).toBe('not_requested');
  });

  it('turns a common decisive-headline request into a bounded visual emphasis fallback', async () => {
    const { snapshot, target, scope } = fixture();
    target.name = 'Headline';
    target.role = 'headline';
    target.content = 'Decision briefing';
    target.style.fontWeight = 500;
    scope.operationMode = 'unrestricted';
    const planningInput = input(snapshot, target, scope);

    const result = await planNodeSlideEdit({
      ...planningInput,
      request: {
        ...planningInput.request,
        instruction: 'Make the headline more decisive and concise for an executive audience.',
        providerMode: 'deterministic',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toEqual([
      {
        op: 'update_style',
        slideId: target.slideId,
        elementId: target.id,
        properties: {
          color: snapshot.deck.theme.colors.accent,
          fontWeight: 700,
        },
      },
    ]);
  });

  it('keeps a repeated decisive-headline fallback non-empty after prior emphasis', async () => {
    const { snapshot, target, scope } = fixture();
    target.name = 'Headline';
    target.role = 'headline';
    target.content = 'Decision briefing';
    target.style.color = snapshot.deck.theme.colors.accent;
    target.style.fontWeight = 700;
    scope.operationMode = 'unrestricted';
    const planningInput = input(snapshot, target, scope);

    const result = await planNodeSlideEdit({
      ...planningInput,
      request: {
        ...planningInput.request,
        instruction: 'Make the headline more decisive and concise for an executive audience.',
        providerMode: 'deterministic',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toMatchObject([
      {
        op: 'update_style',
        elementId: target.id,
        properties: { fontWeight: 750 },
      },
    ]);
  });

  it('plans a deterministic exact-copy edit from a slide-anchored comment', async () => {
    const { snapshot, target } = fixture();
    const headline = snapshot.elements.find(
      (element) =>
        element.slideId === target.slideId &&
        (element.role === 'headline' || element.role === 'title') &&
        !element.locked,
    );
    if (!headline) throw new Error('Fixture needs an editable headline.');
    const slideElements = snapshot.elements.filter((element) => element.slideId === target.slideId);
    const comment: DeckComment = {
      id: 'comment-slide-scope',
      deckId: snapshot.deck.id,
      anchor: { type: 'slide', deckId: snapshot.deck.id, slideId: target.slideId },
      authorId: 'reviewer',
      authorName: 'Reviewer',
      text: 'Make the headline more decisive.',
      status: 'open',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const scope: PatchScope = {
      kind: 'comment',
      deckId: snapshot.deck.id,
      slideIds: [target.slideId],
      elementIds: slideElements.map((element) => element.id),
      commentId: comment.id,
      operationMode: 'copy',
    };
    const planningInput = input(snapshot, headline, scope);

    const result = await planNodeSlideEdit({
      ...planningInput,
      scopedComment: comment,
      request: {
        ...planningInput.request,
        providerMode: 'deterministic',
        instruction: 'Set the headline copy exactly to "Launch-ready decisions stay reviewable".',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toEqual([
      {
        op: 'replace_text',
        slideId: headline.slideId,
        elementId: headline.id,
        text: 'Launch-ready decisions stay reviewable',
      },
    ]);
  });

  it('accepts valid provider operations and derives its summary from the validated diff', async () => {
    const { snapshot, target, scope } = fixture();
    const before = structuredClone(snapshot);
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: true as const,
      value: {
        summary: 'UNTRUSTED_PROVIDER_PROSE',
        operations: [
          {
            op: 'replace_text',
            slideId: target.slideId,
            elementId: target.id,
            text: 'Provider replacement',
          },
        ],
      },
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_EDIT_MODEL,
        costMicroUsd: 0,
        inputTokens: 100,
        outputTokens: 20,
      },
    }));

    const result = await planNodeSlideEdit(input(snapshot, target, scope), {
      callProvider: provider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.origin).toBe('free_route');
    expect(result.receipt.providerOutcome).toBe('accepted');
    expect(result.operations).toEqual([
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'Provider replacement',
      },
    ]);
    expect(result.summary).toContain('Rewrite');
    expect(JSON.stringify(result)).not.toContain('UNTRUSTED_PROVIDER_PROSE');
    const providerSchema = JSON.stringify(provider.mock.calls[0]?.[0].jsonSchema?.schema);
    expect(providerSchema).toContain(target.slideId);
    expect(providerSchema).toContain(target.id);
    expect(providerSchema).not.toContain('"const":"move"');
    expect(providerSchema).not.toContain('"const":"update_style"');
    expect(providerSchema).not.toContain(
      snapshot.elements.find((element) => element.locked)?.id ?? 'missing-locked-element',
    );
    expect(provider.mock.calls[0]?.[0].model).toBe(NODESLIDE_EDIT_MODEL);
    expect(snapshot).toEqual(before);
  });

  it('passes the user-selected catalog model to the pi-ai provider boundary', async () => {
    const { snapshot, target, scope } = fixture();
    const planningInput = input(snapshot, target, scope);
    planningInput.request.providerModel = 'google/gemini-3.5-flash';
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: true,
      value: {
        summary: 'Data-aware rewrite',
        operations: [
          {
            op: 'replace_text',
            slideId: target.slideId,
            elementId: target.id,
            text: 'After',
          },
        ],
      },
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: 'google/gemini-3.5-flash',
        costMicroUsd: 900,
        inputTokens: 80,
        outputTokens: 20,
      },
    }));

    const result = await planNodeSlideEdit(planningInput, { callProvider: provider });

    expect(result.ok).toBe(true);
    expect(provider.mock.calls[0]?.[0].model).toBe('google/gemini-3.5-flash');
    if (result.ok) {
      expect(result.receipt.providerTelemetry?.model).toBe('google/gemini-3.5-flash');
    }
  });

  it('binds source-grounded replacement copy only to authorized read-context sources', async () => {
    const { snapshot, target, scope } = fixture();
    const source = snapshot.sources[0];
    const slide = snapshot.slides.find((candidate) => candidate.id === target.slideId);
    if (!source || !slide) throw new Error('Expected source and slide fixtures.');
    const planningInput = {
      ...input(snapshot, target, scope),
      readContext: {
        references: [{ id: source.id, kind: 'source' as const, label: source.title }],
        slides: [slide],
        elements: [target],
        sources: [source],
        comments: [],
      },
    };
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: true,
      value: {
        summary: 'Grounded rewrite',
        operations: [
          {
            op: 'replace_text',
            slideId: target.slideId,
            elementId: target.id,
            text: 'Provider replacement grounded in the uploaded file.',
            sourceIds: [source.id],
          },
        ],
      },
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_EDIT_MODEL,
        costMicroUsd: 1200,
        inputTokens: 100,
        outputTokens: 20,
      },
    }));

    const result = await planNodeSlideEdit(planningInput, { callProvider: provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toEqual([
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'Provider replacement grounded in the uploaded file.',
        sourceIds: [source.id],
      },
    ]);
    expect(JSON.stringify(provider.mock.calls[0]?.[0].jsonSchema?.schema)).toContain(source.id);
  });

  it('keeps an authorized matching web snapshot bound through deterministic fallback', async () => {
    const { snapshot, target, scope } = fixture();
    const slide = snapshot.slides.find((candidate) => candidate.id === target.slideId);
    if (!slide) throw new Error('Expected slide fixture.');
    const source = {
      ...snapshot.sources[0],
      id: 'source-openai-responses',
      title: 'Migrate to the Responses API',
      citation: 'OpenAI recommends the Responses API for all new projects.',
      format: 'web' as const,
      provider: 'linkup',
      snapshot: {
        kind: 'search_excerpt' as const,
        capturedAt: NOW,
        text: 'OpenAI recommends the Responses API for all new projects.',
        contentDigest: 'sha256:responses-api',
      },
    };
    const planningInput = {
      ...input(snapshot, target, scope),
      readContext: {
        references: [{ id: source.id, kind: 'source' as const, label: source.title }],
        slides: [slide],
        elements: [target],
        sources: [source],
        comments: [],
      },
    };
    planningInput.request.providerMode = 'deterministic';
    planningInput.request.instruction =
      'Replace the selected text exactly with "OpenAI recommends the Responses API for new projects." Cite the retrieved source.';

    const result = await planNodeSlideEdit(planningInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toEqual([
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'OpenAI recommends the Responses API for new projects.',
        sourceIds: [source.id],
      },
    ]);
  });

  it('does not bind a deterministic fallback to a weakly related source', async () => {
    const { snapshot, target, scope } = fixture();
    const slide = snapshot.slides.find((candidate) => candidate.id === target.slideId);
    const source = snapshot.sources[0];
    if (!slide || !source) throw new Error('Expected source and slide fixtures.');
    const planningInput = {
      ...input(snapshot, target, scope),
      readContext: {
        references: [{ id: source.id, kind: 'source' as const, label: source.title }],
        slides: [slide],
        elements: [target],
        sources: [source],
        comments: [],
      },
    };
    planningInput.request.providerMode = 'deterministic';
    planningInput.request.instruction =
      'Replace the selected text exactly with "OpenAI recommends the Responses API for new projects." Cite the retrieved source.';

    const result = await planNodeSlideEdit(planningInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations[0]).not.toHaveProperty('sourceIds');
  });

  it('accepts a typed chart update only when its data source is in bounded read context', async () => {
    const { snapshot } = fixture();
    const chart = snapshot.elements.find((element) => element.kind === 'chart' && element.chart);
    const source = snapshot.sources[0];
    if (!chart || !source) throw new Error('Expected chart and source fixtures.');
    const slide = snapshot.slides.find((candidate) => candidate.id === chart.slideId);
    if (!slide) throw new Error('Expected chart slide fixture.');
    const scope: PatchScope = {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [chart.slideId],
      elementIds: [chart.id],
      operationMode: 'unrestricted',
    };
    const planningInput = {
      ...input(snapshot, chart, scope),
      readContext: {
        references: [{ id: source.id, kind: 'source' as const, label: source.title }],
        slides: [slide],
        elements: [chart],
        sources: [source],
        comments: [],
      },
    };
    planningInput.request.instruction = 'Update this chart from the supplied source.';
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: true,
      value: {
        summary: 'Updated chart data',
        operations: [
          {
            op: 'update_chart',
            slideId: chart.slideId,
            elementId: chart.id,
            chart: {
              chartType: 'line',
              labels: ['2022', '2026'],
              series: [{ name: 'Teams', values: [32, 48] }],
              unit: 'teams',
              sourceId: source.id,
            },
          },
        ],
      },
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_EDIT_MODEL,
        costMicroUsd: 1200,
        inputTokens: 100,
        outputTokens: 20,
      },
    }));

    const result = await planNodeSlideEdit(planningInput, { callProvider: provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.origin).toBe('free_route');
    expect(result.operations).toEqual([
      {
        op: 'update_chart',
        slideId: chart.slideId,
        elementId: chart.id,
        chart: {
          chartType: 'line',
          labels: ['2022', '2026'],
          series: [{ name: 'Teams', values: [32, 48] }],
          unit: 'teams',
          sourceId: source.id,
        },
      },
    ]);
    expect(JSON.stringify(provider.mock.calls[0]?.[0].jsonSchema?.schema)).toContain(source.id);
  });

  it('rejects provider source bindings outside the authorized read context', async () => {
    const { snapshot, target, scope } = fixture();
    const result = await planNodeSlideEdit(input(snapshot, target, scope), {
      callProvider: async () => ({
        ok: true,
        value: {
          summary: 'Untrusted provenance',
          operations: [
            {
              op: 'replace_text',
              slideId: target.slideId,
              elementId: target.id,
              text: 'Provider replacement',
              sourceIds: ['source-outside-read-context'],
            },
          ],
        },
        telemetry: {
          provider: NODESLIDE_EDIT_PROVIDER,
          model: NODESLIDE_EDIT_MODEL,
          costMicroUsd: 1200,
          inputTokens: 100,
          outputTokens: 20,
        },
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.origin).toBe('deterministic_fallback');
    expect(result.receipt.providerOutcome).toBe('invalid');
    expect(result.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceIds: ['source-outside-read-context'] }),
      ]),
    );
  });

  it('falls back when an otherwise valid provider envelope targets outside scope', async () => {
    const { snapshot, target, scope } = fixture();
    const other = snapshot.elements.find((element) => element.id !== target.id && !element.locked);
    if (!other) throw new Error('Expected another element fixture.');
    const provider = vi.fn(async () => ({
      ok: true as const,
      value: {
        operations: [
          {
            op: 'move',
            slideId: other.slideId,
            elementId: other.id,
            x: 0.1,
            y: 0.1,
          },
        ],
      },
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_EDIT_MODEL,
        costMicroUsd: 0,
        inputTokens: 100,
        outputTokens: 20,
      },
    }));

    const result = await planNodeSlideEdit(input(snapshot, target, scope), {
      callProvider: provider,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.origin).toBe('deterministic_fallback');
    expect(result.receipt.providerOutcome).toBe('invalid');
    expect(result.receipt.fallbackReason).toContain('candidate validation rejected');
    expect(result.operations).toEqual([
      {
        op: 'replace_text',
        slideId: target.slideId,
        elementId: target.id,
        text: 'After',
      },
    ]);
  });

  it('retains provider telemetry when a failed route supplies it', async () => {
    const { snapshot, target, scope } = fixture();
    const telemetry = {
      provider: NODESLIDE_EDIT_PROVIDER,
      model: NODESLIDE_EDIT_MODEL,
      costMicroUsd: 0,
      inputTokens: 100,
      outputTokens: 20,
    };
    const result = await planNodeSlideEdit(input(snapshot, target, scope), {
      callProvider: async () => ({
        ok: false,
        reason: 'The GLM 5.2 route returned invalid JSON after one repair attempt.',
        telemetry,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.origin).toBe('deterministic_fallback');
    expect(result.receipt.providerOutcome).toBe('failed');
    expect(result.receipt.providerTelemetry).toEqual(telemetry);
  });

  it('recovers an invalid GLM envelope with a validated focused whole-slide rewrite', async () => {
    const { snapshot, target } = fixture();
    const focusedSlide = snapshot.slides.find((slide) => slide.id === target.slideId);
    if (!focusedSlide) throw new Error('Expected a focused slide fixture.');
    const scope: PatchScope = {
      kind: 'deck',
      deckId: snapshot.deck.id,
      operationMode: 'unrestricted',
    };
    const planningInput = input(snapshot, target, scope);
    planningInput.request.instruction = 'What if I wanted to make the entire slide aout AI agents?';
    planningInput.request.focusSlideId = focusedSlide.id;
    planningInput.request.baseSlideVersions = Object.fromEntries(
      snapshot.slides.map((slide) => [slide.id, slide.version]),
    );
    planningInput.request.baseElementVersions = Object.fromEntries(
      snapshot.elements.map((element) => [element.id, element.version]),
    );

    const result = await planNodeSlideEdit(planningInput, {
      callProvider: async () => ({
        ok: true,
        value: { summary: 'invalid', operations: [{ op: 'invented_operation' }] },
        telemetry: {
          provider: NODESLIDE_EDIT_PROVIDER,
          model: NODESLIDE_EDIT_MODEL,
          costMicroUsd: 24,
          inputTokens: 120,
          outputTokens: 30,
        },
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt).toMatchObject({
      adapterVersion: '1.1.0',
      origin: 'deterministic_fallback',
      providerOutcome: 'invalid',
      terminalOutcome: 'completed',
      providerTelemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: NODESLIDE_EDIT_MODEL,
      },
    });
    expect(result.operations.length).toBeGreaterThanOrEqual(4);
    expect(
      result.operations.every(
        (operation) => operation.op === 'replace_text' && operation.slideId === focusedSlide.id,
      ),
    ).toBe(true);
    expect(result.summary).toMatch(/^Rewrite editable copy on .+ · \d+ changes$/);
  });

  it('preserves the public fallback-unavailable mapping for unsupported intent', async () => {
    const { snapshot, target, scope } = fixture();
    scope.operationMode = 'unrestricted';
    const planningInput = input(snapshot, target, scope);
    planningInput.request.instruction = 'Improve it somehow.';
    const result = await planNodeSlideEdit(planningInput, {
      callProvider: async () => ({ ok: false, reason: 'The GLM 5.2 route was unavailable.' }),
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'fallback_unavailable',
      receipt: {
        origin: 'deterministic_fallback',
        providerOutcome: 'failed',
        terminalOutcome: 'fallback_unavailable',
      },
    });
    if (result.ok) return;
    expect(result.message).toContain('could not safely infer');
  });
});

describe('NodeSlide edit shadow verification + bounded repair (B4)', () => {
  function overflowFixture() {
    const { snapshot, target, scope } = fixture();
    // A tiny box (192x36px on the 1600x900 raster) that fits "Before" but
    // overflows on any long replacement copy.
    target.bbox = { x: 0.05, y: 0.05, width: 0.12, height: 0.04 };
    const planningInput = input(snapshot, target, scope);
    const longText = 'lorem ipsum dolor sit amet '.repeat(60).trim();
    const overflowingOps = [
      {
        op: 'replace_text' as const,
        slideId: target.slideId,
        elementId: target.id,
        text: longText,
      },
    ];
    const cleanOps = [
      {
        op: 'replace_text' as const,
        slideId: target.slideId,
        elementId: target.id,
        text: 'Short.',
      },
    ];
    return { snapshot, target, planningInput, overflowingOps, cleanOps, longText };
  }

  it('runs ONE repair call when the shadow apply introduces geometry issues and adopts a strictly better revision', async () => {
    const { planningInput, overflowingOps, cleanOps } = overflowFixture();
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: true as const,
      value: { summary: 'Repaired copy', operations: cleanOps },
      telemetry: {
        provider: 'openrouter',
        model: 'z-ai/glm-5.2',
        inputTokens: 20,
        outputTokens: 10,
        costMicroUsd: 2,
      },
    }));

    const verified = await verifyNodeSlideEditCandidate(
      { ...planningInput, operations: overflowingOps, summary: 'Overflowing copy' },
      { callProvider: provider },
    );

    expect(provider).toHaveBeenCalledTimes(1);
    const call = provider.mock.calls[0]?.[0];
    expect(call?.systemPrompt).toContain('REPAIR PASS');
    expect(call?.jsonSchema?.name).toBe('nodeslide_edit_patch_repair');
    expect(verified.verification.issueCount).toBeGreaterThan(0);
    expect(verified.verification.repair).toMatchObject({
      outcome: 'adopted',
      operationCount: 1,
      residualIssueCount: 0,
    });
    expect(verified.operations[0]).toMatchObject({ op: 'replace_text', text: 'Short.' });
    expect(nodeSlideVerifyStepMessage(verified.verification)).toContain('repairing');
    const repair = verified.verification.repair;
    if (!repair) throw new Error('Expected a repair receipt.');
    expect(nodeSlideRepairStepMessage(repair, 'GLM 5.2')).toContain('revised 1 operation');
  });

  it('keeps the planner operations when the repair revision is not strictly better', async () => {
    const { planningInput, overflowingOps, longText } = overflowFixture();
    const provider = vi.fn<NodeSlideEditProvider>(async () => ({
      ok: true as const,
      value: { summary: 'Still overflowing', operations: overflowingOps },
      telemetry: {
        provider: 'openrouter',
        model: 'z-ai/glm-5.2',
        inputTokens: 20,
        outputTokens: 10,
        costMicroUsd: 2,
      },
    }));

    const verified = await verifyNodeSlideEditCandidate(
      { ...planningInput, operations: overflowingOps, summary: 'Overflowing copy' },
      { callProvider: provider },
    );

    expect(verified.verification.repair?.outcome).toBe('not_better');
    expect(verified.operations[0]).toMatchObject({ text: longText });
    expect(verified.summary).toBe('Overflowing copy');
  });

  it('skips the repair call entirely when the shadow snapshot is clean', async () => {
    const { planningInput, cleanOps } = overflowFixture();
    const provider = vi.fn<NodeSlideEditProvider>(async () => {
      throw new Error('The verify lane must not call the provider on a clean candidate.');
    });

    const verified = await verifyNodeSlideEditCandidate(
      { ...planningInput, operations: cleanOps, summary: 'Clean copy' },
      { callProvider: provider },
    );

    expect(provider).not.toHaveBeenCalled();
    expect(verified.verification).toEqual({ issueCount: 0, issues: [] });
    expect(nodeSlideVerifyStepMessage(verified.verification)).toContain('clean');
    expect(verified.operations).toBe(cleanOps);
  });

  it('reports issues without a repair call on the deterministic route', async () => {
    const { planningInput, overflowingOps } = overflowFixture();
    const provider = vi.fn<NodeSlideEditProvider>(async () => {
      throw new Error('The deterministic route has no provider lane.');
    });

    const verified = await verifyNodeSlideEditCandidate(
      {
        ...planningInput,
        request: { ...planningInput.request, providerMode: 'deterministic' as const },
        operations: overflowingOps,
        summary: 'Overflowing copy',
      },
      { callProvider: provider },
    );

    expect(provider).not.toHaveBeenCalled();
    expect(verified.verification.issueCount).toBeGreaterThan(0);
    expect(verified.verification.repair).toBeUndefined();
    expect(nodeSlideVerifyStepMessage(verified.verification)).toContain('noted for review');
    expect(verified.operations).toBe(overflowingOps);
  });
});
