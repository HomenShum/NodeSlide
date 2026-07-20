import {
  type NodeSlideApprovalPolicy,
  type NodeSlidePatchCommand,
  type NodeSlidePrincipal,
  type NodeSlideRepository,
  NodeSlideRepositoryError,
  nodeSlideApprovalModeForPatch,
} from '@nodeslide/backend';
import type { DeckSnapshot } from '@nodeslide/contracts';

export type DeckEditOutcome =
  | { ok: true; version: number }
  | { ok: false; conflict: true; expected: number; actual: number }
  | { ok: false; locked: true; holder: string }
  | { ok: false; pendingApproval: true; proposalId?: string }
  | { ok: false; invalid: true; findings: string[] };

export interface NodeSlideRoomTools {
  snapshot(): Promise<DeckSnapshot>;
  readRange(args: { slideId: string; region?: string }): Promise<unknown>;
  proposeLock(args: { slideId: string }): Promise<{ ok: boolean; holder?: string }>;
  releaseLock(args: { slideId: string }): Promise<void>;
  applyDeckPatch(args: {
    patch: NodeSlidePatchCommand;
    expectedVersion: number;
  }): Promise<DeckEditOutcome>;
  say(text: string): Promise<void>;
  renderSlidePreview?(args: { slideId: string }): Promise<{ pngDigest: string }>;
  runDeckCI?(): Promise<{ ok: boolean; findings: string[] }>;
  exportPptx?(): Promise<{ artifactId: string; sha256: string }>;
}

/** Structural schema seam; zod/valibot ownership remains with the host runtime. */
export interface NodeSlideAgentToolSchema<Output = unknown> {
  parse(value: unknown): Output;
}

export interface NodeSlideAgentTool<
  Args = unknown,
  RT extends NodeSlideRoomTools = NodeSlideRoomTools,
> {
  name: string;
  description: string;
  schema: NodeSlideAgentToolSchema<Args>;
  execute(args: Args, runtime: RT): Promise<unknown>;
}

export interface NodeSlideAgentAdapter<RT extends NodeSlideRoomTools = NodeSlideRoomTools> {
  runtime: RT;
  tools: readonly NodeSlideAgentTool<unknown, RT>[];
  systemPrompt: string;
  toolClasses: Readonly<Record<string, 'query' | 'mutation'>>;
}

export interface NodeSlideLockAdapter {
  acquire(input: {
    deckId: string;
    slideId: string;
    principal: NodeSlidePrincipal;
  }): Promise<{ ok: boolean; holder?: string }>;
  release(input: {
    deckId: string;
    slideId: string;
    principal: NodeSlidePrincipal;
  }): Promise<void>;
}

export interface CreateNodeSlideRoomToolsInput {
  deckId: string;
  principal: NodeSlidePrincipal;
  repository: NodeSlideRepository;
  approvalPolicy: NodeSlideApprovalPolicy;
  locks: NodeSlideLockAdapter;
  say(text: string): Promise<void>;
  renderSlidePreview?: NodeSlideRoomTools['renderSlidePreview'];
  runDeckCI?: NodeSlideRoomTools['runDeckCI'];
  exportPptx?: NodeSlideRoomTools['exportPptx'];
}

export function createNodeSlideRoomTools(input: CreateNodeSlideRoomToolsInput): NodeSlideRoomTools {
  return {
    snapshot: async () => {
      const snapshot = await input.repository.getDeck({
        deckId: input.deckId,
        principal: input.principal,
      });
      if (!snapshot) {
        throw new NodeSlideRepositoryError('not_found', `Deck ${input.deckId} was not found.`);
      }
      return snapshot;
    },
    readRange: async ({ slideId, region }) => {
      const snapshot = await input.repository.getDeck({
        deckId: input.deckId,
        principal: input.principal,
      });
      const slide = snapshot?.slides.find((candidate) => candidate.id === slideId);
      if (!snapshot || !slide) return null;
      const elements = snapshot.elements.filter((element) => element.slideId === slideId);
      return { slide, elements, ...(region === undefined ? {} : { region }) };
    },
    proposeLock: ({ slideId }) =>
      input.locks.acquire({ deckId: input.deckId, slideId, principal: input.principal }),
    releaseLock: ({ slideId }) =>
      input.locks.release({ deckId: input.deckId, slideId, principal: input.principal }),
    applyDeckPatch: async ({ patch, expectedVersion }) => {
      if (patch.baseDeckVersion !== expectedVersion) {
        return {
          ok: false,
          invalid: true,
          findings: [
            `Patch base ${patch.baseDeckVersion} does not match expected version ${expectedVersion}.`,
          ],
        };
      }
      try {
        if (nodeSlideApprovalModeForPatch(input.approvalPolicy, patch) === 'proposal_required') {
          const proposal = await input.repository.createProposal({
            deckId: input.deckId,
            principal: input.principal,
            patch,
          });
          return { ok: false, pendingApproval: true, proposalId: proposal.id };
        }
        const applied = await input.repository.applyPatch({
          deckId: input.deckId,
          principal: input.principal,
          patch,
        });
        return { ok: true, version: applied.snapshot.deck.version };
      } catch (error) {
        if (error instanceof NodeSlideRepositoryError && error.code === 'conflict') {
          const current = await input.repository.getDeck({
            deckId: input.deckId,
            principal: input.principal,
          });
          return {
            ok: false,
            conflict: true,
            expected: patch.baseDeckVersion,
            actual: current?.deck.version ?? -1,
          };
        }
        return {
          ok: false,
          invalid: true,
          findings: [error instanceof Error ? error.message : String(error)],
        };
      }
    },
    say: input.say,
    ...(input.renderSlidePreview ? { renderSlidePreview: input.renderSlidePreview } : {}),
    ...(input.runDeckCI ? { runDeckCI: input.runDeckCI } : {}),
    ...(input.exportPptx ? { exportPptx: input.exportPptx } : {}),
  };
}
