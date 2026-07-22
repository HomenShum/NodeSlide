// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import { SlideRenderer } from './SlideRenderer';

const theme: ThemeSpec = {
  id: 'theme-image-test',
  name: 'Image test',
  mode: 'light',
  colors: {
    canvas: '#ffffff',
    ink: '#111111',
    muted: '#666666',
    accent: '#3355ff',
    accentSoft: '#dde3ff',
    insight: '#fff3d6',
    insightInk: '#7a5200',
    trace: '#f0f0f0',
    border: '#e0e0e0',
  },
  typography: { display: 'Georgia', body: 'Helvetica', data: 'monospace' },
  defaultRadius: 8,
  spacingUnit: 8,
};

const slide: Slide = {
  id: 'slide-1',
  deckId: 'deck-1',
  title: 'Image framing',
  background: '#ffffff',
  elementOrder: ['image-1'],
  version: 1,
};

afterEach(cleanup);

describe('SlideRenderer image framing', () => {
  it('maps fit and continuous focal point to the browser image primitive', () => {
    const element: SlideElement = {
      id: 'image-1',
      slideId: 'slide-1',
      name: 'Harbor',
      kind: 'image',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
      rotation: 0,
      style: {},
      imageUrl: 'data:image/webp;base64,UklGRg==',
      altText: 'A calm harbor',
      image: { placeholder: false, fit: 'contain', focalPoint: { x: 0.2, y: 0.8 } },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_static_fallback'],
      version: 1,
    };

    const { container } = render(
      <SlideRenderer elements={[element]} slide={slide} theme={theme} />,
    );
    const image = container.querySelector('img');
    expect(image?.style.objectFit).toBe('contain');
    expect(image?.style.objectPosition).toBe('20% 80%');
    expect(image?.getAttribute('alt')).toBe('A calm harbor');
  });

  it('does not contact a remote image host while rendering a deck', () => {
    const element: SlideElement = {
      id: 'image-1',
      slideId: 'slide-1',
      name: 'Remote legacy image',
      kind: 'image',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
      rotation: 0,
      style: {},
      imageUrl: 'https://tracker.example.test/pixel.png',
      altText: 'Remote image withheld',
      image: { placeholder: false },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['pptx_static_fallback'],
      version: 1,
    };

    const { container, getByText } = render(
      <SlideRenderer elements={[element]} slide={slide} theme={theme} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('Replace image')).toBeTruthy();
  });

  it('does not mount remote video, poster, or captions URLs before an explicit click', () => {
    const element: SlideElement = {
      id: 'video-1',
      slideId: 'slide-1',
      name: 'Private walkthrough',
      kind: 'video',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
      rotation: 0,
      style: {},
      video: {
        url: 'https://media.example.test/private.mp4',
        posterUrl: 'https://media.example.test/poster.jpg',
        captionsUrl: 'https://media.example.test/private.vtt',
        title: 'Private walkthrough',
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native'],
      version: 1,
    };
    const videoSlide = { ...slide, elementOrder: [element.id] };
    const { container, getByRole, rerender } = render(
      <SlideRenderer elements={[element]} slide={videoSlide} theme={theme} />,
    );

    expect(container.querySelector('video')).toBeNull();
    expect(container.innerHTML).not.toContain('media.example.test');
    fireEvent.click(getByRole('button', { name: 'Load remote video: Private walkthrough' }));

    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toContain('private.mp4');
    expect(video?.crossOrigin).toBe('anonymous');
    expect(video?.getAttribute('poster')).toContain('poster.jpg');
    expect(video?.querySelector('track')?.getAttribute('src')).toContain('private.vtt');

    const replacement: SlideElement = {
      ...element,
      video: {
        ...element.video,
        url: 'https://replacement.example.test/new.mp4',
        posterUrl: 'https://replacement.example.test/new.jpg',
        captionsUrl: 'https://replacement.example.test/new.vtt',
      },
      version: 2,
    };
    rerender(<SlideRenderer elements={[replacement]} slide={videoSlide} theme={theme} />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.innerHTML).not.toContain('replacement.example.test');
    expect(getByRole('button', { name: 'Load remote video: Private walkthrough' })).toBeTruthy();
  });
});
