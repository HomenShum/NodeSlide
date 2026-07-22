import { createHash } from 'node:crypto';

const RECEIPT_SCHEMA = 'nodeslide.workspace-retention-receipt/v1';
const OWNER_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TARGET_BINDING_DOMAIN = 'nodeslide.retention-target/v1';
const PRINCIPAL_BINDING_DOMAIN = 'nodeslide.retention-principal/v1';
const TICKET_DOMAIN = 'nodeslide.retention-ticket/v1';
const PROBE_RECEIPT_SCHEMA = 'nodeslide.production-probe-retention-receipt/v1';
const PROBE_TOKEN_PATTERN = /^probe_[A-Za-z0-9_-]{43}$/u;
const PROBE_CLEANUP_DOMAIN = 'nodeslide.production-probe-cleanup/v1';

/**
 * Deletes one UI-created production fixture through its owner capability and
 * accepts only a zero-row, secret-free server receipt.
 */
export async function cleanupNodeSlideProductionFixture({
  client,
  mutation,
  deckId,
  ownerAccessKey,
  cleanupTicket,
}) {
  if (!client || typeof client.mutation !== 'function') {
    throw new TypeError('A Convex mutation client is required for fixture cleanup.');
  }
  if (!mutation) throw new TypeError('The retention mutation reference is required.');
  if (typeof deckId !== 'string' || deckId.length === 0 || deckId.length > 256) {
    throw new TypeError('Fixture cleanup deck ID is invalid.');
  }
  if (typeof ownerAccessKey !== 'string' || !OWNER_KEY_PATTERN.test(ownerAccessKey)) {
    throw new TypeError('Fixture cleanup owner capability is invalid.');
  }
  if (cleanupTicket !== undefined && !SHA256_PATTERN.test(cleanupTicket)) {
    throw new TypeError('Fixture cleanup replay ticket is invalid.');
  }
  const expected = productionFixtureRetentionBindings(deckId, ownerAccessKey);
  if (cleanupTicket !== undefined && cleanupTicket !== expected.cleanupTicket) {
    throw new Error('Fixture cleanup replay ticket does not bind the requested target and owner.');
  }
  const receipt = await client.mutation(mutation, {
    deckId,
    ownerAccessKey,
    ...(cleanupTicket ? { cleanupTicket } : {}),
  });
  assertRetentionReceipt(receipt, expected);
  const serialized = JSON.stringify(receipt);
  if (serialized.includes(deckId) || serialized.includes(ownerAccessKey)) {
    throw new Error('Fixture cleanup receipt exposed a stable identifier or owner capability.');
  }
  return receipt;
}

export async function cleanupNodeSlideProductionProbe({
  client,
  mutation,
  clientSessionId,
  cleanupToken,
}) {
  if (!client || typeof client.mutation !== 'function' || !mutation) {
    throw new TypeError('A Convex mutation client and probe cleanup reference are required.');
  }
  if (
    typeof clientSessionId !== 'string' ||
    clientSessionId.length === 0 ||
    clientSessionId.length > 256 ||
    typeof cleanupToken !== 'string' ||
    !PROBE_TOKEN_PATTERN.test(cleanupToken)
  ) {
    throw new TypeError('Production probe cleanup lease is invalid.');
  }
  const receipt = await client.mutation(mutation, { clientSessionId, cleanupToken });
  return assertProductionProbeRetentionReceipt(receipt, cleanupToken);
}

export function productionProbeCleanupBinding(cleanupToken) {
  if (typeof cleanupToken !== 'string' || !PROBE_TOKEN_PATTERN.test(cleanupToken)) {
    throw new TypeError('Production probe cleanup token is invalid.');
  }
  return digest([PROBE_CLEANUP_DOMAIN, cleanupToken].join('\u001f'));
}

export function assertProductionProbeRetentionReceipt(value, cleanupToken) {
  if (!value || typeof value !== 'object') {
    throw new Error('Production probe cleanup returned no retention receipt.');
  }
  const deletedCounts = value.deletedCounts;
  const countValues =
    deletedCounts && typeof deletedCounts === 'object' && !Array.isArray(deletedCounts)
      ? Object.values(deletedCounts)
      : [];
  const { receiptDigest, ...unsigned } = value;
  if (
    value.schemaVersion !== PROBE_RECEIPT_SCHEMA ||
    value.status !== 'passed' ||
    value.retentionSafe !== true ||
    value.remainingDeckRows !== 0 ||
    value.remainingSourceRows !== 0 ||
    !Number.isInteger(value.deletedRowCount) ||
    value.deletedRowCount < 0 ||
    !deletedCounts ||
    typeof deletedCounts !== 'object' ||
    Array.isArray(deletedCounts) ||
    countValues.some((count) => !Number.isInteger(count) || count < 0) ||
    countValues.reduce((total, count) => total + count, 0) !== value.deletedRowCount ||
    typeof value.alreadyAbsent !== 'boolean' ||
    (value.alreadyAbsent && (value.deletedRowCount !== 0 || countValues.length !== 0)) ||
    value.cleanupBindingDigest !== productionProbeCleanupBinding(cleanupToken) ||
    !SHA256_PATTERN.test(receiptDigest ?? '') ||
    receiptDigest !== digest(JSON.stringify(unsigned))
  ) {
    throw new Error('Production probe cleanup did not prove token-bound zero retention.');
  }
  return value;
}

