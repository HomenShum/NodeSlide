/// <reference types="vite/client" />

import { contentHash } from '@homenshum/nodekit/caseflow';
import type { NodeSlidePatchCommand } from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot } from '@nodeslide/contracts';
import { createNodeSlideTextPatch } from '@nodeslide/testing';
import { convexTest } from 'convex-test';
import { type FunctionReference, makeFunctionReference } from 'convex/server';
import { describe, expect, it } from 'vitest';
import {
  NODEKIT_CASEFLOW_SOURCE_COMMIT,
  type NodeSlideCaseflowMutation,
  type NodeSlideCaseflowTransport,
  createNodeSlideCaseflowRuntime,
  runNodeSlideCaseflowConformance,
} from '../src/integrations/nodekit/caseflowAdapter';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const NOW = 1_800_000_000_000;

type T = ReturnType<typeof convexTest>;
type AuthenticatedT = ReturnType<T['withIdentity']>;
type WorkspaceResponse = DeckSnapshot & { ownerAccessKey: string };
type PortableRun = { runId: string; status: string; nextActionOwner: string };
type PortableArtifact = {
  artifactId: string;
  canonicalVersion: number;
  versions: Array<{ version: number; content: unknown; contentHash: string; proposalId?: string }>;
};
type PortableProposal = { proposalId: string; status: string; patchId?: string };
type PortableDecision = {
  approval: { approvalId: string; domainReceiptRef?: string };
  artifact: PortableArtifact;
  proposal: PortableProposal;
  reused: boolean;
};
type PortableException = { exceptionId: string; preservedState: unknown; validationRef?: string };
type PortableCompletion = {
  receipt: {
    receiptId: string;
    receiptHash: string;
    applicationRefs: {
      deckIds: string[];
      domainArtifactRefs: string[];
      domainReceiptRefs: string[];
      generationIds: string[];
      patchIds: string[];
      validationRefs: string[];
    };
    [key: string]: unknown;
  };
  run: PortableRun;
  reused: boolean;
};

const mutations = Object.fromEntries(
  (
    [
      'createCase',
      'startRun',
      'enterStage',
      'createArtifact',
      'createProposal',
      'decideProposal',
      'raiseException',
      'resolveException',
      'completeRun',
    ] satisfies NodeSlideCaseflowMutation[]
  ).map((operation) => [
    operation,
    makeFunctionReference<'mutation'>(`nodekitCaseflow:${operation}`),
  ]),
) as Record<NodeSlideCaseflowMutation, FunctionReference<'mutation'>>;

const refs = {
  ensureNodeSlideWorkspace: makeFunctionReference<'mutation'>('nodeslide:ensureWorkspace'),
  ensureCaseflowWorkspace: makeFunctionReference<'mutation'>('nodekitCaseflow:ensureWorkspace'),
  bootstrapDeck: makeFunctionReference<'mutation'>('nodekitCaseflow:bootstrapPreviewDeckBinding'),
  snapshot: makeFunctionReference<'query'>('nodekitCaseflow:snapshot'),
};

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
  scope: { workspaceId: string; deckId: string; domainArtifactRef: string };
}> {
  const client = t.withIdentity({ subject, name: subject });
  const deck = (await client.mutation(refs.ensureNodeSlideWorkspace, {
    clientSessionId: `nodekit-consumer-${suffix}`,
  })) as WorkspaceResponse;
  const workspace = (await client.mutation(refs.ensureCaseflowWorkspace, {
    slug: `workspace-${suffix}`,
  })) as { workspaceId: string; reused: boolean };
  await client.mutation(refs.bootstrapDeck, {
    workspaceId: workspace.workspaceId,
    deckId: deck.deck.id,
    ownerAccessKey: deck.ownerAccessKey,
  });
  return {
    client,
    deck,
    scope: {
      workspaceId: workspace.workspaceId,
      deckId: deck.deck.id,
      domainArtifactRef: `nodeslide:deck:${deck.deck.id}`,
    },
  };
}

function receiptBody(receipt: PortableCompletion['receipt']): Record<string, unknown> {
  const { receiptHash: _hash, receiptId: _id, ...body } = receipt;
  return body;
}

