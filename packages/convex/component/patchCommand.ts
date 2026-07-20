import type { NodeSlidePatchCommand } from '@nodeslide/backend';

const COMMAND_KEYS = new Set([
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
  'profileId',
  'profileDigest',
]);

const OPERATION_KEYS: Readonly<Record<string, readonly string[]>> = {
  move: ['op', 'slideId', 'elementId', 'x', 'y'],
  resize: ['op', 'slideId', 'elementId', 'width', 'height'],
  replace_text: ['op', 'slideId', 'elementId', 'text', 'sourceIds'],
  update_style: ['op', 'slideId', 'elementId', 'properties'],
  update_chart: ['op', 'slideId', 'elementId', 'chart', 'chartType', 'series'],
  update_image: [
    'op',
    'slideId',
    'elementId',
    'imageUrl',
    'altText',
    'credit',
    'sourceIds',
    'fit',
    'focalPoint',
  ],
  add_element: ['op', 'slideId', 'element'],
  remove_element: ['op', 'slideId', 'elementId'],
  set_visibility_v1: ['op', 'slideId', 'elementId', 'visible'],
  group_elements_v1: ['op', 'slideId', 'elementIds', 'groupId'],
  ungroup_elements_v1: ['op', 'slideId', 'elementIds', 'groupId'],
  reorder_element_v1: ['op', 'slideId', 'elementId', 'index'],
  add_slide: ['op', 'slide', 'elements', 'index'],
  remove_slide: ['op', 'slideId'],
  reorder_slide: ['op', 'slideId', 'index'],
  update_slide: ['op', 'slideId', 'properties'],
  update_deck: ['op', 'properties'],
};

export async function parseNodeSlideComponentPatchCommand(
  value: unknown,
): Promise<NodeSlidePatchCommand> {
  const command = boundedJson(value, 'Patch command', { nodes: 0, characters: 0 }, 0);
  const record = requiredRecord(command, 'Patch command');
  rejectUnknownKeys(record, COMMAND_KEYS, 'Patch command');
  requiredIdentifier(record['id'], 'Patch command id');
  const deckId = requiredIdentifier(record['deckId'], 'Patch deckId');
  requiredVersion(record['baseDeckVersion'], 'Patch baseDeckVersion');
  versionMap(record['baseSlideVersions'], 'Patch baseSlideVersions');
  versionMap(record['baseElementVersions'], 'Patch baseElementVersions');
  parseScope(record['scope'], deckId);
  parseOperations(record['operations']);
  if (!['human', 'agent', 'import', 'system'].includes(String(record['source']))) {
    throw new Error('Patch source is invalid.');
  }
  requiredText(record['summary'], 'Patch summary', 1_000);
  for (const field of ['linkedCommentId', 'traceId', 'profileId'] as const) {
    if (record[field] !== undefined) requiredIdentifier(record[field], `Patch ${field}`);
  }
  if ((record['profileId'] === undefined) !== (record['profileDigest'] === undefined)) {
    throw new Error('Patch profileId and profileDigest must appear together.');
  }
  if (
    record['profileDigest'] !== undefined &&
    !/^(?:sha256|profile_sha256):[0-9a-f]{64}$/u.test(String(record['profileDigest']))
  ) {
    throw new Error('Patch profileDigest is invalid.');
  }
  if ('candidateDigest' in record || 'candidateValidation' in record) {
    throw new Error(
      'Caller-supplied candidate validation is not accepted; the component validates the candidate server-side.',
    );
  }
  const proposalKind = record['proposalKind'];
  if (proposalKind !== undefined && proposalKind !== 'edit' && proposalKind !== 'propagation') {
    throw new Error('Patch proposalKind is invalid.');
  }
  if (proposalKind === 'propagation') {
    const parentPatchId = requiredIdentifier(record['parentPatchId'], 'Patch parentPatchId');
    const affectedSlideIds = identifierArray(
      record['affectedSlideIds'],
      'Patch affectedSlideIds',
      128,
      false,
    );
    if (affectedSlideIds.join('\u0000') !== [...affectedSlideIds].sort().join('\u0000')) {
      throw new Error('Patch affectedSlideIds must be canonical and sorted.');
    }
    const suppliedDigest = record['affectedSlideDigest'];
    if (typeof suppliedDigest !== 'string')
      throw new Error('Patch affectedSlideDigest is required.');
    const expectedDigest = await sha256Text(
      JSON.stringify({
        version: 'nodeslide.propagation-affected-slides/v1',
        deckId,
        parentPatchId,
        affectedSlideIds,
      }),
    );
    if (suppliedDigest !== expectedDigest) throw new Error('Patch affectedSlideDigest is invalid.');
  } else if (
    record['parentPatchId'] !== undefined ||
    record['affectedSlideIds'] !== undefined ||
    record['affectedSlideDigest'] !== undefined
  ) {
    throw new Error('Propagation lineage fields require proposalKind propagation.');
  }
  return command as unknown as NodeSlidePatchCommand;
}

