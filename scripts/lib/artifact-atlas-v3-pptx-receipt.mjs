import { createHash } from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import { digestJson } from './node-gym-runner-core.mjs';

const APPROVED_GENERATOR = Object.freeze({
  package: '@oai/artifact-tool',
  version: '2.8.24',
  exporterDependency: '@oai/walnut@0.1.225',
  exporterApplication: 'Walnut Exporter',
  workflow: 'artifact-tool-import-edit-export',
  buildCommand: 'node scripts/build-artifact-atlas-v3-pptx.mjs',
});

const RELEASE_GATE_ROWS = Object.freeze([
  ['repositoryGates', 'Repository gates'],
  ['typedSpecCompiler', 'Typed spec + compiler'],
  ['portabilityPackage', 'Portability + package'],
  ['productionJourney', 'Production journey'],
  ['fleetAvailability', 'Fleet availability'],
  ['atlasUiRenders', 'Atlas + UI renders'],
  ['blindPreference', 'Blind preference'],
  ['routingPromotion', 'Routing promotion'],
  ['fineTuningRun', 'Fine-tuning run'],
]);

export function validateAtlasV3ReleaseGates(value) {
  if (value?.schemaVersion !== 'nodeslide.artifact-atlas-v3-release-gates/v1')
    throw new Error('Artifact Atlas V3 release-gate input schema is invalid.');
  if (value.atlasVersion !== 'artifact-atlas-v3')
    throw new Error('Artifact Atlas V3 release-gate input targets the wrong Atlas version.');
  const mutable = new Set([
    'repositoryGates',
    'typedSpecCompiler',
    'portabilityPackage',
    'productionJourney',
    'fleetAvailability',
    'atlasUiRenders',
  ]);
  for (const [key] of RELEASE_GATE_ROWS) {
    const gate = value.gates?.[key];
    if (!gate || typeof gate.basis !== 'string' || !gate.basis.trim())
      throw new Error(`Artifact Atlas V3 release gate ${key} is incomplete.`);
    if (mutable.has(key) && !['passed', 'pending'].includes(gate.status))
      throw new Error(`Artifact Atlas V3 release gate ${key} has an invalid status.`);
  }
  if (value.gates.blindPreference.status !== 'pending')
    throw new Error('Artifact Atlas V3 blind preference must remain pending without human review.');
  if (value.gates.routingPromotion.status !== 'hold')
    throw new Error('Artifact Atlas V3 routing promotion must remain on hold.');
  if (value.gates.fineTuningRun.status !== 'not_authorized')
    throw new Error('Artifact Atlas V3 fine-tuning must remain not authorized.');
  if (value.publicReleaseApproved !== false || value.promotionEligible !== false)
    throw new Error(
      'Artifact Atlas V3 release-gate input cannot auto-approve release or promotion.',
    );
  return value;
}

export function atlasV3ReleaseGateSlideTexts(value) {
  const releaseGates = validateAtlasV3ReleaseGates(value);
  const exactMainRecorded = ['productionJourney', 'fleetAvailability'].every(
    (key) => releaseGates.gates[key].status === 'passed',
  );
  const texts = [
    'EVIDENCE TECHNICAL PROOF / RELEASE RECEIPT',
    exactMainRecorded
      ? 'Technical gates are explicit; exact-main deployment evidence is recorded'
      : 'Technical gates are explicit; deployment proof still waits for exact main',
    'Automated proof can ship the product without silently promoting a model, harness, routing rule, or training dataset.',
    'SOURCE / candidate, build recipe, asset digests, and release gates',
    'ATLAS V3 43',
  ];
  for (const [key, label] of RELEASE_GATE_ROWS) {
    const rendered = renderReleaseGateStatus(releaseGates.gates[key].status);
    texts.push(rendered.badge, label, rendered.label);
  }
  return texts;
}

