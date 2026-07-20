import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type SlideElement,
} from '../../../../shared/nodeslide';
import { createHostedSlideLangAdapter } from './hosted';
import { createLocalSlideLangAdapter } from './localAdapter';
import { type MathRasterInput, getMathPptxPlan, registerMathRasterizer } from './mathRaster';
import { embeddedImageDimensions } from './pptx';

const HIDDEN_ELEMENT_ID = 'element:hidden-export-sentinel';
const HIDDEN_ELEMENT_NAME = 'Hidden export sentinel label';
const HIDDEN_TEXT = 'HIDDEN_TEXT_MUST_NOT_EXPORT_7F31';
const HIDDEN_SOURCE_ID = 'source:hidden-export-sentinel';

function cleanSnapshot(): DeckSnapshot {
  const deckId = 'deck:golden';
  const slideId = 'slide:overview';
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: deckId,
      projectId: 'project:golden',
      title: 'Native export overview',
      brief: {
        prompt: 'Explain the native export path.',
        audience: 'Product and engineering',
        purpose: 'Show editable output without hidden rasterization.',
        successCriteria: ['Clean validation', 'Editable PowerPoint objects'],
      },
      theme: {
        id: 'theme:night',
        name: 'Night signal',
        mode: 'dark',
        colors: {
          canvas: '#10131a',
          ink: '#f7f4ec',
          muted: '#b9c0cb',
          accent: '#f6b94a',
          accentSoft: '#3b3222',
          insight: '#d9f99d',
          insightInk: '#17210b',
          trace: '#7dd3fc',
          border: '#3a4351',
        },
        typography: { display: 'Aptos Display', body: 'Aptos', data: 'Aptos Mono' },
        defaultRadius: 16,
        spacingUnit: 8,
      },
      slideOrder: [slideId],
      version: 3,
      status: 'ready',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_123,
    },
    slides: [
      {
        id: slideId,
        deckId,
        title: 'Overview',
        notes: 'Advance after explaining that every object remains editable.',
        background: '#10131a',
        elementOrder: ['element:headline', 'element:body', 'element:accent', 'element:chart'],
        version: 2,
      },
    ],
    elements: [
      {
        id: 'element:headline',
        slideId,
        name: 'Headline',
        kind: 'text',
        role: 'title',
        bbox: { x: 0.06, y: 0.07, width: 0.62, height: 0.14 },
        rotation: 0,
        content: 'Editable native headline',
        style: {
          color: '#f7f4ec',
          fontFamily: 'Aptos Display',
          fontSize: 40,
          fontWeight: 700,
          lineHeight: 1.05,
        },
        sourceIds: ['source:adoption'],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: 'element:body',
        slideId,
        name: 'Summary',
        kind: 'text',
        role: 'body',
        bbox: { x: 0.06, y: 0.23, width: 0.58, height: 0.1 },
        rotation: 0,
        content: 'Semantic HTML and native Office objects share one canonical snapshot.',
        style: {
          color: '#b9c0cb',
          fontFamily: 'Aptos',
          fontSize: 20,
          lineHeight: 1.2,
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: 'element:accent',
        slideId,
        name: 'Accent block',
        kind: 'shape',
        role: 'decoration',
        bbox: { x: 0.72, y: 0.08, width: 0.2, height: 0.22 },
        rotation: 0,
        style: { fill: '#f6b94a', radius: 18 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: 'element:chart',
        slideId,
        name: 'Adoption chart',
        kind: 'chart',
        role: 'data',
        bbox: { x: 0.06, y: 0.4, width: 0.86, height: 0.45 },
        rotation: 0,
        style: {},
        chart: {
          chartType: 'bar',
          labels: ['Alpha', 'Beta', 'GA'],
          series: [{ name: 'Teams', values: [12, 28, 47], color: '#7dd3fc' }],
          unit: 'teams',
          sourceId: 'source:adoption',
        },
        sourceIds: ['source:adoption'],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
    ],
    sources: [
      {
        id: 'source:adoption',
        deckId,
        title: 'Internal adoption snapshot',
        sourceType: 'internal',
        retrievedAt: 1_700_000_000_000,
        citation: 'Internal adoption snapshot, Q4.',
        url: 'https://sources.example.test/adoption',
        license: 'Internal planning data; not independently audited.',
      },
      {
        id: 'source:unused',
        deckId,
        title: 'Unused research note',
        sourceType: 'note',
        retrievedAt: 1_700_000_000_001,
        citation: 'This source is not referenced by the overview slide.',
      },
    ],
  };
}

function addHiddenTextElement(snapshot: DeckSnapshot): SlideElement {
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Missing slide fixture.');
  const body = snapshot.elements.find((element) => element.id === 'element:body');
  if (!body) throw new Error('Missing body fixture.');
  body.visible = true;

  const hidden: SlideElement = {
    id: HIDDEN_ELEMENT_ID,
    slideId: slide.id,
    name: HIDDEN_ELEMENT_NAME,
    kind: 'text',
    role: 'body',
    bbox: { x: 0.06, y: 0.34, width: 0.58, height: 0.08 },
    rotation: 0,
    content: HIDDEN_TEXT,
    style: { color: '#fb7185', fontFamily: 'Aptos', fontSize: 18 },
    sourceIds: [HIDDEN_SOURCE_ID],
    locked: false,
    visible: false,
    exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
    version: 1,
  };
  snapshot.elements.push(hidden);
  slide.elementOrder.splice(1, 0, hidden.id);
  snapshot.sources.push({
    id: HIDDEN_SOURCE_ID,
    deckId: snapshot.deck.id,
    title: HIDDEN_ELEMENT_NAME,
    sourceType: 'note',
    retrievedAt: 1_700_000_000_002,
    citation: HIDDEN_TEXT,
  });
  return hidden;
}

describe('local SlideLangAdapter', () => {
  const adapter = createLocalSlideLangAdapter();

  it('reads bounded PNG and WebP dimensions for deterministic PPTX framing', () => {
    expect(
      embeddedImageDimensions(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
    ).toEqual({ width: 1, height: 1 });
    expect(
      embeddedImageDimensions('data:image/webp;base64,UklGRhYAAABXRUJQVlA4WAoAAAAAAAAAPwEAswAA'),
    ).toEqual({ width: 320, height: 180 });
    expect(embeddedImageDimensions('data:image/png;base64,not-base64')).toBeNull();
  });

  it('returns a clean, deterministic success contract for a golden-ish snapshot', () => {
    const snapshot = cleanSnapshot();
    const first = adapter.validate(snapshot);
    const second = adapter.check(snapshot);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, publishOk: true, cleanOk: true, issues: [] });
    expect(first.checkedAt).toBe(snapshot.deck.updatedAt);
  });

  it('preserves image fit and focal intent in web export and reports the static-export limit', async () => {
    const snapshot = cleanSnapshot();
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Missing slide fixture.');
    const image: SlideElement = {
      id: 'element:framed-image',
      slideId: slide.id,
      name: 'Framed harbor',
      kind: 'image',
      bbox: { x: 0.67, y: 0.38, width: 0.25, height: 0.42 },
      rotation: 0,
      style: {},
      imageUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      altText: 'A calm harbor',
      image: { placeholder: false, fit: 'contain', focalPoint: { x: 0.2, y: 0.8 } },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_static_fallback', 'google_importable'],
      version: 1,
    };
    snapshot.elements.push(image);
    slide.elementOrder.push(image.id);

    const html = adapter.renderSlideHtml(snapshot, slide.id);
    expect(html).toContain('object-fit:contain');
    expect(html).toContain('object-position:20% 80%');

    const containBinary = await adapter.buildPptx(snapshot);
    const containZip = await JSZip.loadAsync(containBinary);
    const containXml = await containZip.file('ppt/slides/slide1.xml')?.async('string');
    if (!containXml) throw new Error('Missing contain-mode slide XML.');
    expect(containXml).toContain('element:framed-image [static image fallback]');

    const coverSnapshot = structuredClone(snapshot);
    const coverImage = coverSnapshot.elements.find((element) => element.id === image.id);
    if (!coverImage?.image) throw new Error('Missing cloned image fixture.');
    coverImage.image.fit = 'cover';
    const coverBinary = await adapter.buildPptx(coverSnapshot);
    const coverZip = await JSZip.loadAsync(coverBinary);
    const coverXml = await coverZip.file('ppt/slides/slide1.xml')?.async('string');
    if (!coverXml) throw new Error('Missing cover-mode slide XML.');

    // The two modes must produce distinct native image geometry, not merely
    // mutate editor-only metadata that disappears during export.
    expect(coverXml).not.toBe(containXml);
  });

  it('matches server readability policy for footer and page-number chrome', () => {
    const snapshot = cleanSnapshot();
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Missing slide fixture.');
    snapshot.elements.push(
      {
        id: 'element:footer',
        slideId: slide.id,
        name: 'Deck footer',
        kind: 'text',
        role: 'footer',
        bbox: { x: 0.06, y: 0.93, width: 0.7, height: 0.035 },
        rotation: 0,
        content: 'INTERNAL PREVIEW',
        style: { color: '#b9c0cb', fontFamily: 'Aptos Mono', fontSize: 10 },
        sourceIds: [],
        locked: true,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: 'element:page-number',
        slideId: slide.id,
        name: 'Page number',
        kind: 'text',
        role: 'page_number',
        bbox: { x: 0.88, y: 0.92, width: 0.06, height: 0.05 },
        rotation: 0,
        content: '01',
        style: { color: '#f6b94a', fontFamily: 'Aptos Mono', fontSize: 13 },
        sourceIds: [],
        locked: true,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: 'element:near-footer',
        slideId: slide.id,
        name: 'Closing point',
        kind: 'text',
        role: 'bullet',
        bbox: { x: 0.06, y: 0.88, width: 0.38, height: 0.08 },
        rotation: 0,
        content: 'Hand off editable structure',
        style: { color: '#f7f4ec', fontFamily: 'Aptos', fontSize: 16 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
    );
    slide.elementOrder.push('element:near-footer', 'element:footer', 'element:page-number');

    const validation = adapter.validate(snapshot);
    expect(validation.issues.filter((issue) => issue.code === 'font_size')).toEqual([]);
    expect(validation.issues.filter((issue) => issue.code === 'collision')).toEqual([]);
    expect(validation.publishOk).toBe(true);
  });

  it('blocks publish for important collisions and estimated text overflow', () => {
    const snapshot = cleanSnapshot();
    const body = snapshot.elements.find((element) => element.id === 'element:body');
    if (!body) throw new Error('Missing body fixture.');
    body.bbox = { x: 0.06, y: 0.07, width: 0.28, height: 0.07 };
    body.content =
      'This intentionally overlong copy cannot fit in the tiny box and also overlaps the headline.';
    body.style.fontSize = 30;

    const validation = adapter.validate(snapshot);
    expect(validation.ok).toBe(true);
    expect(validation.publishOk).toBe(false);
    expect(validation.cleanOk).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['collision', 'overflow']),
    );
    expect(adapter.getRepairPlan(validation)).toEqual(adapter.getRepairPlan(validation));
    expect(adapter.getRepairPlan(validation).actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fit_text' })]),
    );
  });

  it('preserves provenance and parallel semantic slide content in HTML exports', () => {
    const snapshot = cleanSnapshot();
    const body = snapshot.elements.find((element) => element.id === 'element:body');
    if (!body) throw new Error('Missing body fixture.');
    body.content =
      'Semantic HTML and native Office objects share one canonical snapshot.\n\u2022 Stable source IDs\n\u2022 Deduplicated citations';

    const html = adapter.renderSlideHtml(snapshot, 'slide:overview');
    expect(html).toContain('data-slide-id="slide:overview"');
    expect(html).toContain('data-source-ids="source:adoption"');
    expect(html).toContain('data-element-id="element:headline"');
    expect(html).toContain('data-element-kind="text"');
    expect(html).toContain('data-slide-semantics');
    expect(html).toContain('Slide 1 of 1: Overview</h2>');
    expect(html).toContain('>Editable native headline</h3>');
    expect(html).toContain(
      '<p>Semantic HTML and native Office objects share one canonical snapshot.</p>',
    );
    expect(html).toContain('<ul><li>Stable source IDs</li><li>Deduplicated citations</li></ul>');
    expect(html).toContain('<table><caption>Adoption chart data</caption>');
    expect(html).toContain('<th scope="col">Teams (teams)</th>');
    expect(html).toContain('<th scope="row">Beta</th><td>28</td>');
    expect(html).toContain('data-source-record data-source-id="source:adoption"');
    expect(html).toContain('<cite data-source-citation>Internal adoption snapshot, Q4.</cite>');
    expect(html).toContain(
      '<dd data-source-disclaimer>Internal planning data; not independently audited.</dd>',
    );
    expect(html).toContain('data-slide-visual aria-hidden="true" focusable="false"');
    expect(html).toContain(
      'data-element-id="element:accent" data-element-kind="shape" aria-hidden="true"',
    );

    const deckHtml = adapter.renderDeckHtml(snapshot);
    expect(deckHtml).toContain('Presenter navigation');
    expect(deckHtml).toContain('data-nodeslide-source-records');
    expect(deckHtml).toContain('data-source-count="1"');
    expect(deckHtml).toContain('"id":"source:adoption"');
    expect(deckHtml).not.toContain('"id":"source:unused"');
  });

  it('renders first-class math and video with honest export capabilities', () => {
    const snapshot = cleanSnapshot();
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Missing slide fixture.');
    const math: SlideElement = {
      id: 'element:math',
      slideId: slide.id,
      name: 'Conversion formula',
      kind: 'math',
      role: 'formula',
      bbox: { x: 0.06, y: 0.87, width: 0.38, height: 0.08 },
      rotation: 0,
      content: '172 ÷ 64 = 2.69',
      style: { color: '#f7f4ec', fontFamily: 'Aptos Mono', fontSize: 20 },
      math: {
        expression: '172 ÷ 64 = 2.69',
        syntax: 'plain',
        displayMode: 'block',
        description: 'Goals per match',
      },
      sourceIds: ['source:adoption'],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
    };
    const video: SlideElement = {
      id: 'element:video',
      slideId: slide.id,
      name: 'Product walkthrough',
      kind: 'video',
      role: 'evidence_video',
      bbox: { x: 0.5, y: 0.87, width: 0.42, height: 0.08 },
      rotation: 0,
      style: {},
      video: {
        url: 'https://example.com/walkthrough.mp4',
        title: 'Product walkthrough',
        captionsUrl: 'https://example.com/walkthrough.vtt',
        captionsLanguage: 'en',
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_static_fallback', 'google_importable'],
      version: 1,
    };
    snapshot.elements.push(math, video);
    slide.elementOrder.push(math.id, video.id);

    const html = adapter.renderSlideHtml(snapshot, slide.id);
    expect(html).toContain('data-element-kind="math"');
    expect(html).toContain('<math aria-label="Goals per match">');
    expect(html).toContain('172 ÷ 64 = 2.69');
    expect(html).toContain('data-element-kind="video"');
    expect(html).toContain('https://example.com/walkthrough.mp4');
    expect(html).toContain('kind="captions"');
    expect(html).toContain('https://example.com/walkthrough.vtt');
    expect(adapter.getElementCapability(math).pptx).toBe('native');
    expect(adapter.getElementCapability(video).pptx).toBe('static_fallback');
  });

  it('exports structured math and an editable replace-image placeholder without rasterizing them', async () => {
    const snapshot = cleanSnapshot();
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Missing slide fixture.');
    const capabilities = ['web_native', 'pptx_editable', 'google_importable'] as const;
    snapshot.elements = [
      {
        id: 'element:formula',
        slideId: slide.id,
        name: 'Goals per match formula',
        kind: 'math',
        role: 'formula',
        bbox: { x: 0.08, y: 0.14, width: 0.84, height: 0.24 },
        rotation: 0,
        content: '172 ÷ 64 = 2.69 goals per match',
        style: {
          fill: '#d9f99d',
          color: '#17210b',
          fontFamily: 'Aptos Mono',
          fontSize: 28,
          fontWeight: 700,
          textAlign: 'center',
          verticalAlign: 'middle',
        },
        math: {
          expression: 'goals / matches',
          display: '172 ÷ 64 = 2.69 goals per match',
          variables: [
            { label: 'goals', value: 172 },
            { label: 'matches', value: 64 },
          ],
          sourceId: 'source:adoption',
        },
        sourceIds: ['source:adoption'],
        locked: false,
        exportCapabilities: [...capabilities],
        version: 1,
      },
      {
        id: 'element:image-placeholder',
        slideId: slide.id,
        name: 'Lusail Stadium image',
        kind: 'image',
        role: 'image',
        bbox: { x: 0.08, y: 0.5, width: 0.84, height: 0.34 },
        rotation: 0,
        style: { fill: '#3b3222', stroke: '#f6b94a', strokeWidth: 2 },
        image: {
          placeholder: true,
          credit: 'Licensed FIFA image and photographer credit required',
          sourceId: 'source:adoption',
        },
        altText: 'Lusail Stadium image placeholder',
        sourceIds: ['source:adoption'],
        locked: false,
        exportCapabilities: [...capabilities],
        version: 1,
      },
    ];
    slide.elementOrder = snapshot.elements.map((element) => element.id);

    const validation = adapter.validate(snapshot);
    expect(validation.issues).toEqual([]);

    const html = adapter.renderSlideHtml(snapshot, slide.id);
    expect(html).toContain('data-element-kind="math"');
    expect(html).toContain('role="math"');
    expect(html).toContain('data-expression="goals / matches"');
    expect(html).toContain('data-image-placeholder>Replace image</p>');
    expect(html).toContain('Licensed FIFA image and photographer credit required');

    const binary = await adapter.buildPptx(snapshot);
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    expect(slideXml).toContain('<a:t>172 ÷ 64 = 2.69 goals per match</a:t>');
    expect(slideXml).toContain('<a:t>Replace image</a:t>');
    expect(slideXml).toContain('<a:t>Licensed FIFA image and photographer credit required</a:t>');
  });

  it('omits hidden text from HTML visual, semantic, accessibility, and provenance output', () => {
    const snapshot = cleanSnapshot();
    const hidden = addHiddenTextElement(snapshot);
    expect(snapshot.elements.find((element) => element.id === 'element:headline')?.visible).toBe(
      undefined,
    );
    expect(snapshot.elements.find((element) => element.id === 'element:chart')?.visible).toBe(
      undefined,
    );
    const slideHtml = adapter.renderSlideHtml(snapshot, 'slide:overview');
    const deckHtml = adapter.renderDeckHtml(snapshot);

    for (const html of [slideHtml, deckHtml]) {
      expect(html).not.toContain(HIDDEN_TEXT);
      expect(html).not.toContain(HIDDEN_ELEMENT_ID);
      expect(html).not.toContain(HIDDEN_ELEMENT_NAME);
      expect(html).not.toContain(HIDDEN_SOURCE_ID);
      expect(html).toContain('Editable native headline');
      expect(html).toContain('source:adoption');
      expect(html).toContain(
        'Semantic HTML and native Office objects share one canonical snapshot.',
      );
    }
    expect(deckHtml).toContain('data-source-count="1"');
    expect(deckHtml).toContain('"id":"source:adoption"');
    expect(deckHtml).not.toContain('"id":"source:unused"');

    const visualMarker = slideHtml.indexOf('data-slide-visual');
    const visualStart = slideHtml.lastIndexOf('<svg', visualMarker);
    const visualEnd = slideHtml.indexOf('</svg>', visualMarker);
    const visualHtml = slideHtml.slice(visualStart, visualEnd);
    let previousIndex = -1;
    for (const elementId of [
      'element:headline',
      'element:body',
      'element:accent',
      'element:chart',
    ]) {
      const elementIndex = visualHtml.indexOf(`data-element-id="${elementId}"`);
      expect(elementIndex).toBeGreaterThan(previousIndex);
      previousIndex = elementIndex;
    }

    expect(snapshot.elements).toContain(hidden);
    expect(hidden.visible).toBe(false);
    expect(snapshot.slides[0]?.elementOrder).toContain(hidden.id);
  });

  it('writes native objects and deduplicated source notes into the PPTX ZIP', async () => {
    const binary = await adapter.buildPptx(cleanSnapshot());
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    const notesXml = await zip.file('ppt/notesSlides/notesSlide1.xml')?.async('string');

    expect(slideXml).toContain('<a:t>Editable native headline</a:t>');
    expect(slideXml).toContain('<p:sp>');
    expect(Object.keys(zip.files).some((path) => /^ppt\/charts\/chart\d+\.xml$/.test(path))).toBe(
      true,
    );
    expect(notesXml).toContain('<a:t>Advance after explaining that every object remains editable.');
    expect(notesXml).toContain('NodeSlide sources');
    expect(notesXml).toContain('Citation: Internal adoption snapshot, Q4.');
    expect(notesXml).toContain('Disclaimer: Internal planning data; not independently audited.');
    expect(notesXml).not.toContain('This source is not referenced by the overview slide.');
    expect(notesXml?.match(/Citation: Internal adoption snapshot, Q4\./g)).toHaveLength(1);
  });

  it('omits hidden text and its provenance from PPTX while preserving visible object order', async () => {
    const snapshot = cleanSnapshot();
    const hidden = addHiddenTextElement(snapshot);
    const binary = await adapter.buildPptx(snapshot);
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    if (!slideXml) throw new Error('Missing exported slide XML.');
    const packageXml = (
      await Promise.all(
        Object.values(zip.files)
          .filter((file) => !file.dir && file.name.endsWith('.xml'))
          .map((file) => file.async('string')),
      )
    ).join('\n');

    expect(packageXml).not.toContain(HIDDEN_TEXT);
    expect(packageXml).not.toContain(HIDDEN_ELEMENT_ID);
    expect(packageXml).not.toContain(HIDDEN_ELEMENT_NAME);
    expect(packageXml).not.toContain(HIDDEN_SOURCE_ID);
    const headlineIndex = slideXml.indexOf('<a:t>Editable native headline</a:t>');
    const bodyIndex = slideXml.indexOf(
      '<a:t>Semantic HTML and native Office objects share one canonical snapshot.</a:t>',
    );
    expect(headlineIndex).toBeGreaterThan(-1);
    expect(bodyIndex).toBeGreaterThan(headlineIndex);

    expect(snapshot.elements).toContain(hidden);
    expect(hidden.visible).toBe(false);
    expect(snapshot.slides[0]?.elementOrder).toContain(hidden.id);
  });
});

describe('hosted SlideLang seam', () => {
  it('uses the documented check route without auth and maps official summary fields', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      return new Response(JSON.stringify({ ok: true, publish_ok: true, clean_ok: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const hosted = createHostedSlideLangAdapter({
      environment: { SLIDELANG_API_BASE_URL: 'https://slides.example.test/' },
      fetch: fetchMock,
    });

    const response = await hosted.check({ project: 'demo', workflow: 'slidemaker', files: [] });
    const call = calls[0];
    expect(call?.url).toBe('https://slides.example.test/api/projects/check');
    expect(new Headers(call?.init?.headers).has('authorization')).toBe(false);
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      project: 'demo',
      workflow: 'slidemaker',
      files: [],
    });
    expect(hosted.mapValidationSummary(response, { deckId: 'demo', deckVersion: 1 })).toMatchObject(
      { ok: true, publishOk: true, cleanOk: false },
    );
    expect(hosted.presenterUrl('demo', 'slidemaker')).toBe(
      'https://slides.example.test/present/demo/slidemaker/',
    );
  });
});

/*
 * D1 — expanded chart types in the export SVG renderer.
 *
 * Every chartType compiles to real SVG primitives in the slide visual: the
 * right mark count for the data, axis/value labels with units where the shape
 * calls for them, and the legacy bar output untouched for golden decks.
 */
describe('SlideLang export chart types (D1)', () => {
  const adapter = createLocalSlideLangAdapter();

  function chartSvg(chartType: NonNullable<SlideElement['chart']>['chartType']): string {
    const snapshot = cleanSnapshot();
    const chartElement = snapshot.elements.find((element) => element.id === 'element:chart');
    if (!chartElement?.chart) throw new Error('Missing chart fixture.');
    chartElement.chart.chartType = chartType;
    if (chartType === 'stacked-bar') {
      chartElement.chart.series = [
        { name: 'Teams', values: [12, 28, 47], color: '#7dd3fc' },
        { name: 'Pilots', values: [6, 9, 11] },
      ];
    }
    const html = adapter.renderSlideHtml(snapshot, 'slide:overview');
    // Isolate the chart element's <g> group inside the slide visual SVG.
    const start = html.indexOf('<g data-element-id="element:chart"');
    if (start < 0) throw new Error('Chart SVG group missing.');
    const end = html.indexOf('</g>', start);
    if (end < 0) throw new Error('Chart SVG group unterminated.');
    return html.slice(start, end);
  }

  const count = (svg: string, marker: string): number => svg.split(marker).length - 1;

  it('keeps the legacy vertical bar output', () => {
    const svg = chartSvg('bar');
    expect(count(svg, '<rect')).toBe(3);
    expect(count(svg, '<polyline')).toBe(0);
  });

  it('renders horizontal bars with category labels and a value axis with units', () => {
    const svg = chartSvg('bar-horizontal');
    expect(count(svg, '<rect')).toBe(3);
    expect(svg).toContain('>Alpha</text>');
    expect(svg).toContain('>Beta</text>');
    expect(svg).toContain('>GA</text>');
    expect(svg).toContain('>0</text>');
    expect(svg).toContain('47 teams</text>');
  });

  it('renders stacked bars with one segment per series value and a value axis', () => {
    const svg = chartSvg('stacked-bar');
    expect(count(svg, '<rect')).toBe(6); // 3 labels x 2 series
    expect(svg).toContain('>0</text>');
    expect(svg).toContain('58 teams</text>'); // 47 + 11 stacked maximum
  });

  it('renders a line chart with a polyline and point markers', () => {
    const svg = chartSvg('line');
    expect(count(svg, '<polyline')).toBe(1);
    expect(count(svg, '<circle')).toBe(3);
  });

  it('renders an area chart with a filled polygon under the line', () => {
    const svg = chartSvg('area');
    expect(count(svg, '<polygon')).toBe(1);
    expect(count(svg, '<polyline')).toBe(1);
  });

  it('renders a pie chart with one filled wedge per slice', () => {
    const svg = chartSvg('pie');
    expect(count(svg, '<circle')).toBe(3);
    expect(svg).toContain('teams</text>');
  });

  it('renders a donut chart with a track plus one arc per slice', () => {
    const svg = chartSvg('donut');
    expect(count(svg, '<circle')).toBe(4);
  });
});

/*
 * D3 — expanded chart types stay native, editable PowerPoint charts.
 *
 * pie compiles to a pieChart, bar-horizontal keeps barChart with a horizontal
 * bar direction, and stacked-bar keeps barChart with stacked grouping — none
 * of them regress to rasterized fallbacks.
 */
describe('SlideLang PPTX native chart types (D3)', () => {
  const adapter = createLocalSlideLangAdapter();

  async function chartXml(
    chartType: NonNullable<SlideElement['chart']>['chartType'],
  ): Promise<string> {
    const snapshot = cleanSnapshot();
    const chartElement = snapshot.elements.find((element) => element.id === 'element:chart');
    if (!chartElement?.chart) throw new Error('Missing chart fixture.');
    chartElement.chart.chartType = chartType;
    const binary = await adapter.buildPptx(snapshot);
    const zip = await JSZip.loadAsync(binary);
    const path = Object.keys(zip.files).find((candidate) =>
      /^ppt\/charts\/chart\d+\.xml$/.test(candidate),
    );
    if (!path) throw new Error('Native chart XML missing from PPTX.');
    const xml = await zip.file(path)?.async('string');
    if (!xml) throw new Error('Native chart XML unreadable.');
    return xml;
  }

  it('compiles pie to a native pieChart', async () => {
    expect(await chartXml('pie')).toContain('<c:pieChart>');
  });

  it('compiles bar-horizontal to a native horizontal barChart', async () => {
    const xml = await chartXml('bar-horizontal');
    expect(xml).toContain('<c:barChart>');
    expect(xml).toContain('<c:barDir val="bar"/>');
  });

  it('compiles stacked-bar to a native stacked barChart', async () => {
    const xml = await chartXml('stacked-bar');
    expect(xml).toContain('<c:barChart>');
    expect(xml).toContain('<c:grouping val="stacked"/>');
  });
});

describe('SlideLang PPTX math raster seam (C2+C4)', () => {
  // Persona: an analyst exports an investor deck with a LaTeX energy formula
  // to PowerPoint for a partner who reviews in Office. The equation must
  // arrive as the *rendered* math (image, truthfully labeled static), not as
  // raw LaTeX source — and when rendering is impossible the export must fall
  // back to editable text with a capability report that says exactly that.
  const adapter = createLocalSlideLangAdapter();
  const PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  afterEach(() => {
    registerMathRasterizer(undefined); // reset the seam to auto-detect
  });

  function latexMathSnapshot(expression: string): {
    snapshot: DeckSnapshot;
    element: SlideElement;
  } {
    const snapshot = cleanSnapshot();
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Missing slide fixture.');
    const element: SlideElement = {
      id: 'element:latex-math',
      slideId: slide.id,
      name: 'Mass-energy equivalence',
      kind: 'math',
      role: 'formula',
      bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 },
      rotation: 0,
      content: 'LATEX_TEXT_FALLBACK_SENTINEL',
      style: { color: '#f7f4ec', fontFamily: 'Aptos Mono', fontSize: 28 },
      math: {
        expression,
        syntax: 'latex',
        displayMode: 'block',
        description: 'Mass-energy equivalence',
        display: 'LATEX_TEXT_FALLBACK_SENTINEL',
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
      version: 1,
    };
    snapshot.elements.push(element);
    slide.elementOrder.push(element.id);
    return { snapshot, element };
  }

  it('jsdom honestly cannot rasterize: default plan is text and capability stays native', async () => {
    // No injected rasterizer: the environment probe must fail under jsdom, so
    // the shared plan — and therefore BOTH the capability report and the
    // compiler — choose the editable text path. No silent fake raster claims.
    const { snapshot, element } = latexMathSnapshot('E = mc^2');
    expect(getMathPptxPlan(element).kind).toBe('text');
    const report = adapter.getElementCapability(element);
    expect(report.pptx).toBe('native');
    expect(report.effective).toContain('pptx_editable');

    const binary = await adapter.buildPptx(snapshot);
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    expect(slideXml).toContain('<a:t>LATEX_TEXT_FALLBACK_SENTINEL</a:t>');
    // The pptx ZIP always carries an empty ppt/media/ folder entry; the
    // honest check is that no media *file* was embedded.
    expect(
      Object.values(zip.files).some((file) => !file.dir && file.name.startsWith('ppt/media/')),
    ).toBe(false);
  });

  it('embeds the rendered equation as a labeled static image and reports pptx_static_fallback', async () => {
    const calls: MathRasterInput[] = [];
    registerMathRasterizer(async (input) => {
      calls.push(input);
      return PNG_DATA_URL;
    });
    const { snapshot, element } = latexMathSnapshot('E = mc^2');
    element.exportCapabilities = ['web_native', 'pptx_static_fallback', 'google_importable'];

    // C4: capability report agrees with the raster branch before export runs.
    const report = adapter.getElementCapability(element);
    expect(report.pptx).toBe('static_fallback');
    expect(report.effective).toContain('pptx_static_fallback');
    expect(report.effective).not.toContain('pptx_editable');
    expect(report.web).toBe('native');
    expect(report.warnings.join(' ')).toContain('rasterized image of the rendered equation');
    expect(adapter.validate(snapshot).issues.filter((issue) => issue.code === 'export')).toEqual(
      [],
    );

    const binary = await adapter.buildPptx(snapshot);
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    if (!slideXml) throw new Error('Missing exported slide XML.');

    // Call contract of the injectable seam.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.expression).toBe('E = mc^2');
    expect(calls[0]?.katexHtml).toContain('katex');
    expect(calls[0]?.widthPx).toBeGreaterThan(0);
    expect(calls[0]?.heightPx).toBeGreaterThan(0);
    expect(calls[0]?.color).toBe('#f7f4ec');

    // The slide holds a truthfully labeled image, not the text fallback.
    expect(slideXml).toContain('math static fallback');
    expect(slideXml).not.toContain('<a:t>LATEX_TEXT_FALLBACK_SENTINEL</a:t>');
    expect(Object.keys(zip.files).some((path) => /^ppt\/media\/.+\.png$/.test(path))).toBe(true);
  });

  it('falls back to editable text when the rasterizer fails at export time', async () => {
    registerMathRasterizer(async () => null);
    const { snapshot } = latexMathSnapshot('E = mc^2');
    const binary = await adapter.buildPptx(snapshot);
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    // Never a broken or empty embed: the honest text path ships instead.
    expect(slideXml).toContain('<a:t>LATEX_TEXT_FALLBACK_SENTINEL</a:t>');
    expect(
      Object.values(zip.files).some((file) => !file.dir && file.name.startsWith('ppt/media/')),
    ).toBe(false);
  });

  it('falls back to editable text when the rasterizer throws', async () => {
    registerMathRasterizer(async () => {
      throw new Error('canvas taint');
    });
    const { snapshot } = latexMathSnapshot('E = mc^2');
    const binary = await adapter.buildPptx(snapshot);
    const zip = await JSZip.loadAsync(binary);
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
    expect(slideXml).toContain('<a:t>LATEX_TEXT_FALLBACK_SENTINEL</a:t>');
  });

  it('never calls the rasterizer for unparsable LaTeX or plain-syntax math', async () => {
    const calls: MathRasterInput[] = [];
    registerMathRasterizer(async (input) => {
      calls.push(input);
      return PNG_DATA_URL;
    });

    // Unparsable LaTeX: plan is text, capability keeps the editable claim.
    const broken = latexMathSnapshot('\\frac{');
    expect(getMathPptxPlan(broken.element).kind).toBe('text');
    expect(adapter.getElementCapability(broken.element).pptx).toBe('native');
    await adapter.buildPptx(broken.snapshot);

    // Plain-syntax math stays editable native text even with a rasterizer
    // available (guards the "without rasterizing them" corpus contract).
    const plain = latexMathSnapshot('goals / matches');
    if (!plain.element.math) throw new Error('Missing math fixture.');
    plain.element.math.syntax = 'plain';
    expect(getMathPptxPlan(plain.element).kind).toBe('text');
    await adapter.buildPptx(plain.snapshot);

    expect(calls).toHaveLength(0);
  });
});
