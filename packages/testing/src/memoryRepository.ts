import {
  type NodeSlideApplyPatchInput,
  type NodeSlideApplyPatchResult,
  type NodeSlideAuthorizationReceipt,
  type NodeSlideAuthorize,
  type NodeSlideCreateProposalInput,
  type NodeSlideGetDeckInput,
  type NodeSlideJsonValue,
  type NodeSlideListVersionsInput,
  type NodeSlidePatchCommand,
  type NodeSlidePrincipal,
  type NodeSlideProposalResolution,
  type NodeSlideReceipt,
  type NodeSlideReceiptDraft,
  type NodeSlideReceiptOperation,
  type NodeSlideRepository,
  type NodeSlideRepositoryAuthorizationAction,
  type NodeSlideRepositoryAuthorizationRequest,
  type NodeSlideRepositoryDescriptor,
  NodeSlideRepositoryError,
  type NodeSlideResolveProposalInput,
  type NodeSlideStoreReceiptInput,
  createNodeSlideAuthorizationReceipt,
  parseNodeSlidePrincipal,
} from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot, DeckVersion } from '@nodeslide/contracts';
import { applyDeckPatch } from '@nodeslide/engine';

export type MemoryNodeSlideRepositoryAction = NodeSlideRepositoryAuthorizationAction;
type MemoryNodeSlideMutationReceiptOperation = Exclude<NodeSlideReceiptOperation, 'custom'>;

export interface MemoryNodeSlideRepositoryOptions {
  snapshots?: readonly DeckSnapshot[];
  now?: () => number;
  authorize: NodeSlideAuthorize;
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

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) deepFreeze(descriptor.value);
  }
  return Object.freeze(value);
}

function cloneReceiptJson(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  budget: { nodes: number; characters: number },
  depth = 0,
): NodeSlideJsonValue {
  budget.nodes += 1;
  if (budget.nodes > 2_048 || depth > 16) {
    throw new NodeSlideRepositoryError('invalid_state', 'Receipt attributes exceed safe bounds.');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    budget.characters += value.length;
    if (budget.characters > 1_000_000) {
      throw new NodeSlideRepositoryError('invalid_state', 'Receipt attributes exceed safe bounds.');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new NodeSlideRepositoryError('invalid_state', `${path} must be finite JSON data.`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new NodeSlideRepositoryError('invalid_state', `${path} must be JSON data.`);
  }
  if (seen.has(value)) {
    throw new NodeSlideRepositoryError(
      'invalid_state',
      `${path} must not contain cyclic or shared identities.`,
    );
  }
  seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new NodeSlideRepositoryError('invalid_state', `${path} must be a bounded plain array.`);
    }
    const keys = Reflect.ownKeys(value);
    const captured = new Map<string, unknown>();
    for (const key of keys) {
      if (typeof key !== 'string') {
        throw new NodeSlideRepositoryError(
          'invalid_state',
          `${path} must be a dense array without extra properties.`,
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) {
        throw new NodeSlideRepositoryError(
          'invalid_state',
          `${path}.${key} must be a data property.`,
        );
      }
      captured.set(key, descriptor.value);
    }
    const length = captured.get('length');
    if (
      typeof length !== 'number' ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > 256 ||
      captured.size !== length + 1
    ) {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `${path} must be a dense array without extra properties.`,
      );
    }
    const result: NodeSlideJsonValue[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!captured.has(String(index))) {
        throw new NodeSlideRepositoryError('invalid_state', `${path} must be a dense array.`);
      }
      result.push(
        cloneReceiptJson(captured.get(String(index)), `${path}[${index}]`, seen, budget, depth + 1),
      );
    }
    return result;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NodeSlideRepositoryError('invalid_state', `${path} must be a plain object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 256) {
    throw new NodeSlideRepositoryError('invalid_state', `${path} has too many fields.`);
  }
  const result: Record<string, NodeSlideJsonValue> = {};
  for (const key of keys) {
    if (
      typeof key !== 'string' ||
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor'
    ) {
      throw new NodeSlideRepositoryError('invalid_state', `${path} has an unsafe field.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `${path}.${key} must be a data property.`,
      );
    }
    result[key] = cloneReceiptJson(descriptor.value, `${path}.${key}`, seen, budget, depth + 1);
  }
  return result;
}

