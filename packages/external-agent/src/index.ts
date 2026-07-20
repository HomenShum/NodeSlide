import { createHash } from 'node:crypto';

import type { NodeSlidePatchCommand } from '@nodeslide/backend';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  type PatchOperation,
  type PatchScope,
  operationElementIds,
} from '@nodeslide/contracts';
import { applyDeckPatch, validatePatchScope } from '@nodeslide/engine';

export const NODESLIDE_FILE_PROPOSAL_VERSION = 'nodeslide.file-proposal/v1' as const;
export const NODESLIDE_FILE_APPLICATION_VERSION = 'nodeslide.file-application/v1' as const;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 250_000;
const MAX_OPERATIONS = 128;

export type NodeSlideExternalErrorCode =
  | 'invalid_snapshot'
  | 'invalid_patch'
  | 'invalid_proposal'
  | 'stale_version'
  | 'approval_required'
  | 'governance_violation';

export class NodeSlideExternalError extends Error {
  readonly code: NodeSlideExternalErrorCode;
  readonly issues: readonly string[];

  constructor(code: NodeSlideExternalErrorCode, message: string, issues: readonly string[] = []) {
    super(message);
    this.name = 'NodeSlideExternalError';
    this.code = code;
    this.issues = [...issues];
  }
}

export interface NodeSlideDeckInspection {
  schemaVersion: typeof NODESLIDE_SCHEMA_VERSION;
  deckId: string;
  title: string;
  version: number;
  status: DeckSnapshot['deck']['status'];
  digest: string;
  counts: {
    slides: number;
    elements: number;
    sources: number;
  };
  slideOrder: string[];
}

export interface NodeSlidePatchValidation {
  valid: true;
  deckId: string;
  baseDeckVersion: number;
  candidateDeckVersion: number;
  baseSnapshotDigest: string;
  patchDigest: string;
  candidateSnapshotDigest: string;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  candidateSnapshot: DeckSnapshot;
}

export interface NodeSlideFileProposal {
  schemaVersion: typeof NODESLIDE_FILE_PROPOSAL_VERSION;
  id: string;
  status: 'ready';
  applied: false;
  createdAt: string;
  base: {
    deckId: string;
    deckVersion: number;
    snapshotDigest: string;
  };
  patch: NodeSlidePatchCommand;
  candidate: {
    committedAt: number;
    deckVersion: number;
    snapshotDigest: string;
    affectedSlideIds: string[];
    affectedElementIds: string[];
  };
}

export interface NodeSlideFileApplication {
  schemaVersion: typeof NODESLIDE_FILE_APPLICATION_VERSION;
  snapshot: DeckSnapshot;
  receipt: {
    id: string;
    proposalId: string;
    deckId: string;
    baseDeckVersion: number;
    resultingDeckVersion: number;
    baseSnapshotDigest: string;
    resultingSnapshotDigest: string;
    patchDigest: string;
    approval: 'exact_proposal_id';
    appliedAt: string;
    affectedSlideIds: string[];
    affectedElementIds: string[];
  };
}

export function inspectDeckSnapshot(value: unknown): NodeSlideDeckInspection {
  const snapshot = parseDeckSnapshot(value);
  return {
    schemaVersion: snapshot.deck.schemaVersion,
    deckId: snapshot.deck.id,
    title: snapshot.deck.title,
    version: snapshot.deck.version,
    status: snapshot.deck.status,
    digest: digestJson(snapshot),
    counts: {
      slides: snapshot.slides.length,
      elements: snapshot.elements.length,
      sources: snapshot.sources.length,
    },
    slideOrder: [...snapshot.deck.slideOrder],
  };
}

