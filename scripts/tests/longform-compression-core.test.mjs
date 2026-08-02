import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  findGenericNarrativeFallbacks,
  findMissingRenderedClaims,
  validateGeneratedDeckGates,
  validateLongformBenchmarkDefinition,
  validateLongformBenchmarkRun,
} from '../lib/longform-compression-core.mjs';

const root = new URL('../../benchmarks/longform-compression/v1/', import.meta.url);
const load = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const benchmark = await load('benchmark.json');
const sourceManifest = await load('staar-alcon/source-manifest.json');
const deckProgram = await load('staar-alcon/deck-program.json');
const questions = await load('staar-alcon/decision-questions.json');
const criticalFacts = await load('staar-alcon/critical-facts.json');
const heldOutPlan = await load('held-out-plan.json');

function receipt(deckKind, slideIndex) {
  return {
    deckKind,
    slideIndex,
    browserImageDigest: `sha256:browser-${deckKind}-${slideIndex}`,
    pptxImageDigest: `sha256:pptx-${deckKind}-${slideIndex}`,
    checks: {
      overlap: 'pass',
      clipping: 'pass',
      minimumType: 'pass',
      sourceLegibility: 'pass',
      visualHierarchy: 'pass',
      semanticVisualFit: 'pass',
      density: 'pass',
      exportParity: 'pass',
    },
    observedProblems: [],
    requiredRepairs: [],
    inspectedBy: 'nodeslide-benchmark-reviewer',
    inspectedAt: '2026-08-01T12:00:00.000Z',
  };
}

function completeRun() {
  const graphDigest = 'sha256:canonical-staar-evidence-graph';
  const values = Object.fromEntries(
    criticalFacts.claims
      .filter((claim) => claim.value !== undefined)
      .map((claim) => [claim.claimId, claim.value]),
  );
  return {
    canonicalEvidenceGraphDigest: graphDigest,
    longDeck: { kind: 'long', slideCount: 72, canonicalEvidenceGraphDigest: graphDigest },
    shortDeck: { kind: 'short', slideCount: 12, canonicalEvidenceGraphDigest: graphDigest },
    executiveDeck: { kind: 'executive', slideCount: 4, canonicalEvidenceGraphDigest: graphDigest },
    generationSourceIds: sourceManifest.evidenceSources.map((source) => source.sourceId),
    approvalAuthoritySourceIds: sourceManifest.evidenceSources
      .filter((source) => source.authority === 'primary')
      .map((source) => source.sourceId),
    artifactEligibility: Array.from({ length: 72 }, (_, offset) => ({
      slideIndex: offset + 1,
      narrativeRole: 'decision evidence',
      evidenceRelationships: ['canonical-claim'],
      eligibleArtifacts: ['native-evidence-table'],
      requiredArtifact: 'native-evidence-table',
      selectedArtifact: 'native-evidence-table',
      textOnlyPermitted: false,
      reason: 'The financial relationship requires an editable native artifact.',
    })),
    visualInspectionReceipts: [
      ...Array.from({ length: 72 }, (_, index) => receipt('long', index + 1)),
      ...Array.from({ length: 12 }, (_, index) => receipt('short', index + 1)),
      ...Array.from({ length: 4 }, (_, index) => receipt('executive', index + 1)),
    ],
    sectionMontageReceipts: deckProgram.sections.map((section) => ({
      sectionId: section.sectionId,
      inspected: true,
    })),
    longContactSheetInspection: { inspected: true },
    shortContactSheetInspection: { inspected: true },
    executiveContactSheetInspection: { inspected: true },
    compressionLedger: criticalFacts.claims.map((claim) => ({
      sourceClaimId: claim.claimId,
      sourceSlideIndexes: claim.longDeckSlideIndexes,
      criticality: claim.criticality,
      disposition: 'retained_compressed',
      targetSlideIndexes: claim.shortDeckSlideIndexes,
      rationale: 'Preserved for the investment committee decision.',
      preservedEvidenceRefs: claim.evidenceSourceIds,
    })),
    reconciledClaimValues: { long: values, short: values },
    unsupportedDecisionCriticalClaims: [],
    materialContradictions: [],
    weightedCompressionRetention: 0.98,
    decisionQuestionResults: questions.questions.map((question) => ({
      questionId: question.questionId,
      longCorrect: true,
      shortCorrect: true,
    })),
  };
}

