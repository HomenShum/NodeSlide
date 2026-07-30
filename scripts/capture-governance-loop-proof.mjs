import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repoRoot = resolve(import.meta.dirname, '..');
const outputDir = resolve(repoRoot, 'evidence/visual-logic-campaign/after');
const screenshotPath = resolve(outputDir, 'governance-loop-full-size.png');
const receiptPath = resolve(outputDir, 'governance-loop-full-size.receipt.json');
await mkdir(outputDir, { recursive: true });

const bundled = await build({
  absWorkingDir: repoRoot,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  write: false,
  stdin: {
    resolveDir: repoRoot,
    sourcefile: 'governance-loop-proof-entry.ts',
    contents: `
      import { buildBriefNodeSlide } from './convex/lib/nodeslideSeed.ts';
      import { validateNodeSlideSnapshot } from './convex/lib/nodeslideValidation.ts';
      import { renderSlideHtml } from './src/domains/nodeslide/slidelang/html.ts';
      const brief = {
        prompt: 'Prepare a NIST AI RMF release decision for a bank risk committee.',
        audience: 'Chief risk officer, legal, security, and model risk',
        purpose: 'Move one AI system to a governed release decision',
        successCriteria: ['Keep GOVERN cross-cutting', 'Show the release gate'],
      };
      const rawSpec = {
        title: 'AI release decision',
        slides: Array.from({ length: 6 }, (_, index) => ({
          title: 'Decision ' + (index + 1),
          section: index === 2 ? 'Build' : 'Orient',
          headline: index === 2
            ? 'MAP, MEASURE, and MANAGE cycle continuously; GOVERN surrounds them all.'
            : 'Decision frame ' + (index + 1),
          body: 'Use verified evidence to move from uncertainty to a controlled release.',
          bullets: ['Name the owner', 'Inspect the evidence', 'Hold the gate when proof is missing'],
          ...(index === 2 ? {
            diagram: {
              kind: 'process',
              direction: 'horizontal',
              nodes: [
                { id: 'govern', label: 'GOVERN (cross-cutting)' },
                { id: 'map', label: 'MAP' },
                { id: 'measure', label: 'MEASURE' },
                { id: 'manage', label: 'MANAGE' },
                { id: 'gate', label: 'Release Gate', kind: 'decision' },
              ],
              edges: [
                { from: 'govern', to: 'map', label: 'oversight' },
                { from: 'govern', to: 'measure', label: 'oversight' },
                { from: 'govern', to: 'manage', label: 'oversight' },
                { from: 'map', to: 'measure' },
                { from: 'measure', to: 'manage' },
                { from: 'manage', to: 'map', label: 'feedback' },
                { from: 'manage', to: 'gate', label: 'evidence' },
              ],
            },
          } : {}),
        })),
      };
      const built = buildBriefNodeSlide({
        deckId: 'deck_governance_loop_proof',
        projectId: 'project_governance_loop_proof',
        title: rawSpec.title,
        brief,
        themeId: 'editorial-signal',
        rawSpec,
        now: 1_700_000_000_000,
      });
      const slide = built.snapshot.slides[2];
      if (!slide) throw new Error('Governance slide did not materialize.');
      const elements = built.snapshot.elements.filter((element) => element.slideId === slide.id);
      const position = (label) => elements.find((element) => element.content === label)?.bbox;
      export const proof = {
        html: renderSlideHtml(built.snapshot, slide.id),
        publishOk: validateNodeSlideSnapshot(built.snapshot, 1_700_000_000_000).publishOk,
        positions: {
          govern: position('GOVERN (cross-cutting)'),
          map: position('MAP'),
          measure: position('MEASURE'),
          manage: position('MANAGE'),
          gate: position('Release Gate'),
        },
        feedbackCount: elements.filter((element) => element.role === 'diagram_feedback').length,
        connectorCount: elements.filter((element) => element.role === 'diagram_edge').length,
        mirroredSelected: built.spec.compositionFanout?.some(
          (candidate) => candidate.slideIndex === 2 && candidate.selected && candidate.variant === 'mirrored',
        ) ?? false,
      };
    `,
  },
});
const bundleText = bundled.outputFiles[0]?.text;
if (!bundleText) throw new Error('Governance proof bundle was empty.');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundleText).toString('base64')}`;
const { proof } = await import(moduleUrl);

const browserIssues = [];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  page.on('console', (message) => {
    if (message.type() === 'error') browserIssues.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserIssues.push(`pageerror: ${error.message}`));
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: #111419; font-family: Arial, sans-serif; }
    body { padding: 40px; }
    section[data-slide-id] { width: 1200px !important; box-sizing: border-box; }
  </style></head><body>${proof.html}</body></html>`);
  const slide = page.locator('section[data-slide-id]');
  await slide.screenshot({ path: screenshotPath });
  const headlineFontPx = await page
    .locator('g[aria-label="Headline"] foreignObject div')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  const order = [
    proof.positions.map?.x,
    proof.positions.measure?.x,
    proof.positions.manage?.x,
    proof.positions.gate?.x,
  ];
  const semanticOrder = order.every(
    (value, index) => typeof value === 'number' && (index === 0 || value > order[index - 1]),
  );
  const { html: _html, ...receipt } = {
    schemaVersion: 'nodeslide.governance-loop-proof/v1',
    generatedAt: new Date().toISOString(),
    status:
      proof.publishOk &&
      proof.positions.govern?.width > 0.4 &&
      semanticOrder &&
      proof.feedbackCount === 1 &&
      proof.connectorCount === 3 &&
      !proof.mirroredSelected &&
      headlineFontPx >= 50 &&
      browserIssues.length === 0
        ? 'passed'
        : 'failed',
    ...proof,
    semanticOrder,
    headlineFontPx,
    browserIssues,
    screenshot: 'governance-loop-full-size.png',
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.status !== 'passed') process.exitCode = 1;
} finally {
  await browser.close();
}
