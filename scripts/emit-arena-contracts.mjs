/**
 * Emit the canonical Arena contract projection.
 *
 * nodeslide owns the Arena contract family; parity-studio consumes a generated projection rather
 * than minting a second schema (Arena reconciliation council, 2026-07-22). This is the producer
 * side of that pattern — the same shape as parity's MCP atlas.json generation, but flowing the
 * other direction (nodeslide -> parity, because nodeslide is the live repo).
 *
 * Writes contracts/arena-contracts.json: the schema ids nodeslide owns, the gate list and
 * omission-reason enums a consumer needs, and a meta block binding the projection to its source
 * commit and a content hash. Run after any change to artifact-atlas-core.mjs / -coverage.mjs.
 *
 * Usage: node scripts/emit-arena-contracts.mjs [--check]
 *   --check  exit 1 if the on-disk projection differs from what would be emitted (CI drift gate)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACT_ARENA_CANDIDATE_SCHEMA_VERSION,
  ARTIFACT_ARENA_HARNESS_SCHEMA_VERSION,
  ARTIFACT_ATLAS_SCHEMA_VERSION,
  ARTIFACT_SHOWCASE_RECEIPT_SCHEMA_VERSION,
} from './lib/artifact-atlas-core.mjs';
import {
  ARENA_OMISSION_REASONS,
  ARTIFACT_ARENA_COVERAGE_SCHEMA_VERSION,
  ARTIFACT_RECEIPT_GATES,
} from './lib/artifact-atlas-coverage.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(rootDirectory, 'contracts', 'arena-contracts.json');

function sourceCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDirectory }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function buildProjection() {
  // The body is everything a consumer relies on; meta.sha256 hashes exactly this, so a consumer
  // can verify the projection was not edited by hand after generation.
  const body = {
    schemaVersion: 'nodeslide.contract-projection/v1',
    sourceRepository: 'nodeslide',
    schemaIds: [
      ARTIFACT_ATLAS_SCHEMA_VERSION,
      ARTIFACT_ARENA_HARNESS_SCHEMA_VERSION,
      ARTIFACT_ARENA_CANDIDATE_SCHEMA_VERSION,
      'nodeslide.artifact-arena-matrix/v1',
      ARTIFACT_SHOWCASE_RECEIPT_SCHEMA_VERSION,
      'nodeslide.model-compare/v1',
      'nodeslide.harness-compare/v1',
      'nodeslide.artifact-gallery/v1',
      ARTIFACT_ARENA_COVERAGE_SCHEMA_VERSION,
    ],
    receiptGates: ARTIFACT_RECEIPT_GATES,
    arenaOmissionReasons: ARENA_OMISSION_REASONS,
    gateStates: ['pass', 'fail', 'not-run'],
    receiptStatuses: ['eligible', 'failed'],
    crossAxisPolicy: {
      // parity must not reintroduce a `confounded` verdict; cross-axis comparison throws.
      representable: false,
      errorName: 'InvalidArenaComparisonError',
      codes: ['cross_axis_comparison', 'no_harness_change'],
    },
    sourceFiles: ['scripts/lib/artifact-atlas-core.mjs', 'scripts/lib/artifact-atlas-coverage.mjs'],
  };
  const sha256 = `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
  return {
    ...body,
    meta: { sourceCommit: sourceCommit(), sha256 },
  };
}

function stableStringify(projection) {
  // Drop meta.sourceCommit from the drift comparison so a rebuild on a new commit is not a false
  // drift; the sha256 over the body is what must match.
  const { meta, ...rest } = projection;
  return JSON.stringify({ ...rest, meta: { sha256: meta.sha256 } }, null, 2);
}

async function main() {
  const check = process.argv.includes('--check');
  const projection = buildProjection();
  const serialized = `${JSON.stringify(projection, null, 2)}\n`;

  if (check) {
    let existing = null;
    try {
      existing = await readFile(outputPath, 'utf8');
    } catch {
      process.stderr.write(
        'Arena contract projection is missing. Run: node scripts/emit-arena-contracts.mjs\n',
      );
      process.exit(1);
    }
    if (stableStringify(JSON.parse(existing)) !== stableStringify(projection)) {
      process.stderr.write(
        'Arena contract projection is stale. Regenerate: node scripts/emit-arena-contracts.mjs\n',
      );
      process.exit(1);
    }
    process.stdout.write('Arena contract projection is up to date.\n');
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, 'utf8');
  process.stdout.write(
    `Wrote ${path.relative(rootDirectory, outputPath)} (${projection.schemaIds.length} schema ids).\n`,
  );
}

await main();
