import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  assertProductionProbeCleanupDisposition,
  assertProductionProbeRetentionReceipt,
  assertRetentionReceipt,
  cleanupNodeSlideProductionFixture,
  cleanupNodeSlideProductionProbe,
  productionFixtureCleanupDisposition,
  productionFixtureRetentionBindings,
  productionProbeCleanupBinding,
} from './lib/production-fixture-retention.mjs';

const DECK_ID = 'deck_fixture';
const OWNER_ACCESS_KEY = 'a'.repeat(43);
const MUTATION = Symbol('retention-mutation');
const BINDINGS = productionFixtureRetentionBindings(DECK_ID, OWNER_ACCESS_KEY);
const PASSING_RECEIPT_BODY = {
  schemaVersion: 'nodeslide.workspace-retention-receipt/v1',
  status: 'passed',
  retentionSafe: true,
  remainingDeckRows: 0,
  remainingSourceRows: 0,
  deletedRowCount: 4,
  deletedCounts: { deck: 1, sources: 3 },
  alreadyAbsent: false,
  ...BINDINGS,
};
const PASSING_RECEIPT = withReceiptDigest(PASSING_RECEIPT_BODY);
const PROBE_TOKEN = `probe_${'p'.repeat(43)}`;
const PASSING_PROBE_RECEIPT_BODY = {
  schemaVersion: 'nodeslide.production-probe-retention-receipt/v1',
  status: 'passed',
  retentionSafe: true,
  remainingDeckRows: 0,
  remainingSourceRows: 0,
  deletedRowCount: 3,
  deletedCounts: { deck: 1, sources: 2 },
  alreadyAbsent: false,
  cleanupBindingDigest: productionProbeCleanupBinding(PROBE_TOKEN),
};