describe('NodeSlide Longform & Compression Bench', () => {
  it('rejects generic evidence placeholders in a transaction associate draft', () => {
    expect(
      findGenericNarrativeFallbacks([
        'Historical performance is assessed only from the frozen pre-vote bundle.',
        'Committee decision',
      ]),
    ).toEqual(['is assessed only from the frozen pre-vote bundle', 'committee decision']);
    expect(
      findGenericNarrativeFallbacks([
        'Q2 2025 gross margin declined to 74.0% from 79.2%.',
        'Decision changes if China recovery evidence fails.',
      ]),
    ).toEqual([]);
  });

  it('accepts the frozen pre-vote transaction program before an investment committee run', () => {
    expect(
      validateLongformBenchmarkDefinition({
        benchmark,
        sourceManifest,
        deckProgram,
        questions,
        criticalFacts,
        heldOutPlan,
      }),
    ).toEqual([]);
  });

  it('rejects a frozen decision question that has no expected evidence', () => {
    const incompleteQuestions = structuredClone(questions);
    incompleteQuestions.questions.find(
      (question) => question.questionId === 'q10',
    ).expectedClaimIds = [];
    expect(
      validateLongformBenchmarkDefinition({
        benchmark,
        sourceManifest,
        deckProgram,
        questions: incompleteQuestions,
        criticalFacts,
        heldOutPlan,
      }),
    ).toContain('q10 has no frozen expected evidence');
  });

  it('kills an approval-book run before export when count or diversity regresses', () => {
    const built = {
      long: {
        snapshot: { slides: Array.from({ length: 71 }) },
        spec: { deckDiversity: { passes: true } },
      },
      short: {
        snapshot: { slides: Array.from({ length: 12 }) },
        spec: { deckDiversity: { passes: false } },
      },
      executive: {
        snapshot: { slides: Array.from({ length: 4 }) },
        spec: { deckDiversity: { passes: true } },
      },
    };
    expect(
      validateGeneratedDeckGates({
        built,
        expectedCounts: { long: 72, short: 12, executive: 4 },
      }),
    ).toEqual(['long deck count 71 does not match 72', 'short deck diversity gate did not pass']);
  });

  it('kills compression when a decision claim exists in the plan but disappears from rendered elements', () => {
    const claims = [
      { claimId: 'liquidity', statement: 'Cash and investments totaled $189.883 million.' },
      { claimId: 'offer', statement: 'Alcon offered $28.00 in cash per STAAR share.' },
    ];
    const snapshot = {
      elements: [{ content: 'Alcon offered $28.00 in cash per STAAR share.' }],
    };
    expect(findMissingRenderedClaims(snapshot, claims)).toEqual(['liquidity']);
  });

  it('accepts a fully reconciled 72-to-12-to-4 production receipt', () => {
    expect(
      validateLongformBenchmarkRun({
        benchmark,
        sourceManifest,
        criticalFacts,
        run: completeRun(),
      }),
    ).toEqual([]);
  });

  it('kills a run when an associate skips one PPTX/browser page inspection during an 88-page review', () => {
    const run = completeRun();
    run.visualInspectionReceipts = run.visualInspectionReceipts.filter(
      (receipt) => !(receipt.deckKind === 'long' && receipt.slideIndex === 47),
    );
    expect(
      validateLongformBenchmarkRun({ benchmark, sourceManifest, criticalFacts, run }),
    ).toContain('long:47 was not opened and inspected');
  });

  it('kills a run when post-vote hindsight leaks into the pre-vote generation bundle', () => {
    const run = completeRun();
    run.generationSourceIds.push('failed-vote-2026-01-06');
    expect(
      validateLongformBenchmarkRun({ benchmark, sourceManifest, criticalFacts, run }),
    ).toContain('generation leaked forbidden source failed-vote-2026-01-06');
  });

  it('kills a run when the promotional investor presentation is treated as approval authority', () => {
    const run = completeRun();
    run.approvalAuthoritySourceIds.push('official-investor-presentation-2025-09-26');
    expect(
      validateLongformBenchmarkRun({ benchmark, sourceManifest, criticalFacts, run }),
    ).toContain(
      'official-investor-presentation-2025-09-26 is not an independent primary approval authority',
    );
  });

  it('kills a run when one critical transaction figure drifts during compression', () => {
    const run = completeRun();
    run.reconciledClaimValues.short['offer-price'] = 28.01;
    expect(
      validateLongformBenchmarkRun({ benchmark, sourceManifest, criticalFacts, run }),
    ).toContain('critical figure mismatch for offer-price');
  });

  it('kills a run when one canonical claim has no compression disposition', () => {
    const run = completeRun();
    run.compressionLedger = run.compressionLedger.filter(
      (entry) => entry.sourceClaimId !== 'citi-contingent-fee',
    );
    expect(
      validateLongformBenchmarkRun({ benchmark, sourceManifest, criticalFacts, run }),
    ).toContain('compression decision missing for claim citi-contingent-fee');
  });

  it('does not count an ineligible Atlas showroom artifact toward utilization', () => {
    const run = completeRun();
    for (let index = 0; index < 12; index += 1) {
      run.artifactEligibility[index] = {
        ...run.artifactEligibility[index],
        eligibleArtifacts: [],
        requiredArtifact: undefined,
        selectedArtifact: 'atlas-ornamental-radial',
        textOnlyPermitted: true,
      };
    }
    for (let index = 12; index < 23; index += 1)
      run.artifactEligibility[index].selectedArtifact = 'generic-card-grid';
    const failures = validateLongformBenchmarkRun({
      benchmark,
      sourceManifest,
      criticalFacts,
      run,
    });
    expect(failures.some((failure) => failure.startsWith('Atlas eligible utilization'))).toBe(true);
  });
});