function cloneReceiptAttributes(value: unknown): Record<string, NodeSlideJsonValue> {
  const cloned = cloneReceiptJson(value, 'Receipt draft.attributes', new WeakSet(), {
    nodes: 0,
    characters: 0,
  });
  if (typeof cloned !== 'object' || cloned === null || Array.isArray(cloned)) {
    throw new NodeSlideRepositoryError(
      'invalid_state',
      'Receipt draft.attributes must be a plain object.',
    );
  }
  return cloned;
}

/**
 * Backend-neutral reference repository used by package consumers and adapter
 * conformance tests. It deliberately exercises the production pure patch
 * engine instead of maintaining a second mutation implementation.
 */
export class MemoryNodeSlideRepository implements NodeSlideRepository {
  readonly descriptor: NodeSlideRepositoryDescriptor = {
    adapter: 'memory',
    name: 'MemoryNodeSlideRepository',
    invariants: {
      mutation_authority: 'in_process_test',
      version_cas: 'in_process_test',
      candidate_validation: 'in_process_test',
      trace_lineage: 'in_process_test',
      source_authorization: 'in_process_test',
      rollback: 'in_process_test',
    },
  };
  readonly #states = new Map<string, MemoryDeckState>();
  readonly #now: () => number;
  readonly #authorizer: NodeSlideAuthorize;
  #authorizationSequence = 0;
  #receiptSequence = 0;

