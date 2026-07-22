import { createHash } from 'node:crypto';

import type { NodeSlidePatchCommand } from '@nodeslide/backend';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  type PatchOperation,
  type PatchScope,
  operationElementIds,
} from '@nodeslide/contracts';
import {
  applyDeckPatch,
  isAllowedNodeSlideAddedImageUrl,
  validateNodeSlidePatch,
  validateNodeSlideSnapshot,
  validatePatchScope,
} from '@nodeslide/engine';

export const NODESLIDE_FILE_PROPOSAL_VERSION = 'nodeslide.file-proposal/v1' as const;
export const NODESLIDE_FILE_APPLICATION_VERSION = 'nodeslide.file-application/v1' as const;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 250_000;
const MAX_OPERATIONS = 128;
const ELEMENT_KINDS = ['text', 'shape', 'image', 'chart', 'math', 'video', 'connector'] as const;
const EXPORT_CAPABILITIES = [
  'web_native',
  'pptx_editable',
  'pptx_static_fallback',
  'google_importable',
  'web_only',
] as const;
const CHART_TYPES = [
  'bar',
  'bar-horizontal',
  'line',
  'area',
  'pie',
  'donut',
  'stacked-bar',
] as const;
const SLIDE_ARCHETYPES = [
  'statement',
  'stat-dominant',
  'chart-dominant',
  'media-dominant',
  'comparison',
  'split',
] as const;

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
    /** Caller confirmation of the bound proposal ID; not an independent authorization receipt. */
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
  const { deckId, slideOrder } = assertDeck(deck, 'snapshot.deck');

  const slides = requireArray(snapshot['slides'], 'snapshot.slides', 'invalid_snapshot');
  const slideIds = new Set<string>();
  const elementOrderBySlide = new Map<string, string[]>();
  for (const [index, candidate] of slides.entries()) {
    const path = `snapshot.slides[${index}]`;
    const { slideId, elementOrder, declaredDeckId } = assertSlide(
      candidate,
      path,
      'invalid_snapshot',
    );
    if (slideIds.has(slideId)) invalid('invalid_snapshot', `${path}.id duplicates ${slideId}.`);
    slideIds.add(slideId);
    requireExactString(declaredDeckId, deckId, `${path}.deckId`, 'invalid_snapshot');
    elementOrderBySlide.set(slideId, elementOrder);
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
    const { elementId, slideId } = assertSlideElement(candidate, path, 'invalid_snapshot');
    if (elementIds.has(elementId))
      invalid('invalid_snapshot', `${path}.id duplicates ${elementId}.`);
    elementIds.add(elementId);
    if (!slideIds.has(slideId)) {
      invalid('invalid_snapshot', `${path}.slideId references an unknown slide.`);
    }
    const onSlide = elementsBySlide.get(slideId) ?? new Set<string>();
    onSlide.add(elementId);
    elementsBySlide.set(slideId, onSlide);
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
    const { sourceId, declaredDeckId } = assertSourceRecord(candidate, path, 'invalid_snapshot');
    if (sourceIds.has(sourceId)) invalid('invalid_snapshot', `${path}.id duplicates ${sourceId}.`);
    sourceIds.add(sourceId);
    requireExactString(declaredDeckId, deckId, `${path}.deckId`, 'invalid_snapshot');
  }
  for (const [index, candidate] of elements.entries()) {
    const element = candidate as Record<string, unknown>;
    const referenced = [...(element['sourceIds'] as string[]), ...nestedSourceIds(element)];
    if (referenced.some((id) => !sourceIds.has(id))) {
      invalid(
        'invalid_snapshot',
        `snapshot.elements[${index}].sourceIds references an unknown source.`,
      );
    }
  }

  const parsed = structuredClone(value) as DeckSnapshot;
  const validation = validateNodeSlideSnapshot(parsed, parsed.deck.updatedAt);
  const errors = validation.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message);
  if (!validation.ok || errors.length > 0) {
    throw new NodeSlideExternalError(
      'invalid_snapshot',
      'The snapshot failed NodeSlide canonical validation.',
      errors,
    );
  }
  return parsed;
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
  if (
    patch['proposalKind'] === 'propagation' ||
    patch['parentPatchId'] !== undefined ||
    patch['affectedSlideIds'] !== undefined ||
    patch['affectedSlideDigest'] !== undefined
  ) {
    invalid(
      'invalid_patch',
      'Offline patches accept edit proposals only; propagation requires an authoritative host ledger.',
    );
  }
  assertOptionalDigest(patch, 'candidateDigest');
  if (patch['candidateValidation'] !== undefined) {
    invalid(
      'invalid_patch',
      'patch.candidateValidation is a derived receipt and is not accepted from offline callers.',
    );
  }
  if (patch['profileId'] !== undefined || patch['profileDigest'] !== undefined) {
    invalid(
      'invalid_patch',
      'Offline patches cannot resolve signature profiles; profile metadata requires an authoritative host.',
    );
  }
  return structuredClone(value) as NodeSlidePatchCommand;
}

