// @vitest-environment jsdom

import type { DeckSnapshot, Slide } from '@nodeslide/contracts';
import { createNodeSlideTestSnapshot } from '@nodeslide/testing';
import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useNodeSlideDeckNavigation } from './deckNavigation';

describe('useNodeSlideDeckNavigation', () => {
  it('wraps controlled previous and next intent without mutating the snapshot', () => {
    const snapshot = withSecondSlide(createNodeSlideTestSnapshot());
    const before = structuredClone(snapshot);
    const onActiveSlideChange = vi.fn();
    const { result } = renderHook(() =>
      useNodeSlideDeckNavigation({
        snapshot,
        activeSlideId: snapshot.deck.slideOrder[0] ?? '',
        onActiveSlideChange,
      }),
    );

    act(() => result.current.previous());
    act(() => result.current.next());

    expect(onActiveSlideChange.mock.calls).toEqual([
      [snapshot.deck.slideOrder[1]],
      [snapshot.deck.slideOrder[1]],
    ]);
    expect(snapshot).toEqual(before);
  });

  it.each([
    ['ArrowRight', 1],
    ['ArrowDown', 1],
    ['ArrowLeft', 1],
    ['ArrowUp', 1],
    ['Home', 0],
    ['End', 1],
  ])('maps %s to controlled selection and focus intent', (key, targetIndex) => {
    const snapshot = withSecondSlide(createNodeSlideTestSnapshot());
    const activeSlideId = snapshot.deck.slideOrder[0] ?? '';
    const onActiveSlideChange = vi.fn();
    const onFocusRequest = vi.fn();
    const { result } = renderHook(() =>
      useNodeSlideDeckNavigation({
        snapshot,
        activeSlideId,
        onActiveSlideChange,
        onFocusRequest,
      }),
    );
    const { event, preventDefault } = keyboardEvent(key);

    act(() => result.current.getTabProps(activeSlideId).onKeyDown(event));

    const targetId = snapshot.deck.slideOrder[targetIndex];
    expect(onActiveSlideChange).toHaveBeenCalledWith(targetId);
    expect(onFocusRequest).toHaveBeenCalledWith(targetId);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('ignores unknown keys and does not consume keys when selection is read-only', () => {
    const snapshot = withSecondSlide(createNodeSlideTestSnapshot());
    const activeSlideId = snapshot.deck.slideOrder[0] ?? '';
    const onActiveSlideChange = vi.fn();
    const onFocusRequest = vi.fn();
    const interactive = renderHook(() =>
      useNodeSlideDeckNavigation({
        snapshot,
        activeSlideId,
        onActiveSlideChange,
        onFocusRequest,
      }),
    );
    const unknown = keyboardEvent('Enter');

    act(() => interactive.result.current.getTabProps(activeSlideId).onKeyDown(unknown.event));

    expect(onActiveSlideChange).not.toHaveBeenCalled();
    expect(onFocusRequest).not.toHaveBeenCalled();
    expect(unknown.preventDefault).not.toHaveBeenCalled();

    const readOnly = renderHook(() => useNodeSlideDeckNavigation({ snapshot, activeSlideId }));
    const arrow = keyboardEvent('ArrowRight');
    act(() => readOnly.result.current.getTabProps(activeSlideId).onKeyDown(arrow.event));
    expect(arrow.preventDefault).not.toHaveBeenCalled();
  });

  it('fails closed for an invalid active slide and filters dangling slide references', () => {
    const snapshot = withSecondSlide(createNodeSlideTestSnapshot());
    snapshot.deck.slideOrder.splice(1, 0, 'slide:missing');
    const onActiveSlideChange = vi.fn();
    const { result } = renderHook(() =>
      useNodeSlideDeckNavigation({
        snapshot,
        activeSlideId: 'slide:invalid',
        onActiveSlideChange,
      }),
    );

    expect(result.current.orderedSlides.map((slide) => slide.id)).toEqual([
      snapshot.deck.slideOrder[0],
      snapshot.deck.slideOrder[2],
    ]);
    expect(result.current.activeSlide).toBeNull();
    expect(result.current.activeIndex).toBe(-1);
    expect(result.current.canNavigate).toBe(false);
    expect(result.current.getTabProps(snapshot.deck.slideOrder[0] ?? '').tabIndex).toBe(0);
    expect(result.current.getTabProps(snapshot.deck.slideOrder[2] ?? '').tabIndex).toBe(-1);
    act(() => result.current.previous());
    act(() => result.current.next());
    expect(onActiveSlideChange).not.toHaveBeenCalled();
  });

  it('returns controlled ARIA tab and panel props', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const activeSlideId = snapshot.deck.slideOrder[0] ?? '';
    const { result } = renderHook(() =>
      useNodeSlideDeckNavigation({ snapshot, activeSlideId, panelId: 'host-panel' }),
    );

    expect(result.current.getPanelProps()).toEqual({ id: 'host-panel', role: 'tabpanel' });
    expect(result.current.getTabProps(activeSlideId)).toMatchObject({
      'aria-controls': 'host-panel',
      'aria-selected': true,
      'data-nodeslide-slide-tab': activeSlideId,
      role: 'tab',
      tabIndex: 0,
    });
  });

  it('does not emit relative navigation for empty or single-slide decks', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const onActiveSlideChange = vi.fn();
    const single = renderHook(() =>
      useNodeSlideDeckNavigation({
        snapshot,
        activeSlideId: snapshot.deck.slideOrder[0] ?? '',
        onActiveSlideChange,
      }),
    );
    act(() => single.result.current.previous());
    act(() => single.result.current.next());

    const emptySnapshot = {
      ...structuredClone(snapshot),
      deck: { ...structuredClone(snapshot.deck), slideOrder: [] },
      slides: [],
      elements: [],
    };
    const empty = renderHook(() =>
      useNodeSlideDeckNavigation({
        snapshot: emptySnapshot,
        activeSlideId: '',
        onActiveSlideChange,
      }),
    );
    act(() => empty.result.current.previous());
    act(() => empty.result.current.next());

    expect(single.result.current.canNavigate).toBe(false);
    expect(empty.result.current.canNavigate).toBe(false);
    expect(onActiveSlideChange).not.toHaveBeenCalled();
  });
});

function keyboardEvent(key: string): {
  event: ReactKeyboardEvent<HTMLButtonElement>;
  preventDefault: ReturnType<typeof vi.fn>;
} {
  const preventDefault = vi.fn();
  return {
    event: { key, preventDefault } as unknown as ReactKeyboardEvent<HTMLButtonElement>,
    preventDefault,
  };
}

function withSecondSlide(snapshot: DeckSnapshot): DeckSnapshot {
  const secondSlideId = `${snapshot.deck.id}:slide:2`;
  const secondSlide: Slide = {
    id: secondSlideId,
    deckId: snapshot.deck.id,
    title: 'Proof',
    background: '#ffffff',
    elementOrder: [],
    version: 1,
  };
  return {
    ...structuredClone(snapshot),
    deck: {
      ...structuredClone(snapshot.deck),
      slideOrder: [...snapshot.deck.slideOrder, secondSlideId],
    },
    slides: [...structuredClone(snapshot.slides), secondSlide],
  };
}
