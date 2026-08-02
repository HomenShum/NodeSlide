/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import type { MutationCtx } from '../_generated/server';
import { createFromBriefInternal } from '../nodeslide';
import schema from '../schema';
import {
  NODESLIDE_CREATION_TRACE_MAX_ELAPSED_MS,
  nodeSlideCreationTraceStartedAt,
} from './nodeslideCreationTraceTiming';
import { deterministicBriefSpec } from './nodeslideSeed';

const COMPLETED_AT = 1_800_000_000_000;
const modules = import.meta.glob('../**/*.ts');

type MutationHandler = (ctx: MutationCtx, args: Record<string, unknown>) => Promise<unknown>;

function handlerOf(fn: unknown): MutationHandler {
  const handler = (fn as { _handler?: MutationHandler })._handler;
  if (!handler) throw new Error('Convex function has no handler.');
  return handler;
}

describe('NodeSlide creation trace timing', () => {
  it('preserves the observed three-and-a-half-minute production run', () => {
    const startedAt = COMPLETED_AT - 211_000;

    expect(nodeSlideCreationTraceStartedAt(startedAt, COMPLETED_AT)).toBe(startedAt);
  });

  it.each([
    ['a future client timestamp', COMPLETED_AT + 1],
    ['a negative timestamp', -1],
    ['a fractional timestamp', COMPLETED_AT - 100.5],
    ['an invalid timestamp', Number.NaN],
  ])('fails closed for %s', (_label, candidate) => {
    expect(nodeSlideCreationTraceStartedAt(candidate, COMPLETED_AT)).toBe(COMPLETED_AT);
  });

  it('bounds a stale timestamp so retries cannot forge an unbounded run time', () => {
    expect(nodeSlideCreationTraceStartedAt(COMPLETED_AT - 3_600_000, COMPLETED_AT)).toBe(
      COMPLETED_AT - NODESLIDE_CREATION_TRACE_MAX_ELAPSED_MS,
    );
  });

  it('persists action-observed elapsed time for a real created deck', async () => {
    const t = convexTest(schema, modules);
    const brief = {
      prompt: 'Create a six-slide operating review with an explicit final decision.',
      audience: 'Operating committee',
      purpose: 'Choose the next operating action',
      successCriteria: ['Name an owner'],
    };
    const startedAt = Date.now() - 211_000;
    const spec = deterministicBriefSpec('Operating review', brief);
    const deckId = 'deck_creation_trace_timing';

    await t.run((ctx: MutationCtx) =>
      handlerOf(createFromBriefInternal)(ctx, {
        deckId,
        projectId: 'project_creation_trace_timing',
        clientSessionId: 'session-creation-trace-timing',
        ownerAccessKey: 'a'.repeat(43),
        title: 'Operating review',
        brief,
        themeId: 'quiet-precision',
        route: 'free',
        plan: spec.slides.map(
          (slide, index) => `${index + 1}. ${slide.section}: ${slide.headline}`,
        ),
        spec,
        traceSummary: 'Created with deterministic proof data.',
        traceStartedAt: startedAt,
      }),
    );
    const trace = await t.run((ctx) =>
      ctx.db
        .query('nodeslide_traces')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
        .unique(),
    );

    expect(trace).not.toBeNull();
    if (!trace) throw new Error('Expected the creation trace row.');
    expect(trace.createdAt).toBe(startedAt);
    expect(trace.completedAt - trace.createdAt).toBeGreaterThanOrEqual(211_000);
    expect(trace.completedAt - trace.createdAt).toBeLessThan(213_000);
  });
});