function parseScope(value: unknown, deckId: string): void {
  const scope = requiredRecord(value, 'Patch scope');
  const kind = scope['kind'];
  const mode = scope['operationMode'];
  if (!['deck', 'slide', 'elements', 'bounding_box', 'comment'].includes(String(kind))) {
    throw new Error('Patch scope kind is invalid.');
  }
  if (!['copy', 'style', 'layout', 'unrestricted'].includes(String(mode))) {
    throw new Error('Patch operationMode is invalid.');
  }
  if (scope['deckId'] !== deckId) throw new Error('Patch scope belongs to another deck.');
  const allowed = new Set(['kind', 'deckId', 'operationMode']);
  if (kind !== 'deck') {
    allowed.add('slideIds');
    identifierArray(scope['slideIds'], 'Patch scope slideIds', 128, false);
  }
  if (kind === 'elements' || kind === 'bounding_box' || kind === 'comment') {
    allowed.add('elementIds');
    identifierArray(scope['elementIds'], 'Patch scope elementIds', 512, true);
  }
  if (kind === 'bounding_box') {
    allowed.add('bbox');
    const bbox = requiredRecord(scope['bbox'], 'Patch scope bbox');
    rejectUnknownKeys(bbox, new Set(['x', 'y', 'width', 'height']), 'Patch scope bbox');
    for (const field of ['x', 'y', 'width', 'height']) requiredFinite(bbox[field], `bbox.${field}`);
  }
  if (kind === 'comment') {
    allowed.add('commentId');
    requiredIdentifier(scope['commentId'], 'Patch scope commentId');
  }
  rejectUnknownKeys(scope, allowed, 'Patch scope');
}

function parseOperations(value: unknown): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    throw new Error('Patch operations must contain 1 through 128 entries.');
  }
  for (const [index, operationValue] of value.entries()) {
    const operation = requiredRecord(operationValue, `Patch operation ${index}`);
    const op = operation['op'];
    const allowed = typeof op === 'string' ? OPERATION_KEYS[op] : undefined;
    if (!allowed) throw new Error(`Patch operation ${index} has an invalid op.`);
    rejectUnknownKeys(operation, new Set(allowed), `Patch operation ${index}`);
  }
}

function versionMap(value: unknown, label: string): void {
  const record = requiredRecord(value, label);
  if (Object.keys(record).length > 512) throw new Error(`${label} has too many entries.`);
  for (const [key, version] of Object.entries(record)) {
    requiredIdentifier(key, `${label} key`);
    requiredVersion(version, `${label}.${key}`);
  }
}

function identifierArray(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty: boolean,
): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) {
    throw new Error(`${label} is not bounded.`);
  }
  const result = value.map((entry) => requiredIdentifier(entry, `${label} entry`));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates.`);
  return result;
}

function requiredIdentifier(value: unknown, label: string): string {
  return requiredText(value, label, 256);
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    [...value].some((character) => (character.codePointAt(0) ?? 0) <= 31)
  ) {
    throw new Error(`${label} is not bounded.`);
  }
  return value;
}

function requiredVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid.`);
  return Number(value);
}

function requiredFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} contains unsupported field ${unknown}.`);
}

function boundedJson(
  value: unknown,
  path: string,
  budget: { nodes: number; characters: number },
  depth: number,
): unknown {
  budget.nodes += 1;
  if (budget.nodes > 8_192 || depth > 24) throw new Error('Patch command exceeds safe bounds.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return requiredFinite(value, path);
  if (typeof value === 'string') {
    budget.characters += value.length;
    if (budget.characters > 1_000_000) throw new Error('Patch command exceeds safe bounds.');
    return value;
  }
  if (Array.isArray(value))
    return value.map((entry) => boundedJson(entry, path, budget, depth + 1));
  const record = requiredRecord(value, path);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new Error(`${path} contains an unsafe field.`);
    }
    result[key] = boundedJson(entry, `${path}.${key}`, budget, depth + 1);
  }
  return result;
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}
