import { v } from 'convex/values';
import { compileNodeSlideArtifactSpecs } from '../shared/nodeslideArtifactSpec';
import { query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { loadNodeSlideSnapshot } from './lib/nodeslideData';
import { buildNodeSlideGymShadowRouteReceipt } from './lib/nodeslideGymShadow';

/**
 * Authenticated, sanitized NodeGym route-decision shadow. This query is
 * advisory only: it has no mutation context, invokes no provider, and supplies
 * no champion until an independently approved registry is implemented.
 */
export const route = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    taskClass: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.taskClass.trim() || args.taskClass.length > 120) {
      throw new Error('NodeGym shadow task class is invalid.');
    }
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const snapshot = await loadNodeSlideSnapshot(ctx, args.deckId);
    if (!snapshot) throw new Error(`Deck ${args.deckId} not found.`);
    const artifactCompilation = compileNodeSlideArtifactSpecs(snapshot).receipt;
    return buildNodeSlideGymShadowRouteReceipt({
      taskClass: args.taskClass,
      artifactCompilation,
      // Deliberately empty until a digest-bound approval registry exists.
      approvedChampions: [],
    });
  },
});
