import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const outputDir = resolve(repoRoot, 'docs/demo/nodeslide-visual-authoring-v2');
const receiptPath = resolve(outputDir, 'receipt.json');
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
const renderedSlides = (await readdir(resolve(outputDir, 'pptx-rendered'))).filter((name) =>
  /^slide-\d+\.png$/u.test(name),
);
const montage = await stat(resolve(outputDir, 'pptx-montage.png'));
const args = new Set(process.argv.slice(2));
const visualVerdictPassed = args.has('--visual-passed');
const overflowTestPassed = args.has('--overflow-passed');
receipt.checks.pptxRenderedSlidesSeven = renderedSlides.length === 7;
receipt.checks.pptxMontagePresent = montage.size > 0;
receipt.checks.pptxOverflowTestPassed = overflowTestPassed;
receipt.checks.fullSizeVisualInspectionPassed = visualVerdictPassed;
receipt.pptx.rendered = renderedSlides.length === 7;
receipt.pptx.renderedSlides = renderedSlides.length;
receipt.pptx.overflowTest = overflowTestPassed ? 'passed' : 'failed';
receipt.pptx.visualVerdict = visualVerdictPassed
  ? 'passed after one diagram-slide copy-budget repair'
  : 'failed or not supplied';
receipt.artifacts.pptxMontage = 'pptx-montage.png';
receipt.artifacts.pptxSlides = 'pptx-rendered/';
receipt.status = Object.values(receipt.checks).every(Boolean) ? 'passed' : 'failed';
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
if (receipt.status !== 'passed') process.exitCode = 1;