function renderReleaseGateStatus(status) {
  if (status === 'passed') return { badge: '✓', label: 'PASSED' };
  if (status === 'pending') return { badge: '-', label: 'PENDING' };
  if (status === 'hold') return { badge: '-', label: 'HOLD' };
  if (status === 'not_authorized') return { badge: '-', label: 'NOT AUTHORIZED' };
  throw new Error(`Unsupported Artifact Atlas V3 release-gate status: ${status}.`);
}

export async function buildAtlasV3PptxReceipt({
  pptxBytes,
  pptxPath,
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
}) {
  const normalizedPath = String(pptxPath).replaceAll('\\', '/');
  if (path.posix.basename(normalizedPath) !== 'nodeslide-artifact-atlas-v3.pptx') {
    throw new Error('Artifact Atlas V3 receipt requires the final, non-RC PPTX filename.');
  }
  assertBytes(pptxBytes, 'Artifact Atlas V3 PPTX');
  assertBytes(candidateBytes, 'Artifact Atlas V3 evidence candidate');
  assertBytes(buildRecipeBytes, 'Artifact Atlas V3 build recipe');
  assertBytes(sourceAtlasBytes, 'Artifact Atlas V3 source atlas');
  assertBytes(builderBytes, 'Artifact Atlas V3 PPTX builder');
  assertBytes(receiptCoreBytes, 'Artifact Atlas V3 receipt core');
  assertBytes(templateStarterBytes, 'Artifact Atlas V3 template starter');
  assertBytes(releaseGateBytes, 'Artifact Atlas V3 release-gate input');
  validateAtlasV3ReleaseGates(releaseGates);
  if (candidate?.schemaVersion !== 'nodeslide.artifact-atlas-v3-evidence-candidate/v1') {
    throw new Error('Artifact Atlas V3 evidence candidate schema is invalid.');
  }
  if (buildRecipe?.schemaVersion !== 'nodeslide.artifact-atlas-v3-build-recipe/v1') {
    throw new Error('Artifact Atlas V3 build recipe schema is invalid.');
  }
  for (const [field, expected] of Object.entries(APPROVED_GENERATOR)) {
    if (buildRecipe.generator?.[field] !== expected) {
      throw new Error(`Artifact Atlas V3 generator ${field} is not approved.`);
    }
  }

  const candidateDigest = sha256(candidateBytes);
  const buildRecipeDigest = sha256(buildRecipeBytes);
  assertInputBinding(candidateBytes, buildRecipe.inputs?.candidate, 'candidate');
  assertInputBinding(sourceAtlasBytes, buildRecipe.inputs?.sourceAtlas, 'source atlas');
  assertInputBinding(builderBytes, buildRecipe.inputs?.builder, 'PPTX builder');
  assertInputBinding(receiptCoreBytes, buildRecipe.inputs?.receiptCore, 'receipt core');
  assertInputBinding(templateStarterBytes, buildRecipe.inputs?.templateStarter, 'template starter');
  assertInputBinding(releaseGateBytes, buildRecipe.inputs?.releaseGates, 'release gates');
  const releaseGateDigest = sha256(releaseGateBytes);
  if (candidate.sourceAtlas?.digest !== buildRecipe.inputs?.sourceAtlas?.sha256) {
    throw new Error('Evidence candidate does not bind the build recipe source atlas.');
  }
  const assetBindings = (buildRecipe.assets ?? []).map(
    ({ id, path: assetPath, sha256, bytes }) => ({
      id,
      path: assetPath,
      sha256,
      bytes,
    }),
  );
  if (buildRecipe.assetSetDigest !== digestJson(assetBindings)) {
    throw new Error('Artifact Atlas V3 asset-set digest is invalid.');
  }
  const modelEvidence = validateModelEvidence(buildRecipe, supportingEvidence);
  if (buildRecipe.modelEvidenceSetDigest !== digestJson(modelEvidence)) {
    throw new Error('Artifact Atlas V3 model-evidence set digest is invalid.');
  }

  const zip = await JSZip.loadAsync(pptxBytes);
  const sourceZip = await JSZip.loadAsync(sourceAtlasBytes);
  const slideCount = Number(buildRecipe.composition?.slideCount);
  if (!Number.isSafeInteger(slideCount) || slideCount < 1) {
    throw new Error('Artifact Atlas V3 build recipe slide count is invalid.');
  }
  const actualSlides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort(numericSlideSort);
  const expectedSlides = Array.from(
    { length: slideCount },
    (_, index) => `ppt/slides/slide${index + 1}.xml`,
  );
  if (actualSlides.length !== slideCount || !sameStrings(actualSlides, expectedSlides)) {
    throw new Error(`Artifact Atlas V3 must contain ${slideCount} ordered slides.`);
  }

  const appXml = await requiredZipText(zip, 'docProps/app.xml');
  const coreXml = await requiredZipText(zip, 'docProps/core.xml');
  const exporterApplication = xmlElementText(appXml, 'Application');
  const creator = xmlElementText(coreXml, 'creator');
  if (
    exporterApplication !== buildRecipe.generator?.exporterApplication ||
    creator !== buildRecipe.generator?.exporterApplication
  ) {
    throw new Error('PPTX exporter metadata does not match the artifact-tool build recipe.');
  }

  const expectations = buildRecipe.composition?.slides;
  if (
    !Array.isArray(expectations) ||
    expectations.length !== slideCount ||
    expectations.some((entry, index) => entry.slide !== index + 1)
  ) {
    throw new Error('Artifact Atlas V3 per-slide composition recipe is incomplete.');
  }
  const slideProofs = [];
  const slideTexts = new Map();
  const slideImageTargets = new Map();
  for (const expectation of expectations) {
    const slide = expectation.slide;
    const slideXml = await requiredZipText(zip, `ppt/slides/slide${slide}.xml`);
    const textRuns = extractTextRuns(slideXml);
    const combinedText = textRuns.join('\n');
    for (const requiredText of expectation.requiredText ?? []) {
      if (!combinedText.includes(requiredText)) {
        throw new Error(
          `Artifact Atlas V3 slide ${slide} is missing required text: ${requiredText}`,
        );
      }
    }
    if (textRuns.length < expectation.minimumTextRuns) {
      throw new Error(
        `Artifact Atlas V3 slide ${slide} has ${textRuns.length} text runs; expected at least ${expectation.minimumTextRuns}.`,
      );
    }
    const relationships = await optionalZipText(zip, `ppt/slides/_rels/slide${slide}.xml.rels`);
    const imageTargets = relationshipTargets(relationships, 'image').map((target) =>
      resolveRelationshipTarget(`ppt/slides/slide${slide}.xml`, target),
    );
    if (imageTargets.length !== expectation.imageRelationships) {
      throw new Error(
        `Artifact Atlas V3 slide ${slide} image relationship count is ${imageTargets.length}; expected ${expectation.imageRelationships}.`,
      );
    }
    slideTexts.set(slide, textRuns);
    slideImageTargets.set(slide, imageTargets);
    const contentProof = await buildSlideContentProof(zip, slide, slideXml, imageTargets);
    assertContentProof(expectation.contentProof, contentProof, slide);
    if (expectation.sourceBinding) {
      const sourceSlide = expectation.sourceBinding.slide;
      const sourceProof = await buildSourceSemanticProof(sourceZip, sourceSlide);
      if (
        sourceProof.semanticDigest !== expectation.sourceBinding.semanticDigest ||
        contentProof.semanticDigest !== sourceProof.semanticDigest
      ) {
        throw new Error(
          `Artifact Atlas V3 slide ${slide} does not match bound source slide ${sourceSlide}.`,
        );
      }
    }
    slideProofs.push({
      slide,
      textRunCount: textRuns.length,
      shapeCount: countMatches(slideXml, /<p:sp>/gu),
      imageRelationshipCount: imageTargets.length,
      ...contentProof,
    });
  }

  validateTruthCorrections(slideTexts, releaseGates);
  const embeddedAssets = await validateSlide42Assets(zip, buildRecipe, slideImageTargets);
  const receiptSlide = Number(buildRecipe.receiptBinding?.slide);
  const receiptText = slideTexts.get(receiptSlide)?.join('\n') ?? '';
  const compositionToken = compositionTokenFromRecipe(buildRecipe.composition);
  const provenanceBindings = [
    buildRecipe.receiptBinding?.marker,
    `CANDIDATE ${candidateDigest}`,
    `BUILD_RECIPE ${buildRecipeDigest}`,
    `ASSET_SET ${buildRecipe.assetSetDigest}`,
    `SOURCE_ATLAS ${buildRecipe.inputs.sourceAtlas.sha256}`,
    `RELEASE_GATES ${releaseGateDigest}`,
    `GENERATOR ${buildRecipe.generator.package}@${buildRecipe.generator.version} / ${exporterApplication}`,
    `COMPOSITION ${compositionToken}`,
  ];
  for (const binding of provenanceBindings) {
    if (!binding || !receiptText.includes(binding)) {
      throw new Error(`Artifact Atlas V3 receipt slide is missing provenance binding: ${binding}`);
    }
  }

  const composition = verifiedComposition(buildRecipe.composition, slideProofs);
  return {
    schemaVersion: 'nodeslide.artifact-atlas-v3-pptx-receipt/v2',
    file: normalizedPath,
    digest: sha256(pptxBytes),
    bytes: pptxBytes.byteLength,
    slideCount,
    candidateDigest,
    buildRecipeDigest,
    assetSetDigest: buildRecipe.assetSetDigest,
    sourceAtlasDigest: buildRecipe.inputs.sourceAtlas.sha256,
    receiptCoreDigest: sha256(receiptCoreBytes),
    releaseGateDigest,
    releaseGates: Object.fromEntries(
      RELEASE_GATE_ROWS.map(([key]) => [key, releaseGates.gates[key].status]),
    ),
    generator: buildRecipe.generator.package,
    generatorEvidence: {
      exporterApplication,
      creator,
      packageVersion: buildRecipe.generator.version,
      exporterDependency: buildRecipe.generator.exporterDependency,
      workflow: buildRecipe.generator.workflow,
      buildCommand: buildRecipe.generator.buildCommand,
      receiptSlide,
    },
    composition,
    contentVerification: {
      verifiedSlideCount: slideProofs.length,
      slideProofDigest: digestJson(slideProofs),
      sourceSlidesVerified: expectations.filter((expectation) => expectation.sourceBinding).length,
      sourceBindingDigest: digestJson(
        expectations
          .filter((expectation) => expectation.sourceBinding)
          .map(({ slide, sourceBinding }) => ({ slide, sourceBinding })),
      ),
      embeddedAssets,
      modelEvidence,
      modelEvidenceSetDigest: buildRecipe.modelEvidenceSetDigest,
    },
    publicReleaseApproved: candidate.publicReleaseApproved === true,
    promotionEligible: candidate.promotionEligible === true,
    humanPreference: candidate.gates?.blindHumanPreference?.status ?? 'not_run',
  };
}

