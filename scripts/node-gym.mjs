#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildNodeGymMatrixInput, validateNodeGymConfig } from './lib/node-gym-config-core.mjs';
import { buildNodeGymMatrix } from './lib/node-gym-matrix-core.mjs';

const command = process.argv[2] ?? 'validate';
const root = process.cwd();
const configPath = path.resolve(option('config') ?? 'benchmarks/deck-gym/v2/gym.json');
const outputRoot = path.resolve(
  option('artifact-dir') ?? 'artifacts/node-gym/nodeslide-deck-gym-v2',
);
const rawConfig = await readFile(configPath, 'utf8');
const config = JSON.parse(rawConfig);
const validation = validateNodeGymConfig(config);
await mkdir(outputRoot, { recursive: true });

if (command === 'validate') {
  const receipt = {
    schemaVersion: 'nodekit.gym-config-validation/v1',
    gymVersion: config.gymVersion,
    configDigest: sha256(rawConfig),
    status: validation.failures.length ? 'failed' : 'passed',
    matrixSize: validation.matrixSize,
    failures: validation.failures,
  };
  await writeJson(path.join(outputRoot, 'configuration-validation.json'), receipt);
  console.log(`[node-gym] ${receipt.status.toUpperCase()} matrix=${receipt.matrixSize}`);
  if (receipt.failures.length) {
    console.error(receipt.failures.join('\n'));
    process.exitCode = 1;
  }
} else if (command === 'matrix') {
  if (validation.failures.length) throw new Error(validation.failures.join('\n'));
  const runs = buildNodeGymMatrix(buildNodeGymMatrixInput(config));
  const matrix = {
    schemaVersion: 'nodekit.gym-matrix/v1',
    gymVersion: config.gymVersion,
    configDigest: sha256(rawConfig),
    runCount: runs.length,
    pairedComparisonReady: true,
    promotionAutoApply: false,
    runs,
  };
  const outputPath = path.resolve(option('out') ?? path.join(outputRoot, 'matrix.json'));
  await writeJson(outputPath, matrix);
  console.log(`[node-gym] planned ${runs.length} paired repeated runs`);
  console.log(`[node-gym] matrix: ${path.relative(root, outputPath)}`);
} else {
  console.error('Usage: node scripts/node-gym.mjs <validate|matrix> [--config path] [--out path]');
  process.exitCode = 1;
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${compactShortStringArrays(JSON.stringify(value, null, 2))}\n`);
}

function compactShortStringArrays(json) {
  return json.replace(
    /(\s+"[^"]+": )\[\n((?:\s+"(?:[^"\\]|\\.)*"(?:,\n)?)+)\s+\]/g,
    (match, prefix, body) => {
      const values = body
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/,$/, ''));
      const compact = `${prefix}[${values.join(', ')}]`;
      return compact.length <= 100 ? compact : match;
    },
  );
}
