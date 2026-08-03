/// <reference types="vite/client" />

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { contentHash } from '@homenshum/nodekit/caseflow';
import { register as registerNodeKitCaseflow } from '@homenshum/nodekit/test';
import type { NodeSlidePatchCommand } from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot } from '@nodeslide/contracts';
import { createNodeSlideTextPatch } from '@nodeslide/testing';
import { convexTest } from 'convex-test';
import { type FunctionReference, makeFunctionReference } from 'convex/server';
import { describe, expect, it } from 'vitest';
import {
  NODEKIT_CASEFLOW_SOURCE_COMMIT,
  NODEKIT_CASEFLOW_SOURCE_HASH,
  NODEKIT_CASEFLOW_TARBALL_SHA256,
  type NodeSlideCaseflowMutation,
  type NodeSlideCaseflowTransport,
  createNodeSlideCaseflowRuntime,
} from '../src/integrations/nodekit/caseflowAdapter';
import schema from './schema';

const hostModules = import.meta.glob('./**/*.ts');
const NOW = 1_800_000_000_000;

type T = ReturnType<typeof convexTest>;
type AuthenticatedT = ReturnType<T['withIdentity']>;
type WorkspaceResponse = DeckSnapshot & { ownerAccessKey: string };
type PortableArtifact = {
  artifactId: string;
  canonicalVersion: number;
  versions: Array<{ version: number; content: unknown; contentHash: string; proposalId?: string }>;
};
type PortableProposal = {
  proposalId: string;
  status: string;
  patch: unknown;
};
type PortableException = { exceptionId: string; preservedState: unknown };
type PortableCompletion = {
  receipt: {
    receiptId: string;
    receiptHash: string;
    status: 'cancelled' | 'completed' | 'failed_safely';
    artifactBindings: Array<{
      artifactId: string;
      canonicalVersion: number;
      contentHash: string;
    }>;
    approvalBindings: Array<{
      approvalId: string;
      commentHash: string;
      decision: string;
      proposalId: string;
    }>;
    proposalBindings: Array<{
      proposalId: string;
      patchHash: string;
      status: string;
    }>;
    eventBindings: Array<{ actorHash: string; payloadHash: string }>;
    [key: string]: unknown;
  };
  run: { runId: string; status: string; nextActionOwner: string };
  reused: boolean;
};

const operations = [
  'createCase',
  'updateCaseInput',
  'startRun',
  'enterStage',
  'createArtifact',
  'createProposal',
  'decideProposal',
  'raiseException',
  'resolveException',
  'completeRun',
  'cancelRun',
  'failRunSafely',
] as const satisfies readonly NodeSlideCaseflowMutation[];

const mutations = Object.fromEntries(
  operations.map((operation) => [
    operation,
    makeFunctionReference<'mutation'>(`nodekitCaseflow:${operation}`),
  ]),
) as Record<NodeSlideCaseflowMutation, FunctionReference<'mutation'>>;

const refs = {
  ensureWorkspace: makeFunctionReference<'mutation'>('nodeslide:ensureWorkspace'),
  bindDeck: makeFunctionReference<'mutation'>('nodekitCaseflow:bindAuthenticatedDeck'),
  snapshot: makeFunctionReference<'query'>('nodekitCaseflow:snapshot'),
};

function testHost(): T {
  const t = convexTest(schema, hostModules);
  registerNodeKitCaseflow(t, 'nodekitCaseflow');
  return t;
}

function transport(client: AuthenticatedT): NodeSlideCaseflowTransport {
  return {
    mutation: async (operation, args) => client.mutation(mutations[operation], args),
    query: async (_operation, args) => client.query(refs.snapshot, args),
  };
}

async function bootstrapOwner(
  t: T,
  subject: string,
  suffix: string,
): Promise<{
  client: AuthenticatedT;
  deck: WorkspaceResponse;
  scope: { deckId: string; domainArtifactRef: string };
}> {
  const client = t.withIdentity({ subject, name: subject });
  const deck = (await client.mutation(refs.ensureWorkspace, {
    clientSessionId: `nodekit-component-consumer-${suffix}`,
  })) as WorkspaceResponse;
  const binding = (await client.mutation(refs.bindDeck, {
    deckId: deck.deck.id,
    ownerAccessKey: deck.ownerAccessKey,
  })) as { deckId: string; reused: boolean; scopeKey: string };
  expect(binding.deckId).toBe(deck.deck.id);
  expect(binding.scopeKey).toMatch(/^nodeslide_[a-f0-9]{32}$/);
  return {
    client,
    deck,
    scope: {
      deckId: deck.deck.id,
      domainArtifactRef: `nodeslide:deck:${deck.deck.id}`,
    },
  };
}