describe('production fixture retention', () => {
  it('requires deletion of the exact leased workspace after creation was submitted', () => {
    expect(
      assertProductionProbeCleanupDisposition(
        {
          alreadyAbsent: false,
          deletedRowCount: 3,
          deletedCounts: { deck: 1, project: 1, slides: 1 },
        },
        true,
      ),
    ).toMatchObject({ alreadyAbsent: false });
    expect(() =>
      assertProductionProbeCleanupDisposition(
        { alreadyAbsent: true, deletedRowCount: 0, deletedCounts: {} },
        true,
      ),
    ).toThrow(/did not delete the workspace whose creation was submitted/u);
    expect(() =>
      assertProductionProbeCleanupDisposition(
        { alreadyAbsent: false, deletedRowCount: 1, deletedCounts: { deck: 1 } },
        true,
      ),
    ).toThrow(/did not delete the workspace whose creation was submitted/u);
    expect(
      assertProductionProbeCleanupDisposition(
        { alreadyAbsent: true, deletedRowCount: 0, deletedCounts: {} },
        false,
      ),
    ).toMatchObject({ alreadyAbsent: true });
  });

  it('sends the owner capability only to the mutation and accepts a sanitized zero-row receipt', async () => {
    const mutation = vi.fn(async () => PASSING_RECEIPT);
    const receipt = await cleanupNodeSlideProductionFixture({
      client: { mutation },
      mutation: MUTATION,
      deckId: DECK_ID,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });

    expect(mutation).toHaveBeenCalledWith(MUTATION, {
      deckId: DECK_ID,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    expect(receipt).toEqual(PASSING_RECEIPT);
    expect(JSON.stringify(receipt)).not.toContain(DECK_ID);
    expect(JSON.stringify(receipt)).not.toContain(OWNER_ACCESS_KEY);
    expect(receipt).toMatchObject(BINDINGS);
  });

  it('verifies target/principal bindings, self-digest, and replay tickets client-side', async () => {
    const mutation = vi.fn(async () =>
      withReceiptDigest({
        ...PASSING_RECEIPT_BODY,
        deletedRowCount: 0,
        deletedCounts: {},
        alreadyAbsent: true,
      }),
    );
    await expect(
      cleanupNodeSlideProductionFixture({
        client: { mutation },
        mutation: MUTATION,
        deckId: DECK_ID,
        ownerAccessKey: OWNER_ACCESS_KEY,
        cleanupTicket: BINDINGS.cleanupTicket,
      }),
    ).resolves.toMatchObject({ alreadyAbsent: true, ...BINDINGS });
    expect(mutation).toHaveBeenCalledWith(MUTATION, {
      deckId: DECK_ID,
      ownerAccessKey: OWNER_ACCESS_KEY,
      cleanupTicket: BINDINGS.cleanupTicket,
    });

    const forgedBinding = withReceiptDigest({
      ...PASSING_RECEIPT_BODY,
      targetBindingDigest: `sha256:${'0'.repeat(64)}`,
    });
    await expect(
      cleanupNodeSlideProductionFixture({
        client: { mutation: vi.fn(async () => forgedBinding) },
        mutation: MUTATION,
        deckId: DECK_ID,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/does not bind the requested target and owner/i);
    expect(() =>
      assertRetentionReceipt(
        { ...PASSING_RECEIPT, receiptDigest: `sha256:${'0'.repeat(64)}` },
        BINDINGS,
      ),
    ).toThrow(/did not prove zero retained/i);
    await expect(
      cleanupNodeSlideProductionFixture({
        client: { mutation: vi.fn() },
        mutation: MUTATION,
        deckId: DECK_ID,
        ownerAccessKey: OWNER_ACCESS_KEY,
        cleanupTicket: `sha256:${'0'.repeat(64)}`,
      }),
    ).rejects.toThrow(/does not bind the requested target and owner/i);
  });

  it('fails closed on retained rows, missing proof, or leaked credentials', async () => {
    expect(() =>
      productionFixtureCleanupDisposition({
        creationSubmitted: true,
        deckId: '',
        ownerAccessKey: '',
      }),
    ).toThrow(/zero-retention cleanup cannot be proven/i);
    expect(
      productionFixtureCleanupDisposition({
        creationSubmitted: false,
        deckId: '',
        ownerAccessKey: '',
      }),
    ).toBe('not_required');
    expect(() =>
      productionFixtureCleanupDisposition({
        creationSubmitted: true,
        deckId: DECK_ID,
        ownerAccessKey: '',
      }),
    ).toThrow(/capability is unavailable/i);
    expect(() => assertRetentionReceipt({ ...PASSING_RECEIPT, remainingSourceRows: 1 })).toThrow(
      /did not prove zero retained/i,
    );
    await expect(
      cleanupNodeSlideProductionFixture({
        client: {
          mutation: vi.fn(async () =>
            withReceiptDigest({ ...PASSING_RECEIPT_BODY, deckId: DECK_ID }),
          ),
        },
        mutation: MUTATION,
        deckId: DECK_ID,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/exposed a stable identifier/i);
    await expect(
      cleanupNodeSlideProductionFixture({
        client: { mutation: vi.fn(async () => null) },
        mutation: MUTATION,
        deckId: DECK_ID,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/no retention receipt/i);
  });

  it('verifies the response-loss cleanup lease, count sum, binding, and self-digest', async () => {
    const receipt = withReceiptDigest(PASSING_PROBE_RECEIPT_BODY);
    const mutation = vi.fn(async () => receipt);
    await expect(
      cleanupNodeSlideProductionProbe({
        client: { mutation },
        mutation: MUTATION,
        clientSessionId: 'probe-session',
        cleanupToken: PROBE_TOKEN,
      }),
    ).resolves.toEqual(receipt);
    expect(mutation).toHaveBeenCalledWith(MUTATION, {
      clientSessionId: 'probe-session',
      cleanupToken: PROBE_TOKEN,
    });

    for (const forged of [
      { ...receipt, retentionSafe: false },
      { ...receipt, deletedRowCount: 4 },
      { ...receipt, remainingSourceRows: 1 },
      { ...receipt, cleanupBindingDigest: `sha256:${'0'.repeat(64)}` },
      { ...receipt, receiptDigest: `sha256:${'0'.repeat(64)}` },
    ]) {
      expect(() => assertProductionProbeRetentionReceipt(forged, PROBE_TOKEN)).toThrow(
        /token-bound zero retention/i,
      );
    }
  });
});

function withReceiptDigest(body) {
  return { ...body, receiptDigest: digest(JSON.stringify(body)) };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
