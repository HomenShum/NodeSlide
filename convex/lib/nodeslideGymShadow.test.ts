import { describe, expect, it } from 'vitest';
import { compileNodeSlideArtifactSpecs } from '../../shared/nodeslideArtifactSpec';
import { buildNodeSlideGymShadowRouteReceipt } from './nodeslideGymShadow';
import { buildGoldenNodeSlide } from './nodeslideSeed';

describe('NodeGym production shadow route adapter', () => {
  it('binds to ArtifactSpec compilation and defaults to a non-mutating fallback', () => {
    const snapshot = buildGoldenNodeSlide('gym-shadow-route', 1_700_000_000_000).snapshot;
    const compilation = compileNodeSlideArtifactSpecs(snapshot).receipt;
    const first = buildNodeSlideGymShadowRouteReceipt({
      taskClass: 'artifact-spec',
      artifactCompilation: compilation,
    });
    const second = buildNodeSlideGymShadowRouteReceipt({
      taskClass: 'artifact-spec',
      artifactCompilation: compilation,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      userVisible: false,
      mutationApplied: false,
      autoApply: false,
      anonymized: true,
      eligibleInput: true,
      artifactCompilationReceiptDigest: compilation.receiptDigest,
      artifactSpecSetDigest: compilation.specSetDigest,
      route: {
        mode: 'fallback',
        model: 'deterministic-control/v1',
        harness: 'bounded-executor@1',
        userVisible: false,
      },
    });
    expect(JSON.stringify(first)).not.toContain(snapshot.deck.id);
    expect(first.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('remains advisory even when supplied a separately approved champion', () => {
    const compilation = compileNodeSlideArtifactSpecs(
      buildGoldenNodeSlide('gym-shadow-champion', 1_700_000_000_000).snapshot,
    ).receipt;
    expect(
      buildNodeSlideGymShadowRouteReceipt({
        taskClass: 'artifact-spec',
        artifactCompilation: compilation,
        approvedChampions: [
          {
            taskClass: 'artifact-spec',
            model: 'approved-small',
            harness: 'bounded-executor@2',
            eligible: true,
          },
        ],
      }),
    ).toMatchObject({
      autoApply: false,
      mutationApplied: false,
      route: { mode: 'shadow', model: 'approved-small', userVisible: false },
    });
  });

  it('refuses to shadow a champion when ArtifactSpec input failed', () => {
    const snapshot = buildGoldenNodeSlide('gym-shadow-failed-input', 1_700_000_000_000).snapshot;
    const chart = snapshot.elements.find((element) => element.kind === 'chart');
    if (!chart?.chart) throw new Error('Golden deck chart unavailable.');
    chart.chart.series[0]?.values.pop();
    const compilation = compileNodeSlideArtifactSpecs(snapshot).receipt;
    expect(compilation.status).toBe('failed');

    expect(
      buildNodeSlideGymShadowRouteReceipt({
        taskClass: 'artifact-spec',
        artifactCompilation: compilation,
        approvedChampions: [
          {
            taskClass: 'artifact-spec',
            model: 'approved-small',
            harness: 'bounded-executor@2',
            eligible: true,
          },
        ],
      }),
    ).toMatchObject({
      eligibleInput: false,
      autoApply: false,
      route: { mode: 'fallback', model: 'deterministic-control/v1' },
    });
  });
});