export async function deriveAtlasV3SlideContentProofs({
  pptxBytes,
  sourceAtlasBytes,
  sourceSlideMap,
}) {
  assertBytes(pptxBytes, 'Artifact Atlas V3 PPTX');
  assertBytes(sourceAtlasBytes, 'Artifact Atlas V3 source atlas');
  const zip = await JSZip.loadAsync(pptxBytes);
  const sourceZip = await JSZip.loadAsync(sourceAtlasBytes);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort(numericSlideSort);
  const proofs = [];
  for (let index = 0; index < slideNames.length; index += 1) {
    const slide = index + 1;
    const slideXml = await requiredZipText(zip, slideNames[index]);
    const relationships = await optionalZipText(zip, `ppt/slides/_rels/slide${slide}.xml.rels`);
    const imageTargets = relationshipTargets(relationships, 'image').map((target) =>
      resolveRelationshipTarget(slideNames[index], target),
    );
    const contentProof = await buildSlideContentProof(zip, slide, slideXml, imageTargets);
    const sourceSlide = slide >= 2 && slide <= 38 ? sourceSlideMap?.[index] : null;
    const sourceBinding = Number.isSafeInteger(sourceSlide)
      ? { slide: sourceSlide, ...(await buildSourceSemanticProof(sourceZip, sourceSlide)) }
      : null;
    if (sourceBinding && sourceBinding.semanticDigest !== contentProof.semanticDigest) {
      throw new Error(
        `Artifact Atlas V3 slide ${slide} does not match source slide ${sourceSlide} while deriving the build recipe.`,
      );
    }
    proofs.push({ slide, contentProof, sourceBinding });
  }
  return proofs;
}

