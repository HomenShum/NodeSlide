import { describe, expect, it } from 'vitest';
import {
  buildArtifactArenaMatrix,
  buildArtifactGallery,
  buildModelCompare,
  compareHarnessReceipts,
  createArtifactShowcaseReceipt,
  readArtifactAtlasConfig,
  validateArtifactAtlasConfig,
} from './lib/artifact-atlas-core.mjs';

describe('NodeSlide Artifact Atlas', () => {
  it('freezes twelve artifact fixtures across all eight categories', async () => {
    const { atlas, harness } = await readArtifactAtlasConfig(process.cwd());
    const validation = validateArtifactAtlasConfig(atlas, harness);
    expect(validation).toMatchObject({
      ok: true,
      fixtureCount: 12,
      artifactTypeCount: 12,
      categoryCount: 8,
      modelCount: 3,
      directionCount: 2,
      modelCandidateCount: 72,
      deterministicBaselineCount: 12,
      candidateCount: 84,
    });
  });

  it('builds equal-input model candidates plus one baseline per fixture', async () => {
    const { atlas, harness } = await readArtifactAtlasConfig(process.cwd());
    const matrix = buildArtifactArenaMatrix(atlas, harness);
    expect(matrix.candidateCount).toBe(84);
    expect(new Set(matrix.candidates.map((candidate) => candidate.candidateId)).size).toBe(84);
    const baseline = matrix.candidates.filter(
      (candidate) => candidate.candidateKind === 'deterministic-baseline',
    );
    expect(baseline).toHaveLength(12);

    const architecture = matrix.candidates.filter(
      (candidate) => candidate.fixtureId === 'system-architecture',
    );
    expect(architecture).toHaveLength(7);
    expect(new Set(architecture.map((candidate) => candidate.sourceDigest)).size).toBe(1);
    expect(new Set(architecture.map((candidate) => candidate.referenceDigest)).size).toBe(1);
    expect(new Set(architecture.map((candidate) => candidate.budgetDigest)).size).toBe(1);
    expect(new Set(architecture.map((candidate) => candidate.artifactRequirementDigest)).size).toBe(
      1,
    );
  });

  it('supports a bounded model-only pilot without silently adding a baseline', async () => {
    const { atlas, harness } = await readArtifactAtlasConfig(process.cwd());
    const matrix = buildArtifactArenaMatrix(atlas, harness, {
      fixtures: ['risk-matrix'],
      models: ['google/gemma-4-26b-a4b-it:free'],
      directions: ['expressive-technical'],
    });
    expect(matrix.candidateCount).toBe(1);
    expect(matrix.candidates[0]).toMatchObject({
      fixtureId: 'risk-matrix',
      model: 'google/gemma-4-26b-a4b-it:free',
      directionId: 'expressive-technical',
      candidateKind: 'model',
    });
  });

  it('fails a receipt closed when an output or artifact-type check is missing', async () => {
    const candidate = await fixtureCandidate('quality-cost-equation');
    const receipt = createArtifactShowcaseReceipt({
      candidate,
      evaluation: passingEvaluation({ artifactTypeMatched: false }),
      outputs: {
        browserRender: 'browser.png',
        pptxRender: 'pptx.png',
        pptxFile: null,
      },
      tools: ['katex', 'pptxgenjs'],
    });
    expect(receipt.status).toBe('failed');
    expect(receipt.outputs.pptxFile).toBeNull();
    expect(receipt.evaluation.artifactTypeMatched).toBe(false);
  });

  it('only exposes passing, rendered receipts in the gallery and model comparison', async () => {
    const { atlas } = await readArtifactAtlasConfig(process.cwd());
    const candidate = await fixtureCandidate('risk-matrix');
    const eligible = createArtifactShowcaseReceipt({
      candidate,
      evaluation: passingEvaluation(),
      outputs: {
        browserRender: 'risk-browser.png',
        pptxRender: 'risk-pptx.png',
        pptxFile: 'risk.pptx',
      },
      tools: ['risk-matrix-builder'],
    });
    const failed = createArtifactShowcaseReceipt({
      candidate: { ...candidate, candidateId: `${candidate.candidateId}-failed` },
      evaluation: passingEvaluation({ evidencePassed: false }),
      outputs: {
        browserRender: 'failed-browser.png',
        pptxRender: 'failed-pptx.png',
        pptxFile: 'failed.pptx',
      },
    });
    const gallery = buildArtifactGallery(atlas, [failed, eligible]);
    expect(gallery.readyCount).toBe(1);
    expect(gallery.entries.find((entry) => entry.fixtureId === 'risk-matrix')).toMatchObject({
      status: 'ready',
      winnerReceiptDigest: eligible.receiptDigest,
      eligibleReceiptDigests: [eligible.receiptDigest],
    });
    const comparison = buildModelCompare([failed, eligible], 'risk-matrix');
    expect(comparison.candidateCount).toBe(2);
  });

  it('pairs the same model and artifact across harness versions', async () => {
    const candidate = await fixtureCandidate('system-architecture');
    const previous = createArtifactShowcaseReceipt({
      candidate: { ...candidate, harnessVersion: 'artifact-arena-v1' },
      evaluation: passingEvaluation({ visualPassed: false, repairCount: 2, generationMs: 9000 }),
      outputs: { browserRender: 'a.png', pptxRender: 'a-pptx.png', pptxFile: 'a.pptx' },
    });
    const current = createArtifactShowcaseReceipt({
      candidate: { ...candidate, harnessVersion: 'artifact-arena-v2' },
      evaluation: passingEvaluation({ repairCount: 1, generationMs: 7000 }),
      outputs: { browserRender: 'b.png', pptxRender: 'b-pptx.png', pptxFile: 'b.pptx' },
    });
    const comparison = compareHarnessReceipts([previous], [current]);
    expect(comparison.pairedCandidateCount).toBe(1);
    expect(comparison.comparisons[0]).toMatchObject({
      previousHarnessVersion: 'artifact-arena-v1',
      currentHarnessVersion: 'artifact-arena-v2',
      statusChanged: true,
      repairCountDelta: -1,
      generationMsDelta: -2000,
      checkDeltas: { visualPassed: 1 },
    });
  });
});

async function fixtureCandidate(fixtureId) {
  const { atlas, harness } = await readArtifactAtlasConfig(process.cwd());
  return buildArtifactArenaMatrix(atlas, harness, {
    fixtures: [fixtureId],
    models: [harness.models[0].id],
    directions: [harness.directions[0].id],
  }).candidates[0];
}

function passingEvaluation(overrides = {}) {
  return {
    briefAdherence: true,
    visualPassed: true,
    evidencePassed: true,
    exportPassed: true,
    artifactTypeMatched: true,
    editabilityPassed: true,
    repairCount: 0,
    generationMs: 8000,
    inputTokens: 1000,
    outputTokens: 500,
    costMicroUsd: 1000,
    ...overrides,
  };
}
