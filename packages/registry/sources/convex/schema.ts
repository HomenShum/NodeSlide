import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  nodeslide_decks: defineTable({
    deckId: v.string(),
    ownerId: v.string(),
    organizationId: v.optional(v.string()),
    version: v.number(),
    snapshot: v.any(),
    updatedAt: v.number(),
  }).index('by_deck_id', ['deckId']),
  nodeslide_proposals: defineTable({
    deckId: v.string(),
    proposalId: v.string(),
    status: v.string(),
    patch: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_deck_id', ['deckId'])
    .index('by_proposal_id', ['proposalId']),
  nodeslide_versions: defineTable({
    deckId: v.string(),
    version: v.number(),
    snapshot: v.any(),
    createdAt: v.number(),
  }).index('by_deck_version', ['deckId', 'version']),
  nodeslide_receipts: defineTable({
    deckId: v.string(),
    receiptId: v.string(),
    receipt: v.any(),
    recordedAt: v.number(),
  })
    .index('by_deck_id', ['deckId'])
    .index('by_receipt_id', ['receiptId']),
  nodeslide_assets: defineTable({
    deckId: v.string(),
    assetId: v.string(),
    reference: v.any(),
    bytes: v.bytes(),
    createdAt: v.number(),
  })
    .index('by_deck_id', ['deckId'])
    .index('by_asset_id', ['assetId']),
  nodeslide_migration_receipts: defineTable({
    stepId: v.string(),
    fromVersion: v.number(),
    toVersion: v.number(),
    appliedAt: v.number(),
  }).index('by_step_id', ['stepId']),
});
