/**
 * Index-scoped row reads driven by the derived erasure contract.
 *
 * The table name and index name arrive as strings from
 * `buildNodeSlideErasureContract`, so the generated per-table types cannot be
 * applied here. The casts are contained in this one file, and the contract has
 * already refused any table whose scoping field has no leading index — so a
 * scan reached from here is always index-bound, never a table scan.
 */

import type { Id, TableNames } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { NodeSlideErasureEntry } from './nodeslideErasureContract';

export interface NodeSlideStoredRow {
  _id: Id<TableNames>;
  _creationTime: number;
  id?: string;
  /** Declared explicitly so the deck-boundary assertion is a typed read. */
  deckId?: string;
  [field: string]: unknown;
}

interface ScopedQuery {
  take: (count: number) => Promise<NodeSlideStoredRow[]>;
}

interface IndexedQuery {
  withIndex: (
    indexName: string,
    builder: (query: { eq: (field: string, value: string) => unknown }) => unknown,
  ) => ScopedQuery;
}

function scopedQuery(
  ctx: Pick<QueryCtx, 'db'>,
  table: string,
  index: string,
  field: string,
  value: string,
): ScopedQuery {
  const query = ctx.db.query(table as TableNames) as unknown as IndexedQuery;
  return query.withIndex(index, (builder) => builder.eq(field, value));
}

/**
 * Resolves the scoping value for one contract entry against a deck.
 * Returns null for the deck and project anchors, which are addressed by row id.
 */
export function nodeSlideScopeValue(
  entry: NodeSlideErasureEntry,
  deck: { id: string; projectId: string },
): string | null {
  switch (entry.scope.kind) {
    case 'deckScoped':
      return deck.id;
    case 'tenantScoped':
      return deck.projectId;
    default:
      return null;
  }
}

/**
 * Every read on this path is bounded by an explicit count. There is no
 * `collect()` helper here on purpose: an unbounded read is how a caller ends up
 * with a deletion set nobody sized, and the erasure envelope in
 * `nodeslideRetention.ts` can only refuse what it was allowed to measure first.
 */
export async function takeNodeSlideScopedRows(
  ctx: Pick<QueryCtx, 'db'>,
  entry: NodeSlideErasureEntry,
  value: string,
  count: number,
): Promise<NodeSlideStoredRow[]> {
  if (entry.scope.index === null) return [];
  return await scopedQuery(ctx, entry.table, entry.scope.index, entry.scope.field, value).take(
    count,
  );
}