export function parseDeckSnapshot(value: unknown): DeckSnapshot {
  assertSafeJson(value, 'snapshot');
  const snapshot = requireRecord(value, 'snapshot', 'invalid_snapshot');
  rejectUnknownKeys(
    snapshot,
    ['deck', 'slides', 'elements', 'sources'],
    'snapshot',
    'invalid_snapshot',
  );

  const deck = requireRecord(snapshot['deck'], 'snapshot.deck', 'invalid_snapshot');
  requireExactString(
    deck['schemaVersion'],
    NODESLIDE_SCHEMA_VERSION,
    'snapshot.deck.schemaVersion',
    'invalid_snapshot',
  );
  requireString(deck['toolchainVersion'], 'snapshot.deck.toolchainVersion', 'invalid_snapshot');
  const deckId = requireString(deck['id'], 'snapshot.deck.id', 'invalid_snapshot');
  requireString(deck['projectId'], 'snapshot.deck.projectId', 'invalid_snapshot');
  requireString(deck['title'], 'snapshot.deck.title', 'invalid_snapshot');
  requireRecord(deck['brief'], 'snapshot.deck.brief', 'invalid_snapshot');
  requireRecord(deck['theme'], 'snapshot.deck.theme', 'invalid_snapshot');
  const slideOrder = requireStringArray(
    deck['slideOrder'],
    'snapshot.deck.slideOrder',
    'invalid_snapshot',
  );
  requireUnique(slideOrder, 'snapshot.deck.slideOrder', 'invalid_snapshot');
  requireNonNegativeInteger(deck['version'], 'snapshot.deck.version', 'invalid_snapshot');
  requireOneOf(
    deck['status'],
    ['draft', 'validating', 'ready', 'published'],
    'snapshot.deck.status',
    'invalid_snapshot',
  );
  requireNonNegativeNumber(deck['createdAt'], 'snapshot.deck.createdAt', 'invalid_snapshot');
  requireNonNegativeNumber(deck['updatedAt'], 'snapshot.deck.updatedAt', 'invalid_snapshot');

  const slides = requireArray(snapshot['slides'], 'snapshot.slides', 'invalid_snapshot');
  const slideIds = new Set<string>();
  const elementOrderBySlide = new Map<string, string[]>();
  for (const [index, candidate] of slides.entries()) {
    const path = `snapshot.slides[${index}]`;
    const slide = requireRecord(candidate, path, 'invalid_snapshot');
    const slideId = requireString(slide['id'], `${path}.id`, 'invalid_snapshot');
    if (slideIds.has(slideId)) invalid('invalid_snapshot', `${path}.id duplicates ${slideId}.`);
    slideIds.add(slideId);
    requireExactString(slide['deckId'], deckId, `${path}.deckId`, 'invalid_snapshot');
    requireString(slide['title'], `${path}.title`, 'invalid_snapshot');
    requireString(slide['background'], `${path}.background`, 'invalid_snapshot');
    const elementOrder = requireStringArray(
      slide['elementOrder'],
      `${path}.elementOrder`,
      'invalid_snapshot',
    );
    requireUnique(elementOrder, `${path}.elementOrder`, 'invalid_snapshot');
    elementOrderBySlide.set(slideId, elementOrder);
    requireNonNegativeInteger(slide['version'], `${path}.version`, 'invalid_snapshot');
  }
  if (slideOrder.length !== slideIds.size || slideOrder.some((id) => !slideIds.has(id))) {
    invalid(
      'invalid_snapshot',
      'snapshot.deck.slideOrder must contain every slide ID exactly once.',
    );
  }

  const elements = requireArray(snapshot['elements'], 'snapshot.elements', 'invalid_snapshot');
  const elementIds = new Set<string>();
  const elementsBySlide = new Map<string, Set<string>>();
  for (const [index, candidate] of elements.entries()) {
    const path = `snapshot.elements[${index}]`;
    const element = requireRecord(candidate, path, 'invalid_snapshot');
    const elementId = requireString(element['id'], `${path}.id`, 'invalid_snapshot');
    if (elementIds.has(elementId))
      invalid('invalid_snapshot', `${path}.id duplicates ${elementId}.`);
    elementIds.add(elementId);
    const slideId = requireString(element['slideId'], `${path}.slideId`, 'invalid_snapshot');
    if (!slideIds.has(slideId)) {
      invalid('invalid_snapshot', `${path}.slideId references an unknown slide.`);
    }
    const onSlide = elementsBySlide.get(slideId) ?? new Set<string>();
    onSlide.add(elementId);
    elementsBySlide.set(slideId, onSlide);
    requireString(element['name'], `${path}.name`, 'invalid_snapshot');
    requireString(element['kind'], `${path}.kind`, 'invalid_snapshot');
    assertBoundingBox(element['bbox'], `${path}.bbox`, 'invalid_snapshot');
    requireRecord(element['style'], `${path}.style`, 'invalid_snapshot');
    requireStringArray(element['sourceIds'], `${path}.sourceIds`, 'invalid_snapshot');
    requireBoolean(element['locked'], `${path}.locked`, 'invalid_snapshot');
    requireStringArray(
      element['exportCapabilities'],
      `${path}.exportCapabilities`,
      'invalid_snapshot',
    );
    requireNonNegativeInteger(element['version'], `${path}.version`, 'invalid_snapshot');
  }
  for (const slideId of slideOrder) {
    const ordered = elementOrderBySlide.get(slideId) ?? [];
    const actual = elementsBySlide.get(slideId) ?? new Set<string>();
    if (ordered.length !== actual.size || ordered.some((id) => !actual.has(id))) {
      invalid(
        'invalid_snapshot',
        `Slide ${slideId} must list every owned element exactly once in elementOrder.`,
      );
    }
  }

  const sources = requireArray(snapshot['sources'], 'snapshot.sources', 'invalid_snapshot');
  const sourceIds = new Set<string>();
  for (const [index, candidate] of sources.entries()) {
    const path = `snapshot.sources[${index}]`;
    const source = requireRecord(candidate, path, 'invalid_snapshot');
    const sourceId = requireString(source['id'], `${path}.id`, 'invalid_snapshot');
    if (sourceIds.has(sourceId)) invalid('invalid_snapshot', `${path}.id duplicates ${sourceId}.`);
    sourceIds.add(sourceId);
    requireExactString(source['deckId'], deckId, `${path}.deckId`, 'invalid_snapshot');
    requireString(source['title'], `${path}.title`, 'invalid_snapshot');
    requireOneOf(
      source['sourceType'],
      ['internal', 'url', 'document', 'spreadsheet', 'note'],
      `${path}.sourceType`,
      'invalid_snapshot',
    );
    requireNonNegativeNumber(source['retrievedAt'], `${path}.retrievedAt`, 'invalid_snapshot');
    requireString(source['citation'], `${path}.citation`, 'invalid_snapshot');
  }
  for (const [index, candidate] of elements.entries()) {
    const element = candidate as Record<string, unknown>;
    const referenced = element['sourceIds'] as string[];
    if (referenced.some((id) => !sourceIds.has(id))) {
      invalid(
        'invalid_snapshot',
        `snapshot.elements[${index}].sourceIds references an unknown source.`,
      );
    }
  }

  return structuredClone(value) as DeckSnapshot;
}

