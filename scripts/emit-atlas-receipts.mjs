/**
 * Emit the Atlas showcase-receipt projection.
 *
 * parity-studio's Atlas contract layer has an `earnedAtlasMaturity` ladder that had never scored a
 * single real receipt: its registry held archetypes and source policies but zero recipes and zero
 * receipts, so the maturity gate was a contract with nothing to grade. Meanwhile this repo already
 * holds 84 committed receipts from the 2026-07-22 arena run — 72 model candidates with paid
 * telemetry and 12 deterministic baselines.
 *
 * The gap was never a missing run. It was a missing projection, and it closes with zero model
 * calls. This is the producer side, following the same nodeslide -> parity flow as
 * emit-arena-contracts.mjs: nodeslide owns the data, parity consumes a generated file rather than
 * minting a second schema.
 *
 * What this deliberately does NOT do: invent a maturity. Every recipe is emitted with the receipts
 * it owns and nothing else. parity computes the maturity from those receipts with its own ladder,
 * so a claim can still disagree with what the evidence earns — which is the entire point of having
 * the ladder.
 *
 * Usage: node scripts/emit-atlas-receipts.mjs [--check]
 *   --check  exit 1 if the on-disk projection differs from what would be emitted (CI drift gate)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPE_BY_ARTIFACT_TYPE } from './build-atlas-v3-native.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receiptsPath = path.join(rootDirectory, 'artifacts/deck-gym/artifact-atlas-v1/receipts.json');
const outputPath = path.join(rootDirectory, 'contracts/atlas-receipts.json');

/**
 * The arena's 12 fixtures predate the v2 deck's 38 and use their own names, so
 * ARCHETYPE_BY_ARTIFACT_TYPE (keyed on deck vocabulary) covers only half the receipts. These are
 * the remaining six, mapped by what the fixture actually produces. Kept here rather than merged
 * into the deck's map: that map answers "what does this SLIDE compile to", and conflating the two
 * vocabularies is how a wrong archetype would silently grade the wrong receipts.
 */
const ARCHETYPE_BY_ARENA_FIXTURE = {
  'architecture-diagram': 'systems.architecture',
  'sequence-diagram': 'systems.sequence',
  'multi-series-chart': 'data.multi-series',
  'katex-equation': 'technical.equation',
  'screenshot-callouts': 'product-evidence.screenshot-callouts',
  timeline: 'progression.timeline',
};

const archetypeFor = (artifactType) =>
  ARCHETYPE_BY_ARTIFACT_TYPE[artifactType] ?? ARCHETYPE_BY_ARENA_FIXTURE[artifactType] ?? null;

const PROJECTION_VERSION = 'nodeslide.atlas-receipt-projection/v1';
const RECEIPT_SCHEMA = 'nodeslide.atlas-showcase-receipt/v1';
const ATLAS_SCHEMA = 'nodeslide.atlas/v1';

/** Sorted-key stringify so the drift check compares content, not key order. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sourceCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: rootDirectory,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Translate one arena receipt into the shape parity's contract declares.
 *
 * `candidateKind` passes through untouched and carries the weight here: parity's ladder refuses to
 * award `proven` to a deterministic baseline, because a baseline is this repo's own compiler
 * replaying the fixture the gates were written against.
 */
function projectReceipt(receipt, recipeId) {
  const evaluation = receipt.evaluation ?? {};
  const outputs = receipt.outputs ?? {};
  return {
    schemaVersion: RECEIPT_SCHEMA,
    id: receipt.candidateId,
    recipeId,
    recipeVersion: receipt.harnessVersion ?? 'artifact-arena-v1',
    archetypeId: archetypeFor(receipt.artifactType),
    model: { id: receipt.model, role: receipt.modelRole ?? 'unknown' },
    candidateKind: receipt.candidateKind,
    harnessVersion: receipt.harnessVersion ?? 'artifact-arena-v1',
    sourceIds: receipt.sourceIds ?? [],
    referenceIds: receipt.referenceIds ?? [],
    editability: receipt.editability ?? { web: 'unsupported', pptx: 'unsupported' },
    evaluation: {
      briefAdherence: evaluation.briefAdherence ?? null,
      visualPassed: evaluation.visualPassed ?? null,
      evidencePassed: evaluation.evidencePassed ?? null,
      exportPassed: evaluation.exportPassed ?? null,
      repairCount: evaluation.repairCount ?? 0,
    },
    outputs: {
      browserRenderRef: outputs.browserRender ?? '',
      pptxRenderRef: outputs.pptxRender ?? '',
      pptxFileRef: outputs.pptxFile ?? '',
    },
    costUsd: (evaluation.costMicroUsd ?? 0) / 1_000_000,
    latencyMs: evaluation.generationMs ?? 0,
    // Never invented. `certified` requires a human blind review that has not happened, and
    // defaulting this to `true` is the single cheapest way to fake the top of the ladder.
    humanPreferred: null,
    producedAt: Date.parse(receipt.generatedAt ?? '') || 0,
    status: receipt.status ?? 'unknown',
  };
}

