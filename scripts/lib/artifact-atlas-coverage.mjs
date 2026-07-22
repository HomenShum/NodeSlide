/**
 * Arena coverage accounting and honest gate scoring.
 *
 * Ported from parity-studio shared/nodeslideArena.ts per docs/NODESLIDE_ARENA_RECONCILIATION.md
 * (two-thread council, 2026-07-22). Two load-bearing honesty fixes the arena core lacked:
 *
 *  1. Coverage-drop accounting. buildArtifactArenaMatrix reports the emitted candidate count but
 *     not what the filters omitted from the full matrix, so "9/9 completed" can be true and
 *     experimentally misleading. This records every omitted combination with a typed reason.
 *
 *  2. Honest gate scoring. createArtifactShowcaseReceipt coerces each gate to a boolean
 *     (`x === true`), so an UNRUN gate becomes false — scored identically to a FAILED gate. A gate
 *     that never ran must be `not-run`, never counted as a pass and never as a fail.
 *
 * This module is additive. It does not change the existing receipt booleans that four scripts
 * already read; it computes new views over the same data.
 */

export const ARTIFACT_ARENA_COVERAGE_SCHEMA_VERSION = 'nodeslide.artifact-arena-coverage/v1';

/** The gates every showcase receipt is scored on. Kept in sync with createArtifactShowcaseReceipt. */
export const ARTIFACT_RECEIPT_GATES = Object.freeze([
  'briefAdherence',
  'visualPassed',
  'evidencePassed',
  'exportPassed',
  'artifactTypeMatched',
  'editabilityPassed',
]);

/** Why a full-matrix combination was not planned or did not complete. */
export const ARENA_OMISSION_REASONS = Object.freeze([
  'fixture_filter',
  'model_filter',
  'direction_filter',
  'budget_limit',
  'unsupported_capability',
  'not_scheduled',
]);

function toSet(values) {
  return new Set(Array.isArray(values) ? values : []);
}

/**
 * Compute coverage of the full fixture × direction × model matrix (plus deterministic baselines)
 * under a set of filters. `receipts`, when supplied, adds run-time completion accounting.
 *
 * The full matrix is defined the same way buildArtifactArenaMatrix builds it: for each fixture,
 * one deterministic baseline plus every direction × model. Filters drop fixtures, models or
 * directions; the baseline is only scheduled when neither a model nor a direction filter is set.
 */
export function buildArtifactArenaCoverage(atlas, harness, filters = {}, receipts = null) {
  const fixtureFilter = toSet(filters.fixtures);
  const modelFilter = toSet(filters.models);
  const directionFilter = toSet(filters.directions);
  const filtersActive = modelFilter.size > 0 || directionFilter.size > 0;

  const fixtures = atlas.fixtures ?? [];
  const models = harness.models ?? [];
  const directions = harness.directions ?? [];

  const planned = [];
  const omitted = [];

  const combo = (fixtureId, modelId, directionId, candidateKind) => ({
    fixtureId,
    modelId,
    directionId,
    candidateKind,
  });

  for (const fixture of fixtures) {
    const fixtureKept = !fixtureFilter.size || fixtureFilter.has(fixture.id);

    // Deterministic baseline: one per fixture, only when no model/direction filter is active.
    const baseline = combo(
      fixture.id,
      harness.deterministicBaseline?.id ?? 'deterministic-baseline',
      'deterministic-baseline',
      'deterministic-baseline',
    );
    if (fixtureKept && !filtersActive) planned.push(baseline);
    else if (!fixtureKept) omitted.push({ ...baseline, reason: 'fixture_filter' });
    else omitted.push({ ...baseline, reason: 'not_scheduled' });

    for (const direction of directions) {
      const directionKept = !directionFilter.size || directionFilter.has(direction.id);
      for (const model of models) {
        const modelKept = !modelFilter.size || modelFilter.has(model.id);
        const entry = combo(fixture.id, model.id, direction.id, 'model');
        if (fixtureKept && directionKept && modelKept) {
          planned.push(entry);
          continue;
        }
        // Report the first filter that excluded this combination, checked in a stable order so a
        // combination dropped by two filters is attributed deterministically.
        const reason = !fixtureKept
          ? 'fixture_filter'
          : !directionKept
            ? 'direction_filter'
            : 'model_filter';
        omitted.push({ ...entry, reason });
      }
    }
  }

  const fullMatrixCount = planned.length + omitted.length;
  const plannedCount = planned.length;

  let attemptedCount = null;
  let completedCount = null;
  const failed = [];
  if (Array.isArray(receipts)) {
    attemptedCount = receipts.length;
    completedCount = receipts.filter((receipt) => receipt?.status === 'eligible').length;
    for (const receipt of receipts) {
      if (receipt?.status !== 'eligible') {
        failed.push({
          candidateId: receipt?.candidateId ?? 'unknown',
          reason: receipt?.status === 'failed' ? 'not_scheduled' : (receipt?.status ?? 'unknown'),
        });
      }
    }
  }

  // Coverage is the fraction of the FULL matrix that actually completed. When receipts are not
  // supplied it falls back to planned/full, which still exposes filter-driven omission.
  const numerator = completedCount ?? plannedCount;
  const coverageRatio = fullMatrixCount === 0 ? 0 : numerator / fullMatrixCount;

  return {
    schemaVersion: ARTIFACT_ARENA_COVERAGE_SCHEMA_VERSION,
    fullMatrixCount,
    plannedCount,
    attemptedCount,
    completedCount,
    omitted,
    failed,
    coverageRatio,
    complete: omitted.length === 0 && failed.length === 0,
  };
}

/**
 * Score one receipt's gates as a tri-state, never crediting or penalising a gate that did not run.
 *
 * A gate is `not-run` when its value is null or undefined; `pass` when strictly true; `fail`
 * otherwise. `passRate` is over EVALUATED gates only, and is null when nothing was evaluated —
 * there is no score to report, so none is invented.
 */
export function scoreReceiptGates(evaluation) {
  const states = {};
  let passed = 0;
  let evaluated = 0;
  let notRun = 0;
  for (const gate of ARTIFACT_RECEIPT_GATES) {
    const value = evaluation?.[gate];
    if (value === null || value === undefined) {
      states[gate] = 'not-run';
      notRun += 1;
      continue;
    }
    evaluated += 1;
    if (value === true) {
      states[gate] = 'pass';
      passed += 1;
    } else {
      states[gate] = 'fail';
    }
  }
  return {
    states,
    passed,
    evaluated,
    notRun,
    passRate: evaluated === 0 ? null : passed / evaluated,
    complete: notRun === 0,
  };
}
