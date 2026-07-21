import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const repoRoot = resolve(import.meta.dirname, '..');
const outputDir = resolve(repoRoot, 'docs/demo/nodeslide-visual-authoring-v2');
const slidesDir = resolve(outputDir, 'html-slides');
const pptxPath = resolve(outputDir, 'nodeslide-visual-authoring-v2.pptx');
const htmlMontagePath = resolve(outputDir, 'deck-montage.png');
const candidateMontagePath = resolve(outputDir, 'composition-candidates.png');
const receiptPath = resolve(outputDir, 'receipt.json');
await mkdir(slidesDir, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), 'nodeslide-visual-v2-'));

try {
  const entryPath = join(scratch, 'visual-proof-entry.mjs');
  await build({
    absWorkingDir: repoRoot,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: entryPath,
    stdin: {
      resolveDir: repoRoot,
      sourcefile: 'visual-proof-entry.ts',
      loader: 'ts',
      contents: `
        import { buildBriefNodeSlide, deterministicBriefSpec } from './convex/lib/nodeslideSeed.ts';
        import { fanOutNodeSlideComposition } from './convex/lib/nodeslideCompositionFanout.ts';
        import { renderSlideHtml } from './src/domains/nodeslide/slidelang/html.ts';
        import { buildPptx } from './src/domains/nodeslide/slidelang/pptx.ts';
        const brief = {
          prompt: 'Create a seven-slide launch decision with an editable revenue chart, an architecture diagram, and a formula grounded in supplied evidence.',
          audience: 'product and engineering leaders',
          purpose: 'Choose whether to expand the launch',
          successCriteria: ['Show the growth evidence', 'Make dependencies visible', 'Name the decision'],
        };
        const attachments = [{
          title: 'launch-revenue.csv',
          format: 'csv' as const,
          content: 'quarter,revenue\\nQ1,120\\nQ2,180\\nQ3,260\\nQ4,400',
        }];
        const spec = deterministicBriefSpec('The launch has earned a measured expansion', brief, attachments);
        spec.slides[2]!.formula = {
          expression: '(400 - 120) / 120',
          display: '(400 - 120) / 120 = 2.33x',
          variables: [
            { label: 'Q4 revenue', value: 400, unit: '$K' },
            { label: 'Q1 revenue', value: 120, unit: '$K' },
          ],
          description: 'Revenue growth from Q1 to Q4 in the supplied launch dataset.',
        };
        spec.slides[3]!.chart = {
          labels: ['Q1', 'Q2', 'Q3', 'Q4'],
          values: [120, 180, 260, 400],
          unit: '$K',
        };
        delete spec.slides[5]!.image;
        spec.slides[5]!.metric = '3 gates';
        spec.slides[5]!.metricLabel = 'evidence, ownership, and rollback readiness';
        const built = buildBriefNodeSlide({
          deckId: 'deck_visual_authoring_v2',
          projectId: 'project_visual_authoring_v2',
          title: spec.title,
          brief,
          themeId: 'editorial-signal',
          rawSpec: spec,
          attachments,
          now: 1_700_000_000_000,
        });
        const diagramPlan = built.spec.designPlans!.find((plan) => plan.dominantVisualCenter === 'diagram')!;
        const diagramSlide = built.snapshot.slides[diagramPlan.slideIndex]!;
        const diagramElements = built.snapshot.elements.filter((element) => element.slideId === diagramSlide.id);
        const fanout = fanOutNodeSlideComposition({ elements: diagramElements, plan: diagramPlan });
        const candidates = fanout.renderCandidates.map((candidate) => {
          const snapshot = structuredClone(built.snapshot);
          snapshot.elements = [
            ...snapshot.elements.filter((element) => element.slideId !== diagramSlide.id),
            ...candidate.elements,
          ];
          return {
            id: candidate.id,
            variant: candidate.variant,
            html: renderSlideHtml(snapshot, diagramSlide.id),
          };
        });
        export const proof = {
          snapshot: built.snapshot,
          spec: built.spec,
          slides: built.snapshot.slides.map((slide) => ({ id: slide.id, title: slide.title, html: renderSlideHtml(built.snapshot, slide.id) })),
          candidates,
          selectedCandidateId: fanout.selectedCandidateId,
          pptx: new Uint8Array(await buildPptx(built.snapshot)),
        };
      `,
    },
  });
  const { proof } = await import(pathToFileURL(entryPath).href);
  await writeFile(pptxPath, proof.pptx);

  const browserIssues = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
    page.on('console', (message) => {
      if (message.type() === 'error') browserIssues.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => browserIssues.push(`pageerror: ${error.message}`));
    for (const [index, slide] of proof.slides.entries()) {
      await page.setContent(
        `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#dfe4df}section[data-slide-id]{width:1280px!important}</style>${slide.html}`,
      );
      await page.locator('section[data-slide-id]').screenshot({
        path: resolve(slidesDir, `slide-${String(index + 1).padStart(2, '0')}.png`),
      });
    }
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#d9ded9;font-family:Arial}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:24px}.item{min-width:0}.label{font:600 18px/1.2 Arial;margin:0 0 8px}.item section[data-slide-id]{width:100%!important}</style><main>${proof.candidates.map((candidate) => `<div class="item"><p class="label">${candidate.variant}${candidate.id === proof.selectedCandidateId ? ' · selected' : ''}</p>${candidate.html}</div>`).join('')}</main>`,
    );
    await page.locator('main').screenshot({ path: candidateMontagePath });
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#d9ded9}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:24px}.item{min-width:0}.item section[data-slide-id]{width:100%!important}</style><main>${proof.slides.map((slide) => `<div class="item">${slide.html}</div>`).join('')}</main>`,
    );
    await page.locator('main').screenshot({ path: htmlMontagePath });
  } finally {
    await browser.close();
  }

  const zip = await JSZip.loadAsync(proof.pptx);
  const slideXmlPaths = Object.keys(zip.files).filter((path) =>
    /^ppt\/slides\/slide\d+\.xml$/u.test(path),
  );
  const slideXml = await Promise.all(slideXmlPaths.map((path) => zip.file(path)?.async('string')));
  const nativeChartCount = slideXml.reduce(
    (count, xml) => count + (xml?.match(/<c:chart\b/gu)?.length ?? 0),
    0,
  );
  const editableShapeCount = slideXml.reduce(
    (count, xml) => count + (xml?.match(/<p:(?:sp|cxnSp)\b/gu)?.length ?? 0),
    0,
  );
  const unresolvedImagePlaceholders = proof.snapshot.elements.filter(
    (element) => element.kind === 'image' && element.image?.placeholder === true,
  ).length;
  const selectedFanout =
    proof.spec.compositionFanout?.filter((candidate) => candidate.selected) ?? [];
  const designPlans = proof.spec.designPlans ?? [];

  const receipt = {
    schemaVersion: 'nodeslide.visual-authoring-v2-proof/v1',
    generatedAt: new Date().toISOString(),
    status: 'pending-pptx-render',
    checks: {
      sevenSlides: proof.slides.length === 7,
      everySlideHasFourReferences: designPlans.every((plan) => plan.referenceIds.length === 4),
      threeCandidatesPerImportantSlide:
        (proof.spec.compositionFanout?.length ?? 0) === selectedFanout.length * 3,
      cleanCandidateSelected: selectedFanout.every(
        (candidate) => candidate.outOfBoundsCount === 0 && candidate.overlapCount === 0,
      ),
      browserIssuesZero: browserIssues.length === 0,
      unresolvedImagePlaceholdersZero: unresolvedImagePlaceholders === 0,
      nativeChartPresent: nativeChartCount >= 1,
      editableShapesPresent: editableShapeCount >= 20,
    },
    browserIssues,
    slideCount: proof.slides.length,
    designPlanCount: designPlans.length,
    compositionCandidateCount: proof.spec.compositionFanout?.length ?? 0,
    selectedCandidateCount: selectedFanout.length,
    pptx: {
      file: 'nodeslide-visual-authoring-v2.pptx',
      nativeChartCount,
      editableShapeCount,
      rendered: false,
    },
    artifacts: {
      htmlMontage: 'deck-montage.png',
      compositionCandidates: 'composition-candidates.png',
      htmlSlides: 'html-slides/',
    },
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  execFileSync(process.execPath, [
    resolve(repoRoot, 'node_modules/@biomejs/biome/bin/biome'),
    'format',
    '--write',
    receiptPath,
  ]);
  console.log(JSON.stringify(receipt, null, 2));
  if (!Object.values(receipt.checks).every(Boolean)) process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
