// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import { SlideRenderer } from './SlideRenderer';

const theme: ThemeSpec = {
  id: 'theme-board-review',
  name: 'Board review',
  mode: 'light',
  colors: {
    canvas: '#ffffff',
    ink: '#111111',
    muted: '#666666',
    accent: '#b44a2d',
    accentSoft: '#f2ded3',
    insight: '#e5e9d6',
    insightInk: '#34452c',
    trace: '#7566a8',
    border: '#ded7cc',
  },
  typography: { display: 'Georgia', body: 'Arial', data: 'monospace' },
  defaultRadius: 18,
  spacingUnit: 8,
};

const headline: SlideElement = {
  id: 'headline',
  slideId: 'slide',
  name: 'Decision headline',
  kind: 'text',
  role: 'headline',
  bbox: { x: 0.07, y: 0.15, width: 0.76, height: 0.22 },
  rotation: 0,
  content: 'The release gate stays closed until evidence is verified',
  style: { fontSize: 38, fontFamily: 'Georgia', fontWeight: 620 },
  sourceIds: [],
  locked: false,
  exportCapabilities: ['web_native', 'pptx_editable'],
  version: 1,
};

const slide: Slide = {
  id: 'slide',
  deckId: 'deck',
  title: 'Decision',
  background: '#ffffff',
  elementOrder: [headline.id],
  version: 1,
};

afterEach(cleanup);

describe('SlideRenderer presentation typography', () => {
  it('renders canonical point sizes at CSS point parity for a full-size committee review', () => {
    render(<SlideRenderer elements={[headline]} slide={slide} theme={theme} />);

    expect(screen.getByTestId(`slide-element-${headline.id}`).style.fontSize).toBe(
      `${38 / 9.6}cqw`,
    );
  });
});
