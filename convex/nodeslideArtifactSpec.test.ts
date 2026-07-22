/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { canonicalArtifactFixture } from '../shared/nodeslideArtifactRegistry.fixtures';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import type { NodeSlideGymArtifactEvidenceReceipt } from './lib/nodeslideGymArtifactEvidence';
import { buildBriefNodeSlide } from './lib/nodeslideSeed';
import { gymArtifactEvidence } from './nodeslideArtifactSpec';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const OWNER_ACCESS_KEY = 'a'.repeat(43);
const OTHER_OWNER_ACCESS_KEY = 'b'.repeat(43);
const PROTECTED = 'PROTECTED_ENDPOINT_SECRET';
const NOW = 1_800_000_000_000;

type GymEvidenceHandler = (
  ctx: QueryCtx,
  args: {
    deckId: string;
    ownerAccessKey: string;
    artifactKind: string;
    claimIds: string[];
    sourceIds: string[];
  },
) => Promise<NodeSlideGymArtifactEvidenceReceipt>;

const gymEvidenceHandler = (gymArtifactEvidence as unknown as { _handler: GymEvidenceHandler })
  ._handler;

function buildProtectedFixture() {
  const slides = Array.from({ length: 6 }, (_, index) => ({
    title: `Review ${index + 1}`,
    section: 'Evidence',
    headline: `Decision ${index + 1}`,
    body: 'Keep the decision bounded.',
    bullets: ['Inspect', 'Decide'],
  }));
  slides[0] = {
    ...slides[0],
    artifactSpec: {
      ...canonicalArtifactFixture('chart'),
      id: `artifact-${PROTECTED}`,
      narrativeJob: `Never project ${PROTECTED}.`,
      sourceIds: ['brief:success-criteria'],
      provenance: {
        truthState: 'derived' as const,
        rationale: `Protected rationale ${PROTECTED}.`,
        sourceRefs: ['brief:success-criteria'],
      },
      payload: {
        unit: '%',
        xAxis: { labels: [`${PROTECTED} A`, `${PROTECTED} B`] },
        yAxis: { min: 0, max: 100 },
        series: [{ id: `${PROTECTED}-series`, values: [42, 61] }],
      },
    },
  } as (typeof slides)[number] & { artifactSpec: unknown };
  return buildBriefNodeSlide({
    deckId: 'deck-gym-evidence-endpoint',
    projectId: 'project-gym-evidence-endpoint',
    title: 'Protected endpoint fixture',
    brief: {
      prompt: `Protected brief ${PROTECTED}.`,
      audience: 'Reviewers',
      purpose: 'verify endpoint authorization',
      successCriteria: ['Compare 42 and 61 percent'],
    },
    themeId: 'quiet-precision',
    rawSpec: { title: 'Protected endpoint fixture', narrative: ['Verify'], slides },
    now: NOW,
  });
}

describe('NodeSlide owner-only Gym ArtifactSpec endpoint', () => {
  it('denies another capability, returns redacted evidence, and rejects forged lineage', async () => {
    const t = convexTest(schema, modules);
    const built = buildProtectedFixture();
    const deckId = built.snapshot.deck.id;
    await t.run(async (ctx) => {
      const projectRowId = await ctx.db.insert('projects', {
        clientSessionId: 'gym-evidence-endpoint',
        title: built.snapshot.deck.title,
        domain: 'nodeslide',
        brief: built.snapshot.deck.brief,
        sourceType: 'prompt',
        starred: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await insertNodeSlideSnapshot(ctx as MutationCtx, {
        snapshot: built.snapshot,
        projectRowId,
        clientSessionId: 'gym-evidence-endpoint',
        ownerAccessKey: OWNER_ACCESS_KEY,
        plan: built.plan,
        spec: built.spec,
      });
    });

    const args = {
      deckId,
      ownerAccessKey: OWNER_ACCESS_KEY,
      artifactKind: 'chart',
      claimIds: ['claim:chart'],
      sourceIds: ['brief:success-criteria'],
    };
    await expect(
      t.run((ctx) =>
        gymEvidenceHandler(ctx as QueryCtx, {
          ...args,
          ownerAccessKey: OTHER_OWNER_ACCESS_KEY,
        }),
      ),
    ).rejects.toThrow(/owner access denied/i);

    const unprovenAlias = await t.run((ctx) =>
      gymEvidenceHandler(ctx as QueryCtx, {
        ...args,
        sourceIds: ['caller-selected-unproven-alias'],
      }),
    );
    expect(unprovenAlias).toMatchObject({
      status: 'failed',
      issueCodes: ['gym_source_identity_unproven'],
      userVisible: false,
      mutationApplied: false,
    });

    const receipt = await t.run((ctx) => gymEvidenceHandler(ctx as QueryCtx, args));
    expect(receipt).toMatchObject({
      status: 'passed',
      normalizedSpec: {
        kind: 'chart',
        payload: { series: [{ values: [42, 61] }] },
      },
      userVisible: false,
      mutationApplied: false,
    });
    expect(JSON.stringify(receipt)).not.toContain(PROTECTED);
    expect(JSON.stringify(receipt)).not.toContain(deckId);
    expect(JSON.stringify(receipt)).not.toContain(OWNER_ACCESS_KEY);

    await t.run(async (ctx) => {
      const deck = await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', deckId))
        .first();
      if (!deck) throw new Error('Fixture deck row missing.');
      const forgedSpec = structuredClone(deck.spec) as typeof built.spec;
      const compilation = forgedSpec.slides[0]?.authoredArtifactCompilation;
      if (!compilation) throw new Error('Fixture authored compilation missing.');
      compilation.authoredSpecDigest = `sha256:${'0'.repeat(64)}`;
      await ctx.db.patch(deck._id, { spec: forgedSpec });
    });

    const forged = await t.run((ctx) => gymEvidenceHandler(ctx as QueryCtx, args));
    expect(forged).toMatchObject({
      status: 'failed',
      issueCodes: ['gym_source_receipt_lineage_invalid'],
      userVisible: false,
      mutationApplied: false,
    });
    expect(JSON.stringify(forged)).not.toContain(PROTECTED);
  });
});