function receiptBody(receipt: PortableCompletion['receipt']): Record<string, unknown> {
  const { receiptHash: _hash, receiptId: _id, ...body } = receipt;
  return body;
}

describe('NodeSlide installed NodeKit Caseflow component consumer', () => {
  it('derives authority in the host, never persists the bearer, and isolates owners', async () => {
    const t = testHost();
    const owner = await bootstrapOwner(t, 'user:nodeslide-owner', 'owner');
    const repeated = await owner.client.mutation(refs.bindDeck, {
      deckId: owner.deck.deck.id,
      ownerAccessKey: owner.deck.ownerAccessKey,
    });
    expect(repeated).toMatchObject({ reused: true });

    const attacker = t.withIdentity({ subject: 'user:attacker', name: 'Attacker' });
    await expect(attacker.query(refs.snapshot, { deckId: owner.deck.deck.id })).rejects.toThrow(
      'nodeslide_nodekit_owner_scope_mismatch',
    );
    await expect(
      attacker.mutation(refs.bindDeck, {
        deckId: owner.deck.deck.id,
        ownerAccessKey: owner.deck.ownerAccessKey,
      }),
    ).rejects.toThrow('nodeslide_nodekit_deck_already_bound');
    await expect(t.query(refs.snapshot, { deckId: owner.deck.deck.id })).rejects.toThrow(
      'nodeslide_nodekit_unauthenticated',
    );

    const rows = await t.run(async (ctx) => ctx.db.query('nodeslide_nodekit_bindings').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('ownerAccessKey');
    expect(JSON.stringify(rows[0])).not.toContain(owner.deck.ownerAccessKey);
  });

  it('executes a real presentation lifecycle in the installed isolated component', async () => {
    const t = testHost();
    const owner = await bootstrapOwner(t, 'user:deck-reviewer', 'lifecycle');
    const firstPatch = createNodeSlideTextPatch(
      owner.deck,
      'Approved presentation narrative',
      'patch:nodekit-component:first',
    );
    const stalePatch = createNodeSlideTextPatch(
      owner.deck,
      'Stale competing narrative',
      'patch:nodekit-component:stale',
    );
    const generationId = 'run:nodekit-component-deck';
    const validationRef = 'validation:nodekit-component-deck';
    const firstReceiptRef = 'receipt:nodekit-component:first';
    const staleReceiptRef = 'receipt:nodekit-component:stale';
    await seedDomainRows(t, owner.deck, {
      firstPatch,
      firstReceiptRef,
      generationId,
      secondPatch: stalePatch,
      secondReceiptRef: staleReceiptRef,
      validationRef,
    });

    const runtime = createNodeSlideCaseflowRuntime(transport(owner.client), {
      ...owner.scope,
      generationId,
      validationRef,
    });
    const work = await runtime.createCase({
      title: 'Investor update deck',
      primaryJob: 'Move one validated deck patch through human review',
    });
    expect(work.caseId).toMatch(/^case_[a-f0-9]{26}$/);
    expect(
      (
        await runtime.createCase({
          title: 'Ignored duplicate title',
          primaryJob: 'Ignored duplicate job',
        })
      ).caseId,
    ).toBe(work.caseId);
    const updated = await runtime.updateCaseInput({
      caseId: work.caseId,
      primaryJob: 'Produce a verified, review-ready investor presentation',
    });
    expect(updated.primaryJob).toContain('verified');

    const stages = [
      { id: 'intake', label: 'Confirm deck intent', owner: 'user' },
      { id: 'compose', label: 'Compose presentation', owner: 'agent' },
      { id: 'review', label: 'Review deck patch', owner: 'user' },
      { id: 'complete', label: 'Verify deck receipt', owner: 'system' },
    ];
    const run = await runtime.startRun({ caseId: work.caseId, stages });
    expect(run.runId).toMatch(/^run_[a-f0-9]{26}$/);
    expect((await runtime.startRun({ caseId: work.caseId, stages })).runId).toBe(run.runId);
    await expect(
      runtime.startRun({
        caseId: work.caseId,
        stages: [{ id: 'other', label: 'Different plan', owner: 'agent' }],
      }),
    ).rejects.toThrow(/stage plan/);

    const artifactContent = {
      schemaVersion: 'nodeslide.deck-artifact/v1',
      deckId: owner.deck.deck.id,
      deckVersion: owner.deck.deck.version,
      domainArtifactRef: owner.scope.domainArtifactRef,
      generationId,
      slideCount: owner.deck.slides.length,
      title: owner.deck.deck.title,
    };
    const artifact = (await runtime.createArtifact({
      caseId: work.caseId,
      runId: run.runId,
      kind: 'presentation',
      title: owner.deck.deck.title,
      content: artifactContent,
      idempotencyKey: ' deck-artifact-v1 ',
    })) as PortableArtifact;
    const artifactRetry = (await runtime.createArtifact({
      caseId: work.caseId,
      runId: run.runId,
      kind: 'presentation',
      title: owner.deck.deck.title,
      content: artifactContent,
      idempotencyKey: 'deck-artifact-v1',
    })) as PortableArtifact;
    expect(artifactRetry.artifactId).toBe(artifact.artifactId);
    expect(artifact.versions[0]?.content).toEqual(artifactContent);
    await expect(
      runtime.createArtifact({
        caseId: work.caseId,
        runId: run.runId,
        content: { ...artifactContent, slideCount: 999 },
        idempotencyKey: 'deck-artifact-v1',
      }),
    ).rejects.toThrow(/different request/);

    const first = (await runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: firstPatch,
      rationale: 'Validated NodeSlide patch',
      idempotencyKey: 'deck-proposal-first',
    })) as PortableProposal;
    const firstRetry = (await runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: firstPatch,
      rationale: 'Validated NodeSlide patch',
      idempotencyKey: 'deck-proposal-first',
    })) as PortableProposal;
    expect(firstRetry.proposalId).toBe(first.proposalId);
    expect((first.patch as { id: string }).id).toBe(firstPatch.id);
    const stale = (await runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: stalePatch,
      rationale: 'Competing same-base deck patch',
    })) as PortableProposal;

    const accepted = await runtime.decideProposal({
      proposalId: first.proposalId,
      decision: 'accepted',
      comment: 'Human reviewed the deck changes.',
      domainReceiptRef: firstReceiptRef,
    });
    const acceptedRetry = await runtime.decideProposal({
      proposalId: first.proposalId,
      decision: 'accepted',
      comment: 'Human reviewed the deck changes.',
      domainReceiptRef: firstReceiptRef,
    });
    expect(acceptedRetry.reused).toBe(true);
    expect(acceptedRetry.approval.approvalId).toBe(accepted.approval.approvalId);
    const conflicted = await runtime.decideProposal({
      proposalId: stale.proposalId,
      decision: 'accepted',
      domainReceiptRef: staleReceiptRef,
    });
    expect(conflicted.proposal.status).toBe('conflicted');
    expect(conflicted.artifact.canonicalVersion).toBe(2);
    expect(conflicted.artifact.versions.at(-1)?.content).toEqual(first.patch);

    const firstException = (await runtime.raiseException({
      runId: run.runId,
      code: 'deck_validation_attention',
      message: 'Preserve the approved deck while visual QA is reviewed.',
      preservedState: { canonicalVersion: 2, reviewedSlides: 7 },
      idempotencyKey: 'visual-qa-exception',
    })) as PortableException;
    const exceptionRetry = (await runtime.raiseException({
      runId: run.runId,
      code: 'deck_validation_attention',
      message: 'Preserve the approved deck while visual QA is reviewed.',
      preservedState: { canonicalVersion: 2, reviewedSlides: 7 },
      idempotencyKey: 'visual-qa-exception',
    })) as PortableException;
    expect(exceptionRetry.exceptionId).toBe(firstException.exceptionId);
    expect(firstException.preservedState).toMatchObject({
      deckId: owner.deck.deck.id,
      validationRef,
      state: { canonicalVersion: 2, reviewedSlides: 7 },
    });
    const secondException = (await runtime.raiseException({
      runId: run.runId,
      code: 'source_license_attention',
      message: 'Resolve one image license before completion.',
      preservedState: { canonicalVersion: 2 },
    })) as PortableException;
    await expect(runtime.enterStage({ runId: run.runId, stageId: 'complete' })).rejects.toThrow(
      /run is not active: blocked/,
    );
    const partial = await runtime.resolveException({
      exceptionId: firstException.exceptionId,
      resolution: 'Visual QA passed',
      nextAction: 'Resolve image license',
      nextActionOwner: 'user',
    });
    expect(partial.run.status).toBe('blocked');
    const recovered = await runtime.resolveException({
      exceptionId: secondException.exceptionId,
      resolution: 'Licensed source confirmed',
      nextAction: 'Verify completion',
      nextActionOwner: 'system',
    });
    expect(recovered.run.status).toBe('active');
    expect(recovered.run.nextActionOwner).toBe('system');

    await runtime.enterStage({
      runId: run.runId,
      stageId: 'complete',
      idempotencyKey: 'enter-complete',
    });
    const completed = (await runtime.completeRun({ runId: run.runId })) as PortableCompletion;
    expect(completed.receipt.schemaVersion).toBe('nodekit.receipt/v2');
    expect(completed.receipt.status).toBe('completed');
    expect(contentHash(receiptBody(completed.receipt))).toBe(completed.receipt.receiptHash);
    expect(completed.receipt.artifactBindings).toEqual([
      {
        artifactId: artifact.artifactId,
        canonicalVersion: 2,
        contentHash: contentHash(first.patch),
      },
    ]);
    expect(
      completed.receipt.proposalBindings.find((entry) => entry.proposalId === first.proposalId),
    ).toMatchObject({ patchHash: contentHash(first.patch), status: 'accepted' });
    expect(
      completed.receipt.approvalBindings.find(
        (entry) => entry.approvalId === accepted.approval.approvalId,
      ),
    ).toMatchObject({
      commentHash: contentHash(
        `NodeSlide receipt: ${firstReceiptRef} | Human reviewed the deck changes.`,
      ),
      decision: 'accepted',
      proposalId: first.proposalId,
    });
    expect(completed.receipt.eventBindings.length).toBeGreaterThan(0);
    expect(
      completed.receipt.eventBindings.every(
        (event) =>
          /^[a-f0-9]{64}$/.test(event.actorHash) && /^[a-f0-9]{64}$/.test(event.payloadHash),
      ),
    ).toBe(true);

    const reloaded = createNodeSlideCaseflowRuntime(transport(owner.client), {
      ...owner.scope,
      generationId,
      validationRef,
    });
    const snapshot = await reloaded.snapshot();
    expect(snapshot.cases).toHaveLength(1);
    expect(snapshot.runs[0]?.status).toBe('completed');
    expect(snapshot.artifacts[0]?.canonicalVersion).toBe(2);
    expect(snapshot.receipts[0]?.receiptHash).toBe(completed.receipt.receiptHash);
    const repeatedCompletion = (await reloaded.completeRun({
      runId: run.runId,
    })) as PortableCompletion;
    expect(repeatedCompletion.reused).toBe(true);
    expect(repeatedCompletion.receipt).toEqual(completed.receipt);
    await expect(
      reloaded.createProposal({
        artifactId: artifact.artifactId,
        baseVersion: 2,
        patch: firstPatch,
      }),
    ).rejects.toThrow(/run is terminal: completed/);

    const hostRows = await t.run(async (ctx) => ({
      bindings: await ctx.db.query('nodeslide_nodekit_bindings').collect(),
      legacyCaseTables: Object.keys(schema.tables).filter((name) =>
        name.startsWith('nodekitCaseflow'),
      ),
    }));
    expect(hostRows.bindings).toHaveLength(1);
    expect(hostRows.legacyCaseTables).toEqual([]);
  });

  it('receipts cancellation and safe failure while preserving partial deck state', async () => {
    const t = testHost();
    const cancelledOwner = await bootstrapOwner(t, 'user:cancel-owner', 'cancel');
    const cancelledRuntime = createNodeSlideCaseflowRuntime(
      transport(cancelledOwner.client),
      cancelledOwner.scope,
    );
    const cancelledCase = await cancelledRuntime.createCase({
      title: 'Cancelled pitch deck',
      primaryJob: 'Stop before generating an artifact',
    });
    const cancelledRun = await cancelledRuntime.startRun({
      caseId: cancelledCase.caseId,
      stages: [{ id: 'intake', label: 'Confirm intent', owner: 'user' }],
    });
    const cancelled = (await cancelledRuntime.cancelRun({
      runId: cancelledRun.runId,
      reason: 'Presenter withdrew the request',
    })) as PortableCompletion;
    expect(cancelled.receipt.status).toBe('cancelled');
    expect(cancelled.receipt.artifactBindings).toEqual([]);
    expect(
      (
        await cancelledRuntime.cancelRun({
          runId: cancelledRun.runId,
          reason: 'Presenter withdrew the request',
        })
      ).reused,
    ).toBe(true);

    const failedOwner = await bootstrapOwner(t, 'user:failure-owner', 'safe-failure');
    const failedRuntime = createNodeSlideCaseflowRuntime(
      transport(failedOwner.client),
      failedOwner.scope,
    );
    const failedCase = await failedRuntime.createCase({
      title: 'Partially rendered board deck',
      primaryJob: 'Preserve a valid partial deck after renderer failure',
    });
    const failedRun = await failedRuntime.startRun({
      caseId: failedCase.caseId,
      stages: [{ id: 'render', label: 'Render deck', owner: 'agent' }],
    });
    const partial = await failedRuntime.createArtifact({
      caseId: failedCase.caseId,
      runId: failedRun.runId,
      title: 'Partial board deck',
      content: {
        schemaVersion: 'nodeslide.deck-artifact/v1',
        deckId: failedOwner.deck.deck.id,
        completedSlides: 5,
        totalSlides: 8,
      },
    });
    const failed = (await failedRuntime.failRunSafely({
      runId: failedRun.runId,
      reason: 'Renderer unavailable after slide 5',
    })) as PortableCompletion;
    expect(failed.receipt.status).toBe('failed_safely');
    expect(failed.receipt.artifactBindings[0]?.artifactId).toBe(partial.artifactId);
    expect(contentHash(receiptBody(failed.receipt))).toBe(failed.receipt.receiptHash);
  });

  it('binds the runtime constants to the exact vendored package bytes and source identity', () => {
    const provenance = JSON.parse(
      readFileSync(
        new URL('../vendor/homenshum-nodekit-0.2.1.provenance.json', import.meta.url),
        'utf8',
      ),
    ) as {
      package: string;
      sourceCommit: string;
      sourceHash: string;
      tarball: { path: string; sha256: string };
      version: string;
    };
    const tarballBytes = readFileSync(new URL(`../${provenance.tarball.path}`, import.meta.url));
    expect(provenance.package).toBe('@homenshum/nodekit');
    expect(provenance.version).toBe('0.2.1');
    expect(provenance.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(provenance.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(NODEKIT_CASEFLOW_SOURCE_COMMIT).toBe(provenance.sourceCommit);
    expect(NODEKIT_CASEFLOW_SOURCE_HASH).toBe(provenance.sourceHash);
    expect(NODEKIT_CASEFLOW_TARBALL_SHA256).toBe(provenance.tarball.sha256);
    expect(createHash('sha256').update(tarballBytes).digest('hex')).toBe(provenance.tarball.sha256);
  });
});