async function buildSlideContentProof(zip, slide, slideXml, imageTargets) {
  const canonicalXml = canonicalSlideXml(slideXml, slide);
  const textRuns = extractTextRuns(canonicalXml);
  const shapeXml = [...canonicalXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/gu)].map((match) =>
    canonicalShapeXml(match[0]),
  );
  const pictureXml = [...canonicalXml.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/gu)].map((match) =>
    canonicalShapeXml(match[0]),
  );
  const imagePayloads = [];
  for (const target of imageTargets) {
    const bytes = await requiredZipBytes(zip, target);
    imagePayloads.push({ sha256: sha256(bytes), bytes: bytes.byteLength });
  }
  const textRunDigest = digestJson(textRuns);
  const shapeXmlDigest = digestJson(shapeXml);
  const pictureXmlDigest = digestJson(pictureXml);
  const imagePayloadDigest = digestJson(imagePayloads);
  const semanticDigest = digestJson({
    textRuns,
    shapeCount: shapeXml.length,
    imagePayloads,
  });
  return {
    textRunDigest,
    shapeXmlDigest,
    pictureXmlDigest,
    imagePayloadDigest,
    semanticDigest,
    contentDigest: digestJson({
      textRunDigest,
      shapeXmlDigest,
      pictureXmlDigest,
      imagePayloadDigest,
      semanticDigest,
    }),
  };
}

