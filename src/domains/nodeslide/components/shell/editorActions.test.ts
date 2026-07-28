import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { NodeSlideWorkspace } from '../../../../../shared/nodeslide';
import {
  createBlankSlide,
  duplicateSlide,
  elementScope,
  resolveEditorMutationFocus,
  runFocusedEditorMutation,
  uniqueClientId,
} from './editorActions';

const studioSource = readFileSync(new URL('../../NodeSlideStudio.tsx', import.meta.url), 'utf8');

/**
 * Scenario: an owner is editing slide 6's headline in the canvas. The blur commit is a network
 * round trip; the receipt it returns installs a new workspace, which re-renders the studio from
 * the subscription. Before this module existed the render dropped the caret's slide and element
 * selection, so the person typing was thrown back to slide 1 by a render they did not cause.
 */
describe('focused editor mutations hold the caret across the receipt', () => {
  it('restores the edited slide and element after a mutation commits', async () => {
    let workspace = focusedWorkspace('Original headline', 2, 4);
    let activeSlideId = 'slide-1';
    let selectedElementIds: string[] = [];

    const accepted = await runFocusedEditorMutation({
      focus: { slideId: 'slide-6', elementIds: ['headline-6'] },
      readWorkspace: () => workspace,
      mutate: async () => {
        expect(workspace.deck.version).toBe(2);
        workspace = focusedWorkspace('Decision-ready headline', 3, 5);
        return true;
      },
      restoreFocus: (focus) => {
        activeSlideId = focus.slideId;
        selectedElementIds = focus.elementIds;
      },
    });

    expect(accepted).toBe(true);
    expect(activeSlideId).toBe('slide-6');
    expect(selectedElementIds).toEqual(['headline-6']);
    expect(workspace.elements[0]?.content).toBe('Decision-ready headline');
  });

  it('preserves focus when the canonical CAS rejects a stale element version', async () => {
    const workspace = focusedWorkspace('Newer remote headline', 3, 5);
    let activeSlideId = 'slide-1';
    let selectedElementIds: string[] = [];

    const accepted = await runFocusedEditorMutation({
      focus: { slideId: 'slide-6', elementIds: ['headline-6'] },
      readWorkspace: () => workspace,
      mutate: async () => false,
      restoreFocus: (focus) => {
        activeSlideId = focus.slideId;
        selectedElementIds = focus.elementIds;
      },
    });

    expect(accepted).toBe(false);
    expect(activeSlideId).toBe('slide-6');
    expect(selectedElementIds).toEqual(['headline-6']);
  });

  it('reports an unexpected failure instead of throwing through the canvas', async () => {
    const workspace = focusedWorkspace('Original headline', 2, 4);
    const onUnexpectedFailure = vi.fn();
    let activeSlideId = 'slide-1';

    const accepted = await runFocusedEditorMutation({
      focus: { slideId: 'slide-6', elementIds: ['headline-6'] },
      readWorkspace: () => workspace,
      mutate: async () => {
        throw new Error('Mutation service unavailable.');
      },
      restoreFocus: (focus) => {
        activeSlideId = focus.slideId;
      },
      onUnexpectedFailure,
    });

    expect(accepted).toBe(false);
    expect(onUnexpectedFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Mutation service unavailable.' }),
    );
    expect(activeSlideId).toBe('slide-6');
  });

  it('never guesses a fallback slide when the edited slide is gone', () => {
    const workspace = focusedWorkspace('Original headline', 2, 4);
    expect(
      resolveEditorMutationFocus(workspace, { slideId: 'slide-9', elementIds: [] }),
    ).toBeNull();
  });

  it('drops element ids that moved off the edited slide, keeping the slide', () => {
    const workspace = focusedWorkspace('Original headline', 2, 4);
    expect(
      resolveEditorMutationFocus(workspace, {
        slideId: 'slide-6',
        elementIds: ['headline-6', 'headline-gone'],
      }),
    ).toEqual({ slideId: 'slide-6', elementIds: ['headline-6'] });
  });
});

