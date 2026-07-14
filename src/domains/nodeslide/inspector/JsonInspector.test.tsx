import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
} from '../../../../shared/nodeslide';
import { JsonInspector, deckJsonView, serializeDeckJson } from './JsonInspector';

const now = 1_700_000_000_000;

function snapshot(): DeckSnapshot {
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: 'deck-1',
      projectId: 'project-1',
      title: 'Scoped editing',
      brief: {
        prompt: 'Explain scoped editing',
        audience: 'Product teams',
        purpose: 'Demo',
        successCriteria: ['Only selected objects change'],
      },
      theme: {
        id: 'editorial',
        name: 'Editorial',
        mode: 'light',
        colors: {
          canvas: '#fbf8f1',
          ink: '#13233f',
          muted: '#667085',
          accent: '#3155d9',
          accentSoft: '#e9edff',
          insight: '#dfe9d8',
          insightInk: '#1e3b2b',
          trace: '#10213f',
          border: '#d9d9d2',
        },
        typography: { display: 'Fraunces', body: 'Geist', data: 'JetBrains Mono' },
        defaultRadius: 0,
        spacingUnit: 8,
      },
      slideOrder: ['slide-1'],
      version: 3,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    },
    slides: [
      {
        id: 'slide-1',
        deckId: 'deck-1',
        title: 'The selected insight',
        background: '#fbf8f1',
        elementOrder: ['headline', 'chart'],
        version: 2,
      },
    ],
    elements: [
      {
        id: 'headline',
        slideId: 'slide-1',
        name: 'Headline',
        kind: 'text',
        bbox: { x: 0.08, y: 0.08, width: 0.5, height: 0.16 },
        rotation: 0,
        content: 'Before',
        style: { color: '#13233f', fontSize: 34 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable'],
        version: 1,
      },
      {
        id: 'chart',
        slideId: 'slide-1',
        name: 'Chart',
        kind: 'chart',
        bbox: { x: 0.08, y: 0.34, width: 0.84, height: 0.5 },
        rotation: 0,
        style: {},
        chart: {
          chartType: 'bar',
          labels: ['Before', 'After'],
          series: [{ name: 'Minutes', values: [44, 8] }],
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable'],
        version: 1,
      },
    ],
    sources: [],
  };
}

describe('deckJsonView', () => {
  const snap = snapshot();
  const [slide] = snap.slides;
  if (!slide) throw new Error('fixture must have a slide');
  const ctx = { snapshot: snap, slide, selectedElements: [], patches: [] };

  it('deck mode returns the whole DeckSnapshot', () => {
    expect(deckJsonView('deck', ctx)).toBe(snap);
  });

  it('slide mode returns the slide plus only its elements', () => {
    const view = deckJsonView('slide', ctx) as { slide: unknown; elements: unknown[] };
    expect(view.slide).toBe(slide);
    expect(view.elements).toHaveLength(2); // both fixture elements live on slide-1
  });

  it('selection mode returns the selected elements, or null when nothing is selected', () => {
    expect(deckJsonView('selection', ctx)).toBeNull();
    const [firstElement] = snap.elements;
    if (!firstElement) throw new Error('fixture must have elements');
    const withSelection = deckJsonView('selection', {
      ...ctx,
      selectedElements: [firstElement],
    });
    expect(withSelection).toEqual([firstElement]);
  });

  it('patch mode returns null when there are no proposals', () => {
    expect(deckJsonView('patch', ctx)).toBeNull();
  });
});

describe('serializeDeckJson', () => {
  it('produces pretty JSON that round-trips back to the snapshot', () => {
    const snap = snapshot();
    const text = serializeDeckJson(snap);
    expect(text).toContain('\n  '); // 2-space indent
    expect(JSON.parse(text)).toEqual(snap);
  });
});

describe('JsonInspector render', () => {
  it('renders the deck-as-code view with mode + action controls and the deck JSON', () => {
    const snap = snapshot();
    const [slide] = snap.slides;
    if (!slide) throw new Error('fixture must have a slide');
    const html = renderToStaticMarkup(
      <JsonInspector snapshot={snap} slide={slide} selectedElements={[]} patches={[]} />,
    );
    expect(html).toContain('Deck as code');
    expect(html).toContain('nodeslide.slidelang/v1');
    expect(html).toContain('Download deck.json');
    // the four view modes are offered
    for (const label of ['Deck', 'Slide', 'Selection', 'Last patch']) {
      expect(html).toContain(`>${label}</button>`);
    }
    // the default (deck) view actually shows the serialized DeckSpec
    expect(html).toContain('deck-1');
    expect(html).toContain('&quot;schemaVersion&quot;');
  });
});
