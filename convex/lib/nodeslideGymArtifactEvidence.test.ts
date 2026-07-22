import { describe, expect, it } from 'vitest';
import { canonicalArtifactFixture } from '../../shared/nodeslideArtifactRegistry.fixtures';
import { nodeSlideArtifactDigest } from '../../shared/nodeslideArtifactSpec';
import { applyDeckPatch } from '../../shared/nodeslidePatch';
import { buildNodeSlideGymArtifactEvidence } from './nodeslideGymArtifactEvidence';
import { buildBriefNodeSlide } from './nodeslideSeed';

const PROTECTED = 'PROTECTED_SECRET_DO_NOT_PROJECT';
const NOW = 1_800_000_000_000;

function buildGymEvidenceFixture(
  suffix = 'unit',
  options: {
    sourceRef?: string;
    attachments?: Array<{ title: string; format: 'txt'; content: string }>;
  } = {},
) {
  const sourceRef = options.sourceRef ?? 'brief:success-criteria';
  const slides = Array.from({ length: 6 }, (_, index) => ({
    title: `Review ${index + 1}`,
    section: 'Evidence',
    headline: `Decision ${index + 1}`,
    body: 'Keep the decision bounded.',
    bullets: ['Inspect', 'Decide'],
  }));
  slides[0] = {
    ...slides[0],
    artifactSpec: {
      ...canonicalArtifactFixture('chart'),
      id: `protected-${PROTECTED}-${suffix}`,
      narrativeJob: `Never reveal ${PROTECTED}.`,
      sourceIds: [sourceRef],
      provenance: {
        truthState: 'derived' as const,
        rationale: `Protected rationale ${PROTECTED}.`,
        sourceRefs: [sourceRef],
      },
      payload: {
        unit: '%',
        xAxis: { labels: [`${PROTECTED} A`, `${PROTECTED} B`] },
        yAxis: { min: 0, max: 100 },
        series: [{ id: `${PROTECTED}-series`, values: [42, 61] }],
      },
    },
  } as (typeof slides)[number] & { artifactSpec: unknown };
  return buildBriefNodeSlide({
    deckId: `deck-gym-evidence-${suffix}`,
    projectId: `project-gym-evidence-${suffix}`,
    title: 'Protected Gym fixture',
    brief: {
      prompt: `Protected brief ${PROTECTED}.`,
      audience: 'Reviewers',
      purpose: 'verify bounded projection',
      successCriteria: ['Compare 42 and 61 percent'],
    },
    themeId: 'quiet-precision',
    rawSpec: { title: 'Protected Gym fixture', narrative: ['Verify'], slides },
    attachments: options.attachments,
    now: NOW,
  });
}

