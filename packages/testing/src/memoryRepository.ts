import type { DeckPatch, DeckSnapshot, DeckVersion } from '../../../shared/nodeslide';
import {
  type NodeSlideApplyPatchInput,
  type NodeSlideApplyPatchResult,
  type NodeSlideCreateProposalInput,
  type NodeSlideGetDeckInput,
  type NodeSlideListVersionsInput,
  type NodeSlidePatchCommand,
  type NodeSlidePrincipal,
  type NodeSlideProposalResolution,
  type NodeSlideReceipt,
  type NodeSlideReceiptOperation,
  type NodeSlideRepository,
  NodeSlideRepositoryError,
  type NodeSlideResolveProposalInput,
} from '../../backend/src';
import { applyDeckPatch } from '../../engine/src';

export type MemoryNodeSlideRepositoryAction =
  | 'read'
  | 'apply_patch'
  | 'create_proposal'
  | 'resolve_proposal'
  | 'list_versions';

export interface MemoryNodeSlideRepositoryOptions {
  snapshots?: readonly DeckSnapshot[];
  now?: () => number;
  authorize?: (
    principal: NodeSlidePrincipal,
    deckId: string,
    action: MemoryNodeSlideRepositoryAction,
  ) => void | Promise<void>;
}

interface MemoryDeckState {
  snapshot: DeckSnapshot;
  patches: Map<string, DeckPatch>;
  versions: DeckVersion[];
  receipts: NodeSlideReceipt[];
  resolutions: Map<string, NodeSlideProposalResolution>;
  applyResults: Map<string, NodeSlideApplyPatchResult>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Backend-neutral reference repository used by package consumers and adapter
 * conformance tests. It deliberately exercises the production pure patch
 * engine instead of maintaining a second mutation implementation.
 */
export class MemoryNodeSlideRepository implements NodeSlideRepository {
  readonly #states = new Map<string, MemoryDeckState>();
  readonly #now: () => number;
  readonly #authorize: NonNullable<MemoryNodeSlideRepositoryOptions['authorize']>;
  #receiptSequence = 0;

  constructor(options: MemoryNodeSlideRepositoryOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#authorize = options.authorize ?? (() => undefined);
    for (const snapshot of options.snapshots ?? []) this.seed(snapshot);
  }

