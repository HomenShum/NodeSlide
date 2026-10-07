/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import type { DeckSnapshot } from '../shared/nodeslide';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("keeps a reviewer's supplied chart bound through creation, repeated title commits and reload", async () => {
  vi.stubEnv('NODESLIDE_PUBLIC_CREATION', 'true');
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected provider request'));
  const t = convexTest(schema, modules);
  const created: DeckSnapshot & { ownerAccessKey: string } = await t.action(
    api.nodeslideAgent.createDeckFromBrief,
    {
      clientSessionId: 'canonical-creation-reviewer',
      creationAttemptId: 'canonical-creation-attempt',
      title: 'Synthetic operational readiness',
      brief: {
        prompt:
          'Create a concise six-slide operational readiness review with a clear decision, a small editable chart, and source-safe claims. This is an automated synthetic production probe. Synthetic example: top scorers were Alpha 42 and Beta 61.',
        audience: 'Release reviewer',
        purpose: 'Verify editable synthetic evidence survives title edits',
        successCriteria: ['Keep source-safe claims and explicitly synthetic evidence.'],
      },
      themeId: 'editorial-signal',
      route: 'free',
      providerMode: 'deterministic',
    },
  );
  const access = { deckId: created.deck.id, ownerAccessKey: created.ownerAccessKey };
  const initial = await t.query(api.nodeslideArtifactSpec.shadowCompile, access);
  expect(initial.status).toBe('passed');
  expect(initial.authoredBindingCount).toBeGreaterThan(0);
  expect(initial.canonicalArtifactCount).toBeGreaterThan(0);
  const originalChart = created.elements.find((element) => element.kind === 'chart');
  expect(originalChart?.chart?.series.map((series) => series.values)).toEqual([[42, 61]]);
  expect(originalChart?.authoredArtifactBinding?.truthState).toBe('derived');
  const binding = originalChart?.authoredArtifactBinding;
  expect(binding?.sourceIds).toHaveLength(1);
  expect(created.sources.find((source) => source.id === binding?.sourceIds[0])?.citation).toContain(
    'Synthetic example: top scorers were Alpha 42 and Beta 61.',
  );
  let version = created.deck.version;
  for (let edit = 1; edit <= 3; edit += 1) {
    const title = `Synthetic review ${edit}`;
    const committed = await t.mutation(api.nodeslide.applyPatch, {
      ...access,
      baseDeckVersion: version,
      baseSlideVersions: {},
      baseElementVersions: {},
      scope: { kind: 'deck', deckId: created.deck.id, operationMode: 'unrestricted' },
      operations: [{ op: 'update_deck', properties: { title } }],
      summary: 'Reviewer renames the saved synthetic deck.',
    });
    expect(committed.patch.status).toBe('accepted');
    version += 1;
    const reloaded = await t.query(api.nodeslide.getWorkspace, access);
    expect(reloaded?.deck.title).toBe(title);
    expect(reloaded?.deck.version).toBe(version);
    const chart = reloaded?.elements.find((element) => element.kind === 'chart');
    expect(chart?.chart).toEqual(originalChart?.chart);
    expect(chart?.authoredArtifactBinding).toEqual(binding);
    const receipt = await t.query(api.nodeslideArtifactSpec.shadowCompile, access);
    expect(receipt.status).toBe('passed');
    expect(receipt.authoredBindingCount).toBe(initial.authoredBindingCount);
    expect(receipt.canonicalArtifactCount).toBe(initial.canonicalArtifactCount);
  }
  expect(network).not.toHaveBeenCalled();
}, 45000);
