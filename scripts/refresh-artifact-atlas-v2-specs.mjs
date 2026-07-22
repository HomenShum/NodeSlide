#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ATLAS_V2_ARTIFACTS } from './lib/artifact-atlas-v2-definition.mjs';
import { validateArtifactSpec } from './lib/artifact-spec-core.mjs';

const root = process.cwd();
const catalogPath = path.resolve(option('catalog') ?? 'public/artifact-atlas-v2/catalog.json');
const receiptsPath = path.resolve(
  option('receipts') ?? 'artifacts/deck-gym/artifact-atlas-v2/receipts.json',
);
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const receipts = JSON.parse(await readFile(receiptsPath, 'utf8'));
const byId = new Map(ATLAS_V2_ARTIFACTS.map((artifact) => [artifact.id, artifact]));

for (const artifact of ATLAS_V2_ARTIFACTS) {
  const validation = validateArtifactSpec(artifact.artifactSpec);
  if (!validation.ok)
    throw new Error(
      `Atlas spec ${artifact.id} is invalid: ${validation.issues.map((entry) => entry.code).join(', ')}`,
    );
}

catalog.entries = catalog.entries.map((entry) => {
  const artifact = byId.get(entry.id);
  if (!artifact) throw new Error(`Catalog artifact ${entry.id} is not canonical.`);
  const validation = validateArtifactSpec(artifact.artifactSpec);
  const receipt = {
    ...entry.receipt,
    artifactSpec: artifact.artifactSpec,
    specDigest: validation.specDigest,
    semanticValidation: validation,
    stages: {
      ...entry.receipt.stages,
      spec: { status: 'passed', issues: [] },
      semantic: { status: 'passed', issues: [] },
    },
  };
  return { ...entry, artifactSpec: artifact.artifactSpec, receipt };
});

const refreshedReceipts = receipts.map((receipt) => {
  const artifact = byId.get(receipt.artifactId);
  if (!artifact) throw new Error(`Receipt artifact ${receipt.artifactId} is not canonical.`);
  const validation = validateArtifactSpec(artifact.artifactSpec);
  return {
    ...receipt,
    artifactSpec: artifact.artifactSpec,
    specDigest: validation.specDigest,
    semanticValidation: validation,
    stages: {
      ...receipt.stages,
      spec: { status: 'passed', issues: [] },
      semantic: { status: 'passed', issues: [] },
    },
  };
});

await writeJson(catalogPath, catalog);
await writeJson(receiptsPath, refreshedReceipts);
console.log(
  `[artifact-atlas-v2] refreshed ${ATLAS_V2_ARTIFACTS.length} typed specs without rewriting renders`,
);

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
