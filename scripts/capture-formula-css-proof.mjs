import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import katex from 'katex';
import { chromium } from 'playwright';

const outputRoot = resolve(process.argv[2] ?? 'docs/demo');
const screenshotPath = resolve(outputRoot, 'nodeslide-b6-formula-css-proof.png');
const receiptPath = resolve(outputRoot, 'nodeslide-b6-formula-css-proof.receipt.json');
await mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 520 }, deviceScaleFactor: 1 });
const expression = String.raw`172 \div 64 \approx 2.69`;
const markup = katex.renderToString(expression, { displayMode: false, throwOnError: true });

try {
  await page.setContent(`<!doctype html>
    <html><body>
      <main>
        <h1>Narrow NodeSlide formula proof</h1>
        <p>Actual product CSS and KaTeX markup · 160 × 96 px element</p>
        <div class="ns-slide-renderer" style="width: 640px; height: 360px;">
          <div class="ns-slide-element ns-slide-element--math" style="left: 220px; top: 120px; width: 160px; height: 96px; background: #dff7e7; color: #153d26; font-size: 28px; border-radius: 10px;">
            <div class="ns-element-math ns-math-primitive ns-element-math--latex" role="math" aria-label="Goals per match: 172 divided by 64 is approximately 2.69">
              <span class="ns-math-typeset">${markup}</span>
            </div>
          </div>
        </div>
      </main>
    </body></html>`);
  await page.addStyleTag({ path: resolve('node_modules/katex/dist/katex.min.css') });
  await page.addStyleTag({ path: resolve('src/domains/nodeslide/nodeslide.css') });
  await page.addStyleTag({
    content: `
    body { background: #f3f1eb; color: #171a18; font-family: Arial, sans-serif; margin: 0; padding: 32px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    p { color: #59615c; margin: 0 0 24px; }
    .ns-slide-renderer { background: #fff; border: 1px solid #c8cec9; box-shadow: 0 18px 50px rgba(24, 36, 29, .12); }
  `,
  });

  const formula = page.locator('.ns-slide-element--math');
  await formula.waitFor({ state: 'visible' });
  const metrics = await formula.evaluate((element) => {
    const katexNode = element.querySelector('.katex');
    const typeset = element.querySelector('.ns-math-typeset');
    if (!(katexNode instanceof HTMLElement) || !(typeset instanceof HTMLElement)) {
      throw new Error('KaTeX markup was not rendered');
    }
    const box = element.getBoundingClientRect();
    const formulaBox = katexNode.getBoundingClientRect();
    const nested = [...katexNode.querySelectorAll('span')];
    const nestedStyles = nested.map((node) => getComputedStyle(node));
    return {
      container: { width: box.width, height: box.height },
      formula: { width: formulaBox.width, height: formulaBox.height },
      aspectRatio: formulaBox.width / formulaBox.height,
      fitsHorizontally: formulaBox.width <= box.width + 1,
      fitsVertically: formulaBox.height <= box.height + 1,
      wrapperWhiteSpace: getComputedStyle(typeset).whiteSpace,
      nestedAnywhereWrapCount: nestedStyles.filter((style) => style.overflowWrap === 'anywhere')
        .length,
      katexFontFamily: getComputedStyle(katexNode).fontFamily,
      accessibleName: element.querySelector('[role="math"]')?.getAttribute('aria-label') ?? null,
      nestedSpanCount: nested.length,
    };
  });
  const failures = [
    !metrics.fitsHorizontally && 'formula overflows its 160px element horizontally',
    !metrics.fitsVertically && 'formula overflows its 96px element vertically',
    metrics.aspectRatio < 2 && 'formula remains vertically stacked',
    metrics.wrapperWhiteSpace !== 'nowrap' && 'typeset wrapper permits line wrapping',
    metrics.nestedAnywhereWrapCount > 0 && 'nested KaTeX spans still use overflow-wrap:anywhere',
    !metrics.katexFontFamily.toLowerCase().includes('katex') && 'KaTeX font was overridden',
    !metrics.accessibleName && 'formula has no accessible name',
  ].filter(Boolean);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const receipt = {
    schemaVersion: 'nodeslide.formula-css-proof/v1',
    capturedAt: new Date().toISOString(),
    expression: '172 ÷ 64 ≈ 2.69',
    browser: 'chromium',
    css: ['node_modules/katex/dist/katex.min.css', 'src/domains/nodeslide/nodeslide.css'],
    metrics,
    screenshot: 'docs/demo/nodeslide-b6-formula-css-proof.png',
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  if (failures.length > 0) throw new Error(`Formula CSS proof failed: ${failures.join('; ')}`);
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await browser.close();
}