export function parsePatchCommand(value: unknown): NodeSlidePatchCommand {
  assertSafeJson(value, 'patch');
  const patch = requireRecord(value, 'patch', 'invalid_patch');
  rejectUnknownKeys(
    patch,
    [
      'id',
      'deckId',
      'baseDeckVersion',
      'baseSlideVersions',
      'baseElementVersions',
      'scope',
      'operations',
      'source',
      'summary',
      'linkedCommentId',
      'traceId',
      'proposalKind',
      'parentPatchId',
      'affectedSlideIds',
      'affectedSlideDigest',
      'candidateDigest',
      'candidateValidation',
      'profileId',
      'profileDigest',
    ],
    'patch',
    'invalid_patch',
  );
  requireString(patch['id'], 'patch.id', 'invalid_patch');
  requireString(patch['deckId'], 'patch.deckId', 'invalid_patch');
  requireNonNegativeInteger(patch['baseDeckVersion'], 'patch.baseDeckVersion', 'invalid_patch');
  assertClockMap(patch['baseSlideVersions'], 'patch.baseSlideVersions');
  assertClockMap(patch['baseElementVersions'], 'patch.baseElementVersions');
  parsePatchScope(patch['scope']);
  const operations = requireArray(patch['operations'], 'patch.operations', 'invalid_patch');
  if (operations.length === 0 || operations.length > MAX_OPERATIONS) {
    invalid('invalid_patch', `patch.operations must contain 1-${MAX_OPERATIONS} operations.`);
  }
  operations.forEach((operation, index) => assertPatchOperation(operation, index));
  requireOneOf(
    patch['source'],
    ['human', 'agent', 'import', 'system'],
    'patch.source',
    'invalid_patch',
  );
  const summary = requireString(patch['summary'], 'patch.summary', 'invalid_patch');
  if (summary.length > 1_000) invalid('invalid_patch', 'patch.summary exceeds 1000 characters.');
  assertOptionalString(patch, 'linkedCommentId');
  assertOptionalString(patch, 'traceId');
  assertOptionalOneOf(patch, 'proposalKind', ['edit', 'propagation']);
  assertOptionalString(patch, 'parentPatchId');
  if (patch['affectedSlideIds'] !== undefined) {
    requireStringArray(patch['affectedSlideIds'], 'patch.affectedSlideIds', 'invalid_patch');
  }
  assertOptionalString(patch, 'affectedSlideDigest');
  assertOptionalString(patch, 'candidateDigest');
  if (patch['candidateValidation'] !== undefined) {
    requireRecord(patch['candidateValidation'], 'patch.candidateValidation', 'invalid_patch');
  }
  assertOptionalString(patch, 'profileId');
  assertOptionalString(patch, 'profileDigest');
  return structuredClone(value) as NodeSlidePatchCommand;
}

export function validateDeckPatch(
  snapshotValue: unknown,
  patchValue: unknown,
  options: { committedAt?: number } = {},
): NodeSlidePatchValidation {
  const snapshot = parseDeckSnapshot(snapshotValue);
  const patch = parsePatchCommand(patchValue);
  if (patch.deckId !== snapshot.deck.id || patch.scope.deckId !== snapshot.deck.id) {
    invalid('invalid_patch', 'Patch deckId and scope.deckId must match the snapshot deck.');
  }
  if (patch.baseDeckVersion !== snapshot.deck.version) {
    throw new NodeSlideExternalError(
      'stale_version',
      `Patch is pinned to deck version ${patch.baseDeckVersion}; current version is ${snapshot.deck.version}.`,
    );
  }
  assertPatchClocks(snapshot, patch);
  const scopeIssues = validatePatchScope(patch.scope, patch.operations);
  if (scopeIssues.length > 0) {
    throw new NodeSlideExternalError(
      'governance_violation',
      'Patch operations exceed the declared write scope.',
      scopeIssues,
    );
  }
  // Candidate compilation must be reproducible. Wall-clock event time belongs
  // on the proposal/application receipt, not inside the candidate snapshot.
  const committedAt = options.committedAt ?? snapshot.deck.updatedAt + 1;
  requireNonNegativeNumber(committedAt, 'committedAt', 'invalid_patch');
  let result: ReturnType<typeof applyDeckPatch>;
  try {
    result = applyDeckPatch(snapshot, patch, committedAt);
  } catch (error) {
    throw new NodeSlideExternalError(
      'governance_violation',
      error instanceof Error ? error.message : 'The canonical patch engine rejected the patch.',
    );
  }
  const candidateSnapshotDigest = digestJson(result.snapshot);
  if (patch.candidateDigest && patch.candidateDigest !== candidateSnapshotDigest) {
    throw new NodeSlideExternalError(
      'governance_violation',
      'patch.candidateDigest does not bind the canonical preflight candidate.',
    );
  }
  return {
    valid: true,
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    candidateDeckVersion: result.snapshot.deck.version,
    baseSnapshotDigest: digestJson(snapshot),
    patchDigest: digestJson(patch),
    candidateSnapshotDigest,
    affectedSlideIds: [...result.affectedSlideIds].sort(),
    affectedElementIds: [...result.affectedElementIds].sort(),
    candidateSnapshot: result.snapshot,
  };
}

