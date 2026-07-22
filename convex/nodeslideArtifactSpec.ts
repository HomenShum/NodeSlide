import { v } from 'convex/values';
import {
  compileNodeSlideArtifactSpecs,
  createNodeSlideArtifactShadowReceipt,
} from '../shared/nodeslideArtifactSpec';
import { query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { findDeckRow, loadNodeSlideSnapshot } from './lib/nodeslideData';
import { buildNodeSlideGymArtifactEvidence } from './lib/nodeslideGymArtifactEvidence';

/**
 * Authenticated, read-only production shadow probe.
 *
 * It compiles the current persisted snapshot but returns no deck text, stable
 * object ids, sources, or specs. `mutationApplied` and `userVisible` are
 * literal false in the digest-bound receipt. Running this query proves only
 * compilation for the requested snapshot; it does not claim a live rollout.
 */
export const shadowCompile = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const snapshot = await loadNodeSlideSnapshot(ctx, args.deckId);
    if (!snapshot) throw new Error(`Deck ${args.deckId} not found.`);
    const compilation = compileNodeSlideArtifactSpecs(snapshot);
    return createNodeSlideArtifactShadowReceipt(compilation.receipt, snapshot);
  },
});

/**
 * Owner-only, read-only projection for NodeGym semantic scoring. The helper
 * verifies the stored compiler receipt and rendered authored binding before
 * returning a bounded payload whose free text and source aliases are redacted.
 */
export const gymArtifactEvidence = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    artifactKind: v.string(),
    claimIds: v.array(v.string()),
    sourceIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const [deck, snapshot] = await Promise.all([
      findDeckRow(ctx, args.deckId),
      loadNodeSlideSnapshot(ctx, args.deckId),
    ]);
    if (!deck || !snapshot) throw new Error('NodeSlide workspace is unavailable.');
    return buildNodeSlideGymArtifactEvidence({
      storedSpec: deck.spec,
      snapshot,
      artifactKind: args.artifactKind,
      claimIds: args.claimIds,
      sourceIds: args.sourceIds,
    });
  },
});