export function validateDeckPatch(
  snapshotValue: unknown,
  patchValue: unknown,
  options: { committedAt?: number } = {},
): NodeSlidePatchValidation {
  const snapshot = parseDeckSnapshot(snapshotValue);
  const patch = parsePatchCommand(patchValue);
  if (
    snapshot.deck.activeSignatureProfileId !== undefined ||
    snapshot.deck.activeSignatureProfileDigest !== undefined
  ) {
    throw new NodeSlideExternalError(
      'governance_violation',
      'Offline mutation cannot validate an active signature profile; use an authoritative host.',
    );
  }
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
  const patchIssues = validateNodeSlidePatch(snapshot, patch);
  if (patchIssues.length > 0) {
    throw new NodeSlideExternalError(
      'governance_violation',
      'The patch failed NodeSlide canonical validation.',
      patchIssues,
    );
  }
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
  let candidateSnapshot: DeckSnapshot;
  try {
    candidateSnapshot = parseDeckSnapshot(result.snapshot);
  } catch (error) {
    throw new NodeSlideExternalError(
      'governance_violation',
      'The canonical patch engine produced a candidate that failed the external schema boundary.',
      [error instanceof Error ? error.message : 'Candidate snapshot validation failed.'],
    );
  }
  const candidateSnapshotDigest = digestJson(candidateSnapshot);
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
    candidateDeckVersion: candidateSnapshot.deck.version,
    baseSnapshotDigest: digestJson(snapshot),
    patchDigest: digestJson(patch),
    candidateSnapshotDigest,
    affectedSlideIds: [...result.affectedSlideIds].sort(),
    affectedElementIds: [...result.affectedElementIds].sort(),
    candidateSnapshot,
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
      `Explicit caller confirmation must equal proposal ID ${proposal.id}.`,
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
        const sourceIds = requireStringArray(
          operation['sourceIds'],
          `${path}.sourceIds`,
          'invalid_patch',
        );
        requireUnique(sourceIds, `${path}.sourceIds`, 'invalid_patch');
      }
      break;
    case 'update_style':
      keys.push('properties');
      assertElementStyle(operation['properties'], `${path}.properties`, 'invalid_patch');
      break;
    case 'update_chart':
      if (operation['chart'] !== undefined) {
        keys.push('chart');
        assertChartData(operation['chart'], `${path}.chart`, 'invalid_patch');
      }
      if (operation['chartType'] !== undefined) {
        keys.push('chartType');
        requireOneOf(operation['chartType'], CHART_TYPES, `${path}.chartType`, 'invalid_patch');
      }
      if (operation['series'] !== undefined) {
        keys.push('series');
        assertChartSeriesArray(operation['series'], `${path}.series`, 'invalid_patch');
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
        const sourceIds = requireStringArray(
          operation['sourceIds'],
          `${path}.sourceIds`,
          'invalid_patch',
        );
        requireUnique(sourceIds, `${path}.sourceIds`, 'invalid_patch');
      }
      break;
    case 'add_element':
      keys.push('element');
      assertSlideElement(operation['element'], `${path}.element`, 'invalid_patch');
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
      const slide = assertSlide(operation['slide'], `${path}.slide`, 'invalid_patch');
      const elements = requireArray(operation['elements'], `${path}.elements`, 'invalid_patch');
      const elementIds = elements.map((element, elementIndex) => {
        const parsed = assertSlideElement(
          element,
          `${path}.elements[${elementIndex}]`,
          'invalid_patch',
        );
        requireExactString(
          parsed.slideId,
          slide.slideId,
          `${path}.elements[${elementIndex}].slideId`,
          'invalid_patch',
        );
        return parsed.elementId;
      });
      requireUnique(elementIds, `${path}.elements`, 'invalid_patch');
      if (
        slide.elementOrder.length !== elementIds.length ||
        slide.elementOrder.some((id) => !elementIds.includes(id))
      ) {
        invalid(
          'invalid_patch',
          `${path}.slide.elementOrder must contain every bundled element ID exactly once.`,
        );
      }
      requireNonNegativeInteger(operation['index'], `${path}.index`, 'invalid_patch');
      break;
    }
    case 'remove_slide':
      break;
    case 'reorder_slide':
      keys.push('index');
      requireNonNegativeInteger(operation['index'], `${path}.index`, 'invalid_patch');
      break;
    case 'update_slide': {
      keys.push('properties');
      const properties = requireRecord(
        operation['properties'],
        `${path}.properties`,
        'invalid_patch',
      );
      rejectUnknownKeys(
        properties,
        ['title', 'notes', 'background'],
        `${path}.properties`,
        'invalid_patch',
      );
      if (properties['title'] !== undefined) {
        requireString(properties['title'], `${path}.properties.title`, 'invalid_patch');
      }
      if (properties['notes'] !== undefined) {
        requireString(properties['notes'], `${path}.properties.notes`, 'invalid_patch', true);
      }
      if (properties['background'] !== undefined) {
        requireString(properties['background'], `${path}.properties.background`, 'invalid_patch');
      }
      break;
    }
    case 'update_deck': {
      keys.push('properties');
      const properties = requireRecord(
        operation['properties'],
        `${path}.properties`,
        'invalid_patch',
      );
      rejectUnknownKeys(properties, ['title'], `${path}.properties`, 'invalid_patch');
      requireString(properties['title'], `${path}.properties.title`, 'invalid_patch');
      break;
    }
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