async function buildSourceSemanticProof(zip, slide) {
  const slideXml = await requiredZipText(zip, `ppt/slides/slide${slide}.xml`);
  const relationships = await optionalZipText(zip, `ppt/slides/_rels/slide${slide}.xml.rels`);
  const imageTargets = relationshipTargets(relationships, 'image').map((target) =>
    resolveRelationshipTarget(`ppt/slides/slide${slide}.xml`, target),
  );
  const imagePayloads = [];
  for (const target of imageTargets) {
    const bytes = await requiredZipBytes(zip, target);
    imagePayloads.push({ sha256: sha256(bytes), bytes: bytes.byteLength });
  }
  return {
    semanticDigest: digestJson({
      textRuns: extractTextRuns(slideXml),
      shapeCount: countMatches(slideXml, /<p:sp>/gu),
      imagePayloads,
    }),
  };
}

function assertContentProof(expected, actual, slide) {
  const fields = [
    'textRunDigest',
    'shapeXmlDigest',
    'pictureXmlDigest',
    'imagePayloadDigest',
    'semanticDigest',
    'contentDigest',
  ];
  for (const field of fields) {
    if (!expected?.[field] || expected[field] !== actual[field]) {
      throw new Error(`Artifact Atlas V3 slide ${slide} ${field} does not match the build recipe.`);
    }
  }
}

function canonicalSlideXml(slideXml, slide) {
  let canonical = slideXml;
  if (slide >= 2 && slide <= 38) canonical = canonical.replace(/ATLAS V3 (\d{2})/gu, 'ATLAS V2 $1');
  if (slide === 43)
    canonical = canonical.replace(
      /BUILD_RECIPE sha256:[a-f0-9]{64}/gu,
      'BUILD_RECIPE sha256:SELF_BOUND_BY_RECEIPT',
    );
  return canonical;
}

