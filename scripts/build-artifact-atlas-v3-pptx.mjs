#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  atlasV3ReleaseGateSlideTexts,
  validateAtlasV3ReleaseGates,
} from './lib/artifact-atlas-v3-pptx-receipt.mjs';

const builderPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(builderPath), '..');
const receiptCorePath = path.join(repoRoot, 'scripts/lib/artifact-atlas-v3-pptx-receipt.mjs');
const buildRoot = process.env.ATLAS_V3_BUILD_DIR
  ? path.resolve(process.env.ATLAS_V3_BUILD_DIR)
  : path.join(os.tmpdir(), 'nodeslide-artifact-atlas-v3-build');
const starter = path.join(repoRoot, 'outputs/artifact-atlas-v3/atlas-v3-template-starter.pptx');
const finalPptx = path.join(repoRoot, 'outputs/artifact-atlas-v3/nodeslide-artifact-atlas-v3.pptx');
const buildRecipePath = path.join(repoRoot, 'outputs/artifact-atlas-v3/atlas-v3-build-recipe.json');
const buildRecipeBytes = await fs.readFile(buildRecipePath);
const buildRecipe = JSON.parse(buildRecipeBytes.toString('utf8'));
const buildRecipeDigest = sha256(buildRecipeBytes);
const releaseGatePath = path.join(repoRoot, buildRecipe.inputs.releaseGates.path);
const releaseGateBytes = await fs.readFile(releaseGatePath);
const releaseGates = validateAtlasV3ReleaseGates(JSON.parse(releaseGateBytes.toString('utf8')));
const releaseGateDigest = sha256(releaseGateBytes);
const previewDir = path.join(buildRoot, 'preview');
const layoutDir = path.join(buildRoot, 'layout');
const modelComparisonAssets = buildRecipe.assets.map((asset) => ({
  ...asset,
  path: path.join(repoRoot, asset.path),
}));

const artifactToolDir = await findArtifactToolPackage();
const artifactToolPackage = JSON.parse(
  await fs.readFile(path.join(artifactToolDir, 'package.json'), 'utf8'),
);
if (
  artifactToolPackage.name !== buildRecipe.generator.package ||
  artifactToolPackage.version !== buildRecipe.generator.version ||
  `@oai/walnut@${artifactToolPackage.dependencies?.['@oai/walnut']}` !==
    buildRecipe.generator.exporterDependency
) {
  throw new Error('Artifact-tool runtime does not match the build recipe.');
}
const artifactToolModule = await findArtifactToolEntrypoint(artifactToolDir);
const { FileBlob, PresentationFile } = await import(pathToFileURL(artifactToolModule).href);

await verifyFile(builderPath, buildRecipe.inputs.builder);
await verifyFile(receiptCorePath, buildRecipe.inputs.receiptCore);
await verifyFile(starter, buildRecipe.inputs.templateStarter);
await verifyFile(releaseGatePath, buildRecipe.inputs.releaseGates);
await verifyFile(
  path.join(repoRoot, buildRecipe.inputs.candidate.path),
  buildRecipe.inputs.candidate,
);
await verifyFile(
  path.join(repoRoot, buildRecipe.inputs.sourceAtlas.path),
  buildRecipe.inputs.sourceAtlas,
);
for (const asset of modelComparisonAssets) {
  await verifyFile(asset.path, asset);
  await verifyFile(
    path.join(repoRoot, asset.modelEvidence.planResult.path),
    asset.modelEvidence.planResult,
  );
  await verifyFile(
    path.join(repoRoot, asset.modelEvidence.showcaseReceipt.path),
    asset.modelEvidence.showcaseReceipt,
  );
}