function assertDeck(value: unknown, path: string): { deckId: string; slideOrder: string[] } {
  const deck = requireRecord(value, path, 'invalid_snapshot');
  rejectUnknownKeys(
    deck,
    [
      'schemaVersion',
      'toolchainVersion',
      'id',
      'projectId',
      'title',
      'brief',
      'theme',
      'slideOrder',
      'version',
      'status',
      'activeSignatureProfileId',
      'activeSignatureProfileDigest',
      'shareSlug',
      'createdAt',
      'updatedAt',
    ],
    path,
    'invalid_snapshot',
  );
  requireExactString(
    deck['schemaVersion'],
    NODESLIDE_SCHEMA_VERSION,
    `${path}.schemaVersion`,
    'invalid_snapshot',
  );
  requireString(deck['toolchainVersion'], `${path}.toolchainVersion`, 'invalid_snapshot');
  const deckId = requireString(deck['id'], `${path}.id`, 'invalid_snapshot');
  requireString(deck['projectId'], `${path}.projectId`, 'invalid_snapshot');
  requireString(deck['title'], `${path}.title`, 'invalid_snapshot');
  assertDeckBrief(deck['brief'], `${path}.brief`, 'invalid_snapshot');
  assertTheme(deck['theme'], `${path}.theme`, 'invalid_snapshot');
  const slideOrder = requireStringArray(
    deck['slideOrder'],
    `${path}.slideOrder`,
    'invalid_snapshot',
  );
  requireUnique(slideOrder, `${path}.slideOrder`, 'invalid_snapshot');
  requireNonNegativeInteger(deck['version'], `${path}.version`, 'invalid_snapshot');
  requireOneOf(
    deck['status'],
    ['draft', 'validating', 'ready', 'published'],
    `${path}.status`,
    'invalid_snapshot',
  );
  assertOptionalTypedString(deck, 'activeSignatureProfileId', path, 'invalid_snapshot');
  assertOptionalTypedString(deck, 'activeSignatureProfileDigest', path, 'invalid_snapshot');
  if (
    (deck['activeSignatureProfileId'] === undefined) !==
    (deck['activeSignatureProfileDigest'] === undefined)
  ) {
    invalid(
      'invalid_snapshot',
      `${path}.activeSignatureProfileId and activeSignatureProfileDigest must appear together.`,
    );
  }
  assertOptionalTypedString(deck, 'shareSlug', path, 'invalid_snapshot');
  requireNonNegativeNumber(deck['createdAt'], `${path}.createdAt`, 'invalid_snapshot');
  requireNonNegativeNumber(deck['updatedAt'], `${path}.updatedAt`, 'invalid_snapshot');
  return { deckId, slideOrder };
}