async function buildProjection() {
  const raw = JSON.parse(await readFile(receiptsPath, 'utf8'));
  const all = Array.isArray(raw) ? raw : (raw.receipts ?? []);

  const byArtifactType = new Map();
  for (const receipt of all) {
    if (!byArtifactType.has(receipt.artifactType)) byArtifactType.set(receipt.artifactType, []);
    byArtifactType.get(receipt.artifactType).push(receipt);
  }

  const recipes = [];
  const receipts = [];
  const unmapped = [];
  for (const [artifactType, group] of [...byArtifactType].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const archetypeId = archetypeFor(artifactType);
    if (!archetypeId) {
      // An artifactType with no archetype cannot be graded, and silently dropping it would make
      // the projection look more complete than it is.
      unmapped.push(artifactType);
      continue;
    }
    const recipeId = `nodeslide.arena.${artifactType}`;
    const owned = group.map((receipt) => projectReceipt(receipt, recipeId));
    receipts.push(...owned);
    recipes.push({
      schemaVersion: ATLAS_SCHEMA,
      id: recipeId,
      artifactType,
      archetypeId,
      narrativeJob: group[0].narrativeJob ?? '',
      receiptIds: owned.map((receipt) => receipt.id),
      modelReceiptCount: owned.filter((receipt) => receipt.candidateKind === 'model').length,
      baselineReceiptCount: owned.filter(
        (receipt) => receipt.candidateKind === 'deterministic-baseline',
      ).length,
      // No `maturity` field on purpose: parity derives it from these receipts. A maturity written
      // here would be a claim travelling alongside its own evidence, which is what the ladder is
      // supposed to be able to contradict.
    });
  }

  return {
    schemaVersion: PROJECTION_VERSION,
    sourceRepository: 'nodeslide',
    receiptSchema: RECEIPT_SCHEMA,
    runId: 'artifact-atlas-v1',
    totals: {
      receipts: receipts.length,
      recipes: recipes.length,
      modelReceipts: receipts.filter((receipt) => receipt.candidateKind === 'model').length,
      baselineReceipts: receipts.filter(
        (receipt) => receipt.candidateKind === 'deterministic-baseline',
      ).length,
      unmappedArtifactTypes: unmapped.sort(),
    },
    recipes,
    receipts,
    meta: {
      sourceFile: path.relative(rootDirectory, receiptsPath).replace(/\\/g, '/'),
      sourceCommit: sourceCommit(),
    },
  };
}

async function main() {
  const projection = await buildProjection();
  // Hash the body, then attach — so the digest covers the data and not itself.
  projection.meta.sha256 = `sha256:${createHash('sha256')
    .update(stableStringify({ ...projection, meta: { ...projection.meta, sha256: undefined } }))
    .digest('hex')}`;
  const serialized = `${JSON.stringify(projection, null, 2)}\n`;

  if (process.argv.includes('--check')) {
    let existing = null;
    try {
      existing = await readFile(outputPath, 'utf8');
    } catch {
      process.stderr.write(
        'Atlas receipt projection is missing. Run: node scripts/emit-atlas-receipts.mjs\n',
      );
      process.exit(1);
    }
    if (stableStringify(JSON.parse(existing)) !== stableStringify(projection)) {
      process.stderr.write(
        'Atlas receipt projection is stale. Regenerate: node scripts/emit-atlas-receipts.mjs\n',
      );
      process.exit(1);
    }
    process.stdout.write('Atlas receipt projection is up to date.\n');
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, 'utf8');
  const { totals } = projection;
  const ungraded =
    totals.unmappedArtifactTypes.length > 0
      ? `\n  ungraded artifactTypes (no archetype mapping): ${totals.unmappedArtifactTypes.join(', ')}`
      : '';
  process.stdout.write(
    `Wrote ${path.relative(rootDirectory, outputPath)}: ${totals.receipts} receipts (${totals.modelReceipts} model, ${totals.baselineReceipts} baseline) across ${totals.recipes} recipes.${ungraded}\n`,
  );
}

await main();
