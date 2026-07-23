import { describe, expect, it } from 'vitest';
import { buildArtifactArenaMatrix, readArtifactAtlasConfig } from './lib/artifact-atlas-core.mjs';
import { buildArtifactArenaCoverage, scoreReceiptGates } from './lib/artifact-atlas-coverage.mjs';

async function config() {
  return readArtifactAtlasConfig(process.cwd());
}

describe('Arena coverage: a benchmark operator running a subset', () => {
  it('reports the full matrix with zero omissions on an unfiltered run', async () => {
    const { atlas, harness } = await config();
    const coverage = buildArtifactArenaCoverage(atlas, harness, {});
    // 12 fixtures × (2 directions × 3 models + 1 baseline) = 84.
    expect(coverage.fullMatrixCount).toBe(84);
    expect(coverage.plannedCount).toBe(84);
    expect(coverage.omitted).toHaveLength(0);
    expect(coverage.planComplete).toBe(true);
    expect(coverage.coverageRatio).toBe(1);
    // Planned is not run. With no receipts supplied nothing has completed, and saying otherwise
    // is how a 12-of-84 run once reported itself complete.
    expect(coverage.complete).toBe(false);
  });

  it('separates a complete PLAN from a complete RUN', async () => {
    const { atlas, harness } = await config();
    const planned = buildArtifactArenaCoverage(atlas, harness, {});
    const receipts = planned.plannedCount;
    const everyCell = buildArtifactArenaCoverage(
      atlas,
      harness,
      {},
      Array.from({ length: receipts }, (_, i) => ({
        candidateId: `candidate-${i}`,
        status: 'eligible',
      })),
    );
    // A run is only complete when the receipts account for the whole matrix.
    expect(everyCell.planComplete).toBe(true);
    expect(everyCell.complete).toBe(everyCell.completedCount === everyCell.fullMatrixCount);
  });

  it('accounts for every combination a fixture filter omits, with a typed reason', async () => {
    const { atlas, harness } = await config();
    const oneFixture = atlas.fixtures[0].id;
    const coverage = buildArtifactArenaCoverage(atlas, harness, { fixtures: [oneFixture] });
    // One fixture planned (1 baseline + 6 model candidates = 7); the other 11 fixtures omitted.
    expect(coverage.plannedCount).toBe(7);
    expect(coverage.omitted.length).toBe(84 - 7);
    expect(coverage.omitted.every((entry) => entry.reason === 'fixture_filter')).toBe(true);
    expect(coverage.complete).toBe(false);
  });

  it('drops the deterministic baseline when a model filter is active, and says so', async () => {
    const { atlas, harness } = await config();
    const oneModel = harness.models[0].id;
    const coverage = buildArtifactArenaCoverage(atlas, harness, { models: [oneModel] });
    // No baselines scheduled; each fixture keeps 2 directions × 1 model = 2 → 24 planned.
    expect(coverage.plannedCount).toBe(24);
    const baselineOmissions = coverage.omitted.filter(
      (entry) => entry.candidateKind === 'deterministic-baseline',
    );
    expect(baselineOmissions).toHaveLength(12);
    expect(baselineOmissions.every((entry) => entry.reason === 'not_scheduled')).toBe(true);
    const modelOmissions = coverage.omitted.filter((entry) => entry.reason === 'model_filter');
    expect(modelOmissions.length).toBeGreaterThan(0);
  });

  it('attributes a combination dropped by two filters to the first in a stable order', async () => {
    const { atlas, harness } = await config();
    const coverage = buildArtifactArenaCoverage(atlas, harness, {
      fixtures: [atlas.fixtures[0].id],
      models: [harness.models[0].id],
    });
    // A non-kept fixture's model candidates are attributed to fixture_filter, not model_filter.
    const other = coverage.omitted.filter(
      (entry) => entry.fixtureId !== atlas.fixtures[0].id && entry.candidateKind === 'model',
    );
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((entry) => entry.reason === 'fixture_filter')).toBe(true);
  });

  it('folds run receipts into completion accounting', async () => {
    const { atlas, harness } = await config();
    const receipts = [
      { candidateId: 'a', status: 'eligible' },
      { candidateId: 'b', status: 'eligible' },
      { candidateId: 'c', status: 'failed' },
    ];
    const coverage = buildArtifactArenaCoverage(atlas, harness, {}, receipts);
    expect(coverage.attemptedCount).toBe(3);
    expect(coverage.completedCount).toBe(2);
    expect(coverage.failed).toHaveLength(1);
    expect(coverage.complete).toBe(false);
  });

  it('exposes the matrix coverage field directly on buildArtifactArenaMatrix', async () => {
    const { atlas, harness } = await config();
    const matrix = buildArtifactArenaMatrix(atlas, harness, {});
    expect(matrix.coverage.fullMatrixCount).toBe(84);
    expect(matrix.coverage.plannedCount).toBe(matrix.candidateCount);
  });
});

describe('Gate scoring: an unrun gate is never a pass and never a fail', () => {
  it('scores an all-passing evaluation as fully evaluated', () => {
    const score = scoreReceiptGates({
      briefAdherence: true,
      visualPassed: true,
      evidencePassed: true,
      exportPassed: true,
      artifactTypeMatched: true,
      editabilityPassed: true,
    });
    expect(score.passRate).toBe(1);
    expect(score.evaluated).toBe(6);
    expect(score.notRun).toBe(0);
    expect(score.complete).toBe(true);
  });

  it('records a null gate as not-run, excluded from the pass rate', () => {
    const score = scoreReceiptGates({
      briefAdherence: true,
      visualPassed: true,
      evidencePassed: null,
      exportPassed: undefined,
      artifactTypeMatched: true,
      editabilityPassed: true,
    });
    expect(score.states.evidencePassed).toBe('not-run');
    expect(score.states.exportPassed).toBe('not-run');
    expect(score.evaluated).toBe(4);
    expect(score.passRate).toBe(1); // 4 of 4 evaluated passed; the 2 unrun are not counted
    expect(score.complete).toBe(false);
  });

  it('distinguishes a failed gate from an unrun one', () => {
    const score = scoreReceiptGates({
      briefAdherence: false,
      visualPassed: null,
    });
    expect(score.states.briefAdherence).toBe('fail');
    expect(score.states.visualPassed).toBe('not-run');
    expect(score.passed).toBe(0);
    expect(score.evaluated).toBe(1); // only briefAdherence ran
  });

  it('reports no score at all when nothing was evaluated', () => {
    const score = scoreReceiptGates({});
    expect(score.passRate).toBeNull();
    expect(score.evaluated).toBe(0);
    expect(score.notRun).toBe(6);
  });

  it('treats a missing evaluation object as everything unrun', () => {
    const score = scoreReceiptGates(undefined);
    expect(score.evaluated).toBe(0);
    expect(score.passRate).toBeNull();
  });
});