function assertDeckBrief(value: unknown, path: string, code: NodeSlideExternalErrorCode): void {
  const brief = requireRecord(value, path, code);
  rejectUnknownKeys(brief, ['prompt', 'audience', 'purpose', 'successCriteria'], path, code);
  requireString(brief['prompt'], `${path}.prompt`, code);
  requireString(brief['audience'], `${path}.audience`, code);
  requireString(brief['purpose'], `${path}.purpose`, code);
  requireStringArray(brief['successCriteria'], `${path}.successCriteria`, code);
}

function assertTheme(value: unknown, path: string, code: NodeSlideExternalErrorCode): void {
  const theme = requireRecord(value, path, code);
  rejectUnknownKeys(
    theme,
    ['id', 'name', 'mode', 'colors', 'typography', 'defaultRadius', 'spacingUnit'],
    path,
    code,
  );
  requireString(theme['id'], `${path}.id`, code);
  requireString(theme['name'], `${path}.name`, code);
  requireOneOf(theme['mode'], ['light', 'dark'], `${path}.mode`, code);
  const colors = requireRecord(theme['colors'], `${path}.colors`, code);
  const colorKeys = [
    'canvas',
    'ink',
    'muted',
    'accent',
    'accentSoft',
    'insight',
    'insightInk',
    'trace',
    'border',
  ] as const;
  rejectUnknownKeys(colors, colorKeys, `${path}.colors`, code);
  for (const key of colorKeys) requireString(colors[key], `${path}.colors.${key}`, code);
  const typography = requireRecord(theme['typography'], `${path}.typography`, code);
  const typographyKeys = ['display', 'body', 'data'] as const;
  rejectUnknownKeys(typography, typographyKeys, `${path}.typography`, code);
  for (const key of typographyKeys) {
    requireString(typography[key], `${path}.typography.${key}`, code);
  }
  requireNonNegativeNumber(theme['defaultRadius'], `${path}.defaultRadius`, code);
  requireNonNegativeNumber(theme['spacingUnit'], `${path}.spacingUnit`, code);
}

function assertSlide(
  value: unknown,
  path: string,
  code: NodeSlideExternalErrorCode,
): { slideId: string; declaredDeckId: string; elementOrder: string[] } {
  const slide = requireRecord(value, path, code);
  rejectUnknownKeys(
    slide,
    [
      'id',
      'deckId',
      'title',
      'section',
      'notes',
      'archetype',
      'background',
      'elementOrder',
      'version',
    ],
    path,
    code,
  );
  const slideId = requireString(slide['id'], `${path}.id`, code);
  const declaredDeckId = requireString(slide['deckId'], `${path}.deckId`, code);
  requireString(slide['title'], `${path}.title`, code);
  assertOptionalTypedString(slide, 'section', path, code, true);
  assertOptionalTypedString(slide, 'notes', path, code, true);
  if (slide['archetype'] !== undefined) {
    requireOneOf(slide['archetype'], SLIDE_ARCHETYPES, `${path}.archetype`, code);
  }
  requireString(slide['background'], `${path}.background`, code);
  const elementOrder = requireStringArray(slide['elementOrder'], `${path}.elementOrder`, code);
  requireUnique(elementOrder, `${path}.elementOrder`, code);
  requireNonNegativeInteger(slide['version'], `${path}.version`, code);
  return { slideId, declaredDeckId, elementOrder };
}