const replacements = new Map([
  [
    1,
    [
      'NODEGYM / ARTIFACT ATLAS V3',
      'Typed evidence turns model variety into governed production',
      'Forty-three inspectable frames connect visual breadth, production semantics, portable evaluation, and honest release proof.',
      'SOURCE / artifact-atlas-v3 / audited V2 + close-all-gaps evidence',
      'ATLAS V3 01',
      'TYPED\nTESTED\nTRACEABLE',
      '43',
      'audited artifact and evidence frames',
      '5 new closure appendices',
    ],
  ],
  [
    39,
    [
      'SYSTEMS / PRODUCTION ARTIFACT SPEC',
      'A typed compiler boundary catches semantic drift before export',
      'Model JSON is bounded by versioned specs, semantic gates, deterministic compilation, and digest-bound receipts.',
      'SOURCE / production-artifact-boundary / compiler + shadow receipts',
      'ATLAS V3 39',
      'Model JSON',
      'Production spec\nversioned / validated',
      'Semantic gates',
      'Compiler boundary',
      'Browser',
      'PowerPoint',
      'Receipt',
      'TRUST BOUNDARY / versioned specs only',
    ],
  ],
  [
    40,
    [
      'SYSTEMS / PORTABLE NODEGYM',
      'NodeGym isolates model, harness, evidence, and promotion decisions',
      'The packed core installs independently; NodeSlide and a committed NodeRoom-domain consumer exercise the same contract.',
      'SOURCE / node-gym portability receipt / exact package digest',
      'ATLAS V3 40',
      'Inputs',
      'Tasks / evidence / budgets',
      'Core',
      '@nodekit/gym-core / immutable plans',
      'Domain packs',
      'NodeSlide / NodeRoom consumer',
      'Evaluation',
      'Typed gates / deltas / diagnoses',
      'Outputs',
      'Receipts / cards / training episodes',
      'PACKED UPGRADE JOURNEY',
      'pack 0.0.1',
      'upgrade 0.1.0',
      'consumer 0.1.0',
      'illustrative path / receipt carries the exact install and digest proof',
    ],
  ],
  [
    41,
    [
      'DECISION EVALUATION / MODEL + FREE ROUTE EVIDENCE',
      'Availability, artifact completion, and comparability are separate facts',
      'Eleven named routes answered the production probe; GPT-OSS captured files but failed the semantic gate in both bounded runs.',
      'SOURCE / fleet probe + immutable NodeGym campaign receipts',
      'ATLAS V3 41',
      'Route',
      'Evidence',
      'Returned',
      'Cost',
      'Truth',
      'GPT-OSS light',
      'files captured',
      'exact live route',
      '$0',
      'semantic fail (0/1)',
      'Fleet surface',
      '11/11 shallow',
      '11 named routes',
      'measured',
      'availability only',
      'GPT-OSS structured',
      '0/2 semantic',
      'exact live route',
      '$0',
      'files captured; semantic gate failed',
      'Gemma 4 Free',
      '0/2 eligible',
      'route absent',
      '$0',
      'degraded retained',
      'Deterministic',
      '2/2 current',
      'local',
      '$0',
      'complete control',
      'Full matrix',
      '720 planned',
      '-',
      'capped',
      'not run',
      'Human preference',
      'pending',
      '-',
      '-',
      'blocks promotion',
    ],
  ],
  [
    42,
    [
      'DECISION EVALUATION / SAME TASK, THREE MODELS',
      'Same evidence. Three model quirks. One governed compiler.',
      'Nearly identical geometry is the finding: compare model judgment separately from deterministic layout containment.',
      'SOURCE / Artifact Arena risk-matrix receipts + exact PPTX renders',
      'ATLAS V3 42',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ],
  ],
  [43, atlasV3ReleaseGateSlideTexts(releaseGates)],
]);

const presentation = await PresentationFile.importPptx(await FileBlob.load(starter));
const inspected = await presentation.inspect({ kind: 'slide,textbox,shape', maxChars: 1_000_000 });
const records = inspected.ndjson
  .trim()
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

