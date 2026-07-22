#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildAtlasV3PptxReceipt } from './lib/artifact-atlas-v3-pptx-receipt.mjs';

const root = process.cwd();
const pptxPath = path.resolve(
  option('pptx') ?? 'outputs/artifact-atlas-v3/nodeslide-artifact-atlas-v3.pptx',
);
const candidatePath = path.resolve(
  option('candidate') ?? 'outputs/artifact-atlas-v3/atlas-v3-evidence-candidate.json',
);
const receiptPath = path.resolve(
  option('receipt') ?? 'outputs/artifact-atlas-v3/atlas-v3-pptx-receipt.json',
);
const buildRecipePath = path.resolve(
  option('build-recipe') ?? 'outputs/artifact-atlas-v3/atlas-v3-build-recipe.json',
);
const sourceAtlasPath = path.resolve(
  option('source-atlas') ?? 'outputs/artifact-atlas-v2/nodeslide-artifact-atlas-v2.pptx',
);
const buildRecipeBytes = await readFile(buildRecipePath);
const buildRecipe = JSON.parse(buildRecipeBytes.toString('utf8'));
const evidenceBindings = (buildRecipe.assets ?? []).flatMap((asset) => [
  asset.modelEvidence?.planResult,
  asset.modelEvidence?.showcaseReceipt,
]);
if (evidenceBindings.some((binding) => !binding?.path)) {
  throw new Error('Artifact Atlas V3 model-evidence bindings are incomplete.');
}
const [
  pptxBytes,
  candidateBytes,
  sourceAtlasBytes,
  builderBytes,
  receiptCoreBytes,
  templateStarterBytes,
  releaseGateBytes,
  supportingEvidence,
] = await Promise.all([
  readFile(pptxPath),
  readFile(candidatePath),
  readFile(sourceAtlasPath),
  readFile(path.resolve(root, buildRecipe.inputs.builder.path)),
  readFile(path.resolve(root, buildRecipe.inputs.receiptCore.path)),
  readFile(path.resolve(root, buildRecipe.inputs.templateStarter.path)),
  readFile(path.resolve(root, buildRecipe.inputs.releaseGates.path)),
  Promise.all(
    evidenceBindings.map(async (binding) => ({
      path: binding.path,
      bytes: await readFile(path.resolve(root, binding.path)),
    })),
  ),
]);
const candidate = JSON.parse(candidateBytes.toString('utf8'));
const releaseGates = JSON.parse(releaseGateBytes.toString('utf8'));
const receipt = await buildAtlasV3PptxReceipt({
  pptxBytes,
  pptxPath: path.relative(root, pptxPath),
  candidateBytes,
  candidate,
  buildRecipeBytes,
  buildRecipe,
  sourceAtlasBytes,
  builderBytes,
  receiptCoreBytes,
  templateStarterBytes,
  releaseGateBytes,
  releaseGates,
  supportingEvidence,
});
await mkdir(path.dirname(receiptPath), { recursive: true });
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`[artifact-atlas-v3] final PPTX receipt: ${path.relative(root, receiptPath)}`);

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