function assertSlideElement(
  value: unknown,
  path: string,
  code: NodeSlideExternalErrorCode,
): { elementId: string; slideId: string } {
  const element = requireRecord(value, path, code);
  rejectUnknownKeys(
    element,
    [
      'id',
      'slideId',
      'name',
      'kind',
      'role',
      'bbox',
      'rotation',
      'content',
      'style',
      'chart',
      'math',
      'video',
      'image',
      'imageUrl',
      'altText',
      'sourceIds',
      'locked',
      'visible',
      'groupId',
      'exportCapabilities',
      'version',
    ],
    path,
    code,
  );
  const elementId = requireString(element['id'], `${path}.id`, code);
  const slideId = requireString(element['slideId'], `${path}.slideId`, code);
  requireString(element['name'], `${path}.name`, code);
  requireOneOf(element['kind'], ELEMENT_KINDS, `${path}.kind`, code);
  assertOptionalTypedString(element, 'role', path, code, true);
  assertBoundingBox(element['bbox'], `${path}.bbox`, code);
  requireFiniteNumber(element['rotation'], `${path}.rotation`, code);
  assertOptionalTypedString(element, 'content', path, code, true);
  assertElementStyle(element['style'], `${path}.style`, code);
  if (element['chart'] !== undefined) assertChartData(element['chart'], `${path}.chart`, code);
  if (element['math'] !== undefined) assertMathData(element['math'], `${path}.math`, code);
  if (element['video'] !== undefined) assertVideoData(element['video'], `${path}.video`, code);
  if (element['image'] !== undefined) assertImageData(element['image'], `${path}.image`, code);
  if (element['imageUrl'] !== undefined) {
    const imageUrl = requireString(element['imageUrl'], `${path}.imageUrl`, code);
    if (!isAllowedNodeSlideAddedImageUrl(imageUrl)) {
      invalid(code, `${path}.imageUrl must be a supported embedded data:image URL under 700 KB.`);
    }
  }
  assertOptionalTypedString(element, 'altText', path, code, true);
  const sourceIds = requireStringArray(element['sourceIds'], `${path}.sourceIds`, code);
  requireUnique(sourceIds, `${path}.sourceIds`, code);
  requireBoolean(element['locked'], `${path}.locked`, code);
  if (element['visible'] !== undefined) requireBoolean(element['visible'], `${path}.visible`, code);
  assertOptionalTypedString(element, 'groupId', path, code);
  const exportCapabilities = requireArray(
    element['exportCapabilities'],
    `${path}.exportCapabilities`,
    code,
  ).map((candidate, index) =>
    requireOneOf(candidate, EXPORT_CAPABILITIES, `${path}.exportCapabilities[${index}]`, code),
  );
  requireUnique(exportCapabilities, `${path}.exportCapabilities`, code);
  requireNonNegativeInteger(element['version'], `${path}.version`, code);
  return { elementId, slideId };
}

function assertElementStyle(value: unknown, path: string, code: NodeSlideExternalErrorCode): void {
  const style = requireRecord(value, path, code);
  const stringKeys = ['fill', 'stroke', 'color', 'fontFamily', 'shadow'] as const;
  const numberKeys = [
    'strokeWidth',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'letterSpacing',
    'radius',
    'opacity',
    'padding',
  ] as const;
  rejectUnknownKeys(
    style,
    [...stringKeys, ...numberKeys, 'textAlign', 'verticalAlign'],
    path,
    code,
  );
  for (const key of stringKeys) assertOptionalTypedString(style, key, path, code, true);
  for (const key of numberKeys) {
    if (style[key] !== undefined) requireFiniteNumber(style[key], `${path}.${key}`, code);
  }
  for (const key of ['strokeWidth', 'radius', 'padding'] as const) {
    if (style[key] !== undefined && (style[key] as number) < 0) {
      invalid(code, `${path}.${key} must be non-negative.`);
    }
  }
  for (const key of ['fontSize', 'fontWeight', 'lineHeight'] as const) {
    if (style[key] !== undefined && (style[key] as number) <= 0) {
      invalid(code, `${path}.${key} must be positive.`);
    }
  }
  if (
    style['opacity'] !== undefined &&
    ((style['opacity'] as number) < 0 || (style['opacity'] as number) > 1)
  ) {
    invalid(code, `${path}.opacity must be between 0 and 1.`);
  }
  if (style['textAlign'] !== undefined) {
    requireOneOf(style['textAlign'], ['left', 'center', 'right'], `${path}.textAlign`, code);
  }
  if (style['verticalAlign'] !== undefined) {
    requireOneOf(
      style['verticalAlign'],
      ['top', 'middle', 'bottom'],
      `${path}.verticalAlign`,
      code,
    );
  }
}