function canonicalShapeXml(shapeXml) {
  return shapeXml
    .replace(/\b(id|r:id|r:embed|r:link)="[^"]*"/gu, '$1="VOLATILE"')
    .replace(/\{[0-9A-Fa-f-]{36}\}/gu, '{VOLATILE-GUID}');
}

function validateModelEvidence(buildRecipe, supportingEvidence) {
  const evidenceByPath = new Map(
    (supportingEvidence ?? []).map((entry) => [normalizeRepoPath(entry.path), entry]),
  );
  return (buildRecipe.assets ?? []).map((asset) => {
    const binding = asset.modelEvidence;
    if (!binding) throw new Error(`Artifact Atlas V3 asset ${asset.id} lacks model evidence.`);
    const planEntry = requiredEvidenceEntry(evidenceByPath, binding.planResult, `${asset.id} plan`);
    const receiptEntry = requiredEvidenceEntry(
      evidenceByPath,
      binding.showcaseReceipt,
      `${asset.id} showcase receipt`,
    );
    const plan = parseEvidenceJson(planEntry, `${asset.id} plan`);
    const receipt = parseEvidenceJson(receiptEntry, `${asset.id} showcase receipt`);
    const expectedLabel = MODEL_LABELS[binding.model];
    if (!expectedLabel || asset.label !== expectedLabel) {
      throw new Error(`Artifact Atlas V3 asset ${asset.id} model label is not approved.`);
    }
    if (
      plan.schemaVersion !== 'nodeslide.artifact-arena-plan-result/v1' ||
      receipt.schemaVersion !== 'nodeslide.artifact-showcase-receipt/v1' ||
      plan.status !== 'passed' ||
      receipt.status !== 'eligible'
    ) {
      throw new Error(`Artifact Atlas V3 asset ${asset.id} model evidence is not eligible.`);
    }
    if (
      plan.candidateId !== binding.candidateId ||
      receipt.candidateId !== binding.candidateId ||
      plan.candidateDigest !== receipt.candidateDigest ||
      plan.model !== binding.model ||
      plan.telemetry?.model !== binding.model ||
      receipt.model !== binding.model ||
      plan.telemetry?.provider !== binding.provider ||
      plan.telemetry?.costMicroUsd !== binding.costMicroUsd ||
      receipt.evaluation?.costMicroUsd !== binding.costMicroUsd
    ) {
      throw new Error(
        `Artifact Atlas V3 asset ${asset.id} route or cost evidence is inconsistent.`,
      );
    }
    if (
      ![
        receipt.evaluation?.visualPassed,
        receipt.evaluation?.evidencePassed,
        receipt.evaluation?.exportPassed,
        receipt.evaluation?.artifactTypeMatched,
      ].every((value) => value === true)
    ) {
      throw new Error(`Artifact Atlas V3 asset ${asset.id} showcase gates are incomplete.`);
    }
    const evidenceRoot = normalizeRepoPath(binding.planResult.path).split('/plan-results/')[0];
    const screenshotPath = path.posix.join(evidenceRoot, receipt.outputs?.pptxRender ?? '');
    if (normalizeRepoPath(asset.path) !== screenshotPath) {
      throw new Error(`Artifact Atlas V3 asset ${asset.id} screenshot is not receipt-bound.`);
    }
    const expectedMeta = formatRouteMeta(binding.provider, binding.costMicroUsd);
    if (asset.meta !== expectedMeta) {
      throw new Error(
        `Artifact Atlas V3 asset ${asset.id} route metadata is not evidence-derived.`,
      );
    }
    return {
      assetId: asset.id,
      candidateId: binding.candidateId,
      model: binding.model,
      provider: binding.provider,
      costMicroUsd: binding.costMicroUsd,
      planResultDigest: binding.planResult.sha256,
      showcaseReceiptDigest: binding.showcaseReceipt.sha256,
      screenshotPath,
      screenshotDigest: asset.sha256,
    };
  });
}