export function proposeDeckPatch(
  snapshotValue: unknown,
  patchValue: unknown,
  options: { committedAt?: number; createdAt?: number } = {},
): NodeSlideFileProposal {
  const snapshot = parseDeckSnapshot(snapshotValue);
  const patch = parsePatchCommand(patchValue);
  const committedAt = options.committedAt ?? snapshot.deck.updatedAt + 1;
  const validation = validateDeckPatch(snapshot, patch, { committedAt });
  const createdAtMillis = options.createdAt ?? Date.now();
  requireNonNegativeNumber(createdAtMillis, 'createdAt', 'invalid_proposal');
  const createdAtDate = new Date(createdAtMillis);
  if (!Number.isFinite(createdAtDate.getTime())) {
    invalid('invalid_proposal', 'createdAt must be a valid timestamp.');
  }
  const createdAt = createdAtDate.toISOString();
  return {
    schemaVersion: NODESLIDE_FILE_PROPOSAL_VERSION,
    id: proposalIdFor(validation),
    status: 'ready',
    applied: false,
    createdAt,
    base: {
      deckId: snapshot.deck.id,
      deckVersion: snapshot.deck.version,
      snapshotDigest: validation.baseSnapshotDigest,
    },
    patch,
    candidate: {
      committedAt,
      deckVersion: validation.candidateDeckVersion,
      snapshotDigest: validation.candidateSnapshotDigest,
      affectedSlideIds: validation.affectedSlideIds,
      affectedElementIds: validation.affectedElementIds,
    },
  };
}

export function parseFileProposal(value: unknown): NodeSlideFileProposal {
  assertSafeJson(value, 'proposal');
  const proposal = requireRecord(value, 'proposal', 'invalid_proposal');
  rejectUnknownKeys(
    proposal,
    ['schemaVersion', 'id', 'status', 'applied', 'createdAt', 'base', 'patch', 'candidate'],
    'proposal',
    'invalid_proposal',
  );
  requireExactString(
    proposal['schemaVersion'],
    NODESLIDE_FILE_PROPOSAL_VERSION,
    'proposal.schemaVersion',
    'invalid_proposal',
  );
  requireString(proposal['id'], 'proposal.id', 'invalid_proposal');
  requireExactString(proposal['status'], 'ready', 'proposal.status', 'invalid_proposal');
  if (proposal['applied'] !== false) invalid('invalid_proposal', 'proposal.applied must be false.');
  const createdAt = requireString(proposal['createdAt'], 'proposal.createdAt', 'invalid_proposal');
  if (!Number.isFinite(Date.parse(createdAt))) {
    invalid('invalid_proposal', 'proposal.createdAt must be an ISO date-time.');
  }
  const base = requireRecord(proposal['base'], 'proposal.base', 'invalid_proposal');
  rejectUnknownKeys(
    base,
    ['deckId', 'deckVersion', 'snapshotDigest'],
    'proposal.base',
    'invalid_proposal',
  );
  requireString(base['deckId'], 'proposal.base.deckId', 'invalid_proposal');
  requireNonNegativeInteger(base['deckVersion'], 'proposal.base.deckVersion', 'invalid_proposal');
  requireDigest(base['snapshotDigest'], 'proposal.base.snapshotDigest', 'invalid_proposal');
  parsePatchCommand(proposal['patch']);
  const candidate = requireRecord(proposal['candidate'], 'proposal.candidate', 'invalid_proposal');
  rejectUnknownKeys(
    candidate,
    ['committedAt', 'deckVersion', 'snapshotDigest', 'affectedSlideIds', 'affectedElementIds'],
    'proposal.candidate',
    'invalid_proposal',
  );
  requireNonNegativeNumber(
    candidate['committedAt'],
    'proposal.candidate.committedAt',
    'invalid_proposal',
  );
  requireNonNegativeInteger(
    candidate['deckVersion'],
    'proposal.candidate.deckVersion',
    'invalid_proposal',
  );
  requireDigest(
    candidate['snapshotDigest'],
    'proposal.candidate.snapshotDigest',
    'invalid_proposal',
  );
  requireStringArray(
    candidate['affectedSlideIds'],
    'proposal.candidate.affectedSlideIds',
    'invalid_proposal',
  );
  requireStringArray(
    candidate['affectedElementIds'],
    'proposal.candidate.affectedElementIds',
    'invalid_proposal',
  );
  return structuredClone(value) as NodeSlideFileProposal;
}

