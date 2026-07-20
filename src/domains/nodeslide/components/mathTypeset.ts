import 'katex/dist/katex.min.css';

/**
 * Typeset a math expression with KaTeX (C1).
 *
 * The implementation lives in slidelang/mathRaster.ts so the web renderer and
 * the PPTX export path share one parse/typeset contract (C2). This module
 * keeps the KaTeX stylesheet import on the UI side — engine code must not
 * pull CSS.
 *
 * Returns the KaTeX HTML markup, or `null` when the expression does not parse
 * so callers can fall back to the styled plain-text rendering (C3 — honest
 * fallback, never a crash and never red error markup posing as math).
 */
export { typesetMathHtml } from '../slidelang/mathRaster';