function requiredEvidenceEntry(evidenceByPath, binding, label) {
  const entry = binding ? evidenceByPath.get(normalizeRepoPath(binding.path)) : null;
  if (!entry) throw new Error(`Artifact Atlas V3 ${label} evidence is missing.`);
  assertInputBinding(entry.bytes, binding, label);
  return entry;
}

function parseEvidenceJson(entry, label) {
  try {
    return JSON.parse(new TextDecoder().decode(entry.bytes));
  } catch {
    throw new Error(`Artifact Atlas V3 ${label} evidence is not valid JSON.`);
  }
}

function formatRouteMeta(provider, costMicroUsd) {
  if (provider !== 'openrouter' || !Number.isSafeInteger(costMicroUsd) || costMicroUsd < 0) {
    throw new Error('Artifact Atlas V3 model route metadata is invalid.');
  }
  return costMicroUsd === 0
    ? '$0 / exact returned free route'
    : `$${(costMicroUsd / 1_000_000).toFixed(6)} / exact OpenRouter route`;
}

function normalizeRepoPath(value) {
  return String(value).replaceAll('\\', '/');
}

const MODEL_LABELS = Object.freeze({
  'anthropic/claude-sonnet-5': 'CLAUDE SONNET 5',
  'moonshotai/kimi-k3': 'KIMI K3',
  'google/gemma-4-26b-a4b-it:free': 'GEMMA 4 26B FREE',
});

async function validateSlide42Assets(zip, buildRecipe, slideImageTargets) {
  const binding = buildRecipe.slide42AssetBinding;
  if (binding?.slide !== 42 || !Array.isArray(binding.assetIds)) {
    throw new Error('Artifact Atlas V3 slide 42 asset binding is invalid.');
  }
  const expected = binding.assetIds.map((id) =>
    buildRecipe.assets.find((asset) => asset.id === id),
  );
  if (expected.some((asset) => !asset) || !allUnique(expected.map((asset) => asset.id))) {
    throw new Error('Artifact Atlas V3 slide 42 asset identities are missing or duplicated.');
  }
  const targets = slideImageTargets.get(42) ?? [];
  const embedded = [];
  for (const target of targets) {
    const bytes = await requiredZipBytes(zip, target);
    embedded.push({ target, sha256: sha256(bytes), bytes: bytes.byteLength });
  }
  const unmatched = [...embedded];
  for (const asset of expected) {
    const matchIndex = unmatched.findIndex(
      (entry) => entry.sha256 === asset.sha256 && entry.bytes === asset.bytes,
    );
    if (matchIndex < 0) {
      throw new Error(`Artifact Atlas V3 slide 42 is missing bound asset ${asset.id}.`);
    }
    unmatched.splice(matchIndex, 1);
  }
  if (unmatched.length) throw new Error('Artifact Atlas V3 slide 42 contains foreign assets.');
  return embedded;
}

function validateTruthCorrections(slideTexts, releaseGates) {
  const slide41 = slideTexts.get(41) ?? [];
  if (
    !slide41.includes('files captured; semantic gate failed') ||
    !slide41.includes('0/2 semantic') ||
    slide41.some((text) => /artifact pass|complete artifact chain/iu.test(text))
  )
    throw new Error('Artifact Atlas V3 slide 41 overstates GPT-OSS semantic evidence.');
  for (let slide = 2; slide <= 38; slide += 1) {
    const texts = slideTexts.get(slide) ?? [];
    const footer = `ATLAS V3 ${String(slide).padStart(2, '0')}`;
    if (!texts.includes(footer) || texts.some((text) => /^ATLAS V2 \d{2}$/u.test(text)))
      throw new Error(`Artifact Atlas V3 slide ${slide} has a stale museum footer.`);
  }
  const slide43 = slideTexts.get(43) ?? [];
  for (const [key, label] of RELEASE_GATE_ROWS) {
    assertFollowing(slide43, label, renderReleaseGateStatus(releaseGates.gates[key].status).label);
  }
  if (slide43.some((text) => text.includes('All technical release gates close'))) {
    throw new Error('Artifact Atlas V3 slide 43 overstates exact-main release evidence.');
  }
}

