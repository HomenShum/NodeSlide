import { NODESLIDE_SCHEMA_VERSION } from '@nodeslide/contracts';

export interface NodeSlideSnapshotMigration {
  id: string;
  fromVersion: string;
  toVersion: string;
  migrate(snapshot: unknown): unknown;
}

export interface NodeSlideSnapshotMigrationReceipt {
  migrationIds: readonly string[];
  fromVersion: string;
  toVersion: string;
  snapshot: unknown;
}

/** v1 is the first packaged schema, so the production chain is intentionally empty. */
export const NODESLIDE_SNAPSHOT_MIGRATIONS: readonly NodeSlideSnapshotMigration[] = [];

export function migrateNodeSlideSnapshot(
  snapshot: unknown,
  targetVersion = NODESLIDE_SCHEMA_VERSION,
  migrations: readonly NodeSlideSnapshotMigration[] = NODESLIDE_SNAPSHOT_MIGRATIONS,
): NodeSlideSnapshotMigrationReceipt {
  const fromVersion = snapshotSchemaVersion(snapshot);
  let currentVersion = fromVersion;
  let current = structuredClone(snapshot);
  const migrationIds: string[] = [];
  const seen = new Set<string>();

  while (currentVersion !== targetVersion) {
    if (seen.has(currentVersion)) {
      throw new Error(`NodeSlide snapshot migration cycle detected at ${currentVersion}.`);
    }
    seen.add(currentVersion);
    const candidates = migrations.filter((migration) => migration.fromVersion === currentVersion);
    if (candidates.length !== 1) {
      throw new Error(
        candidates.length === 0
          ? `No NodeSlide snapshot migration starts at ${currentVersion}.`
          : `Ambiguous NodeSlide snapshot migrations start at ${currentVersion}.`,
      );
    }
    const migration = candidates[0];
    if (!migration) throw new Error(`No NodeSlide snapshot migration starts at ${currentVersion}.`);
    current = migration.migrate(structuredClone(current));
    const resultingVersion = snapshotSchemaVersion(current);
    if (resultingVersion !== migration.toVersion) {
      throw new Error(
        `Migration ${migration.id} declared ${migration.toVersion} but produced ${resultingVersion}.`,
      );
    }
    currentVersion = resultingVersion;
    migrationIds.push(migration.id);
  }

  return { migrationIds, fromVersion, toVersion: targetVersion, snapshot: current };
}

function snapshotSchemaVersion(value: unknown): string {
  if (!value || typeof value !== 'object' || !('deck' in value)) {
    throw new Error('NodeSlide snapshot is missing a deck object.');
  }
  const deck = value.deck;
  if (!deck || typeof deck !== 'object' || !('schemaVersion' in deck)) {
    throw new Error('NodeSlide snapshot is missing deck.schemaVersion.');
  }
  const version = deck.schemaVersion;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('NodeSlide snapshot has an invalid deck.schemaVersion.');
  }
  return version;
}
