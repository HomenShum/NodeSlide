import { createNodeSlideTestSnapshot } from '@nodeslide/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useNodeSlideDeckNavigation } from './deckNavigation';

describe('@nodeslide/react-headless server rendering', () => {
  it('derives navigation without window or document', () => {
    expect('window' in globalThis).toBe(false);
    expect('document' in globalThis).toBe(false);
    const snapshot = createNodeSlideTestSnapshot();

    function Probe() {
      const navigation = useNodeSlideDeckNavigation({
        snapshot,
        activeSlideId: snapshot.deck.slideOrder[0] ?? '',
      });
      return <output>{`${navigation.activeIndex}:${navigation.activeSlide?.title}`}</output>;
    }

    expect(renderToStaticMarkup(<Probe />)).toContain('0:Portable boundary');
  });
});
