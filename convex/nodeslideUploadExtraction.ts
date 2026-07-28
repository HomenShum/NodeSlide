'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action } from './_generated/server';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import {
  canonicalNodeSlideUploadDigest,
  extractNodeSlidePdfText,
} from './lib/nodeslidePdfExtraction';

/**
 * Node-runtime PDF extractor for an approved upload.
 *
 * This is the caller `convex/lib/nodeslidePdfExtraction.ts` never had. `pdf` is
 * an accepted `nodeslide_uploads.format`, the extractor landed with the uploads
 * cluster, and `materializeApprovedTextUpload` explicitly refuses the format
 * with "this stored format does not yet have a model-readable extractor" — so a
 * user could store a PDF and then never make it readable. This action is the
 * missing half, and it is a separate `'use node'` module for the same reason
 * the text sibling is not: the PDF parser cannot run in the Convex default
 * runtime.
 *
 * Only approved, owner/session-bound storage can reach it:
 * `getApprovedUploadForMaterializationInternal` re-checks owner session, deck
 * ownership and the model-accessibility gate inside a trusted internal query,
 * so a raw storage id never crosses the action boundary.
 *
 * The digest re-check is the part worth keeping: the bytes are hashed AFTER
 * they come back from storage and compared against the digest recorded on the
 * approval receipt. Approval is granted against content, not against a row, so
 * extracting bytes that no longer match what was approved would hand the model
 * text no human ever cleared.
 */
export const materializeApprovedPdfUpload = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    uploadId: v.string(),
  },
  handler: async (ctx, args): Promise<{ id: string; kind: 'source'; label: string }> => {
    const upload = await ctx.runQuery(
      internal.nodeslideUploads.getApprovedUploadForMaterializationInternal,
      args,
    );
    if (!upload || upload.format !== 'pdf') {
      throw new Error('NodeSlide approved PDF upload is unavailable.');
    }
    const blob = await ctx.storage.get(upload.storageId);
    if (!blob) throw new Error('NodeSlide approved PDF storage is unavailable.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = nodeslideContentDigest(bytes);
    if (digest !== canonicalNodeSlideUploadDigest(upload.contentDigest)) {
      throw new Error('Stored PDF digest no longer matches its approved upload receipt.');
    }
    const extracted = await extractNodeSlidePdfText(bytes);
    return ctx.runMutation(internal.nodeslide.attachStoredDataSourceInternal, {
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
      title: upload.fileName,
      format: 'pdf',
      preview: `PDF pages: ${extracted.pageCount}\n${extracted.preview}`,
      previewTruncated: extracted.truncated,
      contentDigest: digest,
      byteSize: bytes.byteLength,
    });
  },
});
