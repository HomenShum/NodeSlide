import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const repoRoot = resolve(import.meta.dirname, '..');
const outputDir = resolve(repoRoot, 'docs/demo');
const screenshotPath = resolve(outputDir, 'nodeslide-k1-diagram-proof.png');
const receiptPath = resolve(outputDir, 'nodeslide-k1-diagram-proof.receipt.json');
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
    sourcefile: 'diagram-proof-entry.ts',
    contents: `
      import { buildBriefNodeSlide, deterministicBriefSpec } from './convex/lib/nodeslideSeed.ts';
      import { renderSlideHtml } from './src/domains/nodeslide/slidelang/html.ts';
      const brief = {
        prompt: 'Explain a governed creation process as a real editable diagram.',
        audience: 'presentation-system reviewers',
        purpose: 'Prove structured visual reasoning',
        successCriteria: ['Typed nodes', 'Explicit edges', 'Editable export'],
      };
      const spec = deterministicBriefSpec('Visual arguments, not arrow text', brief);
      const built = buildBriefNodeSlide({
        deckId: 'deck_k1_diagram_proof',
        projectId: 'project_k1_diagram_proof',
        title: spec.title,
        brief,
        themeId: 'editorial-signal',
        rawSpec: spec,
        now: 1_700_000_000_000,
      });
      const slide = built.snapshot.slides.find((candidate) => candidate.archetype === 'diagram-dominant');
      if (!slide) throw new Error('Diagram-dominant slide did not materialize.');
      export const proof = {
        html: renderSlideHtml(built.snapshot, slide.id),
        slideId: slide.id,
        archetype: slide.archetype,
        nodeCount: built.snapshot.elements.filter((element) => element.slideId === slide.id && element.kind === 'shape' && element.role?.startsWith('diagram_')).length,
        edgeCount: built.snapshot.elements.filter((element) => element.slideId === slide.id && element.kind === 'connector' && element.role === 'diagram_edge').length,
      };
    `,
  },
});
const bundleText = bundled.outputFiles[0]?.text;
if (!bundleText) throw new Error('Diagram proof bundle was empty.');
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
    html, body { margin: 0; background: #dfe4df; font-family: Arial, sans-serif; }
    body { padding: 40px; }
    section[data-slide-id] { width: 1200px !important; box-sizing: border-box; }
  </style></head><body>${proof.html}</body></html>`);
  const slide = page.locator('section[data-slide-id]');
  await slide.screenshot({ path: screenshotPath });
  const receipt = {
    schemaVersion: 'nodeslide.diagram-proof/v1',
    generatedAt: new Date().toISOString(),
    status:
      proof.archetype === 'diagram-dominant' &&
      proof.nodeCount === 3 &&
      proof.edgeCount === 2 &&
      browserIssues.length === 0
        ? 'passed'
        : 'failed',
    archetype: proof.archetype,
    editableNodes: proof.nodeCount,
    editableEdges: proof.edgeCount,
    browserIssues,
    screenshot: 'nodeslide-k1-diagram-proof.png',
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.status !== 'passed') process.exitCode = 1;
} finally {
  await browser.close();
}