function assertChartData(value: unknown, path: string, code: NodeSlideExternalErrorCode): void {
  const chart = requireRecord(value, path, code);
  rejectUnknownKeys(chart, ['chartType', 'labels', 'series', 'unit', 'sourceId'], path, code);
  requireOneOf(chart['chartType'], CHART_TYPES, `${path}.chartType`, code);
  const labels = requireStringArray(chart['labels'], `${path}.labels`, code);
  const series = assertChartSeriesArray(chart['series'], `${path}.series`, code);
  for (const [index, item] of series.entries()) {
    if (item.values.length !== labels.length) {
      invalid(code, `${path}.series[${index}].values must match the label count.`);
    }
  }
  assertOptionalTypedString(chart, 'unit', path, code, true);
  assertOptionalTypedString(chart, 'sourceId', path, code);
}

function assertChartSeriesArray(
  value: unknown,
  path: string,
  code: NodeSlideExternalErrorCode,
): Array<{ values: number[] }> {
  return requireArray(value, path, code).map((candidate, index) => {
    const itemPath = `${path}[${index}]`;
    const series = requireRecord(candidate, itemPath, code);
    rejectUnknownKeys(series, ['name', 'values', 'color'], itemPath, code);
    requireString(series['name'], `${itemPath}.name`, code);
    const values = requireArray(series['values'], `${itemPath}.values`, code).map(
      (item, valueIndex) => requireFiniteNumber(item, `${itemPath}.values[${valueIndex}]`, code),
    );
    assertOptionalTypedString(series, 'color', itemPath, code, true);
    return { values };
  });
}

function assertMathData(value: unknown, path: string, code: NodeSlideExternalErrorCode): void {
  const math = requireRecord(value, path, code);
  rejectUnknownKeys(
    math,
    ['expression', 'syntax', 'displayMode', 'description', 'display', 'variables', 'sourceId'],
    path,
    code,
  );
  requireString(math['expression'], `${path}.expression`, code);
  if (math['syntax'] !== undefined) {
    requireOneOf(math['syntax'], ['plain', 'latex'], `${path}.syntax`, code);
  }
  if (math['displayMode'] !== undefined) {
    requireOneOf(math['displayMode'], ['inline', 'block'], `${path}.displayMode`, code);
  }
  assertOptionalTypedString(math, 'description', path, code, true);
  assertOptionalTypedString(math, 'display', path, code, true);
  if (math['variables'] !== undefined) {
    requireArray(math['variables'], `${path}.variables`, code).forEach((candidate, index) => {
      const itemPath = `${path}.variables[${index}]`;
      const variable = requireRecord(candidate, itemPath, code);
      rejectUnknownKeys(variable, ['label', 'value', 'unit'], itemPath, code);
      requireString(variable['label'], `${itemPath}.label`, code);
      requireFiniteNumber(variable['value'], `${itemPath}.value`, code);
      assertOptionalTypedString(variable, 'unit', itemPath, code, true);
    });
  }
  assertOptionalTypedString(math, 'sourceId', path, code);
}

