import type { DeckSnapshot, Slide } from '@nodeslide/contracts';
import { useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface UseNodeSlideDeckNavigationInput {
  snapshot: DeckSnapshot;
  activeSlideId: string;
  onActiveSlideChange?: (slideId: string) => void;
  onFocusRequest?: (slideId: string) => void;
  panelId?: string;
}

export interface NodeSlideSlideTabProps {
  'aria-controls': string;
  'aria-selected': boolean;
  'data-nodeslide-slide-tab': string;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  role: 'tab';
  tabIndex: 0 | -1;
}

export interface NodeSlideSlidePanelProps {
  id: string;
  role: 'tabpanel';
}

export interface NodeSlideDeckNavigation {
  orderedSlides: readonly Slide[];
  activeSlide: Slide | null;
  activeIndex: number;
  panelId: string;
  canNavigate: boolean;
  previous: () => void;
  next: () => void;
  getTabProps: (slideId: string) => NodeSlideSlideTabProps;
  getPanelProps: () => NodeSlideSlidePanelProps;
}

export function useNodeSlideDeckNavigation({
  snapshot,
  activeSlideId,
  onActiveSlideChange,
  onFocusRequest,
  panelId: hostPanelId,
}: UseNodeSlideDeckNavigationInput): NodeSlideDeckNavigation {
  const generatedPanelId = `nodeslide-panel-${useId().replaceAll(':', '')}`;
  const panelId = hostPanelId ?? generatedPanelId;
  const orderedSlides = snapshot.deck.slideOrder
    .map((slideId) => snapshot.slides.find((slide) => slide.id === slideId))
    .filter((slide): slide is Slide => slide !== undefined);
  const activeIndex = orderedSlides.findIndex((slide) => slide.id === activeSlideId);
  const activeSlide = activeIndex >= 0 ? (orderedSlides[activeIndex] ?? null) : null;

  function selectRelative(offset: number): void {
    if (!onActiveSlideChange || activeIndex < 0 || orderedSlides.length === 0) return;
    const target =
      orderedSlides[(activeIndex + offset + orderedSlides.length) % orderedSlides.length];
    if (target) onActiveSlideChange(target.id);
  }

  function select(slideId: string, focus: boolean): void {
    if (!onActiveSlideChange || !orderedSlides.some((slide) => slide.id === slideId)) return;
    onActiveSlideChange(slideId);
    if (focus) onFocusRequest?.(slideId);
  }

  return {
    orderedSlides,
    activeSlide,
    activeIndex,
    panelId,
    canNavigate: activeSlide !== null && orderedSlides.length >= 2 && !!onActiveSlideChange,
    previous: () => selectRelative(-1),
    next: () => selectRelative(1),
    getTabProps: (slideId) => ({
      'aria-controls': panelId,
      'aria-selected': slideId === activeSlideId,
      'data-nodeslide-slide-tab': slideId,
      onClick: () => select(slideId, false),
      onKeyDown: (event) => {
        if (!onActiveSlideChange) return;
        const index = orderedSlides.findIndex((slide) => slide.id === slideId);
        const targetIndex = targetIndexForKey(event.key, index, orderedSlides.length);
        if (targetIndex === null) return;
        const target = orderedSlides[targetIndex];
        if (!target) return;
        event.preventDefault();
        select(target.id, true);
      },
      role: 'tab',
      tabIndex: slideId === activeSlideId ? 0 : -1,
    }),
    getPanelProps: () => ({ id: panelId, role: 'tabpanel' }),
  };
}

function targetIndexForKey(key: string, index: number, length: number): number | null {
  if (index < 0 || length === 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}
