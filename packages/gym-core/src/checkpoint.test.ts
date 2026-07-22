import { describe, expect, it } from 'vitest';
import {
  type NodeGymPairCandidate,
  buildNodeGymTrainingPair,
  runNodeGymCheckpointReplay,
} from './checkpoint';

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function candidate(input: Partial<NodeGymPairCandidate> = {}): NodeGymPairCandidate {
  return {
    runId: 'run-1',
    taskId: 'artifact-1',
    comparisonKey: 'comparison-1',
    harnessPairingKey: 'harness-1',
    episodeDigest: digest('a'),
    artifactDigest: digest('b'),
    hardGatesPassed: true,
    issueCodes: [],
    observableTrajectory: { toolCalls: [{ name: 'build_chart' }] },
    ...input,
  };
}

describe('NodeGym training pairs and checkpoint boundary', () => {
  it('builds only exact-paired, human-selected observable corrections', () => {
    const pair = buildNodeGymTrainingPair({
      pairId: 'pair-1',
      accepted: candidate(),
      rejected: candidate({
        runId: 'run-0',
        episodeDigest: digest('c'),
        artifactDigest: digest('d'),
        hardGatesPassed: false,
        issueCodes: ['chart_series_alignment'],
      }),
      correctedToolCalls: [{ name: 'build_chart', args: { labels: ['A'], values: [1] } }],
      humanPreference: {
        reviewerType: 'human',
        winner: 'accepted',
        reasonCodes: ['clearer_and_correct'],
      },
    });
    expect(pair).toMatchObject({
      schemaVersion: 'nodekit.gym-training-pair/v1',
      excludesHiddenReasoning: true,
      preference: { reviewerType: 'human', winner: 'accepted' },
    });
    expect(pair.correction.issueCodes).toEqual(['chart_series_alignment']);
  });

  it('rejects hidden reasoning and non-failing rejected candidates', () => {
    expect(() =>
      buildNodeGymTrainingPair({
        pairId: 'pair-1',
        accepted: candidate(),
        rejected: candidate({ artifactDigest: digest('d') }),
        repairOperations: [{ operation: 'replace' }],
        humanPreference: {
          reviewerType: 'human',
          winner: 'accepted',
          reasonCodes: ['correct'],
        },
      }),
    ).toThrow('Rejected training candidate');
    expect(() =>
      buildNodeGymTrainingPair({
        pairId: 'pair-1',
        accepted: candidate({ observableTrajectory: { chainOfThought: 'private' } }),
        rejected: candidate({
          artifactDigest: digest('d'),
          hardGatesPassed: false,
          issueCodes: ['failed'],
        }),
        repairOperations: [{ operation: 'replace' }],
        humanPreference: {
          reviewerType: 'human',
          winner: 'accepted',
          reasonCodes: ['correct'],
        },
      }),
    ).toThrow('hidden reasoning');
  });

  it('replays a provider-neutral local fake checkpoint without routing mutation', async () => {
    const receipt = await runNodeGymCheckpointReplay({
      adapter: {
        adapterId: 'fake-checkpoint-v1',
        provider: 'local-test',
        execution: 'local-fake',
        async train(input) {
          return {
            checkpointId: 'checkpoint-fixture',
            datasetDigest: input.datasetDigest,
            costMicroUsd: 0,
          };
        },
        async sample(input) {
          return {
            checkpointId: input.checkpointId,
            output: { answer: input.input.expected },
            costMicroUsd: 0,
          };
        },
      },
      pairDigests: [digest('a')],
      datasetDigest: digest('b'),
      holdoutCases: [{ id: 'heldout-1', digest: digest('c'), input: { expected: 42 } }],
      maxCostMicroUsd: 0,
      externalTrainingAuthorized: false,
      evaluate: ({ output }) => ({
        hardGatesPassed: output.answer === 42,
        issueCodes: output.answer === 42 ? [] : ['wrong_answer'],
      }),
    });
    expect(receipt).toMatchObject({
      schemaVersion: 'nodekit.gym-checkpoint-replay/v1',
      status: 'passed',
      totalCostMicroUsd: 0,
      autoApply: false,
      routingMutationApplied: false,
    });
  });

  it('fails closed before an unauthorized external adapter can run', async () => {
    let called = false;
    await expect(
      runNodeGymCheckpointReplay({
        adapter: {
          adapterId: 'external',
          provider: 'provider',
          execution: 'external',
          async train() {
            called = true;
            throw new Error('must not run');
          },
          async sample() {
            throw new Error('must not run');
          },
        },
        pairDigests: [digest('a')],
        datasetDigest: digest('b'),
        holdoutCases: [{ id: 'heldout', digest: digest('c'), input: {} }],
        maxCostMicroUsd: 0,
        externalTrainingAuthorized: false,
        evaluate: () => ({ hardGatesPassed: false, issueCodes: ['not_run'] }),
      }),
    ).rejects.toThrow('separate explicit authorization');
    expect(called).toBe(false);
  });
});
