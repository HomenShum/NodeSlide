import { describe, expect, it } from 'vitest';
import {
  InvalidArenaComparisonError,
  assertHarnessComparable,
  compareHarnessReceipts,
} from './lib/artifact-atlas-core.mjs';

/**
 * Negative conformance for cross-axis attribution (Arena reconciliation council, 2026-07-22).
 * The canonical harness comparison must NOT be able to produce a harness-winner or model-winner
 * from a pair that changed both model and harness. There is no `confounded` result category —
 * the comparison is simply unrepresentable.
 */

function receipt(overrides = {}) {
  return {
    candidateId: 'fixture-01__editorial__model-a',
    artifactType: 'system-architecture',
    directionId: 'editorial',
    candidateKind: 'model',
    model: 'model-a',
    harnessVersion: 'harness/v4',
    status: 'eligible',
    evaluation: { repairCount: 2 },
    ...overrides,
  };
}

describe('Cross-axis attribution is unrepresentable, not a verdict', () => {
  it('never pairs receipts that changed both model and harness', () => {
    const previous = [receipt({ model: 'model-a', harnessVersion: 'harness/v4' })];
    const current = [receipt({ model: 'model-b', harnessVersion: 'harness/v5' })];
    const result = compareHarnessReceipts(previous, current);
    // Different model → different comparisonKey → no pair → no winner can be attributed.
    expect(result.pairedCandidateCount).toBe(0);
    expect(result.comparisons).toHaveLength(0);
  });

  it('pairs a genuine harness change on the same model', () => {
    const previous = [receipt({ model: 'model-a', harnessVersion: 'harness/v4' })];
    const current = [receipt({ model: 'model-a', harnessVersion: 'harness/v5' })];
    const result = compareHarnessReceipts(previous, current);
    expect(result.pairedCandidateCount).toBe(1);
    expect(result.comparisons[0].previousHarnessVersion).toBe('harness/v4');
    expect(result.comparisons[0].currentHarnessVersion).toBe('harness/v5');
  });

  it('emits no result object claiming a confounded verdict', () => {
    const result = compareHarnessReceipts(
      [receipt({ model: 'model-a', harnessVersion: 'harness/v4' })],
      [receipt({ model: 'model-b', harnessVersion: 'harness/v5' })],
    );
    expect(JSON.stringify(result)).not.toMatch(/confounded/i);
    for (const comparison of result.comparisons) {
      expect(comparison).not.toHaveProperty('verdict');
    }
  });
});

describe('assertHarnessComparable guard', () => {
  it('throws cross_axis_comparison when the model also changed', () => {
    const attempt = () =>
      assertHarnessComparable(
        receipt({ model: 'model-a', harnessVersion: 'harness/v4' }),
        receipt({ model: 'model-b', harnessVersion: 'harness/v5' }),
      );
    expect(attempt).toThrow(InvalidArenaComparisonError);
    try {
      attempt();
    } catch (error) {
      expect(error.code).toBe('cross_axis_comparison');
      expect(error.message).toMatch(/confounded/i); // only in the message, never stored
    }
  });

  it('throws no_harness_change when both receipts are the same harness', () => {
    const attempt = () =>
      assertHarnessComparable(
        receipt({ model: 'model-a', harnessVersion: 'harness/v5' }),
        receipt({ model: 'model-a', harnessVersion: 'harness/v5' }),
      );
    expect(attempt).toThrow(InvalidArenaComparisonError);
    try {
      attempt();
    } catch (error) {
      expect(error.code).toBe('no_harness_change');
    }
  });

  it('passes a same-model, changed-harness pair', () => {
    expect(() =>
      assertHarnessComparable(
        receipt({ model: 'model-a', harnessVersion: 'harness/v4' }),
        receipt({ model: 'model-a', harnessVersion: 'harness/v5' }),
      ),
    ).not.toThrow();
  });
});
