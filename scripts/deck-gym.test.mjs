import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildBlindTournament,
  buildDeckGymMatrix,
  buildPromotionProposal,
  digest,
  evaluateDeckGymPptx,
  readDeckGymConfig,
  validateDeckGymConfig,
} from './lib/deck-gym-core.mjs';

describe('Deck Gym', () => {
  it('freezes twelve distinct deck families into a 72-run controlled matrix', async () => {
    const { corpus, harness } = await readDeckGymConfig(process.cwd());
    const validation = validateDeckGymConfig(corpus, harness);
    expect(validation).toMatchObject({
      ok: true,
      briefCount: 12,
      familyCount: 12,
      modelCount: 3,
      directionCount: 2,
      matrixSize: 72,
    });
    const matrix = buildDeckGymMatrix(corpus, harness);
    expect(matrix.runCount).toBe(72);
    expect(new Set(matrix.runs.map((run) => run.runId)).size).toBe(72);
    expect(matrix.runs.every((run) => run.promptDigest.startsWith('sha256:'))).toBe(true);
    expect(matrix.runs.every((run) => run.attachments.length > 0)).toBe(true);
  });

  it('supports bounded matrix filters without changing frozen run identity', async () => {
    const { corpus, harness } = await readDeckGymConfig(process.cwd());
    const matrix = buildDeckGymMatrix(corpus, harness, {
      briefs: ['research-talk'],
      models: ['moonshotai/kimi-k3'],
      directions: ['evidence-editorial'],
    });
    expect(matrix.runCount).toBe(1);
    expect(matrix.runs[0]).toMatchObject({
      briefId: 'research-talk',
      model: 'moonshotai/kimi-k3',
      directionId: 'evidence-editorial',
    });
  });

  it('fails a technically valid PPTX when the requested brief facts are absent', async () => {
    const bytes = await fakePptx([
      fakeSlide('Create an editable, reviewable presentation from this idea', 0),
      fakeSlide('Start narrow and learn quickly', 1),
    ]);
    const run = fakeRun({ requiredClaims: ['0.75', '0.038', '1040'] });
    const evaluation = await evaluateDeckGymPptx({ bytes, run, renderedSlideCount: 2 });
    expect(evaluation.status).toBe('failed');
    expect(evaluation.checks.claimCoverage).toBe(false);
    expect(evaluation.evidence.claimCoverage).toBe(0);
  });

  it('passes the semantic gate when frozen claims survive the exported PPTX', async () => {
    const bytes = await fakePptx([
      fakeSlide('Adaptive quality is 0.75 at a cost of 0.038', 0),
      fakeSlide('Latency is 1040 milliseconds', 1),
    ]);
    const run = fakeRun({ requiredClaims: ['0.75', '0.038', '1040'] });
    const evaluation = await evaluateDeckGymPptx({ bytes, run, renderedSlideCount: 2 });
    expect(evaluation.status).toBe('passed');
    expect(evaluation.checks.claimCoverage).toBe(true);
    expect(evaluation.evidence.claimCoverage).toBe(1);
  });

  it('fails dense text that is likely to overflow inside an exported text box', async () => {
    const text = Array.from({ length: 80 }, () => 'evidence').join(' ');
    const bytes = await fakePptx([
      fakeSlide(text, 0, { width: 1200000, height: 260000, fontSize: 2200 }),
      fakeSlide('A concise second slide', 1),
    ]);
    const evaluation = await evaluateDeckGymPptx({
      bytes,
      run: fakeRun(),
      renderedSlideCount: 2,
    });
    expect(evaluation.status).toBe('failed');
    expect(evaluation.checks.internalCollisions).toBe(false);
    expect(evaluation.evidence.estimatedTextOverflowCount).toBeGreaterThan(0);
  });

  it('creates model-blind matches and keeps promotion human-gated', async () => {
    const base = {
      schemaVersion: 'nodeslide.deck-gym-evaluation/v1',
      briefId: 'research-talk',
      directionId: 'evidence-editorial',
      harnessVersion: 'deck-gym-v1',
      status: 'passed',
      score: 0.8,
    };
    const evaluations = ['kimi', 'claude', 'gemini'].map((model, index) => {
      const partial = {
        ...base,
        runId: `run-${index}`,
        runDigest: digest({ model }),
        model,
      };
      return { ...partial, evaluationDigest: digest(partial) };
    });
    const tournament = buildBlindTournament(evaluations);
    expect(tournament.matchCount).toBe(3);
    expect(tournament.matches.every((match) => !('model' in match.candidateA))).toBe(true);
    const proposal = buildPromotionProposal({
      tournament,
      preferences: [],
      harness: {
        promotion: { minimumMatchedCases: 2, autoApply: false },
      },
    });
    expect(proposal).toMatchObject({
      decision: 'blocked',
      autoApply: false,
      rollbackRequired: true,
    });
    expect(proposal.blockers).toContain('human_review_incomplete');
  });
});

function fakeRun(overrides = {}) {
  const partial = {
    schemaVersion: 'nodeslide.deck-gym-run/v1',
    runId: 'fixture-run',
    harnessVersion: 'deck-gym-v1',
    briefId: 'fixture',
    model: 'fixture-model',
    directionId: 'fixture-direction',
    slideCount: 2,
    requiredClaims: [],
    requiredArtifacts: [],
    forbiddenClaims: [],
    gates: {
      minimumClaimCoverage: 0.75,
      minimumDistinctLayoutSignatures: 1,
      maximumRepeatedLayoutCount: 2,
      maximumAdjacentLayoutSimilarity: 1,
      maximumTextAreaRatio: 1,
      minimumMeaningfulVisualSlides: 0,
      maximumInternalCollisionCount: 0,
      requiredSlideCountTolerance: 0,
      requireRenderedPptx: true,
    },
    ...overrides,
  };
  return { ...partial, runDigest: digest(partial) };
}

async function fakePptx(slides) {
  const zip = new JSZip();
  slides.forEach((xml, index) => zip.file(`ppt/slides/slide${index + 1}.xml`, xml));
  return zip.generateAsync({ type: 'uint8array' });
}

function fakeSlide(text, index, options = {}) {
  const x = 500000 + index * 300000;
  const width = options.width ?? 5000000;
  const height = options.height ?? 1000000;
  const fontSize = options.fontSize ?? 1800;
  return `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="${x}" y="500000"/><a:ext cx="${width}" cy="${height}"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="${fontSize}"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}
