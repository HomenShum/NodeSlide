import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadHumanPreference,
  preferenceRunProblems,
  preferenceShapeProblems,
} from '../emit-atlas-receipts.mjs';

const temporaryDirectories = [];

afterEach(async () =>
  Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

const eligibleReceipt = (id) => ({
  id,
  candidateKind: 'model',
  status: 'eligible',
  evaluation: {
    briefAdherence: true,
    visualPassed: true,
    evidencePassed: true,
    exportPassed: true,
  },
});

function completedReview() {
  return {
    schemaVersion: 'nodeslide.atlas-human-preference/v1',
    scheduleDigest: 'sha256:schedule',
    seedFingerprint: 'sha256:seed',
    cropHeight: 720,
    reviewedAt: 1_785_000_000_000,
    preferred: ['candidate-a'],
    notPreferred: ['candidate-b', 'candidate-c'],
    notJudged: [],
    evidence: [
      {
        receiptId: 'candidate-a',
        cellKey: 'executive-story',
        wins: 2,
        losses: 0,
        undecidedPairs: 0,
        opponentCount: 2,
        cellSize: 3,
      },
      {
        receiptId: 'candidate-b',
        cellKey: 'executive-story',
        wins: 1,
        losses: 1,
        undecidedPairs: 0,
        opponentCount: 2,
        cellSize: 3,
      },
      {
        receiptId: 'candidate-c',
        cellKey: 'executive-story',
        wins: 0,
        losses: 2,
        undecidedPairs: 0,
        opponentCount: 2,
        cellSize: 3,
      },
    ],
    renderBindings: ['candidate-a', 'candidate-b', 'candidate-c'].map((receiptId) => ({
      receiptId,
      renderSha256: `sha256:${receiptId}`,
    })),
  };
}

describe('Atlas human-preference recovery', () => {
  it('accepts a complete three-way blind review and binds every eligible receipt', () => {
    const review = completedReview();
    const receipts = ['candidate-a', 'candidate-b', 'candidate-c'].map(eligibleReceipt);

    expect(preferenceShapeProblems(review, 'board-review.json')).toEqual([]);
    expect(preferenceRunProblems(review, receipts, 'board-review.json')).toEqual([]);
  });

  it('rejects a forged winner when the head-to-head evidence derives a different verdict', () => {
    const review = completedReview();
    review.preferred = ['candidate-b'];
    review.notPreferred = ['candidate-a', 'candidate-b', 'candidate-c'];

    const problems = preferenceShapeProblems(review, 'tampered-review.json').join('\n');
    expect(problems).toMatch(/both prefers and rejects/iu);
    expect(problems).toMatch(/own evidence/iu);
  });

  it('rejects preference claims on a deterministic fallback and reports omitted receipts', () => {
    const review = completedReview();
    const receipts = [
      eligibleReceipt('candidate-a'),
      {
        ...eligibleReceipt('candidate-b'),
        candidateKind: 'deterministic-baseline',
      },
      eligibleReceipt('candidate-c'),
      eligibleReceipt('candidate-d'),
    ];

    const problems = preferenceRunProblems(review, receipts, 'degraded-review.json').join('\n');
    expect(problems).toMatch(/not-a-model-candidate/iu);
    expect(problems).toMatch(/names 1 of 4 receipts nowhere/iu);
  });

  it('handles a sustained 5,000-receipt abstention without inventing preferences', () => {
    const receipts = Array.from({ length: 5_000 }, (_, index) =>
      eligibleReceipt(`candidate-${index}`),
    );
    const review = {
      ...completedReview(),
      preferred: [],
      notPreferred: [],
      evidence: [],
      renderBindings: [],
      notJudged: receipts.map(({ id }) => ({ receiptId: id, reason: 'not shown' })),
    };

    expect(preferenceShapeProblems(review, 'large-review.json')).toEqual([]);
    expect(preferenceRunProblems(review, receipts, 'large-review.json')).toEqual([]);
  });

  it('refuses a review collection above the deterministic processing bound', () => {
    const review = {
      ...completedReview(),
      preferred: [],
      notPreferred: [],
      evidence: [],
      renderBindings: [],
      notJudged: Array.from({ length: 10_001 }, (_, index) => ({
        receiptId: `candidate-${index}`,
        reason: 'not shown',
      })),
    };

    expect(preferenceShapeProblems(review, 'unbounded-review.json').join('\n')).toMatch(
      /10001 notJudged entries; the bound is 10000/iu,
    );
  });

  it('refuses an oversized declared review before reading it into memory', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-atlas-preference-'));
    temporaryDirectories.push(directory);
    const preferencePath = path.join(directory, 'oversized.json');
    await writeFile(preferencePath, ' '.repeat(1_048_577), 'utf8');

    await expect(loadHumanPreference(preferencePath)).rejects.toThrow(/bound is 1048576 bytes/iu);
  });
});