function verifiedComposition(composition, slideProofs) {
  const titleSlides = composition.segments?.titleSlides;
  const museum = composition.segments?.auditedMuseumPreviewSlides;
  const appendix = composition.segments?.evidenceAppendixSlides;
  if (
    !Array.isArray(titleSlides) ||
    titleSlides.length !== 1 ||
    rangeCount(museum) !== museum?.count ||
    rangeCount(appendix) !== appendix?.count ||
    titleSlides.length + museum.count + appendix.count !== composition.slideCount
  )
    throw new Error('Artifact Atlas V3 composition segments are inconsistent.');
  return {
    titleSlides: titleSlides.length,
    auditedMuseumPreviewSlides: museum.count,
    evidenceAppendixSlides: appendix.count,
    verifiedContentSlides: slideProofs.length,
    verifiedShapeCount: slideProofs.reduce((total, slide) => total + slide.shapeCount, 0),
    verifiedImageRelationships: slideProofs.reduce(
      (total, slide) => total + slide.imageRelationshipCount,
      0,
    ),
  };
}

function compositionTokenFromRecipe(composition) {
  const title = composition.segments?.titleSlides?.length ?? 0;
  const museum = rangeCount(composition.segments?.auditedMuseumPreviewSlides);
  const appendix = rangeCount(composition.segments?.evidenceAppendixSlides);
  return `${title}+${museum}+${appendix}=${composition.slideCount}`;
}

function relationshipTargets(xml, relationshipKind) {
  const targets = [];
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?\s*>/gu)) {
    const tag = match[0];
    const type = attribute(tag, 'Type');
    const target = attribute(tag, 'Target');
    if (type?.endsWith(`/${relationshipKind}`) && target) targets.push(target);
  }
  return targets;
}

function resolveRelationshipTarget(sourcePart, target) {
  if (target.startsWith('/')) return target.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePart), target));
}

function extractTextRuns(xml) {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)]
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean);
}

function xmlElementText(xml, localName) {
  const escaped = localName.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = xml.match(new RegExp(`<[^>]*:?${escaped}[^>]*>([^<]*)<\\/[^>]*:?${escaped}>`, 'u'));
  return match ? decodeXml(match[1]).trim() : null;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'u'));
  return match ? decodeXml(match[1]) : null;
}

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function assertFollowing(values, label, expected) {
  const index = values.indexOf(label);
  if (index < 0 || values[index + 1] !== expected) {
    throw new Error(`Artifact Atlas V3 ${label} must remain ${expected}.`);
  }
}

function assertInputBinding(bytes, binding, label) {
  if (!binding || bytes.byteLength !== binding.bytes || sha256(bytes) !== binding.sha256) {
    throw new Error(`Artifact Atlas V3 ${label} input does not match the build recipe.`);
  }
}

function assertBytes(bytes, label) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error(`${label} is missing or empty.`);
  }
}

async function requiredZipText(zip, name) {
  const file = zip.file(name);
  if (!file) throw new Error(`Artifact Atlas V3 PPTX is missing ${name}.`);
  return file.async('string');
}

async function optionalZipText(zip, name) {
  const file = zip.file(name);
  return file ? file.async('string') : '';
}

async function requiredZipBytes(zip, name) {
  const file = zip.file(name);
  if (!file) throw new Error(`Artifact Atlas V3 PPTX is missing embedded asset ${name}.`);
  return file.async('uint8array');
}

function numericSlideSort(left, right) {
  return (
    Number(left.match(/slide(\d+)\.xml$/u)?.[1]) - Number(right.match(/slide(\d+)\.xml$/u)?.[1])
  );
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function allUnique(values) {
  return new Set(values).size === values.length;
}

function rangeCount(range) {
  return Number.isSafeInteger(range?.from) && Number.isSafeInteger(range?.to)
    ? range.to - range.from + 1
    : 0;
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
