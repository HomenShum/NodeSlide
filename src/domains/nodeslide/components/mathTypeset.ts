import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Typeset a math expression with KaTeX (C1).
 *
 * Returns the KaTeX HTML markup, or `null` when the expression does not parse
 * so callers can fall back to the styled plain-text rendering (C3 — honest
 * fallback, never a crash and never red error markup posing as math).
 *
 * `throwOnError: true` is deliberate: with `false`, KaTeX swallows parse
 * errors and renders the raw source in error styling, which would make the
 * fallback unreachable and dishonest. The try/catch is the fallback boundary.
 */
export function typesetMathHtml(expression: string): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  try {
    return katex.renderToString(trimmed, { output: 'html', throwOnError: true });
  } catch {
    return null;
  }
}
