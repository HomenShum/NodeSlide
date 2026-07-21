// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import { SlideRenderer } from './SlideRenderer';
import { typesetMathHtml } from './mathTypeset';

/*
 * C1+C3 — real math typesetting in the browser canvas.
 *
 * A latex math element must render actual KaTeX markup (class "katex"), and an
 * expression KaTeX cannot parse must fall back to the pre-existing styled-text
 * rendering (<code> with the display string) without throwing. The fallback is
 * the honest path: no red KaTeX error markup posing as typeset math.
 */

const theme: ThemeSpec = {
  id: 'theme-test',
  name: 'Test',
  mode: 'light',
  colors: {
    canvas: '#ffffff',
    ink: '#1a1a1a',
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

function mathElement(id: string, expression: string, syntax: 'plain' | 'latex'): SlideElement {
  return {
    id,
    slideId: 'slide-1',
    name: `Math ${id}`,
    kind: 'math',
    bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 },
    rotation: 0,
    style: {},
    math: { expression, syntax },
    sourceIds: [],
    locked: false,
    exportCapabilities: ['web_native'],
    version: 1,
  };
}

function slideWith(elements: SlideElement[]): Slide {
  return {
    id: 'slide-1',
    deckId: 'deck-1',
    title: 'Math slide',
    background: '#ffffff',
    elementOrder: elements.map((element) => element.id),
    version: 1,
  };
}

afterEach(cleanup);

describe('SlideRenderer math typesetting (C1+C3)', () => {
  it('keeps fallback wrapping rules away from nested KaTeX spans', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/domains/nodeslide/nodeslide.css'), 'utf8');
    expect(css).toContain('.ns-element-math > code');
    expect(css).toContain('.ns-element-math > .ns-math-typeset .katex');
    expect(css).not.toMatch(/\.ns-element-math\s+span\s*\{/);
  });

  it('renders KaTeX markup for a valid latex expression', () => {
    const element = mathElement('el-valid', 'E = mc^2', 'latex');
    const { container } = render(
      <SlideRenderer elements={[element]} slide={slideWith([element])} theme={theme} />,
    );
    const katexNode = container.querySelector('.katex');
    expect(katexNode).not.toBeNull();
    expect(container.querySelector('.ns-math-typeset')).not.toBeNull();
    // The styled-text fallback must NOT render alongside the typeset output.
    expect(container.querySelector('.ns-element-math > code')).toBeNull();
  });

  it('falls back to styled plain text for an invalid expression without throwing', () => {
    const element = mathElement('el-invalid', '\\frac{1}{', 'latex');
    expect(() =>
      render(<SlideRenderer elements={[element]} slide={slideWith([element])} theme={theme} />),
    ).not.toThrow();
    // No KaTeX markup — neither typeset output nor red error spans.
    expect(document.querySelector('.katex')).toBeNull();
    expect(document.querySelector('.katex-error')).toBeNull();
    // The original styled-text rendering carries the raw expression.
    const fallback = document.querySelector('.ns-element-math > code');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toBe('\\frac{1}{');
    // The raw-source badge stays for the latex fallback path.
    expect(screen.getByText('LaTeX source')).toBeTruthy();
  });

  it('typesets plain-syntax expressions that parse as TeX', () => {
    const element = mathElement('el-plain', 'a^2 + b^2 = c^2', 'plain');
    const { container } = render(
      <SlideRenderer elements={[element]} slide={slideWith([element])} theme={theme} />,
    );
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('typesetMathHtml returns null for unparseable or empty input', () => {
    expect(typesetMathHtml('')).toBeNull();
    expect(typesetMathHtml('   ')).toBeNull();
    expect(typesetMathHtml('\\undefinedmacro{')).toBeNull();
    expect(typesetMathHtml('x_1 + x_2')).toContain('katex');
  });
});