  seed(snapshot: DeckSnapshot): void {
    const value = clone(snapshot);
    this.#states.set(value.deck.id, {
      snapshot: value,
      patches: new Map(),
      versions: [
        {
          id: `version:${value.deck.id}:${value.deck.version}`,
          deckId: value.deck.id,
          version: value.deck.version,
          label: 'Seed snapshot',
          source: 'system',
          snapshot: clone(value),
          createdAt: value.deck.updatedAt,
        },
      ],
      receipts: [],
      resolutions: new Map(),
      applyResults: new Map(),
    });
  }

  async getDeck(input: NodeSlideGetDeckInput): Promise<DeckSnapshot | null> {
    await this.#authorize(input.principal, input.deckId, 'read');
    const state = this.#states.get(input.deckId);
    return state ? clone(state.snapshot) : null;
  }

  async applyPatch(input: NodeSlideApplyPatchInput): Promise<NodeSlideApplyPatchResult> {
    const state = await this.#stateFor(input, 'apply_patch');
    this.#assertPatchDeck(input.patch, input.deckId);
    const prior = state.applyResults.get(input.patch.id);
    if (prior) return clone(prior);
    const existing = state.patches.get(input.patch.id);
    if (existing) {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Patch ${input.patch.id} already exists with status ${existing.status}.`,
      );
    }
    return clone(this.#commit(state, input.patch, input.principal, 'patch.applied', this.#now()));
  }

  async createProposal(input: NodeSlideCreateProposalInput): Promise<DeckPatch> {
    const state = await this.#stateFor(input, 'create_proposal');
    this.#assertPatchDeck(input.patch, input.deckId);
    const existing = state.patches.get(input.patch.id);
    if (existing) {
      if (this.#sameCommand(existing, input.patch)) return clone(existing);
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Proposal ID ${input.patch.id} is already bound to another patch.`,
      );
    }
    this.#previewOrConflict(state.snapshot, input.patch);
    const now = this.#now();
    const proposal = this.#persistedPatch(input.patch, 'ready', now);
    state.patches.set(proposal.id, proposal);
    this.#appendReceipt(
      state,
      this.#receipt(
        input.principal,
        proposal,
        state.snapshot.deck.version,
        'proposal.created',
        now,
      ),
    );
    return clone(proposal);
  }

  async resolveProposal(
    input: NodeSlideResolveProposalInput,
  ): Promise<NodeSlideProposalResolution> {
    const state = await this.#stateFor(input, 'resolve_proposal');
    const existingResolution = state.resolutions.get(input.proposalId);
    if (existingResolution) {
      const existingDecision = existingResolution.status === 'accepted' ? 'accept' : 'reject';
      if (existingResolution.status !== 'stale' && existingDecision !== input.decision) {
        throw new NodeSlideRepositoryError(
          'invalid_state',
          `Proposal ${input.proposalId} is already ${existingResolution.status}.`,
        );
      }
      return clone(existingResolution);
    }
    const proposal = state.patches.get(input.proposalId);
    if (!proposal) {
      throw new NodeSlideRepositoryError(
        'not_found',
        `Proposal ${input.proposalId} was not found for deck ${input.deckId}.`,
      );
    }
    if (proposal.status !== 'ready' && proposal.status !== 'draft') {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Proposal ${proposal.id} cannot be resolved from status ${proposal.status}.`,
      );
    }
    const now = this.#now();
    if (input.decision === 'reject') {
      const rejected = { ...clone(proposal), status: 'rejected' as const, updatedAt: now };
      state.patches.set(rejected.id, rejected);
      const receipt = this.#receipt(
        input.principal,
        rejected,
        state.snapshot.deck.version,
        'proposal.rejected',
        now,
      );
      this.#appendReceipt(state, receipt);
      const resolution: NodeSlideProposalResolution = {
        status: 'rejected',
        patch: rejected,
        snapshot: clone(state.snapshot),
        receipt,
      };
      state.resolutions.set(rejected.id, clone(resolution));
      return clone(resolution);
    }

    try {
      const applied = this.#commit(
        state,
        this.#commandFromPatch(proposal),
        input.principal,
        'proposal.accepted',
        now,
      );
      const resolution: NodeSlideProposalResolution = {
        status: 'accepted',
        patch: applied.patch,
        snapshot: applied.snapshot,
        receipt: applied.receipt,
      };
      state.resolutions.set(proposal.id, clone(resolution));
      return clone(resolution);
    } catch (error) {
      if (!(error instanceof NodeSlideRepositoryError) || error.code !== 'conflict') throw error;
      const stale = { ...clone(proposal), status: 'stale' as const, updatedAt: now };
      state.patches.set(stale.id, stale);
      const receipt = this.#receipt(
        input.principal,
        stale,
        state.snapshot.deck.version,
        'proposal.stale',
        now,
      );
      this.#appendReceipt(state, receipt);
      const resolution: NodeSlideProposalResolution = {
        status: 'stale',
        patch: stale,
        snapshot: clone(state.snapshot),
        receipt,
      };
      state.resolutions.set(stale.id, clone(resolution));
      return clone(resolution);
    }
  }

  async listVersions(input: NodeSlideListVersionsInput): Promise<DeckVersion[]> {
    const state = await this.#stateFor(input, 'list_versions');
    const limit = Math.max(1, Math.floor(input.limit ?? state.versions.length));
    return clone(
      [...state.versions].sort((left, right) => right.version - left.version).slice(0, limit),
    );
  }

  async storeReceipt(receipt: NodeSlideReceipt): Promise<void> {
    const state = this.#states.get(receipt.deckId);
    if (!state) {
      throw new NodeSlideRepositoryError(
        'not_found',
        `Deck ${receipt.deckId} was not found while storing receipt ${receipt.id}.`,
      );
    }
    this.#appendReceipt(state, receipt);
  }

  receiptsForDeck(deckId: string): NodeSlideReceipt[] {
    const state = this.#states.get(deckId);
    return state ? clone(state.receipts) : [];
  }

  async #stateFor(
    input: { deckId: string; principal: NodeSlidePrincipal },
    action: MemoryNodeSlideRepositoryAction,
  ): Promise<MemoryDeckState> {
    await this.#authorize(input.principal, input.deckId, action);
    const state = this.#states.get(input.deckId);
    if (!state)
      throw new NodeSlideRepositoryError('not_found', `Deck ${input.deckId} was not found.`);
    return state;
  }

  #commit(
    state: MemoryDeckState,
    command: NodeSlidePatchCommand,
    principal: NodeSlidePrincipal,
    operation: NodeSlideReceiptOperation,
    now: number,
  ): NodeSlideApplyPatchResult {
    const result = this.#previewOrConflict(state.snapshot, command, now);
    const accepted = this.#persistedPatch(command, 'accepted', now, result.snapshot.deck.version);
    state.snapshot = clone(result.snapshot);
    state.patches.set(accepted.id, accepted);
    const version: DeckVersion = {
      id: `version:${accepted.deckId}:${result.snapshot.deck.version}`,
      deckId: accepted.deckId,
      version: result.snapshot.deck.version,
      label: accepted.summary,
      source: accepted.source,
      patchId: accepted.id,
      snapshot: clone(result.snapshot),
      createdAt: now,
    };
    state.versions.push(version);
    const receipt = this.#receipt(
      principal,
      accepted,
      result.snapshot.deck.version,
      operation,
      now,
    );
    this.#appendReceipt(state, receipt);
    const applied: NodeSlideApplyPatchResult = {
      patch: accepted,
      snapshot: clone(result.snapshot),
      affectedSlideIds: [...result.affectedSlideIds],
      affectedElementIds: [...result.affectedElementIds],
      receipt,
    };
    state.applyResults.set(accepted.id, clone(applied));
    return applied;
  }

  #previewOrConflict(snapshot: DeckSnapshot, command: NodeSlidePatchCommand, now = this.#now()) {
    try {
      const result = applyDeckPatch(
        clone(snapshot),
        {
          baseDeckVersion: command.baseDeckVersion,
          scope: command.scope,
          operations: command.operations,
        },
        now,
      );
      for (const slideId of result.affectedSlideIds) {
        const current = snapshot.slides.find((slide) => slide.id === slideId);
        if (current && command.baseSlideVersions[slideId] !== current.version) {
          throw new NodeSlideRepositoryError(
            'conflict',
            `Stale patch: slide ${slideId} expected version ${String(command.baseSlideVersions[slideId])}, current version is ${current.version}.`,
          );
        }
      }
      for (const elementId of result.affectedElementIds) {
        const current = snapshot.elements.find((element) => element.id === elementId);
        if (current && command.baseElementVersions[elementId] !== current.version) {
          throw new NodeSlideRepositoryError(
            'conflict',
            `Stale patch: element ${elementId} expected version ${String(command.baseElementVersions[elementId])}, current version is ${current.version}.`,
          );
        }
      }
      return result;
    } catch (error) {
      if (error instanceof NodeSlideRepositoryError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const code = message.startsWith('Stale patch:') ? 'conflict' : 'invalid_state';
      throw new NodeSlideRepositoryError(code, message);
    }
  }

  #persistedPatch(
    command: NodeSlidePatchCommand,
    status: DeckPatch['status'],
    now: number,
    resultingDeckVersion?: number,
  ): DeckPatch {
    return {
      ...clone(command),
      status,
      ...(resultingDeckVersion === undefined ? {} : { resultingDeckVersion }),
      createdAt: now,
      updatedAt: now,
    };
  }

  #commandFromPatch(patch: DeckPatch): NodeSlidePatchCommand {
    const {
      status: _status,
      resultingDeckVersion: _resultingDeckVersion,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...command
    } = patch;
    return command;
  }

  #sameCommand(patch: DeckPatch, command: NodeSlidePatchCommand): boolean {
    return JSON.stringify(this.#commandFromPatch(patch)) === JSON.stringify(command);
  }

  #assertPatchDeck(patch: NodeSlidePatchCommand, deckId: string): void {
    if (patch.deckId !== deckId || patch.scope.deckId !== deckId) {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Patch ${patch.id} is not scoped to deck ${deckId}.`,
      );
    }
  }

  #receipt(
    principal: NodeSlidePrincipal,
    patch: Pick<DeckPatch, 'id' | 'deckId' | 'source' | 'traceId'>,
    deckVersion: number,
    operation: NodeSlideReceiptOperation,
    now: number,
  ): NodeSlideReceipt {
    this.#receiptSequence += 1;
    return {
      id: `receipt:${patch.id}:${this.#receiptSequence}`,
      deckId: patch.deckId,
      deckVersion,
      operation,
      principalId: principal.userId,
      patchId: patch.id,
      ...(patch.traceId === undefined ? {} : { traceId: patch.traceId }),
      recordedAt: now,
      attributes: { source: patch.source },
    };
  }

  #appendReceipt(state: MemoryDeckState, receipt: NodeSlideReceipt): void {
    if (state.receipts.some((candidate) => candidate.id === receipt.id)) return;
    state.receipts.push(clone(receipt));
  }
}
