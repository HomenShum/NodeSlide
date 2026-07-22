#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const artifactRoot = path.resolve(
  option('artifact-root') ?? 'artifacts/deck-gym/artifact-atlas-v1',
);
const publicRoot = path.resolve(option('public-root') ?? 'public/artifact-atlas');
const receipts = JSON.parse(await readFile(path.join(artifactRoot, 'receipts.json'), 'utf8'));
const atlas = JSON.parse(await readFile('benchmarks/artifact-atlas/v1/atlas.json', 'utf8'));
const grouped = Map.groupBy(receipts, (receipt) => receipt.fixtureId);
const winners = [];
const candidateEvidence = [];

await mkdir(publicRoot, { recursive: true });
const candidateRoot = path.join(publicRoot, 'candidates');
await mkdir(candidateRoot, { recursive: true });
const blindRoot = path.join(publicRoot, 'blind');
await mkdir(blindRoot, { recursive: true });
for (const receipt of receipts.filter(
  (entry) => entry.outputs?.browserRender && entry.outputs?.pptxRender,
)) {
  await copyFile(
    path.join(artifactRoot, receipt.outputs.browserRender),
    path.join(candidateRoot, `${receipt.candidateId}.png`),
  );
  if (receipt.status === 'eligible') {
    const blindId = receipt.receiptDigest.replace('sha256:', '');
    await copyFile(
      path.join(artifactRoot, receipt.outputs.browserRender),
      path.join(blindRoot, `${blindId}.png`),
    );
  }
  await copyFile(
    path.join(artifactRoot, receipt.outputs.pptxRender),
    path.join(candidateRoot, `${receipt.candidateId}-pptx.png`),
  );
  const result = JSON.parse(
    await readFile(path.join(artifactRoot, 'plan-results', `${receipt.candidateId}.json`), 'utf8'),
  );
  candidateEvidence.push({
    candidateId: receipt.candidateId,
    fixtureId: receipt.fixtureId,
    model: receipt.model,
    directionId: receipt.directionId,
    status: receipt.status,
    evaluation: receipt.evaluation,
    operations: result.plan?.operations ?? [],
    receiptDigest: receipt.receiptDigest,
  });
}
for (const [index, fixture] of atlas.fixtures.entries()) {
  const eligible = (grouped.get(fixture.id) ?? [])
    .filter((receipt) => receipt.status === 'eligible')
    .sort((left, right) => rank(left, index) - rank(right, index));
  const winner = eligible[0];
  if (!winner) continue;
  const previewName = `${fixture.id}.png`;
  await copyFile(
    path.join(artifactRoot, winner.outputs.browserRender),
    path.join(publicRoot, previewName),
  );
  winners.push({
    fixtureId: fixture.id,
    artifactType: fixture.artifactType,
    candidateId: winner.candidateId,
    model: winner.model,
    directionId: winner.directionId,
    browserRender: `artifact-atlas/${previewName}`,
    pptxFile: winner.outputs.pptxFile,
    receiptDigest: winner.receiptDigest,
    selection: 'machine-provisional',
    humanPreference: 'pending',
  });
}

const catalog = {
  schemaVersion: 'nodeslide.artifact-arena-curation/v1',
  generatedAt: new Date().toISOString(),
  eligibleFixtureCount: winners.length,
  fixtureCount: atlas.fixtures.length,
  publicReleaseApproved: false,
  candidatePreviewCount: receipts.filter((entry) => entry.status === 'eligible').length,
  candidates: candidateEvidence,
  selectionPolicy:
    'Eligibility first; coverage-balance the three live models; alternate visual direction; then latency. Human model-blind preference remains required.',
  winners,
};
await writeJson(path.join(artifactRoot, 'curation.json'), catalog);
await writeJson(path.join(publicRoot, 'catalog.json'), catalog);
console.log(
  `[artifact-curation] ${winners.length}/${atlas.fixtures.length} provisional winners published to the local gallery`,
);
if (winners.length !== atlas.fixtures.length) process.exitCode = 1;

function rank(receipt, index) {
  const desiredDirection = index % 2 ? 'expressive-technical' : 'evidence-editorial';
  const desiredModel = [
    'anthropic/claude-sonnet-5',
    'moonshotai/kimi-k3',
    'google/gemma-4-26b-a4b-it:free',
  ][index % 3];
  const baselinePenalty = receipt.candidateKind === 'deterministic-baseline' ? 1_000_000 : 0;
  const modelCoveragePenalty = receipt.model === desiredModel ? 0 : 200_000;
  const directionPenalty = receipt.directionId === desiredDirection ? 0 : 100_000;
  const coveragePenalty = (1 - Number(receipt.claimCoverage ?? 0)) * 10_000;
  return (
    baselinePenalty +
    modelCoveragePenalty +
    directionPenalty +
    coveragePenalty +
    Number(receipt.evaluation.generationMs ?? 99_999)
  );
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
