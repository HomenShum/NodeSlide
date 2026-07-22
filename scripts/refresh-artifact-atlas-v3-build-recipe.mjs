#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  atlasV3ReleaseGateSlideTexts,
  deriveAtlasV3SlideContentProofs,
  validateAtlasV3ReleaseGates,
} from './lib/artifact-atlas-v3-pptx-receipt.mjs';
import { digestJson } from './lib/node-gym-runner-core.mjs';

const root = process.cwd();
const recipePath = path.resolve(root, 'outputs/artifact-atlas-v3/atlas-v3-build-recipe.json');
const pptxPath = path.resolve(root, 'outputs/artifact-atlas-v3/nodeslide-artifact-atlas-v3.pptx');
const sourceAtlasPath = path.resolve(
  root,
  'outputs/artifact-atlas-v2/nodeslide-artifact-atlas-v2.pptx',
);
const recipe = JSON.parse(await readFile(recipePath, 'utf8'));
recipe.generator.buildCommand = 'node scripts/build-artifact-atlas-v3-pptx.mjs';
recipe.inputs.candidate = await fileBinding(
  'outputs/artifact-atlas-v3/atlas-v3-evidence-candidate.json',
);
recipe.inputs.builder = await fileBinding('scripts/build-artifact-atlas-v3-pptx.mjs');
recipe.inputs.receiptCore = await fileBinding('scripts/lib/artifact-atlas-v3-pptx-receipt.mjs');
recipe.inputs.templateStarter = await fileBinding(
  'outputs/artifact-atlas-v3/atlas-v3-template-starter.pptx',
);
recipe.inputs.releaseGates = await fileBinding(
  'outputs/artifact-atlas-v3/atlas-v3-release-gates.json',
);
const releaseGates = validateAtlasV3ReleaseGates(
  JSON.parse(await readFile(path.resolve(root, recipe.inputs.releaseGates.path), 'utf8')),
);
const slide43Texts = atlasV3ReleaseGateSlideTexts(releaseGates);
const slide43Expectation = recipe.composition.slides[42];
slide43Expectation.requiredText = [
  slide43Texts[0],
  'Production journey',
  'Fleet availability',
  'Atlas + UI renders',
  ...[
    ...new Set(
      slide43Texts.filter((text) => ['PASSED', 'PENDING', 'HOLD', 'NOT AUTHORIZED'].includes(text)),
    ),
  ],
  'ATLAS_V3_PROVENANCE_V1',
];
recipe.receiptBinding.bind = [
  'candidateDigest',
  'buildRecipeDigest',
  'assetSetDigest',
  'sourceAtlasDigest',
  'releaseGateDigest',
  'generator',
  'composition',
];
recipe.truthCorrections.slide43 = Object.fromEntries(
  Object.entries(releaseGates.gates).map(([key, gate]) => [key, gate.status]),
);

const evidenceSpecs = {
  'claude-sonnet-5': {
    candidateId: 'risk-matrix__evidence-editorial__anthropic-claude-sonnet-5',
    model: 'anthropic/claude-sonnet-5',
    provider: 'openrouter',
    costMicroUsd: 5010,
  },
  'kimi-k3': {
    candidateId: 'risk-matrix__evidence-editorial__moonshotai-kimi-k3',
    model: 'moonshotai/kimi-k3',
    provider: 'openrouter',
    costMicroUsd: 1261,
  },
  'gemma-4-26b-free': {
    candidateId: 'risk-matrix__evidence-editorial__google-gemma-4-26b-a4b-it-free',
    model: 'google/gemma-4-26b-a4b-it:free',
    provider: 'openrouter',
    costMicroUsd: 0,
  },
};

for (const asset of recipe.assets) {
  const spec = evidenceSpecs[asset.id];
  if (!spec) throw new Error(`No model-evidence specification for ${asset.id}.`);
  const planResultPath = `artifacts/deck-gym/artifact-atlas-v1/plan-results/${spec.candidateId.replaceAll(':', '-')}.json`;
  const showcaseReceiptPath = `artifacts/deck-gym/artifact-atlas-v1/runs/${spec.candidateId.replaceAll(':', '-')}/receipt.json`;
  asset.modelEvidence = {
    ...spec,
    planResult: await fileBinding(planResultPath),
    showcaseReceipt: await fileBinding(showcaseReceiptPath),
  };
}

const [pptxBytes, sourceAtlasBytes] = await Promise.all([
  readFile(pptxPath),
  readFile(sourceAtlasPath),
]);
const proofs = await deriveAtlasV3SlideContentProofs({
  pptxBytes,
  sourceAtlasBytes,
  sourceSlideMap: recipe.composition.sourceSlideMap,
});
for (const proof of proofs) {
  const expectation = recipe.composition.slides[proof.slide - 1];
  if (!expectation || expectation.slide !== proof.slide) {
    throw new Error(`Build recipe slide ${proof.slide} is missing.`);
  }
  expectation.contentProof = proof.contentProof;
  if (proof.sourceBinding) expectation.sourceBinding = proof.sourceBinding;
  else expectation.sourceBinding = undefined;
}

recipe.modelEvidenceSetDigest = digestJson(
  recipe.assets.map((asset) => ({
    assetId: asset.id,
    candidateId: asset.modelEvidence.candidateId,
    model: asset.modelEvidence.model,
    provider: asset.modelEvidence.provider,
    costMicroUsd: asset.modelEvidence.costMicroUsd,
    planResultDigest: asset.modelEvidence.planResult.sha256,
    showcaseReceiptDigest: asset.modelEvidence.showcaseReceipt.sha256,
    screenshotPath: asset.path,
    screenshotDigest: asset.sha256,
  })),
);

await writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
console.log(`[artifact-atlas-v3] refreshed build recipe: ${path.relative(root, recipePath)}`);

async function fileBinding(relativePath) {
  const bytes = await readFile(path.resolve(root, relativePath));
  return {
    path: relativePath,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    bytes: bytes.byteLength,
  };
}
