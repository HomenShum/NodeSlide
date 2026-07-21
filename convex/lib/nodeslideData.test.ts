import { describe, expect, it } from 'vitest';
import type { Doc } from '../_generated/dataModel';
import { sourceFromRow } from './nodeslideData';

describe('NodeSlide source row projection', () => {
  it('preserves immutable web snapshot and ingestion metadata for evidence UI', () => {
    const row = {
      _id: 'source-row',
      _creationTime: 1_700_000_000_000,
      id: 'source-web',
      deckId: 'deck-proof',
      title: 'Migrate to the Responses API',
      url: 'https://platform.openai.com/docs/guides/migrate-to-responses',
      sourceType: 'url',
      retrievedAt: 1_700_000_000_000,
      citation: 'Migrate to the Responses API.',
      license: 'Web source; verify reuse rights',
      format: 'web',
      contentDigest: 'sha256:source',
      byteSize: 29,
      provider: 'linkup',
      retention: 'public_snapshot',
      status: 'ready',
      lastRefreshedAt: 1_700_000_000_100,
      snapshot: {
        kind: 'search_excerpt',
        capturedAt: 1_700_000_000_100,
        text: 'Migrate to the Responses API.',
        contentDigest: 'sha256:source',
      },
    } satisfies Doc<'nodeslide_sources'>;

    expect(sourceFromRow(row)).toMatchObject({
      format: 'web',
      provider: 'linkup',
      retention: 'public_snapshot',
      status: 'ready',
      snapshot: {
        kind: 'search_excerpt',
        text: 'Migrate to the Responses API.',
        contentDigest: 'sha256:source',
      },
    });
  });
});