  constructor(options: MemoryNodeSlideRepositoryOptions) {
    const authorizer = options?.authorize;
    if (typeof authorizer !== 'function') {
      throw new NodeSlideRepositoryError(
        'forbidden',
        'MemoryNodeSlideRepository requires a host authorizer.',
      );
    }
    this.#now = options.now ?? (() => Date.now());
    this.#authorizer = authorizer;
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
    const { request } = await this.#authorizeRequest({
      action: 'deck.read',
      deckId: input.deckId,
      principal: input.principal,
    });
    const state = this.#states.get(request.deckId);
    return state ? clone(state.snapshot) : null;
  }

  async applyPatch(input: NodeSlideApplyPatchInput): Promise<NodeSlideApplyPatchResult> {
    const { request, authorization } = await this.#authorizeRequest({
      action: 'patch.apply',
      deckId: input.deckId,
      principal: input.principal,
      patch: input.patch,
    });
    const state = this.#stateFor(request.deckId);
    this.#assertPatchDeck(request.patch, request.deckId);
    const prior = state.applyResults.get(request.patch.id);
    if (prior) {
      if (this.#sameCommand(prior.patch, request.patch)) return clone(prior);
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Patch ID ${request.patch.id} is already bound to another command.`,
      );
    }
    const existing = state.patches.get(request.patch.id);
    if (existing) {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Patch ${request.patch.id} already exists with status ${existing.status}.`,
      );
    }
    return clone(
      this.#commit(
        state,
        request.patch,
        request.principal,
        authorization,
        'patch.applied',
        this.#now(),
      ),
    );
  }

  async createProposal(input: NodeSlideCreateProposalInput): Promise<DeckPatch> {
    const { request, authorization } = await this.#authorizeRequest({
      action: 'proposal.create',
      deckId: input.deckId,
      principal: input.principal,
      patch: input.patch,
    });
    const state = this.#stateFor(request.deckId);
    this.#assertPatchDeck(request.patch, request.deckId);
    const existing = state.patches.get(request.patch.id);
    if (existing) {
      if (this.#sameCommand(existing, request.patch)) return clone(existing);
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Proposal ID ${request.patch.id} is already bound to another patch.`,
      );
    }
    this.#previewOrConflict(state.snapshot, request.patch);
    const now = this.#now();
    const proposal = this.#persistedPatch(request.patch, 'ready', now);
    const receipt = this.#receipt(
      request.principal,
      proposal,
      state.snapshot.deck.version,
      'proposal.created',
      now,
      authorization,
    );
    this.#assertReceiptIdAvailable(state, receipt);
    state.patches.set(proposal.id, proposal);
    this.#appendReceipt(state, receipt);
    return clone(proposal);
  }

  async resolveProposal(
    input: NodeSlideResolveProposalInput,
  ): Promise<NodeSlideProposalResolution> {
    if (input.decision !== 'accept' && input.decision !== 'reject') {
      throw new NodeSlideRepositoryError('invalid_state', 'Proposal decision is invalid.');
    }
    const { request, authorization } = await this.#authorizeRequest({
      action: input.decision === 'accept' ? 'proposal.accept' : 'proposal.reject',
      deckId: input.deckId,
      principal: input.principal,
      proposalId: input.proposalId,
    });
    const state = this.#stateFor(request.deckId);
    const existingResolution = state.resolutions.get(request.proposalId);
    if (existingResolution) {
      const existingDecision = existingResolution.status === 'rejected' ? 'reject' : 'accept';
      const decision = request.action === 'proposal.accept' ? 'accept' : 'reject';
      if (existingDecision !== decision) {
        throw new NodeSlideRepositoryError(
          'invalid_state',
          `Proposal ${request.proposalId} is already ${existingResolution.status}.`,
        );
      }
      return clone(existingResolution);
    }
    const proposal = state.patches.get(request.proposalId);
    if (!proposal) {
      throw new NodeSlideRepositoryError(
        'not_found',
        `Proposal ${request.proposalId} was not found for deck ${request.deckId}.`,
      );
    }
    if (proposal.status !== 'ready' && proposal.status !== 'draft') {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Proposal ${proposal.id} cannot be resolved from status ${proposal.status}.`,
      );
    }
    const now = this.#now();
    if (request.action === 'proposal.reject') {
      const rejected = {
        ...clone(proposal),
        status: 'rejected' as const,
        updatedAt: now,
      };
      const receipt = this.#receipt(
        request.principal,
        rejected,
        state.snapshot.deck.version,
        'proposal.rejected',
        now,
        authorization,
      );
      this.#assertReceiptIdAvailable(state, receipt);
      state.patches.set(rejected.id, rejected);
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
        request.principal,
        authorization,
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
      const stale = {
        ...clone(proposal),
        status: 'stale' as const,
        updatedAt: now,
      };
      const receipt = this.#receipt(
        request.principal,
        stale,
        state.snapshot.deck.version,
        'proposal.stale',
        now,
        authorization,
      );
      this.#assertReceiptIdAvailable(state, receipt);
      state.patches.set(stale.id, stale);
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
    const { request } = await this.#authorizeRequest({
      action: 'versions.list',
      deckId: input.deckId,
      principal: input.principal,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
    const state = this.#stateFor(request.deckId);
    const limit = Math.max(1, Math.floor(request.limit ?? state.versions.length));
    return clone(
      [...state.versions].sort((left, right) => right.version - left.version).slice(0, limit),
    );
  }

  async storeReceipt(input: NodeSlideStoreReceiptInput): Promise<NodeSlideReceipt> {
    const capturedInput = this.#storeReceiptInput(input);
    const draft = this.#receiptDraft(capturedInput.receipt);
    if (draft.deckId !== capturedInput.deckId) {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Receipt ${draft.id} is not scoped to deck ${capturedInput.deckId}.`,
      );
    }
    const { request, authorization } = await this.#authorizeRequest({
      action: 'receipt.store',
      deckId: capturedInput.deckId,
      principal: capturedInput.principal,
      receipt: draft,
    });
    const state = this.#stateFor(request.deckId);
    const existing = state.receipts.find((candidate) => candidate.id === request.receipt.id);
    if (existing) {
      const {
        principalId: existingPrincipalId,
        authorization: _existingAuthorization,
        ...existingDraft
      } = existing;
      if (
        existingPrincipalId === request.principal.userId &&
        JSON.stringify(existingDraft) === JSON.stringify(request.receipt)
      ) {
        return clone(existing);
      }
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Receipt ID ${request.receipt.id} is already bound to another receipt.`,
      );
    }
    const receipt: NodeSlideReceipt = {
      ...clone(request.receipt),
      principalId: request.principal.userId,
      authorization,
    };
    this.#appendReceipt(state, receipt);
    return clone(receipt);
  }

  #storeReceiptInput(value: unknown): NodeSlideStoreReceiptInput {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        'Store-receipt input must be a plain object.',
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        'Store-receipt input must be a plain object.',
      );
    }
    const allowedKeys = new Set(['deckId', 'principal', 'receipt']);
    const captured: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowedKeys.has(key)) {
        throw new NodeSlideRepositoryError(
          'invalid_state',
          'Store-receipt input contains an invalid field.',
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) {
        throw new NodeSlideRepositoryError(
          'invalid_state',
          'Store-receipt input fields must be data properties.',
        );
      }
      captured[key] = descriptor.value;
    }
    for (const key of allowedKeys) {
      if (!Object.hasOwn(captured, key)) {
        throw new NodeSlideRepositoryError(
          'invalid_state',
          `Store-receipt input.${key} is required.`,
        );
      }
    }
    return captured as unknown as NodeSlideStoreReceiptInput;
  }

  receiptsForDeck(deckId: string): NodeSlideReceipt[] {
    const state = this.#states.get(deckId);
    return state ? clone(state.receipts) : [];
  }

  async #authorizeRequest<T extends NodeSlideRepositoryAuthorizationRequest>(
    request: T,
  ): Promise<{ request: T; authorization: NodeSlideAuthorizationReceipt }> {
    let principal: NodeSlidePrincipal;
    try {
      principal = parseNodeSlidePrincipal(request.principal);
    } catch {
      throw new NodeSlideRepositoryError('forbidden', 'NodeSlide principal validation failed.');
    }

    const frozenRequest = deepFreeze(clone({ ...request, principal })) as unknown as T;
    try {
      const evidence = await this.#authorizer(frozenRequest);
      const nextSequence = this.#authorizationSequence + 1;
      const authorization = createNodeSlideAuthorizationReceipt(frozenRequest, evidence, {
        id: `authorization:${frozenRequest.action}:${nextSequence}`,
        authorizedAt: this.#now(),
      });
      this.#authorizationSequence = nextSequence;
      return { request: frozenRequest, authorization };
    } catch {
      throw new NodeSlideRepositoryError('forbidden', 'NodeSlide host authorization denied.');
    }
  }

  #receiptDraft(value: NodeSlideReceiptDraft): NodeSlideReceiptDraft {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new NodeSlideRepositoryError('invalid_state', 'Receipt draft must be a plain object.');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new NodeSlideRepositoryError('invalid_state', 'Receipt draft must be a plain object.');
    }
    const allowedKeys = new Set([
      'id',
      'deckId',
      'deckVersion',
      'operation',
      'patchId',
      'traceId',
      'recordedAt',
      'attributes',
    ]);
    const captured: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowedKeys.has(key)) {
        throw new NodeSlideRepositoryError(
          'invalid_state',
          'Receipt draft contains a caller-controlled identity or authorization field.',
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) {
        throw new NodeSlideRepositoryError(
          'invalid_state',
          'Receipt draft fields must be data properties.',
        );
      }
      captured[key] = descriptor.value;
    }
    const id = captured['id'];
    const deckId = captured['deckId'];
    const deckVersion = captured['deckVersion'];
    const operation = captured['operation'];
    const recordedAt = captured['recordedAt'];
    const attributes = captured['attributes'];
    const patchId = captured['patchId'];
    const traceId = captured['traceId'];
    if (
      typeof id !== 'string' ||
      !id.startsWith('custom-receipt:') ||
      id.length === 'custom-receipt:'.length ||
      typeof deckId !== 'string' ||
      typeof deckVersion !== 'number' ||
      !Number.isSafeInteger(deckVersion) ||
      deckVersion < 0 ||
      typeof recordedAt !== 'number' ||
      !Number.isSafeInteger(recordedAt) ||
      recordedAt < 0 ||
      operation !== 'custom' ||
      typeof attributes !== 'object' ||
      attributes === null ||
      Array.isArray(attributes)
    ) {
      throw new NodeSlideRepositoryError('invalid_state', 'Receipt draft is malformed.');
    }
    if (patchId !== undefined && typeof patchId !== 'string') {
      throw new NodeSlideRepositoryError('invalid_state', 'Receipt draft.patchId is malformed.');
    }
    if (traceId !== undefined && typeof traceId !== 'string') {
      throw new NodeSlideRepositoryError('invalid_state', 'Receipt draft.traceId is malformed.');
    }
    return {
      id: id as NodeSlideReceiptDraft['id'],
      deckId,
      deckVersion,
      operation,
      ...(patchId === undefined ? {} : { patchId }),
      ...(traceId === undefined ? {} : { traceId }),
      recordedAt,
      attributes: cloneReceiptAttributes(attributes),
    };
  }

  #stateFor(deckId: string): MemoryDeckState {
    const state = this.#states.get(deckId);
    if (!state) throw new NodeSlideRepositoryError('not_found', `Deck ${deckId} was not found.`);
    return state;
  }

  #commit(
    state: MemoryDeckState,
    command: NodeSlidePatchCommand,
    principal: NodeSlidePrincipal,
    authorization: NodeSlideAuthorizationReceipt,
    operation: 'patch.applied' | 'proposal.accepted',
    now: number,
  ): NodeSlideApplyPatchResult {
    const result = this.#previewOrConflict(state.snapshot, command, now);
    const accepted = this.#persistedPatch(command, 'accepted', now, result.snapshot.deck.version);
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
    const receipt = this.#receipt(
      principal,
      accepted,
      result.snapshot.deck.version,
      operation,
      now,
      authorization,
    );
    this.#assertReceiptIdAvailable(state, receipt);
    state.snapshot = clone(result.snapshot);
    state.patches.set(accepted.id, accepted);
    state.versions.push(version);
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
    operation: MemoryNodeSlideMutationReceiptOperation,
    now: number,
    authorization: NodeSlideAuthorizationReceipt,
  ): NodeSlideReceipt {
    let expectedAction: NodeSlideRepositoryAuthorizationAction;
    switch (operation) {
      case 'patch.applied':
        expectedAction = 'patch.apply';
        break;
      case 'proposal.created':
        expectedAction = 'proposal.create';
        break;
      case 'proposal.rejected':
        expectedAction = 'proposal.reject';
        break;
      case 'proposal.accepted':
      case 'proposal.stale':
        expectedAction = 'proposal.accept';
        break;
    }
    if (
      authorization.action !== expectedAction ||
      authorization.principalId !== principal.userId ||
      authorization.deckId !== patch.deckId ||
      authorization.resource.id !== patch.id
    ) {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        'Repository receipt authorization binding is inconsistent.',
      );
    }
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
      authorization,
    };
  }

  #appendReceipt(state: MemoryDeckState, receipt: NodeSlideReceipt): void {
    const existing = state.receipts.find((candidate) => candidate.id === receipt.id);
    if (existing) {
      if (JSON.stringify(existing) === JSON.stringify(receipt)) return;
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Receipt ID ${receipt.id} is already bound to another receipt.`,
      );
    }
    state.receipts.push(clone(receipt));
  }

  #assertReceiptIdAvailable(state: MemoryDeckState, receipt: NodeSlideReceipt): void {
    if (state.receipts.some((candidate) => candidate.id === receipt.id)) {
      throw new NodeSlideRepositoryError(
        'invalid_state',
        `Receipt ID ${receipt.id} is already reserved.`,
      );
    }
  }
}