/**
 * Once the browser submitted creation, cleanup must prove it deleted that exact
 * leased deck. An `alreadyAbsent` receipt is acceptable only before submission:
 * after a click, the Convex action can still commit after a browser-side timeout,
 * so a momentary absence would not prove zero retention. The expiry sweeper is
 * a crash backstop, not a substitute for a fail-closed production receipt.
 */
export function assertProductionProbeCleanupDisposition(value, creationSubmitted) {
  if (!creationSubmitted) return value;
  if (
    value?.alreadyAbsent !== false ||
    value?.deletedCounts?.deck !== 1 ||
    value?.deletedCounts?.project !== 1 ||
    !Number.isInteger(value?.deletedRowCount) ||
    value.deletedRowCount < 2
  ) {
    throw new Error(
      'Production probe cleanup did not delete the workspace whose creation was submitted.',
    );
  }
  return value;
}

export function productionFixtureCleanupDisposition({ creationSubmitted, deckId, ownerAccessKey }) {
  if (!deckId && !ownerAccessKey) {
    if (creationSubmitted) {
      throw new Error('Creation was submitted but zero-retention cleanup cannot be proven.');
    }
    return 'not_required';
  }
  if (!deckId || !ownerAccessKey) {
    throw new Error('Created workspace capability is unavailable for retention cleanup.');
  }
  return 'required';
}

export function productionFixtureRetentionBindings(deckId, ownerAccessKey) {
  const targetBindingDigest = digest([TARGET_BINDING_DOMAIN, deckId].join('\u001f'));
  const principalBindingDigest = digest([PRINCIPAL_BINDING_DOMAIN, ownerAccessKey].join('\u001f'));
  const cleanupTicket = digest(
    [TICKET_DOMAIN, targetBindingDigest, principalBindingDigest].join('\u001f'),
  );
  return { targetBindingDigest, principalBindingDigest, cleanupTicket };
}

export function assertRetentionReceipt(value, expectedBindings) {
  if (!value || typeof value !== 'object') {
    throw new Error('Fixture cleanup returned no retention receipt.');
  }
  const deletedCounts = value.deletedCounts;
  const countValues =
    deletedCounts && typeof deletedCounts === 'object' && !Array.isArray(deletedCounts)
      ? Object.values(deletedCounts)
      : [];
  const { receiptDigest, ...unsigned } = value;
  if (
    value.schemaVersion !== RECEIPT_SCHEMA ||
    value.status !== 'passed' ||
    value.retentionSafe !== true ||
    value.remainingDeckRows !== 0 ||
    value.remainingSourceRows !== 0 ||
    !Number.isInteger(value.deletedRowCount) ||
    value.deletedRowCount < 0 ||
    !deletedCounts ||
    typeof deletedCounts !== 'object' ||
    Array.isArray(deletedCounts) ||
    countValues.some((count) => !Number.isInteger(count) || count < 0) ||
    countValues.reduce((total, count) => total + count, 0) !== value.deletedRowCount ||
    typeof value.alreadyAbsent !== 'boolean' ||
    (value.alreadyAbsent && (value.deletedRowCount !== 0 || countValues.length !== 0)) ||
    !SHA256_PATTERN.test(value.targetBindingDigest ?? '') ||
    !SHA256_PATTERN.test(value.principalBindingDigest ?? '') ||
    !SHA256_PATTERN.test(value.cleanupTicket ?? '') ||
    !SHA256_PATTERN.test(receiptDigest ?? '') ||
    receiptDigest !== digest(JSON.stringify(unsigned))
  ) {
    throw new Error('Fixture cleanup did not prove zero retained deck/source rows.');
  }
  if (
    expectedBindings &&
    (value.targetBindingDigest !== expectedBindings.targetBindingDigest ||
      value.principalBindingDigest !== expectedBindings.principalBindingDigest ||
      value.cleanupTicket !== expectedBindings.cleanupTicket)
  ) {
    throw new Error('Fixture cleanup receipt does not bind the requested target and owner.');
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
