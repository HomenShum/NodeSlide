/**
 * Wire contract for the owner data export.
 *
 * The bundle is deliberately flat: one entry per table the erasure contract
 * covers, keyed by the same label the deletion receipt uses. That makes the
 * two halves of the data-rights surface comparable by eye — whatever "delete
 * my deck" destroys is what "export my data" hands back, minus the omissions
 * the manifest names out loud.
 */

export const NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION = 'nodeslide.owner-data-export/v1' as const;
export const NODESLIDE_OWNER_DATA_EXPORT_REDACTION_VERSION =
  'nodeslide.secret-redaction/v1' as const;
export const NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE = 'application/json' as const;

export type NodeSlideDataExportValue =
  | null
  | boolean
  | number
  | string
  | NodeSlideDataExportValue[]
  | { [key: string]: NodeSlideDataExportValue };

export type NodeSlideDataExportRecord = Record<string, NodeSlideDataExportValue>;

export interface NodeSlideDataExportCollectionManifest {
  /** Path inside `data`, which is also the deletion receipt's count key. */
  path: string;
  /** Physical table in `convex/schema.ts` the rows came from. */
  table: string;
  recordCount: number;
}

export type NodeSlideDataExportOmissionReason =
  | 'cross_deck_profile'
  | 'infrastructure_state'
  | 'erasure_receipt'
  | 'binary_blob_contents'
  | 'secret_or_capability'
  /**
   * Reachable from a deck only through a two-hop derivation (deck -> job ->
   * session/budget), so the schema-derived collector cannot read it. The row is
   * still erased — see the derived sweep in `convex/nodeslideRetention.ts` — but
   * it is not in this bundle, and a bundle that stayed silent about it would be
   * claiming completeness it does not have.
   */
  | 'derived_scope';

export interface NodeSlideDataExportOmission {
  /** Table name, or `table.field` when only one field is withheld. */
  name: string;
  reason: NodeSlideDataExportOmissionReason;
  detail: string;
}

export interface NodeSlideOwnerDataExportManifest {
  schemaVersion: typeof NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION;
  generatedAt: number;
  mediaType: typeof NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE;
  scope: {
    kind: 'deck_owner_capability';
    deckId: string;
    deckVersion: number;
  };
  completeness: {
    status: 'complete';
    truncated: false;
    recordCount: number;
  };
  /** Every table the erasure contract covers and this export includes. */
  collections: NodeSlideDataExportCollectionManifest[];
  /**
   * What is NOT in the bundle, and why. An export that silently drops a field
   * is worse than one that names the gap, so this list is part of the contract
   * and is asserted by the tests rather than written as prose.
   */
  omissions: {
    policyVersion: typeof NODESLIDE_OWNER_DATA_EXPORT_REDACTION_VERSION;
    /** Fields dropped whole (secrets, capabilities, storage ids, binary blobs). */
    removedFieldCount: number;
    /** String values rewritten because they contained a secret-shaped substring. */
    redactedValueCount: number;
    collections: NodeSlideDataExportOmission[];
    fields: NodeSlideDataExportOmission[];
  };
  determinism: {
    collectionOrder: 'schema_defined';
    recordOrder: 'creation_time_then_stable_id';
    objectKeyOrder: 'lexicographic';
    generatedAt: 'request_time_only_nondeterministic_field';
  };
  retention: {
    serverCopyCreated: false;
    bundlePersistence: 'client_download_only';
    sourceSnapshot: 'retained_records_at_export_time';
    expiredOrPrunedRecords: 'not_recoverable';
  };
  mutationPolicy: 'read_only_no_cas_or_proposal_state_changes';
}

export interface NodeSlideOwnerDataExport {
  manifest: NodeSlideOwnerDataExportManifest;
  /**
   * Keyed by the erasure label (`slides`, `agentRuns`, `deck`, `project`, …).
   * Singleton anchors are one-element arrays so every value has one shape.
   */
  data: Record<string, NodeSlideDataExportRecord[]>;
}