function assertVideoData(value: unknown, path: string, code: NodeSlideExternalErrorCode): void {
  const video = requireRecord(value, path, code);
  rejectUnknownKeys(
    video,
    [
      'url',
      'posterUrl',
      'title',
      'captionsUrl',
      'captionsLanguage',
      'startAtSeconds',
      'endAtSeconds',
    ],
    path,
    code,
  );
  const url = requireString(video['url'], `${path}.url`, code);
  if (!isSafeExternalUrl(url, 'video')) {
    invalid(code, `${path}.url must be https or supported embedded video data.`);
  }
  for (const key of ['posterUrl', 'title', 'captionsUrl', 'captionsLanguage'] as const) {
    assertOptionalTypedString(video, key, path, code, true);
  }
  if (
    typeof video['posterUrl'] === 'string' &&
    video['posterUrl'] &&
    !isSafeExternalUrl(video['posterUrl'], 'image')
  ) {
    invalid(code, `${path}.posterUrl must be https or supported embedded image data.`);
  }
  if (
    typeof video['captionsUrl'] === 'string' &&
    video['captionsUrl'] &&
    !isSafeCaptionUrl(video['captionsUrl'])
  ) {
    invalid(code, `${path}.captionsUrl must be https or embedded WebVTT data.`);
  }
  if (
    typeof video['captionsLanguage'] === 'string' &&
    video['captionsLanguage'].trim().length > 32
  ) {
    invalid(code, `${path}.captionsLanguage cannot exceed 32 characters.`);
  }
  for (const key of ['startAtSeconds', 'endAtSeconds'] as const) {
    if (video[key] !== undefined) requireNonNegativeNumber(video[key], `${path}.${key}`, code);
  }
  if (
    typeof video['endAtSeconds'] === 'number' &&
    video['endAtSeconds'] <=
      (typeof video['startAtSeconds'] === 'number' ? video['startAtSeconds'] : 0)
  ) {
    invalid(code, `${path}.endAtSeconds must be greater than startAtSeconds.`);
  }
}

function isSafeExternalUrl(value: string, kind: 'image' | 'video'): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('https://') || normalized.startsWith(`data:${kind}/`);
}

function isSafeCaptionUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('https://') || normalized.startsWith('data:text/vtt');
}

function assertImageData(value: unknown, path: string, code: NodeSlideExternalErrorCode): void {
  const image = requireRecord(value, path, code);
  rejectUnknownKeys(image, ['placeholder', 'credit', 'sourceId'], path, code);
  requireBoolean(image['placeholder'], `${path}.placeholder`, code);
  assertOptionalTypedString(image, 'credit', path, code, true);
  assertOptionalTypedString(image, 'sourceId', path, code);
}

function assertSourceRecord(
  value: unknown,
  path: string,
  code: NodeSlideExternalErrorCode,
): { sourceId: string; declaredDeckId: string } {
  const source = requireRecord(value, path, code);
  rejectUnknownKeys(
    source,
    [
      'id',
      'deckId',
      'title',
      'url',
      'sourceType',
      'retrievedAt',
      'citation',
      'license',
      'format',
      'contentDigest',
      'byteSize',
      'rowCount',
      'columns',
      'provider',
      'retention',
      'status',
      'lastRefreshedAt',
    ],
    path,
    code,
  );
  const sourceId = requireString(source['id'], `${path}.id`, code);
  const declaredDeckId = requireString(source['deckId'], `${path}.deckId`, code);
  requireString(source['title'], `${path}.title`, code);
  assertOptionalTypedString(source, 'url', path, code, true);
  requireOneOf(
    source['sourceType'],
    ['internal', 'url', 'document', 'spreadsheet', 'note'],
    `${path}.sourceType`,
    code,
  );
  requireNonNegativeNumber(source['retrievedAt'], `${path}.retrievedAt`, code);
  requireString(source['citation'], `${path}.citation`, code);
  assertOptionalTypedString(source, 'license', path, code, true);
  if (source['format'] !== undefined) {
    requireOneOf(source['format'], ['csv', 'json', 'txt', 'web'], `${path}.format`, code);
  }
  assertOptionalTypedString(source, 'contentDigest', path, code);
  for (const key of ['byteSize', 'rowCount'] as const) {
    if (source[key] !== undefined) requireNonNegativeInteger(source[key], `${path}.${key}`, code);
  }
  if (source['columns'] !== undefined) {
    requireStringArray(source['columns'], `${path}.columns`, code);
  }
  assertOptionalTypedString(source, 'provider', path, code, true);
  if (source['retention'] !== undefined) {
    requireOneOf(
      source['retention'],
      ['until_deleted', 'public_snapshot'],
      `${path}.retention`,
      code,
    );
  }
  if (source['status'] !== undefined) {
    requireOneOf(source['status'], ['ready', 'refreshing', 'failed'], `${path}.status`, code);
  }
  if (source['lastRefreshedAt'] !== undefined) {
    requireNonNegativeNumber(source['lastRefreshedAt'], `${path}.lastRefreshedAt`, code);
  }
  return { sourceId, declaredDeckId };
}

