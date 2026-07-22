#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  buildArtifactArenaMatrix,
  buildArtifactGallery,
  buildModelCompare,
  compareHarnessReceipts,
  readArtifactAtlasConfig,
  validateArtifactAtlasConfig,
} from './lib/artifact-atlas-core.mjs';

const command = process.argv[2] ?? 'validate';
const root = process.cwd();
const config = await readArtifactAtlasConfig(root, {
  atlasPath: option('atlas'),
  harnessPath: option('harness'),
});
const artifactRoot = path.resolve(
  option('artifact-root') ?? path.join('artifacts', 'deck-gym', 'artifact-atlas-v1'),
);

if (command === 'validate') {
  const result = validateArtifactAtlasConfig(config.atlas, config.harness);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else if (command === 'matrix') {
  const matrix = buildArtifactArenaMatrix(config.atlas, config.harness, {
    fixtures: csvOption('fixtures'),
    models: csvOption('models'),
    directions: csvOption('directions'),
  });
  const outputPath = path.resolve(option('out') ?? path.join(artifactRoot, 'matrix.json'));
  await writeJson(outputPath, matrix);
  console.log(
    `[artifact-atlas] wrote ${matrix.candidateCount} candidates to ${path.relative(root, outputPath)}`,
  );
} else if (command === 'gallery') {
  const receipts = await readReceipts(option('receipts'));
  const gallery = buildArtifactGallery(config.atlas, receipts);
  const outputPath = path.resolve(option('out') ?? path.join(artifactRoot, 'gallery.json'));
  await writeJson(outputPath, gallery);
  console.log(
    `[artifact-atlas] gallery ${gallery.readyCount}/${gallery.entries.length} ready at ${path.relative(root, outputPath)}`,
  );
} else if (command === 'model-compare') {
  const fixtureId = option('fixture');
  if (!fixtureId) throw new Error('--fixture is required for model-compare.');
  const receipts = await readReceipts(option('receipts'));
  const comparison = buildModelCompare(receipts, fixtureId);
  const outputPath = path.resolve(
    option('out') ?? path.join(artifactRoot, 'model-compare', `${fixtureId}.json`),
  );
  await writeJson(outputPath, comparison);
  console.log(
    `[artifact-atlas] model comparison has ${comparison.candidateCount} candidates at ${path.relative(root, outputPath)}`,
  );
} else if (command === 'harness-compare') {
  const previous = await readReceipts(option('previous'));
  const current = await readReceipts(option('current'));
  const comparison = compareHarnessReceipts(previous, current);
  const outputPath = path.resolve(option('out') ?? path.join(artifactRoot, 'harness-compare.json'));
  await writeJson(outputPath, comparison);
  console.log(
    `[artifact-atlas] paired ${comparison.pairedCandidateCount} candidates at ${path.relative(root, outputPath)}`,
  );
} else {
  console.error(
    'Usage: node scripts/artifact-atlas.mjs <validate|matrix|gallery|model-compare|harness-compare> [options]',
  );
  process.exitCode = 1;
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function csvOption(name) {
  return (option(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function readReceipts(value) {
  if (!value) return [];
  const content = await readFile(path.resolve(value), 'utf8');
  if (value.endsWith('.jsonl')) {
    return content
      .split(/\r?\n/gu)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  const parsed = JSON.parse(content);
  return Array.isArray(parsed) ? parsed : (parsed.receipts ?? []);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
