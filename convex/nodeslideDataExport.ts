import { v } from 'convex/values';
import { query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { collectNodeSlideOwnerDataExport } from './lib/nodeslideDataExport';
import type { NodeSlideSchemaLike } from './lib/nodeslideErasureContract';
import { NODESLIDE_ERASURE_CONTRACT } from './nodeslideRetention';
import schema from './schema';

/**
 * Produces a complete redacted JSON bundle for exactly one owner-authorized
 * deck. Read-only: it never advances deck or proposal versions, and it writes
 * no server-side copy of the bundle.
 *
 * It walks the same contract `deleteOwnedWorkspace` walks, so the archive and
 * the erasure describe the same set of rows.
 */
export const exportMyData = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    return await collectNodeSlideOwnerDataExport(ctx, {
      deck,
      ownerAccessKey: args.ownerAccessKey,
      generatedAt: Date.now(),
      contract: NODESLIDE_ERASURE_CONTRACT,
      schema: schema as unknown as NodeSlideSchemaLike,
    });
  },
});