function nestedSourceIds(element: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const key of ['chart', 'math', 'image'] as const) {
    const payload = element[key];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const sourceId = (payload as Record<string, unknown>)['sourceId'];
    if (typeof sourceId === 'string') ids.push(sourceId);
  }
  return ids;
}

function assertBoundingBox(value: unknown, path: string, code: NodeSlideExternalErrorCode): void {
  const bbox = requireRecord(value, path, code);
  rejectUnknownKeys(bbox, ['x', 'y', 'width', 'height'], path, code);
  const x = requireFiniteNumber(bbox['x'], `${path}.x`, code);
  const y = requireFiniteNumber(bbox['y'], `${path}.y`, code);
  const width = requireFiniteNumber(bbox['width'], `${path}.width`, code);
  const height = requireFiniteNumber(bbox['height'], `${path}.height`, code);
  if (
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1 + Number.EPSILON ||
    y + height > 1 + Number.EPSILON
  ) {
    invalid(code, `${path} must be positive and contained within normalized slide bounds.`);
  }
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

function assertOptionalDigest(record: Record<string, unknown>, key: string): void {
  if (record[key] !== undefined) requireDigest(record[key], `patch.${key}`, 'invalid_patch');
}

function assertOptionalTypedString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  code: NodeSlideExternalErrorCode,
  allowEmpty = false,
): void {
  if (record[key] !== undefined) {
    requireString(record[key], `${path}.${key}`, code, allowEmpty);
  }
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
  const seen = new WeakSet<object>();
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
    if (candidate && typeof candidate === 'object') {
      if (seen.has(candidate)) {
        invalid(
          'governance_violation',
          `${candidatePath} repeats an object identity; JSON inputs must be trees.`,
        );
      }
      seen.add(candidate);
    }
    if (Array.isArray(candidate)) {
      if (Object.getPrototypeOf(candidate) !== Array.prototype) {
        invalid('governance_violation', `${candidatePath} must be a plain JSON array.`);
      }
      const keys = Reflect.ownKeys(candidate).filter((key) => key !== 'length');
      if (
        keys.some((key) => typeof key !== 'string') ||
        keys.length !== candidate.length ||
        keys.some((key, index) => key !== String(index))
      ) {
        invalid(
          'governance_violation',
          `${candidatePath} must be a dense JSON array without extra properties.`,
        );
      }
      for (let index = 0; index < candidate.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          invalid('governance_violation', `${candidatePath}[${index}] must be JSON data.`);
        }
        visit(descriptor.value, `${candidatePath}[${index}]`, depth + 1);
      }
      return;
    }
    if (candidate && typeof candidate === 'object') {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        invalid('governance_violation', `${candidatePath} must be a plain JSON object.`);
      }
      for (const key of Reflect.ownKeys(candidate)) {
        if (typeof key !== 'string') {
          invalid('governance_violation', `${candidatePath} contains a symbol property.`);
        }
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
          invalid('governance_violation', `${candidatePath} contains forbidden key ${key}.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          invalid('governance_violation', `${candidatePath}.${key} must be JSON data.`);
        }
        visit(descriptor.value, `${candidatePath}.${key}`, depth + 1);
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
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
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
