import { describe, expect, it } from 'vitest';
import schema from '../schema';
import {
  NODESLIDE_ERASURE_EXCLUSIONS,
  NodeSlideErasureContractError,
  type NodeSlideSchemaLike,
  type NodeSlideSchemaTableLike,
  buildNodeSlideErasureContract,
  nodeSlideBinaryFields,
  nodeSlideErasureLabel,
  nodeSlideStorageIdFields,
} from './nodeslideErasureContract';

const realSchema = schema as unknown as NodeSlideSchemaLike;

function fixtureTable(
  fields: Record<string, { kind: string; isOptional?: string }>,
  indexes: Array<{ indexDescriptor: string; fields: string[] }>,
): NodeSlideSchemaTableLike {
  return { validator: { kind: 'object', fields }, indexes };
}

/** The live schema plus one table, as if somebody shipped a feature tomorrow. */
function schemaGrownBy(table: string, definition: NodeSlideSchemaTableLike): NodeSlideSchemaLike {
  return { tables: { ...realSchema.tables, [table]: definition } };
}

describe('erasure contract derivation', () => {
  it('accounts for every table in the schema, with no table left unclassified', () => {
    const contract = buildNodeSlideErasureContract(realSchema);
    const covered = new Set(contract.map((entry) => entry.table));
    const excluded = new Set(NODESLIDE_ERASURE_EXCLUSIONS.map((entry) => entry.table));

    const unaccounted = Object.keys(realSchema.tables).filter(
      (table) => !covered.has(table) && !excluded.has(table),
    );
    expect(unaccounted).toEqual([]);
    expect(covered.size + excluded.size).toBe(Object.keys(realSchema.tables).length);

    // Every excluded table must really exist; a stale exclusion is a lie that
    // reads as diligence.
    for (const table of excluded) expect(Object.keys(realSchema.tables)).toContain(table);
  });

  it('produces the deck-owned table set the deletion actually walks', () => {
    const contract = buildNodeSlideErasureContract(realSchema);
    expect(contract.map((entry) => entry.table)).toEqual([
      'nodeslide_slides',
      'nodeslide_elements',
      'nodeslide_patches',
      'nodeslide_variation_batches',
      'nodeslide_variations',
      'nodeslide_variation_decisions',
      'nodeslide_comments',
      'nodeslide_versions',
      'nodeslide_package_receipts',
      'nodeslide_package_submissions',
      'nodeslide_package_assets',
      'nodeslide_sources',
      // Immutable source evidence. It outlives the mutable source row by
      // design, so nothing but the deck erasure will ever remove it.
      'nodeslide_source_revisions',
      // Source monitoring state and the review items it produces. The proposal
      // embeds the plan JSON, so it holds deck content, not just scheduling.
      'nodeslide_source_refresh_schedules',
      'nodeslide_source_refresh_proposals',
      // Web-evidence captures and their steps. The goal text is the owner's own
      // question and the steps hold stored screenshots and PDFs.
      'nodeslide_evidence_captures',
      'nodeslide_evidence_steps',
      // A claim-to-region custody receipt is a standing assertion about this
      // deck's content, so it cannot outlive the deck.
      'nodeslide_claim_evidence_receipts',
      // Upload metadata survives the blob it describes, so it is erased here.
      'nodeslide_uploads',
      'nodeslide_agent_runs',
      'nodeslide_agent_messages',
      'nodeslide_agent_memories',
      'nodeslide_agent_spans',
      'nodeslide_agent_events',
      'nodeslide_validations',
      'nodeslide_traces',
      'nodeslide_execution_traces',
      'nodeslide_shadow_comparisons',
      'nodeslide_exports',
      // The remote-presentation link and its object mapping name local slide
      // and element ids, so the connection is deck content, not plumbing.
      'nodeslide_sync_connections',
      // The Google Slides grant is deck-owned like everything else: an OAuth
      // token is user data, so a deck erasure has to take it with the deck.
      'nodeslide_oauth_sessions',
      'nodeslide_oauth_credentials',
      'nodeslide_google_sync_states',
      // The linked-PPTX baseline, pending plan, and verified remote snapshot
      // are serialized deck content, so the link is erased with the deck.
      'nodeslide_pptx_sync_links',
      'nodeslide_publications',
      'nodeslide_publish_approvers',
      'nodeslide_publish_approvals',
      'nodeslide_preference_events',
      'nodeslide_signature_profiles',
      'nodeslide_taste_profiles',
      'nodeslide_presence',
      // Deck-scoped delegation: a live bearer capability must not outlive the
      // deck it authorizes, and its audit trail goes with it.
      'nodeslide_deck_grants',
      'nodeslide_deck_grant_events',
      // Deck > session > run agent memory. Every row carries deckId, so a
      // run-scoped memory cannot survive the deck it was learned on.
      'nodeslide_scoped_memories',
      'nodeslide_decks',
      'projects',
    ]);
  });

  it('picks a real leading index for every scoped table', () => {
    for (const entry of buildNodeSlideErasureContract(realSchema)) {
      if (entry.scope.index === null) {
        expect(entry.scope.kind).toBe('project');
        continue;
      }
      const indexes = realSchema.tables[entry.table]?.indexes ?? [];
      const index = indexes.find((candidate) => candidate.indexDescriptor === entry.scope.index);
      expect(index, `${entry.table} must expose ${entry.scope.index}`).toBeDefined();
      expect(index?.fields[0]).toBe(entry.scope.field);
    }
  });

  it('erases the deck and project anchors last, after their children', () => {
    const contract = buildNodeSlideErasureContract(realSchema);
    const kinds = contract.map((entry) => entry.scope.kind);
    expect(kinds.at(-1)).toBe('project');
    expect(kinds.at(-2)).toBe('deck');
    expect(kinds.slice(0, -2).every((kind) => kind !== 'deck' && kind !== 'project')).toBe(true);
  });

  it('derives receipt labels from table names rather than a mapping table', () => {
    expect(nodeSlideErasureLabel('nodeslide_variation_batches')).toBe('variationBatches');
    expect(nodeSlideErasureLabel('nodeslide_agent_runs')).toBe('agentRuns');
    expect(nodeSlideErasureLabel('nodeslide_sources')).toBe('sources');
    expect(nodeSlideErasureLabel('nodeslide_decks')).toBe('deck');
    expect(nodeSlideErasureLabel('projects')).toBe('project');
  });

  it('finds byte-valued columns without being told where they are', () => {
    expect(nodeSlideBinaryFields(realSchema, 'nodeslide_package_assets')).toEqual(['bytes']);
    expect(nodeSlideBinaryFields(realSchema, 'nodeslide_slides')).toEqual([]);
  });

  it('finds file-storage pointers, which a row delete would strand rather than erase', () => {
    expect(nodeSlideStorageIdFields(realSchema, 'nodeslide_uploads')).toEqual(['storageId']);
    // Two per row, and both optional: a capture step may hold a screenshot, a
    // PDF, or neither, and each one that exists is a file the erasure must take.
    expect(nodeSlideStorageIdFields(realSchema, 'nodeslide_evidence_steps')).toEqual([
      'pdfStorageId',
      'screenshotStorageId',
    ]);
    // Inline bytes live in the row and go with it; they are not storage ids.
    expect(nodeSlideStorageIdFields(realSchema, 'nodeslide_package_assets')).toEqual([]);
    expect(nodeSlideStorageIdFields(realSchema, 'nodeslide_slides')).toEqual([]);

    // Every table the schema declares with a `_storage` pointer must be one the
    // erasure walks. A blob hanging off an unerased table is unreachable data.
    const contractTables = new Set(
      buildNodeSlideErasureContract(realSchema).map((entry) => entry.table),
    );
    const strandable = Object.keys(realSchema.tables).filter(
      (table) =>
        nodeSlideStorageIdFields(realSchema, table).length > 0 && !contractTables.has(table),
    );
    expect(strandable, 'a table holding storage ids must be inside the erasure').toEqual([]);
  });
});

