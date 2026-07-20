export const NODESLIDE_CONVEX_COMPONENT_SCHEMA_VERSION = 1 as const;

export const NODESLIDE_CONVEX_TABLES = {
  decks: 'nodeslide_decks',
  proposals: 'nodeslide_proposals',
  versions: 'nodeslide_versions',
  receipts: 'nodeslide_receipts',
  assets: 'nodeslide_assets',
  migrationReceipts: 'nodeslide_migration_receipts',
} as const;

export interface NodeSlideConvexMigrationStep {
  id: string;
  fromVersion: number;
  toVersion: number;
  destructive: false;
  description: string;
}

export interface NodeSlideConvexMigrationReceipt {
  id: string;
  stepId: string;
  fromVersion: number;
  toVersion: number;
  appliedAt: number;
}

export const NODESLIDE_CONVEX_MIGRATIONS: readonly NodeSlideConvexMigrationStep[] = [
  {
    id: 'initialize_isolated_tables_v1',
    fromVersion: 0,
    toVersion: 1,
    destructive: false,
    description: 'Initialize the isolated NodeSlide component tables and migration ledger.',
  },
];

export function planNodeSlideConvexMigrations(
  installedVersion: number,
): readonly NodeSlideConvexMigrationStep[] {
  if (!Number.isInteger(installedVersion) || installedVersion < 0) {
    throw new Error(`Invalid installed Convex component version ${installedVersion}.`);
  }
  if (installedVersion > NODESLIDE_CONVEX_COMPONENT_SCHEMA_VERSION) {
    throw new Error(
      `Installed Convex component schema ${installedVersion} is newer than supported version ${NODESLIDE_CONVEX_COMPONENT_SCHEMA_VERSION}.`,
    );
  }
  const plan: NodeSlideConvexMigrationStep[] = [];
  let cursor = installedVersion;
  while (cursor < NODESLIDE_CONVEX_COMPONENT_SCHEMA_VERSION) {
    const step = NODESLIDE_CONVEX_MIGRATIONS.find((candidate) => candidate.fromVersion === cursor);
    if (!step) throw new Error(`No Convex component migration starts at version ${cursor}.`);
    plan.push(step);
    cursor = step.toVersion;
  }
  return plan;
}

export async function runNodeSlideConvexMigrations(input: {
  installedVersion: number;
  apply(step: NodeSlideConvexMigrationStep): Promise<NodeSlideConvexMigrationReceipt>;
}): Promise<readonly NodeSlideConvexMigrationReceipt[]> {
  const receipts: NodeSlideConvexMigrationReceipt[] = [];
  for (const step of planNodeSlideConvexMigrations(input.installedVersion)) {
    const receipt = await input.apply(step);
    if (
      receipt.stepId !== step.id ||
      receipt.fromVersion !== step.fromVersion ||
      receipt.toVersion !== step.toVersion
    ) {
      throw new Error(`Migration ${step.id} returned a mismatched receipt.`);
    }
    receipts.push(receipt);
  }
  return receipts;
}
