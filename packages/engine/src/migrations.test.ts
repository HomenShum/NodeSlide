import { createNodeSlideTestSnapshot } from '@nodeslide/testing';
import { describe, expect, it } from 'vitest';
import { type NodeSlideSnapshotMigration, migrateNodeSlideSnapshot } from './migrations';

describe('NodeSlide snapshot migrations', () => {
  it('returns an isolated current snapshot without inventing a migration', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const result = migrateNodeSlideSnapshot(snapshot);
    expect(result.migrationIds).toEqual([]);
    expect(result.snapshot).toEqual(snapshot);
    expect(result.snapshot).not.toBe(snapshot);
  });

  it('runs a contiguous chain and fails closed on missing or dishonest steps', () => {
    const legacy = createNodeSlideTestSnapshot() as unknown as {
      deck: { schemaVersion: string; migrated?: boolean };
    };
    legacy.deck.schemaVersion = 'nodeslide.slidelang/v0';
    const migration: NodeSlideSnapshotMigration = {
      id: 'v0_to_v1',
      fromVersion: 'nodeslide.slidelang/v0',
      toVersion: 'nodeslide.slidelang/v1',
      migrate: (value) => {
        const next = structuredClone(value) as typeof legacy;
        next.deck.schemaVersion = 'nodeslide.slidelang/v1';
        next.deck.migrated = true;
        return next;
      },
    };
    const result = migrateNodeSlideSnapshot(legacy, 'nodeslide.slidelang/v1', [migration]);
    expect(result.migrationIds).toEqual(['v0_to_v1']);
    expect((result.snapshot as typeof legacy).deck.migrated).toBe(true);
    expect(() => migrateNodeSlideSnapshot(legacy, 'nodeslide.slidelang/v1', [])).toThrow(
      /No NodeSlide snapshot migration/,
    );
  });
});