async function seedDomainRows(
  t: T,
  deck: WorkspaceResponse,
  input: {
    firstPatch: NodeSlidePatchCommand;
    firstReceiptRef: string;
    generationId: string;
    secondPatch: NodeSlidePatchCommand;
    secondReceiptRef: string;
    validationRef: string;
  },
) {
  await t.run(async (ctx) => {
    for (const patch of [input.firstPatch, input.secondPatch]) {
      const persisted: DeckPatch = {
        ...patch,
        status: 'ready',
        createdAt: NOW,
        updatedAt: NOW,
      };
      await ctx.db.insert('nodeslide_patches', persisted);
    }
    await ctx.db.insert('nodeslide_agent_runs', {
      id: input.generationId,
      deckId: deck.deck.id,
      ownerDigest: 'sha256:nodekit-component-consumer',
      idempotencyKey: 'nodekit-component-consumer-generation',
      instruction: 'Compose one reviewable presentation update.',
      status: 'awaiting_review',
      provider: 'deterministic',
      model: 'nodekit-component-consumer/v2',
      webResearch: false,
      attempt: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert('nodeslide_validations', {
      id: input.validationRef,
      deckId: deck.deck.id,
      deckVersion: deck.deck.version,
      ok: true,
      publishOk: true,
      cleanOk: true,
      issues: [],
      checkedAt: NOW,
      toolchainVersion: deck.deck.toolchainVersion,
    });
    for (const [receiptId, patch] of [
      [input.firstReceiptRef, input.firstPatch],
      [input.secondReceiptRef, input.secondPatch],
    ] as const) {
      await ctx.db.insert('nodeslide_package_receipts', {
        receiptId,
        deckId: deck.deck.id,
        patchId: patch.id,
        principalId: 'user:deck-reviewer',
        receipt: {
          id: receiptId,
          deckId: deck.deck.id,
          deckVersion: deck.deck.version + 1,
          patchId: patch.id,
          operation: 'proposal.accepted',
          recordedAt: NOW,
        },
        recordedAt: NOW,
      });
    }
  });
}