describe('slide construction helpers', () => {
  it('mints collision-free client ids under the requested prefix', () => {
    const ids = new Set(Array.from({ length: 64 }, () => uniqueClientId('slide')));
    expect(ids.size).toBe(64);
    for (const id of ids) expect(id.startsWith('slide_')).toBe(true);
  });

  it('clamps a blank slide into the deck and gives it two editable primitives', () => {
    const workspace = blankDeckWorkspace();
    const added = createBlankSlide(workspace, 99);

    expect(added.index).toBe(workspace.deck.slideOrder.length);
    expect(added.elements).toHaveLength(2);
    expect(added.slide.elementOrder).toEqual(added.elements.map((element) => element.id));
    expect(added.elements.every((element) => element.slideId === added.slide.id)).toBe(true);
  });

  it('duplicates a slide with fresh ids and refuses an unknown source', () => {
    const workspace = blankDeckWorkspace();
    const copy = duplicateSlide(workspace, 'slide-6');
    if (!copy) throw new Error('Expected slide-6 to duplicate');

    expect(copy.index).toBe(workspace.deck.slideOrder.indexOf('slide-6') + 1);
    expect(copy.slide.id).not.toBe('slide-6');
    expect(copy.slide.elementOrder).not.toContain('headline-6');
    expect(copy.elements.every((element) => element.slideId === copy.slide.id)).toBe(true);
    expect(duplicateSlide(workspace, 'slide-does-not-exist')).toBeNull();
  });

  it('narrows an element scope to the distinct slides those elements sit on', () => {
    const scope = elementScope('deck-1', [
      { id: 'a', slideId: 'slide-6' },
      { id: 'b', slideId: 'slide-6' },
      { id: 'c', slideId: 'slide-1' },
    ] as never);

    expect(scope).toMatchObject({
      kind: 'elements',
      deckId: 'deck-1',
      slideIds: ['slide-6', 'slide-1'],
      elementIds: ['a', 'b', 'c'],
    });
  });
});

/**
 * The wiring, not the copy.
 *
 * Extracting these helpers is worth nothing if the studio keeps its own private duplicates or
 * routes text edits around the focus hold. These assertions are the sensor for both: they go red
 * if the import is dropped, if a local `function createBlankSlide(` reappears, or if the direct
 * text-edit path is reverted to a bare `applyOperations` call.
 */
describe('NodeSlideStudio consumes these helpers rather than redefining them', () => {
  it('imports the shell editor actions instead of keeping private copies', () => {
    expect(studioSource).toContain("from './components/shell/editorActions'");
    expect(studioSource).not.toMatch(/^function createBlankSlide\(/m);
    expect(studioSource).not.toMatch(/^function duplicateSlide\(/m);
    expect(studioSource).not.toMatch(/^function uniqueClientId\(/m);
    expect(studioSource).not.toMatch(/^function elementScope\(/m);
  });

  it('routes direct text edits and design patches through the focus hold', () => {
    expect(studioSource).toContain('runFocusedEditorMutation({');
    expect(studioSource).toContain('onReplaceText={(elementId, text, baseElementVersion) => {');
    expect(studioSource.match(/applyFocusedOperations\(/g) ?? []).toHaveLength(2);
    expect(studioSource).toContain(
      "[{ op: 'replace_text', slideId: element.slideId, elementId, text }]",
    );
    expect(studioSource).toContain('{ [elementId]: baseElementVersion }');
  });
});

function focusedWorkspace(
  headline: string,
  deckVersion: number,
  elementVersion: number,
): NodeSlideWorkspace {
  return {
    deck: { id: 'deck-1', slideOrder: ['slide-1', 'slide-6'], version: deckVersion },
    slides: [
      { id: 'slide-1', deckId: 'deck-1', elementOrder: [], version: 1 },
      { id: 'slide-6', deckId: 'deck-1', elementOrder: ['headline-6'], version: 2 },
    ],
    elements: [
      {
        id: 'headline-6',
        slideId: 'slide-6',
        kind: 'text',
        name: 'Headline',
        content: headline,
        version: elementVersion,
      },
    ],
    sources: [],
    comments: [],
    patches: [],
    versions: [],
    traces: [],
    validations: [],
    exports: [],
    presence: [],
    publication: null,
  } as unknown as NodeSlideWorkspace;
}

function blankDeckWorkspace(): NodeSlideWorkspace {
  const base = focusedWorkspace('Original headline', 2, 4) as unknown as Record<string, unknown>;
  const deck = base['deck'] as Record<string, unknown>;
  deck['theme'] = {
    colors: { ink: '#101010', muted: '#606060', canvas: '#ffffff' },
    typography: { display: 'Display', body: 'Body' },
  };
  return base as unknown as NodeSlideWorkspace;
}