export function applyDeckProposal(
  snapshotValue: unknown,
  proposalValue: unknown,
  options: { approvedProposalId: string; appliedAt?: number },
): NodeSlideFileApplication {
  const snapshot = parseDeckSnapshot(snapshotValue);
  const proposal = parseFileProposal(proposalValue);
  if (!options.approvedProposalId || options.approvedProposalId !== proposal.id) {
    throw new NodeSlideExternalError(
      'approval_required',
      `Explicit approval must equal proposal ID ${proposal.id}.`,
    );
  }
  if (
    proposal.base.deckId !== snapshot.deck.id ||
    proposal.base.deckVersion !== snapshot.deck.version ||
    proposal.base.snapshotDigest !== digestJson(snapshot)
  ) {
    throw new NodeSlideExternalError(
      'stale_version',
      'The proposal base no longer matches the supplied deck snapshot.',
    );
  }
  const validation = validateDeckPatch(snapshot, proposal.patch, {
    committedAt: proposal.candidate.committedAt,
  });
  if (proposal.id !== proposalIdFor(validation)) {
    throw new NodeSlideExternalError(
      'governance_violation',
      'The proposal ID does not bind the base snapshot, patch, and candidate digests.',
    );
  }
  if (
    validation.candidateDeckVersion !== proposal.candidate.deckVersion ||
    validation.candidateSnapshotDigest !== proposal.candidate.snapshotDigest ||
    !sameStrings(validation.affectedSlideIds, proposal.candidate.affectedSlideIds) ||
    !sameStrings(validation.affectedElementIds, proposal.candidate.affectedElementIds)
  ) {
    throw new NodeSlideExternalError(
      'governance_violation',
      'The proposal candidate binding does not match canonical patch preflight.',
    );
  }
  const appliedAt = options.appliedAt ?? Date.now();
  requireNonNegativeNumber(appliedAt, 'appliedAt', 'invalid_proposal');
  const appliedAtDate = new Date(appliedAt);
  if (!Number.isFinite(appliedAtDate.getTime())) {
    invalid('invalid_proposal', 'appliedAt must be a valid timestamp.');
  }
  const receiptBinding = digestJson({
    proposalId: proposal.id,
    baseSnapshotDigest: validation.baseSnapshotDigest,
    resultingSnapshotDigest: validation.candidateSnapshotDigest,
    appliedAt,
  });
  return {
    schemaVersion: NODESLIDE_FILE_APPLICATION_VERSION,
    snapshot: validation.candidateSnapshot,
    receipt: {
      id: `application:${receiptBinding.slice('sha256:'.length, 'sha256:'.length + 32)}`,
      proposalId: proposal.id,
      deckId: snapshot.deck.id,
      baseDeckVersion: snapshot.deck.version,
      resultingDeckVersion: validation.candidateDeckVersion,
      baseSnapshotDigest: validation.baseSnapshotDigest,
      resultingSnapshotDigest: validation.candidateSnapshotDigest,
      patchDigest: validation.patchDigest,
      approval: 'exact_proposal_id',
      appliedAt: appliedAtDate.toISOString(),
      affectedSlideIds: validation.affectedSlideIds,
      affectedElementIds: validation.affectedElementIds,
    },
  };
}

