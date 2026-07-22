#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const artifactRoot = path.resolve(
  option('artifact-root') ?? 'artifacts/deck-gym/artifact-atlas-v1',
);
const publicRoot = path.resolve(option('public-root') ?? 'public/artifact-atlas');
const receipts = JSON.parse(await readFile(path.join(artifactRoot, 'receipts.json'), 'utf8'));
const eligible = receipts.filter((receipt) => receipt.status === 'eligible');
const grouped = Map.groupBy(eligible, (receipt) => receipt.fixtureId);
const brackets = [];

for (const [fixtureId, fixtureReceipts] of grouped.entries()) {
  const representatives = representativeCandidates(fixtureReceipts);
  if (representatives.length < 4) continue;
  brackets.push({
    fixtureId,
    status: 'awaiting-human-preference',
    rounds: [
      pair(fixtureId, 'semifinal-1', representatives[0], representatives[1]),
      pair(fixtureId, 'semifinal-2', representatives[2], representatives[3]),
    ],
    final: null,
    winnerReceiptDigest: null,
    preferenceReasons: [],
  });
}

const tournament = {
  schemaVersion: 'nodeslide.artifact-blind-tournament/v1',
  generatedAt: new Date().toISOString(),
  fixtureCount: grouped.size,
  bracketCount: brackets.length,
  status: 'awaiting-human-preference',
  blind: true,
  allowedPreferenceReasons: [
    'clearer_story',
    'stronger_visual_hierarchy',
    'better_artifact_choice',
    'less_repetition',
    'better_evidence',
    'better_data_fidelity',
    'more_audience_appropriate',
    'more_editable',
    'better_export',
  ],
  brackets,
};
await writeJson(path.join(artifactRoot, 'tournament.json'), tournament);
await writeJson(path.join(publicRoot, 'tournament.json'), tournament);
console.log(
  `[artifact-tournament] wrote ${brackets.length} model-blind brackets; human decisions remain pending`,
);

function representativeCandidates(values) {
  const byModel = Map.groupBy(values, (receipt) => receipt.model);
  return [...byModel.values()]
    .map((modelReceipts) =>
      modelReceipts
        .toSorted(
          (left, right) =>
            Number(left.evaluation.repairCount) - Number(right.evaluation.repairCount) ||
            Number(left.evaluation.generationMs ?? Number.MAX_SAFE_INTEGER) -
              Number(right.evaluation.generationMs ?? Number.MAX_SAFE_INTEGER),
        )
        .at(0),
    )
    .filter(Boolean)
    .toSorted((left, right) => left.receiptDigest.localeCompare(right.receiptDigest));
}

function pair(fixtureId, round, left, right) {
  return {
    comparisonId: digest(`${fixtureId}:${round}:${left.receiptDigest}:${right.receiptDigest}`),
    left: blindCandidate('A', left),
    right: blindCandidate('B', right),
    selected: null,
    reason: null,
  };
}

function blindCandidate(label, receipt) {
  const blindId = receipt.receiptDigest.replace('sha256:', '');
  return {
    label,
    receiptDigest: receipt.receiptDigest,
    browserRender: `artifact-atlas/blind/${blindId}.png`,
    editability: receipt.editability,
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
