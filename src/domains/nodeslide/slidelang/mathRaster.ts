import katex from 'katex';

/**
 * C2 — PPTX math as a rendered equation, capability-truthful.
 *
 * PowerPoint has no first-class KaTeX surface, so the only honest way to ship
 * a *rendered* equation is a raster image, clearly labeled as a static
 * fallback. Rasterization needs a real browser (canvas 2d + Image + SVG
 * foreignObject); jsdom cannot do it. This module therefore exposes an
 * injectable rasterizer seam:
 *
 * - `registerMathRasterizer(fn)` — hosts/tests inject a rasterizer.
 * - `registerMathRasterizer(null)` — force the text fallback.
 * - unset (default) — auto-detect: the built-in browser rasterizer is used
 *   only when a sync environment probe passes (never in jsdom).
 *
 * `getMathPptxPlan(element)` is the single decision predicate shared by the
 * capability report (capabilities.ts) and the PPTX compiler (pptx.ts), so
 * what the report claims and what the adapter does agree in both branches.
 * The one residual divergence: if the plan says `raster` but the rasterizer
 * fails at export time (returns null/throws), the compiler falls back to
 * text; the default rasterizer minimizes this window by validating its own
 * output (non-blank canvas, PNG data URL) before returning it.
 */

export interface MathRasterInput {
  /** Raw expression, exactly what KaTeX parsed. */
  expression: string;
  /** KaTeX HTML markup produced from `expression` (throwOnError succeeded). */
  katexHtml: string;
  /** Target box in CSS pixels at 96dpi (matches the element's slide box). */
  widthPx: number;
  heightPx: number;
  /** Ink color for the equation (CSS color). */
  color: string;
  fontSizePx: number;
}

/** Returns a PNG data URL, or null when rasterization honestly failed. */
export type MathRasterizer = (input: MathRasterInput) => Promise<string | null>;

export type MathPptxPlan =
  | { kind: 'raster'; expression: string; katexHtml: string }
  | { kind: 'text' };

/**
 * Typeset an expression with KaTeX, or null when it does not parse.
 * `throwOnError: true` is deliberate (see components/mathTypeset.ts): with
 * `false`, KaTeX renders red error markup and the honest fallback becomes
 * unreachable.
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

// --- injectable rasterizer registry -----------------------------------------

/** undefined = auto-detect; null = explicitly disabled; fn = injected. */
let registeredRasterizer: MathRasterizer | null | undefined;

/** Inject a rasterizer (tests, hosts), disable with null, reset with undefined. */
export function registerMathRasterizer(rasterizer: MathRasterizer | null | undefined): void {
  registeredRasterizer = rasterizer;
}

let cachedEnvironmentProbe: boolean | undefined;

/**
 * Sync probe for the built-in browser rasterizer. jsdom returns null from
 * canvas.getContext('2d'), so tests exercise the text fallback honestly.
 */
export function canRasterizeMathInBrowser(): boolean {
  if (cachedEnvironmentProbe !== undefined) return cachedEnvironmentProbe;
  try {
    cachedEnvironmentProbe =
      typeof document !== 'undefined' &&
      typeof Image !== 'undefined' &&
      typeof XMLSerializer !== 'undefined' &&
      document.createElement('canvas').getContext('2d') !== null;
  } catch {
    cachedEnvironmentProbe = false;
  }
  return cachedEnvironmentProbe;
}

export function resolveMathRasterizer(): MathRasterizer | null {
  if (registeredRasterizer !== undefined) return registeredRasterizer;
  return canRasterizeMathInBrowser() ? rasterizeMathInBrowser : null;
}

export function hasMathRasterizer(): boolean {
  return resolveMathRasterizer() !== null;
}

// --- shared decision predicate -----------------------------------------------

interface MathPlanElement {
  kind: string;
  content?: string;
  math?: { expression: string; syntax?: 'plain' | 'latex' };
}

/**
 * The single raster-vs-text decision used by BOTH the capability report and
 * the PPTX compiler. Raster is only planned for latex-syntax expressions:
 * plain math is already faithful, editable native text in PowerPoint, and
 * silently rasterizing it would trade editability for nothing (the corpus
 * test "without rasterizing them" guards exactly that).
 */
export function getMathPptxPlan(element: MathPlanElement): MathPptxPlan {
  if (element.kind !== 'math') return { kind: 'text' };
  if (element.math?.syntax !== 'latex') return { kind: 'text' };
  if (!hasMathRasterizer()) return { kind: 'text' };
  const expression = element.math.expression.trim();
  if (!expression) return { kind: 'text' };
  const katexHtml = typesetMathHtml(expression);
  if (!katexHtml) return { kind: 'text' };
  return { kind: 'raster', expression, katexHtml };
}

// --- default browser rasterizer ----------------------------------------------

function collectKatexCss(): string {
  let css = '';
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet; skip rather than throw
      }
      for (const rule of Array.from(rules)) {
        // KaTeX class rules only; font-face url() loads are blocked inside
        // an <img>-loaded SVG anyway, so glyphs use fallback fonts (recorded
        // limitation — layout still comes from real KaTeX CSS).
        if (rule.cssText.includes('katex') && !rule.cssText.includes('@font-face')) {
          css += `${rule.cssText}\n`;
        }
      }
    }
  } catch {
    return '';
  }
  return css;
}

function serializeKatexSvg(input: MathRasterInput): string {
  const host = document.createElement('div');
  host.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  host.setAttribute(
    'style',
    [
      `width:${input.widthPx}px`,
      `height:${input.heightPx}px`,
      'display:flex',
      'align-items:center',
      'justify-content:center',
      `color:${input.color}`,
      `font-size:${input.fontSizePx}px`,
      'background:transparent',
    ].join(';'),
  );
  host.innerHTML = input.katexHtml;
  const style = document.createElement('style');
  style.textContent = collectKatexCss();
  host.prepend(style);
  // XMLSerializer yields well-formed XHTML for the foreignObject payload;
  // raw KaTeX innerHTML is not guaranteed to be valid XML.
  const xhtml = new XMLSerializer().serializeToString(host);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${input.widthPx}" height="${input.heightPx}">` +
    `<foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`
  );
}

/**
 * Built-in browser rasterizer: KaTeX HTML → SVG foreignObject → Image →
 * canvas → PNG data URL. Every failure mode (taint, decode error, blank
 * output) returns null so the compiler falls back to text instead of
 * embedding a broken image.
 */
export async function rasterizeMathInBrowser(input: MathRasterInput): Promise<string | null> {
  try {
    if (input.widthPx < 1 || input.heightPx < 1) return null;
    const svg = serializeKatexSvg(input);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG decode failed.'));
      image.src = url;
    });
    const scale = 2; // export crispness on projector zoom
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(input.widthPx * scale));
    canvas.height = Math.max(1, Math.round(input.heightPx * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, input.widthPx, input.heightPx);
    // Honest output validation: a fully transparent canvas means the
    // foreignObject silently rendered nothing — that is a failure, not math.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hasInk = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) {
        hasInk = true;
        break;
      }
    }
    if (!hasInk) return null;
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.startsWith('data:image/png') ? dataUrl : null;
  } catch {
    return null;
  }
}