export function digestJson(value: unknown): string {
  assertSafeJson(value, 'digest input');
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

export function externalErrorEnvelope(error: unknown): {
  ok: false;
  error: { code: string; message: string; issues: readonly string[] };
} {
  if (error instanceof NodeSlideExternalError) {
    return {
      ok: false,
      error: { code: error.code, message: error.message, issues: error.issues },
    };
  }
  return {
    ok: false,
    error: {
      code: 'unexpected_error',
      message: error instanceof Error ? error.message : 'Unknown NodeSlide external-agent error.',
      issues: [],
    },
  };
}

function parsePatchScope(value: unknown): PatchScope {
  const scope = requireRecord(value, 'patch.scope', 'invalid_patch');
  const kind = requireOneOf(
    scope['kind'],
    ['deck', 'slide', 'elements', 'bounding_box', 'comment'],
    'patch.scope.kind',
    'invalid_patch',
  );
  const keys = ['kind', 'deckId', 'operationMode'];
  requireString(scope['deckId'], 'patch.scope.deckId', 'invalid_patch');
  requireOneOf(
    scope['operationMode'],
    ['copy', 'style', 'layout', 'unrestricted'],
    'patch.scope.operationMode',
    'invalid_patch',
  );
  if (kind !== 'deck') {
    keys.push('slideIds');
    const slideIds = requireStringArray(scope['slideIds'], 'patch.scope.slideIds', 'invalid_patch');
    requireUnique(slideIds, 'patch.scope.slideIds', 'invalid_patch');
  }
  if (kind === 'elements' || kind === 'bounding_box' || kind === 'comment') {
    keys.push('elementIds');
    const elementIds = requireStringArray(
      scope['elementIds'],
      'patch.scope.elementIds',
      'invalid_patch',
    );
    requireUnique(elementIds, 'patch.scope.elementIds', 'invalid_patch');
  }
  if (kind === 'bounding_box') {
    keys.push('bbox');
    assertBoundingBox(scope['bbox'], 'patch.scope.bbox', 'invalid_patch');
  }
  if (kind === 'comment') {
    keys.push('commentId');
    requireString(scope['commentId'], 'patch.scope.commentId', 'invalid_patch');
  }
  rejectUnknownKeys(scope, keys, 'patch.scope', 'invalid_patch');
  return structuredClone(value) as PatchScope;
}

function assertPatchOperation(value: unknown, index: number): asserts value is PatchOperation {
  const path = `patch.operations[${index}]`;
  const operation = requireRecord(value, path, 'invalid_patch');
  const op = requireOneOf(
    operation['op'],
    [
      'move',
      'resize',
      'replace_text',
      'update_style',
      'update_chart',
      'update_image',
      'add_element',
      'remove_element',
      'set_visibility_v1',
      'group_elements_v1',
      'ungroup_elements_v1',
      'reorder_element_v1',
      'add_slide',
      'remove_slide',
      'reorder_slide',
      'update_slide',
      'update_deck',
    ],
    `${path}.op`,
    'invalid_patch',
  );
  const keys = ['op'];
  if (op !== 'add_slide' && op !== 'update_deck') {
    keys.push('slideId');
    requireString(operation['slideId'], `${path}.slideId`, 'invalid_patch');
  }
  if (
    op === 'move' ||
    op === 'resize' ||
    op === 'replace_text' ||
    op === 'update_style' ||
    op === 'update_chart' ||
    op === 'update_image' ||
    op === 'remove_element' ||
    op === 'set_visibility_v1' ||
    op === 'reorder_element_v1'
  ) {
    keys.push('elementId');
    requireString(operation['elementId'], `${path}.elementId`, 'invalid_patch');
  }
  switch (op) {
    case 'move':
      keys.push('x', 'y');
      requireFiniteNumber(operation['x'], `${path}.x`, 'invalid_patch');
      requireFiniteNumber(operation['y'], `${path}.y`, 'invalid_patch');
      break;
    case 'resize':
      keys.push('width', 'height');
      requireFiniteNumber(operation['width'], `${path}.width`, 'invalid_patch');
      requireFiniteNumber(operation['height'], `${path}.height`, 'invalid_patch');
      break;
    case 'replace_text':
      keys.push('text');
      requireString(operation['text'], `${path}.text`, 'invalid_patch', true);
      if (operation['sourceIds'] !== undefined) {
        keys.push('sourceIds');
        requireStringArray(operation['sourceIds'], `${path}.sourceIds`, 'invalid_patch');
      }
      break;
    case 'update_style':
      keys.push('properties');
      requireRecord(operation['properties'], `${path}.properties`, 'invalid_patch');
      break;
    case 'update_chart':
      if (operation['chart'] !== undefined) {
        keys.push('chart');
        requireRecord(operation['chart'], `${path}.chart`, 'invalid_patch');
      }
      if (operation['chartType'] !== undefined) {
        keys.push('chartType');
        requireString(operation['chartType'], `${path}.chartType`, 'invalid_patch');
      }
      if (operation['series'] !== undefined) {
        keys.push('series');
        requireArray(operation['series'], `${path}.series`, 'invalid_patch');
      }
      if (
        operation['chart'] === undefined &&
        operation['chartType'] === undefined &&
        operation['series'] === undefined
      ) {
        invalid('invalid_patch', `${path} must provide chart, chartType, or series.`);
      }
      break;
    case 'update_image':
      keys.push('imageUrl', 'altText');
      requireString(operation['imageUrl'], `${path}.imageUrl`, 'invalid_patch');
      requireString(operation['altText'], `${path}.altText`, 'invalid_patch', true);
      if (operation['credit'] !== undefined) {
        keys.push('credit');
        requireString(operation['credit'], `${path}.credit`, 'invalid_patch');
      }
      if (operation['sourceIds'] !== undefined) {
        keys.push('sourceIds');
        requireStringArray(operation['sourceIds'], `${path}.sourceIds`, 'invalid_patch');
      }
      break;
    case 'add_element':
      keys.push('element');
      assertLooseElement(operation['element'], `${path}.element`);
      break;
    case 'remove_element':
      break;
    case 'set_visibility_v1':
      keys.push('visible');
      requireBoolean(operation['visible'], `${path}.visible`, 'invalid_patch');
      break;
    case 'group_elements_v1':
    case 'ungroup_elements_v1': {
      keys.push('elementIds', 'groupId');
      const ids = requireStringArray(
        operation['elementIds'],
        `${path}.elementIds`,
        'invalid_patch',
      );
      requireUnique(ids, `${path}.elementIds`, 'invalid_patch');
      requireString(operation['groupId'], `${path}.groupId`, 'invalid_patch');
      break;
    }
    case 'reorder_element_v1':
      keys.push('index');
      requireNonNegativeInteger(operation['index'], `${path}.index`, 'invalid_patch');
      break;
    case 'add_slide': {
      keys.push('slide', 'elements', 'index');
      assertLooseSlide(operation['slide'], `${path}.slide`);
      const elements = requireArray(operation['elements'], `${path}.elements`, 'invalid_patch');
      elements.forEach((element, elementIndex) =>
        assertLooseElement(element, `${path}.elements[${elementIndex}]`),
      );
      requireNonNegativeInteger(operation['index'], `${path}.index`, 'invalid_patch');
      break;
    }
    case 'remove_slide':
      break;
    case 'reorder_slide':
      keys.push('index');
      requireNonNegativeInteger(operation['index'], `${path}.index`, 'invalid_patch');
      break;
    case 'update_slide':
      keys.push('properties');
      requireRecord(operation['properties'], `${path}.properties`, 'invalid_patch');
      break;
    case 'update_deck':
      keys.push('properties');
      requireRecord(operation['properties'], `${path}.properties`, 'invalid_patch');
      break;
  }
  rejectUnknownKeys(operation, keys, path, 'invalid_patch');
}

function assertPatchClocks(snapshot: DeckSnapshot, patch: NodeSlidePatchCommand): void {
  const slides = new Map(snapshot.slides.map((slide) => [slide.id, slide]));
  const elements = new Map(snapshot.elements.map((element) => [element.id, element]));
  for (const [id, version] of Object.entries(patch.baseSlideVersions)) {
    const current = slides.get(id);
    if (!current) invalid('invalid_patch', `baseSlideVersions contains unknown slide ${id}.`);
    if (current.version !== version) {
      throw new NodeSlideExternalError(
        'stale_version',
        `Slide ${id} is pinned to version ${version}; current version is ${current.version}.`,
      );
    }
  }
  for (const [id, version] of Object.entries(patch.baseElementVersions)) {
    const current = elements.get(id);
    if (!current) invalid('invalid_patch', `baseElementVersions contains unknown element ${id}.`);
    if (current.version !== version) {
      throw new NodeSlideExternalError(
        'stale_version',
        `Element ${id} is pinned to version ${version}; current version is ${current.version}.`,
      );
    }
  }
  const targetedSlides = new Set<string>();
  const targetedElements = new Set<string>();
  for (const operation of patch.operations) {
    if (operation.op !== 'add_slide' && operation.op !== 'update_deck') {
      if (!slides.has(operation.slideId)) {
        invalid(
          'invalid_patch',
          `Operation ${operation.op} targets unknown slide ${operation.slideId}.`,
        );
      }
      targetedSlides.add(operation.slideId);
    }
    for (const id of operationElementIds(operation)) {
      if (elements.has(id)) targetedElements.add(id);
    }
    if (operation.op === 'add_element') {
      if (elements.has(operation.element.id)) {
        invalid('invalid_patch', `add_element reuses existing element ID ${operation.element.id}.`);
      }
      if (operation.element.slideId !== operation.slideId) {
        invalid('invalid_patch', 'add_element element.slideId must match operation.slideId.');
      }
    }
    if (operation.op === 'add_slide') {
      if (operation.slide.deckId !== snapshot.deck.id) {
        invalid('invalid_patch', 'add_slide slide.deckId must match the snapshot deck.');
      }
      if (slides.has(operation.slide.id)) {
        invalid('invalid_patch', `add_slide reuses existing slide ID ${operation.slide.id}.`);
      }
    }
  }
  for (const slideId of targetedSlides) {
    if (patch.baseSlideVersions[slideId] === undefined) {
      invalid('invalid_patch', `Patch must pin targeted slide ${slideId}.`);
    }
  }
  for (const elementId of targetedElements) {
    if (patch.baseElementVersions[elementId] === undefined) {
      invalid('invalid_patch', `Patch must pin targeted element ${elementId}.`);
    }
  }
}

function assertLooseSlide(value: unknown, path: string): void {
  const slide = requireRecord(value, path, 'invalid_patch');
  requireString(slide['id'], `${path}.id`, 'invalid_patch');
  requireString(slide['deckId'], `${path}.deckId`, 'invalid_patch');
  requireString(slide['title'], `${path}.title`, 'invalid_patch');
  requireString(slide['background'], `${path}.background`, 'invalid_patch');
  const order = requireStringArray(slide['elementOrder'], `${path}.elementOrder`, 'invalid_patch');
  requireUnique(order, `${path}.elementOrder`, 'invalid_patch');
  requireNonNegativeInteger(slide['version'], `${path}.version`, 'invalid_patch');
}

function assertLooseElement(value: unknown, path: string): void {
  const element = requireRecord(value, path, 'invalid_patch');
  requireString(element['id'], `${path}.id`, 'invalid_patch');
  requireString(element['slideId'], `${path}.slideId`, 'invalid_patch');
  requireString(element['name'], `${path}.name`, 'invalid_patch');
  requireString(element['kind'], `${path}.kind`, 'invalid_patch');
  assertBoundingBox(element['bbox'], `${path}.bbox`, 'invalid_patch');
  requireRecord(element['style'], `${path}.style`, 'invalid_patch');
  requireStringArray(element['sourceIds'], `${path}.sourceIds`, 'invalid_patch');
  requireBoolean(element['locked'], `${path}.locked`, 'invalid_patch');
  requireStringArray(element['exportCapabilities'], `${path}.exportCapabilities`, 'invalid_patch');
  requireNonNegativeInteger(element['version'], `${path}.version`, 'invalid_patch');
}

function assertBoundingBox(value: unknown, path: string, code: NodeSlideExternalErrorCode): void {
  const bbox = requireRecord(value, path, code);
  rejectUnknownKeys(bbox, ['x', 'y', 'width', 'height'], path, code);
  requireFiniteNumber(bbox['x'], `${path}.x`, code);
  requireFiniteNumber(bbox['y'], `${path}.y`, code);
  requireFiniteNumber(bbox['width'], `${path}.width`, code);
  requireFiniteNumber(bbox['height'], `${path}.height`, code);
}

function assertClockMap(value: unknown, path: string): void {
  const clock = requireRecord(value, path, 'invalid_patch');
  for (const [id, version] of Object.entries(clock)) {
    if (!id) invalid('invalid_patch', `${path} contains an empty ID.`);
    requireNonNegativeInteger(version, `${path}.${id}`, 'invalid_patch');
  }
}

function assertOptionalString(record: Record<string, unknown>, key: string): void {
  if (record[key] !== undefined) requireString(record[key], `patch.${key}`, 'invalid_patch');
}

function assertOptionalOneOf(
  record: Record<string, unknown>,
  key: string,
  choices: readonly string[],
): void {
  if (record[key] !== undefined)
    requireOneOf(record[key], choices, `patch.${key}`, 'invalid_patch');
}

function requireRecord(
  value: unknown,
  path: string,
  code: NodeSlideExternalErrorCode,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(code, `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string, code: NodeSlideExternalErrorCode): unknown[] {
  if (!Array.isArray(value)) invalid(code, `${path} must be an array.`);
  return value;
}

function requireString(
  value: unknown,
  path: string,
  code: NodeSlideExternalErrorCode,
  allowEmpty = false,
): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    invalid(code, `${path} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
  }
  return value;
}

function requireExactString(
  value: unknown,
  expected: string,
  path: string,
  code: NodeSlideExternalErrorCode,
): void {
  if (value !== expected) invalid(code, `${path} must equal ${JSON.stringify(expected)}.`);
}

function requireStringArray(
  value: unknown,
  path: string,
  code: NodeSlideExternalErrorCode,
): string[] {
  const values = requireArray(value, path, code);
  return values.map((candidate, index) => requireString(candidate, `${path}[${index}]`, code));
}

function requireUnique(
  values: readonly string[],
  path: string,
  code: NodeSlideExternalErrorCode,
): void {
  if (new Set(values).size !== values.length) invalid(code, `${path} must not contain duplicates.`);
}

function requireBoolean(value: unknown, path: string, code: NodeSlideExternalErrorCode): boolean {
  if (typeof value !== 'boolean') invalid(code, `${path} must be a boolean.`);
  return value;
}

function requireFiniteNumber(
  value: unknown,
  path: string,
  code: NodeSlideExternalErrorCode,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(code, `${path} must be a finite number.`);
  }
  return value;
}