for (const [slideNumber, nextTexts] of replacements) {
  const textboxes = records.filter(
    (record) => record.kind === 'textbox' && record.slide === slideNumber,
  );
  if (textboxes.length !== nextTexts.length) {
    throw new Error(
      `Slide ${slideNumber} text map mismatch: expected ${nextTexts.length}, found ${textboxes.length}.`,
    );
  }
  for (let index = 0; index < textboxes.length; index += 1) {
    const record = textboxes[index];
    const nextText = nextTexts[index];
    if (!record?.id || nextText === undefined) {
      throw new Error(`Slide ${slideNumber} text target ${index + 1} is missing.`);
    }
    presentation.resolve(record.id).text.set(nextText);
  }
}

let museumFooterCount = 0;
for (const record of records) {
  if (
    record.kind !== 'textbox' ||
    record.slide < 2 ||
    record.slide > 38 ||
    !/^ATLAS V2 \d{2}$/u.test(record.text ?? '')
  )
    continue;
  presentation.resolve(record.id).text.set(`ATLAS V3 ${String(record.slide).padStart(2, '0')}`);
  museumFooterCount += 1;
}
if (museumFooterCount !== 37)
  throw new Error(
    `Artifact Atlas V3 expected 37 inherited museum footers, found ${museumFooterCount}.`,
  );

const indicatorGates = [
  ['Shape 6', 'repositoryGates'],
  ['Shape 10', 'typedSpecCompiler'],
  ['Shape 14', 'portabilityPackage'],
  ['Shape 18', 'productionJourney'],
  ['Shape 22', 'fleetAvailability'],
  ['Shape 26', 'atlasUiRenders'],
  ['Shape 30', 'blindPreference'],
  ['Shape 34', 'routingPromotion'],
  ['Shape 38', 'fineTuningRun'],
];
for (const [shapeName, gateKey] of indicatorGates) {
  const record = records.find(
    (entry) => entry.kind === 'shape' && entry.slide === 43 && entry.name === shapeName,
  );
  if (!record?.id) throw new Error(`Slide 43 release indicator ${shapeName} is missing.`);
  const indicator = presentation.resolve(record.id);
  const passed = releaseGates.gates[gateKey].status === 'passed';
  indicator.fill = passed ? '#C65334' : '#FFFFFF';
  indicator.line = { fill: passed ? '#C65334' : '#68726D', width: 1 };
}

const comparisonSlide = presentation.slides.items[41];
comparisonSlide.shapes.add({
  geometry: 'rect',
  name: 'Three-model comparison field',
  position: { left: 48, top: 184, width: 1184, height: 400 },
  fill: '#F5F1E8',
  line: { fill: '#F5F1E8', width: 0 },
});
for (let index = 0; index < modelComparisonAssets.length; index += 1) {
  const asset = modelComparisonAssets[index];
  const left = 58 + index * 400;
  const bytes = await fs.readFile(asset.path);
  const imageBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const label = comparisonSlide.shapes.add({
    geometry: 'textbox',
    name: `${asset.label} label`,
    position: { left, top: 216, width: 368, height: 22 },
  });
  label.text = asset.label;
  label.text.style = { fontSize: 14, bold: true, color: '#C65334' };
  const meta = comparisonSlide.shapes.add({
    geometry: 'textbox',
    name: `${asset.label} route metadata`,
    position: { left, top: 238, width: 368, height: 20 },
  });
  meta.text = asset.meta;
  meta.text.style = { fontSize: 11, color: '#68726D' };
  comparisonSlide.images.add({
    blob: imageBytes,
    contentType: 'image/png',
    alt: asset.alt,
    fit: 'contain',
    position: { left, top: 265, width: 368, height: 207 },
    geometry: 'roundRect',
    borderRadius: 10,
  });
  const caption = comparisonSlide.shapes.add({
    geometry: 'textbox',
    name: `${asset.label} finding`,
    position: { left, top: 486, width: 368, height: 54 },
  });
  caption.text = asset.caption;
  caption.text.style = { fontSize: 12, color: '#17231D' };
}
const caveat = comparisonSlide.shapes.add({
  geometry: 'textbox',
  name: 'Three-model comparison caveat',
  position: { left: 58, top: 550, width: 1168, height: 24 },
});
caveat.text =
  'Same task / same evidence / same typed artifact contract / same harness / no independent-design equivalence claim';
