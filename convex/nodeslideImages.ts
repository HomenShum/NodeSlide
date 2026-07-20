'use node';

import { ConvexError, v } from 'convex/values';
import type { LicensedImageResult } from '../shared/nodeslide';
import { action } from './_generated/server';
import {
  OPENVERSE_MAX_QUERY_LENGTH,
  assertImageSearchConsent,
  searchOpenverseImages,
} from './lib/nodeslideImageSearch';

/**
 * License-aware image search. Runs server-side against the Openverse catalog
 * (commercial-use licenses only) and never fires without the exact consent
 * receipt — clicking Search in the editor is the consent act that mints it.
 */
export const searchImages = action({
  args: {
    query: v.string(),
    consent: v.string(),
  },
  handler: async (_ctx, args): Promise<{ results: LicensedImageResult[] }> => {
    try {
      assertImageSearchConsent(args.consent);
    } catch (cause) {
      throw new ConvexError(
        cause instanceof Error
          ? cause.message
          : 'Explicit image search consent is required before sending this query to Openverse.',
      );
    }
    const query = args.query.trim();
    if (!query) throw new ConvexError('Enter a search query before searching Openverse.');
    if (query.length > OPENVERSE_MAX_QUERY_LENGTH) {
      throw new ConvexError(
        `Image search queries are capped at ${OPENVERSE_MAX_QUERY_LENGTH} characters.`,
      );
    }
    const outcome = await searchOpenverseImages(query);
    if (!outcome.ok) throw new ConvexError(outcome.reason);
    return { results: outcome.results };
  },
});