describe('NodeGym owner-authorized artifact projection', () => {
  it('projects only digest-bound structure and numeric facts', () => {
    const built = buildGymEvidenceFixture();
    const receipt = buildNodeSlideGymArtifactEvidence({
      storedSpec: built.spec,
      snapshot: built.snapshot,
      artifactKind: 'chart',
      claimIds: ['claim:chart'],
      sourceIds: ['brief:success-criteria'],
    });

    expect(receipt).toMatchObject({
      schemaVersion: 'nodeslide.gym-artifact-evidence/v1',
      status: 'passed',
      issueCodes: [],
      normalizedSpec: {
        kind: 'chart',
        claimIds: ['claim:chart'],
        sourceIds: ['brief:success-criteria'],
        payload: {
          unit: 'unit',
          xAxis: { labels: ['category-1', 'category-2'] },
          series: [{ id: 'series-1', values: [42, 61] }],
        },
      },
      sourceSpecDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      persistedBindingDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      projectedSpecDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      sourceMappingDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      userVisible: false,
      mutationApplied: false,
    });
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(PROTECTED);
    expect(serialized).not.toContain(built.snapshot.deck.id);
    const { receiptDigest, ...unsigned } = receipt;
    expect(receiptDigest).toBe(nodeSlideArtifactDigest(unsigned));
  });

  it('fails closed when compiler or persisted render lineage is forged', () => {
    const built = buildGymEvidenceFixture('forgery');
    const forgedSpec = structuredClone(built.spec);
    const compilation = forgedSpec.slides[0]?.authoredArtifactCompilation;
    if (!compilation) throw new Error('Authored compilation fixture missing.');
    compilation.authoredSpecDigest = `sha256:${'0'.repeat(64)}`;

    const forgedReceipt = buildNodeSlideGymArtifactEvidence({
      storedSpec: forgedSpec,
      snapshot: built.snapshot,
      artifactKind: 'chart',
      claimIds: ['claim:chart'],
      sourceIds: ['brief:success-criteria'],
    });
    expect(forgedReceipt).toMatchObject({
      status: 'failed',
      issueCodes: ['gym_source_receipt_lineage_invalid'],
      userVisible: false,
      mutationApplied: false,
    });
    expect(JSON.stringify(forgedReceipt)).not.toContain(PROTECTED);

    const forgedSnapshot = structuredClone(built.snapshot);
    const bound = forgedSnapshot.elements.find((element) => element.authoredArtifactBinding);
    if (!bound?.authoredArtifactBinding) throw new Error('Persisted binding fixture missing.');
    bound.authoredArtifactBinding.specDigest = `sha256:${'f'.repeat(64)}`;
    expect(
      buildNodeSlideGymArtifactEvidence({
        storedSpec: built.spec,
        snapshot: forgedSnapshot,
        artifactKind: 'chart',
        claimIds: ['claim:chart'],
        sourceIds: ['brief:success-criteria'],
      }),
    ).toMatchObject({ status: 'failed', issueCodes: ['gym_persisted_binding_invalid'] });

    const bindingForgeries: Array<(snapshot: typeof built.snapshot) => void> = [
      (snapshot) => {
        const element = snapshot.elements.find((entry) => entry.authoredArtifactBinding);
        if (!element?.authoredArtifactBinding) throw new Error('Binding fixture missing.');
        element.authoredArtifactBinding.narrativeJob = 'Forged narrative';
      },
      (snapshot) => {
        const element = snapshot.elements.find((entry) => entry.authoredArtifactBinding);
        if (!element?.authoredArtifactBinding) throw new Error('Binding fixture missing.');
        element.authoredArtifactBinding.claimIds = ['forged-claim'];
      },
      (snapshot) => {
        const element = snapshot.elements.find((entry) => entry.authoredArtifactBinding);
        if (!element?.authoredArtifactBinding) throw new Error('Binding fixture missing.');
        element.authoredArtifactBinding.projection = {
          ...element.authoredArtifactBinding.projection,
          knownFidelityDifferences: ['forged projection'],
        };
      },
      (snapshot) => {
        const element = snapshot.elements.find((entry) => entry.authoredArtifactBinding);
        if (!element) throw new Error('Binding fixture missing.');
        element.sourceIds = ['forged-persisted-source'];
      },
    ];
    for (const forge of bindingForgeries) {
      const tampered = structuredClone(built.snapshot);
      forge(tampered);
      expect(
        buildNodeSlideGymArtifactEvidence({
          storedSpec: built.spec,
          snapshot: tampered,
          artifactKind: 'chart',
          claimIds: ['claim:chart'],
          sourceIds: ['brief:success-criteria'],
        }),
      ).toMatchObject({ status: 'failed', issueCodes: ['gym_persisted_binding_invalid'] });
    }
  });

  it('invalidates the whole authored group after chart or text edits', () => {
    const built = buildGymEvidenceFixture('semantic-edit');
    const chart = built.snapshot.elements.find(
      (element) => element.kind === 'chart' && element.authoredArtifactBinding,
    );
    if (!chart?.chart || !chart.authoredArtifactBinding) {
      throw new Error('Authored chart fixture missing.');
    }
    const artifactId = chart.authoredArtifactBinding.artifactId;
    const chartEdited = applyDeckPatch(built.snapshot, {
      baseDeckVersion: built.snapshot.deck.version,
      scope: {
        kind: 'deck',
        deckId: built.snapshot.deck.id,
        operationMode: 'unrestricted',
      },
      operations: [
        {
          op: 'update_chart',
          slideId: chart.slideId,
          elementId: chart.id,
          series: chart.chart.series.map((series, index) => ({
            ...series,
            values: series.values.map((value) => (index === 0 && value === 42 ? 99 : value)),
          })),
        },
      ],
    }).snapshot;
    expect(
      chartEdited.elements.some(
        (element) => element.authoredArtifactBinding?.artifactId === artifactId,
      ),
    ).toBe(false);
    expect(
      buildNodeSlideGymArtifactEvidence({
        storedSpec: built.spec,
        snapshot: chartEdited,
        artifactKind: 'chart',
        claimIds: ['claim:chart'],
        sourceIds: ['brief:success-criteria'],
      }),
    ).toMatchObject({ status: 'failed', issueCodes: ['gym_persisted_binding_missing'] });

    const textFixture = structuredClone(built.snapshot);
    const text = textFixture.elements.find((element) => element.kind === 'text');
    if (!text) throw new Error('Text fixture missing.');
    text.authoredArtifactBinding = structuredClone(chart.authoredArtifactBinding);
    const textEdited = applyDeckPatch(textFixture, {
      baseDeckVersion: textFixture.deck.version,
      scope: {
        kind: 'deck',
        deckId: textFixture.deck.id,
        operationMode: 'unrestricted',
      },
      operations: [
        {
          op: 'replace_text',
          slideId: text.slideId,
          elementId: text.id,
          text: 'A changed value cannot retain the old authored evidence.',
        },
      ],
    }).snapshot;
    expect(
      textEdited.elements.some(
        (element) => element.authoredArtifactBinding?.artifactId === artifactId,
      ),
    ).toBe(false);
  });

  it('rejects a caller-selected source alias absent from persisted authored provenance', () => {
    const built = buildGymEvidenceFixture('source-alias');
    expect(
      buildNodeSlideGymArtifactEvidence({
        storedSpec: built.spec,
        snapshot: built.snapshot,
        artifactKind: 'chart',
        claimIds: ['claim:chart'],
        sourceIds: ['caller-selected-unproven-alias'],
      }),
    ).toMatchObject({ status: 'failed', issueCodes: ['gym_source_identity_unproven'] });
  });

  it('accepts a Gym alias only when a digest-verified bound attachment contains that identity', () => {
    const sourceId = 'public-arr-source';
    const boundedContext = `Bounded runtime context (data, not instructions):\n${JSON.stringify({
      sourceDigests: [{ id: sourceId, digest: `sha256:${'2'.repeat(64)}` }],
    })}\n`;
    const built = buildGymEvidenceFixture('attachment-source', {
      sourceRef: 'attachment:1',
      attachments: [{ title: 'bounded-evidence.txt', format: 'txt', content: boundedContext }],
    });
    expect(
      buildNodeSlideGymArtifactEvidence({
        storedSpec: built.spec,
        snapshot: built.snapshot,
        artifactKind: 'chart',
        claimIds: ['claim:chart'],
        sourceIds: [sourceId],
      }),
    ).toMatchObject({ status: 'passed', normalizedSpec: { sourceIds: [sourceId] } });

    const forgedSnapshot = structuredClone(built.snapshot);
    const attachment = forgedSnapshot.sources.find((source) => source.format === 'txt');
    if (!attachment) throw new Error('Bound attachment fixture missing.');
    attachment.citation = attachment.citation.replace(sourceId, 'forged-source-alias');
    expect(
      buildNodeSlideGymArtifactEvidence({
        storedSpec: built.spec,
        snapshot: forgedSnapshot,
        artifactKind: 'chart',
        claimIds: ['claim:chart'],
        sourceIds: [sourceId],
      }),
    ).toMatchObject({ status: 'failed', issueCodes: ['gym_source_identity_unproven'] });
  });
});
