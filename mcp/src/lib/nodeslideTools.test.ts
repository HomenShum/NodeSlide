import { afterEach, describe, expect, it } from 'vitest';

import { localByokStatus } from './byok.js';
import { registerNodeSlideLocalTools } from './localDeckTools.js';
import {
  type NodeSlideWorkspace,
  canonicalNodeSlideSnapshot,
  paginateNodeSlideItems,
  planLocalByokEdit,
  registerNodeSlideTools,
  requireExplicitConsent,
  resolveScope,
  unappliedProposalReceipt,
} from './nodeslideTools.js';

const workspace: NodeSlideWorkspace = {
  deck: { id: 'deck_1', title: 'Test deck', version: 3, slideOrder: ['slide_1'] },
  slides: [{ id: 'slide_1', title: 'Opening', version: 2 }],
  elements: [
    {
      id: 'element_1',
      slideId: 'slide_1',
      name: 'Headline',
      kind: 'text',
      role: 'headline',
      content: 'Before',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
      style: {},
      sourceIds: [],
      locked: false,
      version: 4,
    },
  ],
  sources: [],
  patches: [],
  traces: [],
  versions: [],
  validations: [],
};

const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  if (originalOpenRouterKey === undefined) {
    Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
  } else {
    process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

describe('NodeSlide MCP governance', () => {
  it('retains all 11 hosted tools and adds exactly four offline file tools', () => {
    const hosted: string[] = [];
    const local: string[] = [];
    registerNodeSlideTools(
      {
        registerTool(name: string) {
          hosted.push(name);
        },
      } as never,
      async () => null,
    );
    registerNodeSlideLocalTools({
      registerTool(name: string) {
        local.push(name);
      },
    } as never);
    expect(hosted).toEqual([
      'nodeslide.byok_status',
      'nodeslide.get_deck',
      'nodeslide.list_slides',
      'nodeslide.get_trace',
      'nodeslide.list_versions',
      'nodeslide.propose_edit',
      'nodeslide.accept_proposal',
      'nodeslide.reject_proposal',
      'nodeslide.upload_source',
      'nodeslide.search_web',
      'nodeslide.create_deck',
    ]);
    expect(local).toEqual([
      'nodeslide.inspect_file',
      'nodeslide.validate_file_patch',
      'nodeslide.propose_file_patch',
      'nodeslide.apply_file_proposal',
    ]);
  });

  it('refuses every external path without explicit consent', () => {
    expect(() => requireExplicitConsent(false, 'local BYOK model egress')).toThrow(
      'Explicit consent',
    );
    expect(() => requireExplicitConsent(true, 'local BYOK model egress')).not.toThrow();
  });

  it('rejects element scope that reaches outside the authorized slide', () => {
    expect(() =>
      resolveScope(workspace, {
        scope: 'elements',
        slideId: 'slide_1',
        elementIds: ['not_in_slide'],
        operationMode: 'copy',
      }),
    ).toThrow('Every elementId must belong');
  });

  it('accepts a local BYOK JSON plan but never gives the model a provider key', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-value-never-echo';
    let captured = '';
    const result = await planLocalByokEdit({
      workspace,
      instruction: 'Replace the headline',
      scope: {
        kind: 'slide',
        deckId: 'deck_1',
        slideIds: ['slide_1'],
        operationMode: 'copy',
      },
      model: 'z-ai/glm-5.2',
      complete: async (input) => {
        captured = JSON.stringify(input);
        return {
          text: JSON.stringify({
            summary: 'Replace headline',
            operations: [
              {
                op: 'replace_text',
                slideId: 'slide_1',
                elementId: 'element_1',
                text: 'After',
              },
            ],
          }),
          costUsd: 0.001,
          inputTokens: 100,
          outputTokens: 20,
          modelUsed: 'z-ai/glm-5.2',
          provider: 'openrouter',
          stopReason: 'stop',
        };
      },
    });
    expect(result.operations).toHaveLength(1);
    expect(captured).not.toContain(process.env.OPENROUTER_API_KEY);
    expect(JSON.stringify(localByokStatus(['z-ai/glm-5.2']))).not.toContain(
      process.env.OPENROUTER_API_KEY,
    );
  });

  it('fails closed on invalid model JSON', async () => {
    await expect(
      planLocalByokEdit({
        workspace,
        instruction: 'Change it',
        scope: {
          kind: 'slide',
          deckId: 'deck_1',
          slideIds: ['slide_1'],
          operationMode: 'unrestricted',
        },
        model: 'z-ai/glm-5.2',
        complete: async () => ({
          text: 'not json',
          costUsd: 0,
          inputTokens: 1,
          outputTokens: 1,
          modelUsed: 'z-ai/glm-5.2',
          provider: 'openrouter',
          stopReason: 'stop',
        }),
      }),
    ).rejects.toThrow('No proposal was saved');
  });

  it('proves propose_edit is non-mutating before returning success', () => {
    const receipt = unappliedProposalReceipt(
      {
        patch: { id: 'patch_1', status: 'ready', candidateValidation: { ok: true } },
        workspace: { ...workspace, deck: { ...workspace.deck, version: 3 } },
      },
      3,
    );
    expect(receipt).toMatchObject({ applied: false, deckVersionBefore: 3, deckVersionAfter: 3 });
    expect(() =>
      unappliedProposalReceipt(
        {
          patch: { id: 'patch_1', status: 'accepted' },
          workspace: { ...workspace, deck: { ...workspace.deck, version: 4 } },
        },
        3,
      ),
    ).toThrow('Governance violation');
  });

  it('orders the canonical snapshot and strips owner capabilities recursively', () => {
    const [firstElement] = workspace.elements;
    if (!firstElement) throw new Error('fixture workspace has no elements');
    const unordered = {
      ...workspace,
      deck: {
        ...workspace.deck,
        slideOrder: ['slide_2', 'slide_1'],
        ownerAccessKey: 'owner-secret',
      },
      slides: [
        { id: 'slide_1', title: 'One', version: 1, elementOrder: ['element_1'] },
        { id: 'slide_2', title: 'Two', version: 1, elementOrder: ['element_2'] },
      ],
      elements: [firstElement, { ...firstElement, id: 'element_2', slideId: 'slide_2' }],
    } as unknown as NodeSlideWorkspace;
    const snapshot = canonicalNodeSlideSnapshot(unordered);
    expect(snapshot.slides.map((slide) => slide.id)).toEqual(['slide_2', 'slide_1']);
    expect(snapshot.elements.map((element) => element.id)).toEqual(['element_2', 'element_1']);
    expect(JSON.stringify(snapshot)).not.toContain('owner-secret');
    expect(JSON.stringify(snapshot)).not.toContain('ownerAccessKey');
  });

  it('removes nested capability secrets from open server payloads, not just the top level', () => {
    // `patches` and `traces` are Record<string, unknown> straight off the server:
    // the leak surface is a nested token, not the destructured top-level key.
    const leaky = {
      ...workspace,
      sources: [
        {
          id: 'source_1',
          title: 'Deck',
          sourceType: 'upload',
          googleRefreshToken: 'refresh-secret',
          nested: { grantTokenDigest: 'digest-secret', keep: 'visible' },
        },
      ],
    } as unknown as NodeSlideWorkspace;
    const serialized = JSON.stringify(canonicalNodeSlideSnapshot(leaky));
    expect(serialized).not.toContain('refresh-secret');
    expect(serialized).not.toContain('digest-secret');
    expect(serialized).toContain('visible');
  });

  it('binds pagination cursors to the deck version, collection, and filter', () => {
    const first = paginateNodeSlideItems(['a', 'b', 'c'], {
      deckId: 'deck_1',
      deckVersion: 3,
      collection: 'elements',
      filter: 'slide_1',
      limit: 2,
    });
    expect(first).toMatchObject({ items: ['a', 'b'], hasMore: true, total: 3, limit: 2 });
    const second = paginateNodeSlideItems(['a', 'b', 'c'], {
      deckId: 'deck_1',
      deckVersion: 3,
      collection: 'elements',
      filter: 'slide_1',
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    expect(second).toMatchObject({ items: ['c'], hasMore: false, nextCursor: null });
    // A cursor minted against deck version 3 must not silently resume into v4.
    expect(() =>
      paginateNodeSlideItems(['a', 'b', 'c'], {
        deckId: 'deck_1',
        deckVersion: 4,
        collection: 'elements',
        filter: 'slide_1',
        cursor: first.nextCursor ?? undefined,
      }),
    ).toThrow('invalid or stale');
  });

  it('caps a caller-requested page size at the module maximum', () => {
    const page = paginateNodeSlideItems(
      Array.from({ length: 500 }, (_, index) => index),
      {
        deckId: 'deck_1',
        deckVersion: 3,
        collection: 'slides',
        limit: 10_000,
      },
    );
    expect(page.limit).toBe(100);
    expect(page.items).toHaveLength(100);
    expect(page.hasMore).toBe(true);
  });
});