caveat.text.style = { fontSize: 11, bold: true, color: '#68726D' };

const receiptSlide = presentation.slides.items[42];
const provenance = receiptSlide.shapes.add({
  geometry: 'textbox',
  name: 'Artifact Atlas V3 provenance binding',
  position: { left: 58, top: 530, width: 1160, height: 62 },
});
provenance.text = [
  'ATLAS_V3_PROVENANCE_V1',
  `CANDIDATE ${buildRecipe.inputs.candidate.sha256} | BUILD_RECIPE ${buildRecipeDigest}`,
  `ASSET_SET ${buildRecipe.assetSetDigest} | SOURCE_ATLAS ${buildRecipe.inputs.sourceAtlas.sha256}`,
  `RELEASE_GATES ${releaseGateDigest}`,
  `GENERATOR ${buildRecipe.generator.package}@${buildRecipe.generator.version} / ${buildRecipe.generator.exporterApplication} | COMPOSITION 1+37+5=43`,
].join('\n');
provenance.text.style = { fontSize: 7.5, color: '#68726D', typeface: 'Aptos Mono' };

await fs.mkdir(path.dirname(finalPptx), { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
await fs.mkdir(layoutDir, { recursive: true });
for (let index = 0; index < presentation.slides.items.length; index += 1) {
  const slide = presentation.slides.items[index];
  const stem = `slide-${String(index + 1).padStart(2, '0')}`;
  await writeBlob(
    path.join(previewDir, `${stem}.png`),
    await presentation.export({ slide, format: 'png', scale: 1 }),
  );
  await fs.writeFile(
    path.join(layoutDir, `${stem}.layout.json`),
    await (await slide.export({ format: 'layout' })).text(),
    'utf8',
  );
}
await writeBlob(
  path.join(previewDir, 'atlas-v3-montage.webp'),
  await presentation.export({ format: 'webp', montage: true, scale: 1 }),
);
const pptx = await PresentationFile.exportPptx(presentation);
await pptx.save(finalPptx);
await fs.writeFile(
  `${finalPptx}.inspect.ndjson`,
  (
    await presentation.inspect({
      kind: 'slide,textbox,shape,image,table,chart',
      maxChars: 1_000_000,
    })
  ).ndjson,
  'utf8',
);
console.log(
  JSON.stringify(
    {
      finalPptx,
      buildRoot,
      slideCount: presentation.slides.items.length,
      editedSlides: [
        ...new Set([...replacements.keys(), ...Array.from({ length: 37 }, (_, i) => i + 2)]),
      ].sort((left, right) => left - right),
    },
    null,
    2,
  ),
);

async function writeBlob(file, blob) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, new Uint8Array(await blob.arrayBuffer()));
}

async function verifyFile(file, expected) {
  const bytes = await fs.readFile(file);
  if (bytes.byteLength !== expected?.bytes || sha256(bytes) !== expected?.sha256) {
    throw new Error(`Build input mismatch: ${file}`);
  }
}

async function findArtifactToolPackage() {
  const candidates = [
    process.env.CODEX_ARTIFACT_TOOL_PACKAGE,
    path.join(repoRoot, 'node_modules/@oai/artifact-tool'),
    path.join(
      process.env.HOME ?? '',
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool',
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(candidate, 'package.json'), 'utf8'),
      );
      if (packageJson.name === '@oai/artifact-tool') return path.resolve(candidate);
    } catch {
      // Continue to the next explicit runtime location.
    }
  }
  throw new Error(
    'Could not locate @oai/artifact-tool. Set CODEX_ARTIFACT_TOOL_PACKAGE to its package directory.',
  );
}

async function findArtifactToolEntrypoint(packageDir) {
  const candidates = [
    path.join(packageDir, 'dist/node/artifact_tool.mjs'),
    path.join(packageDir, 'dist/artifact_tool.mjs'),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue to the fallback entrypoint.
    }
  }
  throw new Error(`Artifact-tool entrypoint is missing from ${packageDir}.`);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