describe('erasure contract when the schema grows', () => {
  it('covers a new deck-scoped table with no change to the erasure source', () => {
    const grown = schemaGrownBy(
      'nodeslide_future_annotations',
      fixtureTable(
        {
          id: { kind: 'string', isOptional: 'required' },
          deckId: { kind: 'string', isOptional: 'required' },
          body: { kind: 'string', isOptional: 'required' },
          createdAt: { kind: 'float64', isOptional: 'required' },
        },
        [
          { indexDescriptor: 'by_stable_id', fields: ['id'] },
          { indexDescriptor: 'by_deck_created', fields: ['deckId', 'createdAt'] },
        ],
      ),
    );

    const entry = buildNodeSlideErasureContract(grown).find(
      (candidate) => candidate.table === 'nodeslide_future_annotations',
    );
    expect(entry).toBeDefined();
    expect(entry?.label).toBe('futureAnnotations');
    expect(entry?.scope).toEqual({
      kind: 'deckScoped',
      field: 'deckId',
      index: 'by_deck_created',
    });
  });

  it('covers a new tenant-scoped table the same way', () => {
    const grown = schemaGrownBy(
      'nodeslide_future_brand_kits',
      fixtureTable(
        {
          id: { kind: 'string', isOptional: 'required' },
          tenantId: { kind: 'string', isOptional: 'required' },
          updatedAt: { kind: 'float64', isOptional: 'required' },
        },
        [{ indexDescriptor: 'by_tenant_updated', fields: ['tenantId', 'updatedAt'] }],
      ),
    );

    expect(
      buildNodeSlideErasureContract(grown).find(
        (candidate) => candidate.table === 'nodeslide_future_brand_kits',
      )?.scope.kind,
    ).toBe('tenantScoped');
  });

  it('refuses to build when a new table is neither scoped nor excluded', () => {
    const grown = schemaGrownBy(
      'nodeslide_future_orphans',
      fixtureTable(
        {
          id: { kind: 'string', isOptional: 'required' },
          payload: { kind: 'string', isOptional: 'required' },
        },
        [{ indexDescriptor: 'by_stable_id', fields: ['id'] }],
      ),
    );

    expect(() => buildNodeSlideErasureContract(grown)).toThrow(NodeSlideErasureContractError);
    expect(() => buildNodeSlideErasureContract(grown)).toThrow(/nodeslide_future_orphans/);
  });

  it('refuses a deck-scoped table that cannot be scanned by index', () => {
    const grown = schemaGrownBy(
      'nodeslide_future_unindexed',
      fixtureTable(
        {
          id: { kind: 'string', isOptional: 'required' },
          deckId: { kind: 'string', isOptional: 'required' },
        },
        [{ indexDescriptor: 'by_stable_id', fields: ['id'] }],
      ),
    );

    expect(() => buildNodeSlideErasureContract(grown)).toThrow(/no index starts with that field/);
  });

  it('does not mistake an optional deckId for a deck-owned scope', () => {
    const grown = schemaGrownBy(
      'nodeslide_future_loose_reference',
      fixtureTable(
        {
          id: { kind: 'string', isOptional: 'required' },
          deckId: { kind: 'string', isOptional: 'optional' },
        },
        [{ indexDescriptor: 'by_deck', fields: ['deckId'] }],
      ),
    );

    // An optional deckId cannot carry an erasure guarantee: rows without one
    // would silently survive. The contract refuses instead of half-covering it.
    expect(() => buildNodeSlideErasureContract(grown)).toThrow(/nodeslide_future_loose_reference/);
  });
});