function requireNonNegativeNumber(
  value: unknown,
  path: string,
  code: NodeSlideExternalErrorCode,
): number {
  const number = requireFiniteNumber(value, path, code);
  if (number < 0) invalid(code, `${path} must be non-negative.`);
  return number;
}

function requireNonNegativeInteger(
  value: unknown,
  path: string,
  code: NodeSlideExternalErrorCode,
): number {
  const number = requireNonNegativeNumber(value, path, code);
  if (!Number.isInteger(number)) invalid(code, `${path} must be an integer.`);
  return number;
}

function requireOneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  path: string,
  code: NodeSlideExternalErrorCode,
): T[number] {
  if (typeof value !== 'string' || !choices.includes(value)) {
    invalid(code, `${path} must be one of ${choices.join(', ')}.`);
  }
  return value as T[number];
}

function requireDigest(value: unknown, path: string, code: NodeSlideExternalErrorCode): void {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    invalid(code, `${path} must be a full sha256 digest.`);
  }
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  code: NodeSlideExternalErrorCode,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) invalid(code, `${path} contains unknown fields: ${unknown.join(', ')}.`);
}

function assertSafeJson(value: unknown, path: string): void {
  let nodes = 0;
  const visit = (candidate: unknown, candidatePath: string, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES)
      invalid('governance_violation', `${path} exceeds the JSON node limit.`);
    if (depth > MAX_JSON_DEPTH)
      invalid('governance_violation', `${path} exceeds the JSON depth limit.`);
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') {
      return;
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        invalid('governance_violation', `${candidatePath} contains a non-finite number.`);
      }
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${candidatePath}[${index}]`, depth + 1));
      return;
    }
    if (candidate && typeof candidate === 'object') {
      for (const [key, item] of Object.entries(candidate)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          invalid('governance_violation', `${candidatePath} contains forbidden key ${key}.`);
        }
        visit(item, `${candidatePath}.${key}`, depth + 1);
      }
      return;
    }
    invalid('governance_violation', `${candidatePath} is not JSON-serializable.`);
  };
  visit(value, path, 0);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join('\u0000') === [...right].sort().join('\u0000');
}

function proposalIdFor(
  validation: Pick<
    NodeSlidePatchValidation,
    'baseSnapshotDigest' | 'patchDigest' | 'candidateSnapshotDigest'
  >,
): string {
  const binding = digestJson({
    baseSnapshotDigest: validation.baseSnapshotDigest,
    patchDigest: validation.patchDigest,
    candidateSnapshotDigest: validation.candidateSnapshotDigest,
  });
  return `proposal:${binding.slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function invalid(code: NodeSlideExternalErrorCode, message: string): never {
  throw new NodeSlideExternalError(code, message);
}
