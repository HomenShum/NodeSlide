export {
  NODESLIDE_CONVEX_COMPONENT_SCHEMA_VERSION,
  NODESLIDE_CONVEX_MIGRATIONS,
  type NodeSlideConvexMigrationReceipt,
  type NodeSlideConvexMigrationStep,
  planNodeSlideConvexMigrations,
  runNodeSlideConvexMigrations,
} from '../component/migrations';

export {
  NODESLIDE_COMPONENT_GRANT_VERSION,
  type NodeSlideComponentGrant,
  type NodeSlideComponentGrantAction,
  type NodeSlideComponentResourceKind,
  nodeSlideComponentPatchDigest,
} from '../component/protocol';

export const NODESLIDE_CONVEX_TABLES = {
  decks: 'nodeslide_decks',
  proposals: 'nodeslide_proposals',
  versions: 'nodeslide_versions',
  receipts: 'nodeslide_receipts',
  assets: 'nodeslide_assets',
  migrationReceipts: 'nodeslide_migration_receipts',
  authorizationGrants: 'nodeslide_authorization_grants',
} as const;