describe('NodeSlide authenticated NodeKit Caseflow consumer', () => {
  it('runs the exact packaged conformance suite against authenticated Convex state', async () => {
    const t = convexTest(schema, modules);
    const owner = await bootstrapOwner(t, 'user:nodeslide-owner', 'conformance');
    const result = await runNodeSlideCaseflowConformance(transport(owner.client), owner.scope);

    expect(NODEKIT_CASEFLOW_SOURCE_COMMIT).toBe('5cc61578b3c1bd5b5c8195b83347b91f8b83242b');
    expect(result.passed).toBe(true);
    expect(result.capabilities.provider).toBe('convex');
    expect(result.capabilityNegotiation.passed).toBe(true);
    expect(result.assertions).toEqual({
      activeRunStartIsIdempotent: true,
      canonicalVersionAdvancedOnce: true,
      contentAddressedReceipt: true,
      exceptionStatePreserved: true,
      nextActionOwnerExplicit: true,
      oneAuthoritativeCase: true,
      repeatedCompletionIsIdempotent: true,
      repeatedDecisionIsIdempotent: true,
      staleProposalFailedClosed: true,
    });

    const persisted = await t.run(async (ctx) => ({
      cases: await ctx.db.query('nodekitCaseflowCases').collect(),
      deckBindings: await ctx.db.query('nodekitCaseflowDeckBindings').collect(),
      receipts: await ctx.db.query('nodekitCaseflowReceipts').collect(),
      versions: await ctx.db.query('nodekitCaseflowArtifactVersions').collect(),
    }));
    expect(persisted.cases).toHaveLength(1);
    expect(persisted.deckBindings).toHaveLength(1);
    expect(persisted.deckBindings[0]?.deckId).toBe(owner.deck.deck.id);
    expect(persisted.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(persisted.receipts).toHaveLength(1);
  });

  it('derives normal authority from ctx.auth and denies cross-owner or anonymous access', async () => {
    const t = convexTest(schema, modules);
    const owner = await bootstrapOwner(t, 'user:owner-a', 'owner-a');
    const attacker = t.withIdentity({ subject: 'user:owner-b', name: 'Attacker' });
    const attackerWorkspace = (await attacker.mutation(refs.ensureCaseflowWorkspace, {
      slug: 'workspace-owner-b',
    })) as { workspaceId: string };

    await expect(
      attacker.query(refs.snapshot, { workspaceId: owner.scope.workspaceId }),
    ).rejects.toThrow('nodekit_caseflow_workspace_owner_mismatch');
    await expect(
      attacker.mutation(refs.bootstrapDeck, {
        workspaceId: attackerWorkspace.workspaceId,
        deckId: owner.deck.deck.id,
        ownerAccessKey: owner.deck.ownerAccessKey,
      }),
    ).rejects.toThrow('nodekit_caseflow_deck_already_bound');
    await expect(t.query(refs.snapshot, { workspaceId: owner.scope.workspaceId })).rejects.toThrow(
      'nodekit_caseflow_unauthenticated',
    );

    const caseRuntime = createNodeSlideCaseflowRuntime(transport(owner.client), owner.scope);
    const work = await caseRuntime.createCase({
      title: 'Owner-only deck lifecycle',
      primaryJob: 'Produce an approved presentation',
    });
    const run = await caseRuntime.startRun({
      caseId: work.caseId,
      stages: [{ id: 'working', label: 'Build', owner: 'agent' }],
    });
    const attackerRuntime = createNodeSlideCaseflowRuntime(transport(attacker), {
      ...owner.scope,
      workspaceId: attackerWorkspace.workspaceId,
    });
    await expect(
      attackerRuntime.enterStage({ runId: run.runId, stageId: 'working' }),
    ).rejects.toThrow('nodekit_caseflow_owner_scope_mismatch');
  });

  it('maps real deck/run/patch/validation/receipt refs and survives races, retries, recovery, and reload', async () => {
    const t = convexTest(schema, modules);
    const owner = await bootstrapOwner(t, 'user:domain-owner', 'domain');
    const firstPatch = createNodeSlideTextPatch(
      owner.deck,
      'First domain proposal',
      'patch:nodekit:first',
    );
    const secondPatch = createNodeSlideTextPatch(
      owner.deck,
      'Second stale proposal',
      'patch:nodekit:second',
    );
    const generationId = 'run:nodekit-domain';
    const validationRef = 'validation:nodekit-domain';
    const firstReceiptRef = 'receipt:nodekit:first';
    const secondReceiptRef = 'receipt:nodekit:second';

    await seedDomainRows(t, owner.deck, {
      firstPatch,
      firstReceiptRef,
      generationId,
      secondPatch,
      secondReceiptRef,
      validationRef,
    });

    const runtime = createNodeSlideCaseflowRuntime(transport(owner.client), {
      ...owner.scope,
      generationId,
      validationRef,
    });
    const work = await runtime.createCase({
      title: 'Mapped NodeSlide production case',
      primaryJob: 'Move one validated deck patch through human review',
    });
    const run = await runtime.startRun({
      caseId: work.caseId,
      stages: [
        { id: 'working', label: 'Compose deck', owner: 'agent' },
        { id: 'review', label: 'Review patch', owner: 'user' },
        { id: 'complete', label: 'Verify receipt', owner: 'system' },
      ],
    });
    const repeatedRun = await runtime.startRun({
      caseId: work.caseId,
      stages: [{ id: 'ignored', label: 'Ignored duplicate start', owner: 'system' }],
    });
    expect(repeatedRun.runId).toBe(run.runId);

    const artifact = (await runtime.createArtifact({
      caseId: work.caseId,
      runId: run.runId,
      kind: 'presentation',
      title: owner.deck.deck.title,
      content: { deckId: owner.deck.deck.id, deckVersion: owner.deck.deck.version },
    })) as PortableArtifact;
    const first = (await runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: firstPatch,
      rationale: 'Validated NodeSlide patch',
    })) as PortableProposal;
    const second = (await runtime.createProposal({
      artifactId: artifact.artifactId,
      baseVersion: 1,
      patch: secondPatch,
      rationale: 'Competing same-base patch',
    })) as PortableProposal;

    const accepted = (await runtime.decideProposal({
      proposalId: first.proposalId,
      decision: 'accepted',
      domainReceiptRef: firstReceiptRef,
    })) as PortableDecision;
    const repeatedDecision = (await runtime.decideProposal({
      proposalId: first.proposalId,
      decision: 'accepted',
      domainReceiptRef: firstReceiptRef,
    })) as PortableDecision;
    const stale = (await runtime.decideProposal({
      proposalId: second.proposalId,
      decision: 'accepted',
      domainReceiptRef: secondReceiptRef,
    })) as PortableDecision;
    expect(accepted.artifact.canonicalVersion).toBe(2);
    expect(repeatedDecision.reused).toBe(true);
    expect(repeatedDecision.approval.approvalId).toBe(accepted.approval.approvalId);
    expect(repeatedDecision.artifact.versions).toHaveLength(2);
    expect(stale.proposal.status).toBe('conflicted');
    expect(stale.artifact.canonicalVersion).toBe(2);
    expect(stale.artifact.versions.at(-1)?.content).toEqual(firstPatch);

    const raised = (await runtime.raiseException({
      runId: run.runId,
      code: 'candidate_validation_attention',
      message: 'Preserve the accepted deck while review continues.',
      preservedState: { canonicalVersion: 2, reviewed: true },
    })) as PortableException;
    expect(raised.validationRef).toBe(validationRef);
    expect(raised.preservedState).toEqual({ canonicalVersion: 2, reviewed: true });
    const recovered = await runtime.resolveException({
      exceptionId: raised.exceptionId,
      resolution: 'Validation reviewed',
      nextAction: 'Verify completion',
      nextActionOwner: 'system',
    });
    expect(recovered.run.status).toBe('active');
    expect(recovered.run.nextActionOwner).toBe('system');

    await runtime.enterStage({ runId: run.runId, stageId: 'complete' });
    const completed = (await runtime.completeRun({ runId: run.runId })) as PortableCompletion;
    expect(contentHash(receiptBody(completed.receipt))).toBe(completed.receipt.receiptHash);
    expect(completed.receipt.applicationRefs).toEqual({
      deckIds: [owner.deck.deck.id],
      domainArtifactRefs: [owner.scope.domainArtifactRef],
      domainReceiptRefs: [firstReceiptRef, secondReceiptRef],
      generationIds: [generationId],
      patchIds: [firstPatch.id, secondPatch.id],
      validationRefs: [validationRef],
    });

    // A fresh adapter instance simulates a browser/client reload.
    const reloadedRuntime = createNodeSlideCaseflowRuntime(transport(owner.client), {
      ...owner.scope,
      generationId,
      validationRef,
    });
    const snapshot = await reloadedRuntime.snapshot();
    const repeatedCompletion = (await reloadedRuntime.completeRun({
      runId: run.runId,
    })) as PortableCompletion;
    expect(snapshot.artifacts[0]?.versions).toHaveLength(2);
    expect(snapshot.receipts).toHaveLength(1);
    expect(repeatedCompletion.reused).toBe(true);
    expect(repeatedCompletion.receipt).toEqual(completed.receipt);

    const rows = await t.run(async (ctx) => ({
      approvals: await ctx.db.query('nodekitCaseflowApprovals').collect(),
      receipts: await ctx.db.query('nodekitCaseflowReceipts').collect(),
      versions: await ctx.db.query('nodekitCaseflowArtifactVersions').collect(),
    }));
    expect(
      rows.approvals.filter((approval) => String(approval.proposalId) === first.proposalId),
    ).toHaveLength(1);
    expect(rows.receipts).toHaveLength(1);
    expect(rows.versions).toHaveLength(2);
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
      ownerDigest: 'sha256:nodekit-domain-owner',
      idempotencyKey: 'nodekit-domain-generation',
      instruction: 'Compose one reviewable deck update.',
      status: 'awaiting_review',
      provider: 'deterministic',
      model: 'nodekit-consumer-proof/v1',
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
        principalId: 'user:domain-owner',
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
