#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ATLAS_V2_ARTIFACTS } from './lib/artifact-atlas-v2-definition.mjs';
import {
  buildAtlasV3BlindReviewManifest,
  buildAtlasV3EvidenceCandidate,
} from './lib/artifact-atlas-v3-core.mjs';
import { digestJson } from './lib/node-gym-runner-core.mjs';

const root = process.cwd();
const catalogPath = path.resolve(option('catalog') ?? 'public/artifact-atlas-v2/catalog.json');
const inspectionPath = path.resolve(
  option('inspection') ?? 'docs/demo/nodeslide-artifact-semantics-v3/visual-inspection.json',
);
const sourceAtlasPptxPath = path.resolve(
  option('atlas-pptx') ?? 'outputs/artifact-atlas-v2/nodeslide-artifact-atlas-v2.pptx',
);
const campaignsRoot = path.resolve(
  option('campaigns') ?? 'artifacts/node-gym/nodeslide-deck-gym-v2/campaigns',
);
const matrixPath = path.resolve(
  option('matrix') ?? 'artifacts/node-gym/nodeslide-deck-gym-v2/matrix.json',
);
const outputRoot = path.resolve(option('out') ?? 'outputs/artifact-atlas-v3');
const catalog = await readJson(catalogPath);
const visualInspection = await readJson(inspectionPath);
const matrix = await readJson(matrixPath);
const activeMatrixDigest = digestJson(matrix);
const campaigns = await readCampaigns(campaignsRoot);
const sourceAtlasPptxDigest = await sha256File(sourceAtlasPptxPath);
const { candidate, lineage } = buildAtlasV3EvidenceCandidate({
  artifacts: ATLAS_V2_ARTIFACTS,
  catalog,
  visualInspection,
  sourceAtlasPptxPath: relative(sourceAtlasPptxPath),
  sourceAtlasPptxDigest,
  expectedMatrixSize: Number(matrix.runCount ?? matrix.runs?.length ?? 0),
  activeMatrixRuns: matrix.runs,
  activeConfigDigest: matrix.configDigest,
  activeMatrixDigest,
  campaigns,
  humanPreference: { status: 'not_run' },
});
const blindReview = buildAtlasV3BlindReviewManifest(candidate.campaigns);
await mkdir(outputRoot, { recursive: true });
await writeJson(path.join(outputRoot, 'atlas-v3-evidence-candidate.json'), {
  ...candidate,
  generatedAt: new Date().toISOString(),
});
await writeJson(path.join(outputRoot, 'artifact-lineage.json'), {
  schemaVersion: 'nodeslide.artifact-atlas-v3-lineage/v1',
  artifactCount: lineage.length,
  sourceAtlasPptxDigest,
  lineage,
});
await writeJson(path.join(outputRoot, 'campaign-ledger.json'), {
  schemaVersion: 'nodeslide.artifact-atlas-v3-campaign-ledger/v1',
  campaigns: candidate.campaigns,
});
await writeJson(path.join(outputRoot, 'blind-review', 'manifest.json'), blindReview);
console.log(
  `[artifact-atlas-v3] candidate built: artifacts=${candidate.canonicalArtifactCount}; campaigns=${candidate.campaignCount}; release=${candidate.publicReleaseApproved}`,
);
console.log(
  `[artifact-atlas-v3] ${relative(path.join(outputRoot, 'atlas-v3-evidence-candidate.json'))}`,
);

async function readCampaigns(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const campaigns = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const campaignDir = path.join(directory, entry.name);
    const plan = await readJson(path.join(campaignDir, 'campaign-plan.json')).catch(() => null);
    const summary = await readJson(path.join(campaignDir, 'summary.json')).catch(() => null);
    const pairedDeltaReport = await readJson(
      path.join(campaignDir, 'paired-delta-report.json'),
    ).catch(() => null);
    if (!plan || !summary) continue;
    const receipts = [];
    const runPlans = [];
    const runDirectories = {};
    const runsDir = path.join(campaignDir, 'runs');
    const runEntries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
    for (const runEntry of runEntries) {
      if (!runEntry.isDirectory()) continue;
      const receipt = await readJson(path.join(runsDir, runEntry.name, 'latest.json')).catch(
        () => null,
      );
      const runPlan = await readJson(path.join(runsDir, runEntry.name, 'plan.json')).catch(
        () => null,
      );
      if (receipt) receipts.push(receipt);
      if (runPlan) runPlans.push(runPlan);
      runDirectories[runEntry.name] = relative(path.join(runsDir, runEntry.name));
    }
    campaigns.push({
      plan,
      summary,
      pairedDeltaReport,
      campaignPath: relative(campaignDir),
      runDirectories,
      receipts: receipts.sort((a, b) => a.runId.localeCompare(b.runId)),
      runPlans: runPlans.sort((a, b) => a.runId.localeCompare(b.runId)),
    });
  }
  return campaigns.sort((a, b) => a.plan.campaignId.localeCompare(b.plan.campaignId));
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function sha256File(filePath) {
  const details = await stat(filePath);
  if (!details.isFile() || details.size === 0)
    throw new Error(`Atlas source is missing: ${filePath}`);
  return `sha256:${createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex')}`;
}
