/**
 * Disabled-model exclusion for the node-gym campaign (SPEC Part A section A.2.8, Codex v2-new-3).
 *
 * Situation: OpenRouter dropped `openai/gpt-oss-20b:free` from its catalog on 2026-10-10. Its row
 * must stay in the benchmark (run ids and pairing keys hash `model.id`, so deleting it renumbers the
 * whole matrix), yet a campaign must never try to run it. These tests load the COMMITTED config and
 * matrix and drive the real selection path the runner uses.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateNodeGymConfig } from '../lib/node-gym-config-core.mjs';
import { selectNodeGymCampaignRuns } from '../lib/node-gym-selection-core.mjs';

const DISABLED_MODEL = 'openai/gpt-oss-20b:free';
const config = JSON.parse(readFileSync('benchmarks/deck-gym/v2/gym.json', 'utf8'));
const matrix = JSON.parse(
  readFileSync('artifacts/node-gym/nodeslide-deck-gym-v2/matrix.json', 'utf8'),
);
// Naming every task explicitly skips runtime filtering of protected-fixture tasks, which depends on
// the machine's environment; the disabled-model partition under test does not.
const noFilters = {
  tasks: config.tasks.map((task) => task.id),
  models: [],
  harnesses: [],
  repetitions: [],
};
const select = (overrides = {}) =>
  selectNodeGymCampaignRuns({
    matrix,
    config,
    filters: noFilters,
    subset: 'all',
    runtime: {},
    ...overrides,
  });

describe('execution.disabled on the committed v2 gym', () => {
  it('keeps the row, so the matrix identity stays 720 runs', () => {
    expect(matrix.runs).toHaveLength(720);
    expect(matrix.runs.filter((run) => run.model.id === DISABLED_MODEL)).toHaveLength(120);
  });

  it('--subset all selects 600 runs and reports the 120 it skipped', () => {
    const { selectedRuns, skippedDisabled } = select();
    expect(selectedRuns).toHaveLength(600);
    expect(skippedDisabled).toHaveLength(120);
    expect(selectedRuns.some((run) => run.model.id === DISABLED_MODEL)).toBe(false);
    expect(skippedDisabled[0]).toMatchObject({
      modelId: DISABLED_MODEL,
      since: '2026-10-10',
      reason: expect.stringContaining('unlisted on OpenRouter'),
    });
  });

  it('--include-disabled is the only override and brings back all 720', () => {
    const { selectedRuns, skippedDisabled } = select({ includeDisabled: true });
    expect(selectedRuns).toHaveLength(720);
    expect(skippedDisabled).toHaveLength(0);
  });

  it('naming the disabled model without the override is an error, not an empty match', () => {
    expect(() => select({ filters: { ...noFilters, models: [DISABLED_MODEL] } })).toThrow(
      /disabled since 2026-10-10.*--include-disabled/u,
    );
  });
});

describe('validateNodeGymConfig accepts execution only as { disabled: true, since, reason }', () => {
  const withExecution = (execution) => {
    const copy = structuredClone(config);
    copy.models.find((model) => model.id === DISABLED_MODEL).execution = execution;
    return validateNodeGymConfig(copy).failures;
  };

  it('passes the committed config', () => {
    expect(validateNodeGymConfig(config).failures).toEqual([]);
  });

  it.each([
    ['disabled false', { disabled: false, since: '2026-10-10', reason: 'x' }],
    ['an extra key', { disabled: true, since: '2026-10-10', reason: 'x', note: 'y' }],
    ['a non-ISO date', { disabled: true, since: 'yesterday', reason: 'x' }],
    ['an empty reason', { disabled: true, since: '2026-10-10', reason: '  ' }],
    ['a non-object', true],
  ])('rejects %s', (_label, execution) => {
    expect(withExecution(execution).some((failure) => failure.includes('execution'))).toBe(true);
  });
});
