import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

export const DECK_GYM_RUN_SCHEMA_VERSION = 'nodeslide.deck-gym-run/v1';
export const DECK_GYM_EVALUATION_SCHEMA_VERSION = 'nodeslide.deck-gym-evaluation/v1';
export const DECK_GYM_TOURNAMENT_SCHEMA_VERSION = 'nodeslide.deck-gym-tournament/v1';

const STRICT_ARTIFACTS = new Set([
  'chart',
  'diagram',
  'architecture',
  'sequence',
  'timeline',
  'screenshot',
  'image',
  'code',
  'formula',
]);

export async function readDeckGymConfig(root, options = {}) {
  const corpusPath = path.resolve(
    root,
    options.corpusPath ?? path.join('benchmarks', 'deck-gym', 'v1', 'corpus.json'),
  );
  const harnessPath = path.resolve(
    root,
    options.harnessPath ?? path.join('benchmarks', 'deck-gym', 'v1', 'harness.json'),
  );
  const [corpus, harness] = await Promise.all([readJson(corpusPath), readJson(harnessPath)]);
  return { corpus, harness, corpusPath, harnessPath };
}

export function validateDeckGymConfig(corpus, harness) {
  const failures = [];
  if (corpus?.schemaVersion !== 'nodeslide.deck-gym-corpus/v1') {
    failures.push('corpus_schema_invalid');
  }
  if (harness?.schemaVersion !== 'nodeslide.deck-gym-harness/v1') {
    failures.push('harness_schema_invalid');
  }
  if (!Array.isArray(corpus?.briefs) || corpus.briefs.length !== 12) {
    failures.push('corpus_must_contain_12_briefs');
  }
  if (!Array.isArray(harness?.models) || harness.models.length < 3) {
    failures.push('harness_requires_at_least_3_models');
  }
  if (!Array.isArray(harness?.directions) || harness.directions.length < 2) {
    failures.push('harness_requires_at_least_2_directions');
  }
  const ids = new Set();
  const families = new Set();
  for (const [index, brief] of (corpus?.briefs ?? []).entries()) {
    if (!cleanId(brief?.id)) failures.push(`brief_${index + 1}_id_invalid`);
    if (ids.has(brief?.id)) failures.push(`brief_id_duplicate:${brief.id}`);
    ids.add(brief?.id);
    if (!cleanId(brief?.family)) failures.push(`brief_${index + 1}_family_invalid`);
    families.add(brief?.family);
    if (!Number.isInteger(brief?.slideCount) || brief.slideCount < 6 || brief.slideCount > 8) {
      failures.push(`brief_slide_count_invalid:${brief?.id ?? index + 1}`);
    }
    if (
      typeof brief?.prompt !== 'string' ||
      brief.prompt.length < 120 ||
      brief.prompt.length > 4000
    ) {
      failures.push(`brief_prompt_invalid:${brief?.id ?? index + 1}`);
    }
    if (!Array.isArray(brief?.attachments) || brief.attachments.length === 0) {
      failures.push(`brief_evidence_pack_missing:${brief?.id ?? index + 1}`);
    }
    if (!Array.isArray(brief?.requiredClaims) || brief.requiredClaims.length < 3) {
      failures.push(`brief_required_claims_missing:${brief?.id ?? index + 1}`);
    }
    if (!Array.isArray(brief?.requiredArtifacts) || brief.requiredArtifacts.length < 3) {
      failures.push(`brief_required_artifacts_missing:${brief?.id ?? index + 1}`);
    }
    if (!Array.isArray(brief?.referenceIds) || brief.referenceIds.length < 3) {
      failures.push(`brief_references_missing:${brief?.id ?? index + 1}`);
    }
    for (const attachment of brief?.attachments ?? []) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u.test(attachment?.fileName ?? '')) {
        failures.push(`attachment_name_invalid:${brief?.id ?? index + 1}`);
      }
      if (!['csv', 'json', 'txt', 'md'].includes(attachment?.format)) {
        failures.push(`attachment_format_invalid:${brief?.id ?? index + 1}`);
      }
      if (typeof attachment?.content !== 'string' || attachment.content.length === 0) {
        failures.push(`attachment_content_missing:${brief?.id ?? index + 1}`);
      }
    }
  }
  if (families.size !== 12) failures.push('corpus_families_must_be_unique');
  const matrixSize =
    (corpus?.briefs?.length ?? 0) *
    (harness?.models?.length ?? 0) *
    (harness?.directions?.length ?? 0);
  if (matrixSize > (harness?.budgets?.maxRuns ?? 0)) failures.push('matrix_exceeds_max_runs');
  const expectedMatrixSize = harness?.expectedMatrixSize ?? 72;
  if (matrixSize !== expectedMatrixSize) {
    failures.push(`expected_${expectedMatrixSize}_run_matrix_received_${matrixSize}`);
  }
  return {
    ok: failures.length === 0,
    failures: [...new Set(failures)].sort(),
    briefCount: corpus?.briefs?.length ?? 0,
    familyCount: families.size,
    modelCount: harness?.models?.length ?? 0,
    directionCount: harness?.directions?.length ?? 0,
    matrixSize,
    corpusDigest: digest(corpus),
    harnessDigest: digest(harness),
  };
}

export function buildDeckGymMatrix(corpus, harness, filters = {}) {
  const validation = validateDeckGymConfig(corpus, harness);
  if (!validation.ok) throw new Error(`Deck Gym configuration failed: ${validation.failures[0]}`);
  const briefFilter = new Set(filters.briefs ?? []);
  const modelFilter = new Set(filters.models ?? []);
  const directionFilter = new Set(filters.directions ?? []);
  const briefs = corpus.briefs.filter((brief) => !briefFilter.size || briefFilter.has(brief.id));
  const models = harness.models.filter((model) => !modelFilter.size || modelFilter.has(model.id));
  const directions = harness.directions.filter(
    (direction) => !directionFilter.size || directionFilter.has(direction.id),
  );
  const runs = [];
  for (const brief of briefs) {
    for (const direction of directions) {
      for (const model of models) {
        const prompt = `${brief.prompt}\n\nDesign direction: ${direction.instruction}`;
        const runSeed = {
          briefId: brief.id,
          model: model.id,
          directionId: direction.id,
          harnessVersion: harness.harnessVersion,
          corpusVersion: corpus.corpusVersion,
          promptDigest: digest(prompt),
        };
        runs.push({
          schemaVersion: DECK_GYM_RUN_SCHEMA_VERSION,
          runId: `${brief.id}__${direction.id}__${modelSlug(model.id)}`,
          ...runSeed,
          runDigest: digest(runSeed),
          title: brief.title,
          family: brief.family,
          audience: brief.audience,
          decision: brief.decision,
          slideCount: brief.slideCount,
          prompt,
          attachments: brief.attachments,
          requiredClaims: brief.requiredClaims,
          requiredArtifacts: brief.requiredArtifacts,
          forbiddenClaims: brief.forbiddenClaims,
          referenceIds: brief.referenceIds,
          modelLabel: model.label,
          provider: model.provider,
          reasoningEffort: model.reasoningEffort,
          designDirection: direction,
          budgets: harness.budgets,
          gates: harness.gates,
        });
      }
    }
  }
  return {
    schemaVersion: 'nodeslide.deck-gym-matrix/v1',
    harnessVersion: harness.harnessVersion,
    corpusVersion: corpus.corpusVersion,
    generatedAt: new Date().toISOString(),
    corpusDigest: validation.corpusDigest,
    harnessDigest: validation.harnessDigest,
    runCount: runs.length,
    matrixDigest: digest(runs.map((run) => run.runDigest)),
    runs,
  };
}

export async function evaluateDeckGymPptx({ bytes, run, renderedSlideCount = null }) {
  const archive = await JSZip.loadAsync(bytes);
  const slideEntries = Object.keys(archive.files)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/u.test(entry))
    .sort(naturalSlideSort);
  const slides = [];
  for (const entry of slideEntries) {
    const xml = await archive.file(entry)?.async('string');
    slides.push(parseSlideXml(xml ?? '', entry));
  }
  const deckText = normalizeText(slides.map((slide) => slide.text).join(' '));
  const requiredClaims = Array.isArray(run.requiredClaims) ? run.requiredClaims : [];
  const matchedClaims = requiredClaims.filter((claim) => claimMatches(deckText, claim));
  const forbiddenClaims = (run.forbiddenClaims ?? []).filter((claim) =>
    claimMatches(deckText, claim),
  );
  const claimCoverage = requiredClaims.length ? matchedClaims.length / requiredClaims.length : 1;
  const slideSignatures = slides.map((slide) => slide.layoutTokens);
  const layoutClusters = clusterLayouts(slideSignatures, run.gates.maximumAdjacentLayoutSimilarity);
  const repeatedLayoutCount = Math.max(0, ...layoutClusters.map((cluster) => cluster.length));
  const adjacentSimilarities = slideSignatures
    .slice(1)
    .map((signature, index) => jaccard(slideSignatures[index] ?? [], signature));
  const maximumAdjacentLayoutSimilarity = Math.max(0, ...adjacentSimilarities);
  const geometryCollisionCount = slides.reduce((sum, slide) => sum + slide.collisions.length, 0);
  const estimatedTextOverflowCount = slides.reduce(
    (sum, slide) => sum + slide.estimatedTextOverflows.length,
    0,
  );
  const collisionCount = geometryCollisionCount + estimatedTextOverflowCount;
  const meaningfulVisualSlides = slides.filter((slide) => slide.meaningfulVisual).length;
  const maximumTextAreaRatio = Math.max(0, ...slides.map((slide) => slide.textAreaRatio));
  const artifactPresence = aggregateArtifacts(slides);
  const strictRequirements = (run.requiredArtifacts ?? []).filter((artifact) =>
    STRICT_ARTIFACTS.has(artifact),
  );
  const missingArtifacts = strictRequirements.filter(
    (artifact) => !artifactSatisfied(artifactPresence, artifact),
  );
  const routeClassification = run.execution?.trace?.classification ?? 'unknown';
  const checks = {
    slideCount: Math.abs(slides.length - run.slideCount) <= run.gates.requiredSlideCountTolerance,
    claimCoverage: claimCoverage >= run.gates.minimumClaimCoverage,
    forbiddenClaims: forbiddenClaims.length === 0,
    distinctLayouts: layoutClusters.length >= run.gates.minimumDistinctLayoutSignatures,
    layoutRepetition: repeatedLayoutCount <= run.gates.maximumRepeatedLayoutCount,
    adjacentSimilarity:
      maximumAdjacentLayoutSimilarity <= run.gates.maximumAdjacentLayoutSimilarity,
    textAreaRatio: maximumTextAreaRatio <= run.gates.maximumTextAreaRatio,
    meaningfulVisuals: meaningfulVisualSlides >= run.gates.minimumMeaningfulVisualSlides,
    internalCollisions: collisionCount <= run.gates.maximumInternalCollisionCount,
    requiredArtifacts: missingArtifacts.length === 0,
    liveModelTrace: run.gates.requireLiveModelTrace !== true || routeClassification === 'live',
    renderedPptx: run.gates.requireRenderedPptx
      ? renderedSlideCount === slides.length
      : renderedSlideCount === null || renderedSlideCount === slides.length,
  };
  const dimensions = {
    factual: mean([claimCoverage, forbiddenClaims.length === 0 ? 1 : 0]),
    visual: mean([
      ratioScore(layoutClusters.length, run.gates.minimumDistinctLayoutSignatures),
      repeatedLayoutCount <= run.gates.maximumRepeatedLayoutCount ? 1 : 0,
      maximumAdjacentLayoutSimilarity <= run.gates.maximumAdjacentLayoutSimilarity ? 1 : 0,
      maximumTextAreaRatio <= run.gates.maximumTextAreaRatio ? 1 : 0,
      collisionCount === 0 ? 1 : 0,
    ]),
    narrative: mean([
      claimCoverage,
      slides.length === run.slideCount ? 1 : 0,
      layoutClusters.length >= run.gates.minimumDistinctLayoutSignatures ? 1 : 0,
    ]),
    rhythm: mean([
      ratioScore(layoutClusters.length, run.gates.minimumDistinctLayoutSignatures),
      1 - Math.min(1, maximumAdjacentLayoutSimilarity),
      ratioScore(meaningfulVisualSlides, run.gates.minimumMeaningfulVisualSlides),
    ]),
    artifactIntegrity: mean([
      missingArtifacts.length === 0 ? 1 : 0,
      renderedSlideCount === null || renderedSlideCount === slides.length ? 1 : 0,
      collisionCount === 0 ? 1 : 0,
    ]),
  };
  const rawScore = mean(Object.values(dimensions));
  const qualificationMultiplier = checks.liveModelTrace && checks.claimCoverage ? 1 : 0.25;
  const passed = Object.values(checks).every(Boolean);
  const partial = {
    schemaVersion: DECK_GYM_EVALUATION_SCHEMA_VERSION,
    runId: run.runId,
    runDigest: run.runDigest,
    harnessVersion: run.harnessVersion,
    evaluationGatesDigest: run.evaluationGatesDigest ?? digest(run.gates),
    briefId: run.briefId,
    model: run.model,
    directionId: run.directionId,
    routeClassification,
    evaluatedAt: new Date().toISOString(),
    status: passed ? 'passed' : 'failed',
    checks,
    dimensions,
    rawScore,
    score: rawScore * qualificationMultiplier,
    evidence: {
      slideCount: slides.length,
      renderedSlideCount,
      matchedClaims,
      requiredClaimCount: requiredClaims.length,
      claimCoverage: round(claimCoverage),
      forbiddenClaims,
      distinctLayoutSignatures: layoutClusters.length,
      repeatedLayoutCount,
      maximumAdjacentLayoutSimilarity: round(maximumAdjacentLayoutSimilarity),
      meaningfulVisualSlides,
      maximumTextAreaRatio: round(maximumTextAreaRatio),
      geometryCollisionCount,
      estimatedTextOverflowCount,
      collisionCount,
      missingArtifacts,
      artifactPresence,
      slideDigests: slides.map((slide) => slide.digest),
      deckDigest: digest(slides.map((slide) => slide.digest)),
    },
  };
  return { ...partial, evaluationDigest: digest(partial) };
}

export function buildBlindTournament(evaluations) {
  const completed = evaluations.filter(
    (entry) => entry?.schemaVersion === DECK_GYM_EVALUATION_SCHEMA_VERSION,
  );
  const groups = new Map();
  for (const evaluation of completed) {
    const key = `${evaluation.briefId}::${evaluation.directionId}`;
    const values = groups.get(key) ?? [];
    values.push(evaluation);
    groups.set(key, values);
  }
  const matches = [];
  for (const [groupId, values] of [...groups.entries()].sort()) {
    const ordered = [...values].sort((left, right) =>
      left.runDigest.localeCompare(right.runDigest),
    );
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
        const left = ordered[leftIndex];
        const right = ordered[rightIndex];
        if (!left || !right) continue;
        const flip =
          Number.parseInt(digest(`${left.runDigest}:${right.runDigest}`).slice(-2), 16) % 2 === 1;
        const a = flip ? right : left;
        const b = flip ? left : right;
        matches.push({
          matchId: `match_${digest(`${groupId}:${a.runDigest}:${b.runDigest}`).slice(-16)}`,
          groupId,
          briefId: a.briefId,
          directionId: a.directionId,
          candidateA: { runId: a.runId, evaluationDigest: a.evaluationDigest },
          candidateB: { runId: b.runId, evaluationDigest: b.evaluationDigest },
          eligible:
            a.checks?.renderedPptx === true &&
            b.checks?.renderedPptx === true &&
            a.checks?.slideCount === true &&
            b.checks?.slideCount === true,
          promotionEligible: a.status === 'passed' && b.status === 'passed',
          requiredPreferenceReasons: [
            'clearer_story',
            'stronger_visual_hierarchy',
            'better_artifact_choice',
            'less_repetition',
            'better_evidence',
            'better_data_fidelity',
            'more_audience_appropriate',
            'more_editable',
            'better_export',
          ],
        });
      }
    }
  }
  const partial = {
    schemaVersion: DECK_GYM_TOURNAMENT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    evaluationCount: completed.length,
    matchCount: matches.length,
    eligibleMatchCount: matches.filter((match) => match.eligible).length,
    promotionEligibleMatchCount: matches.filter((match) => match.promotionEligible).length,
    blind: true,
    matches,
  };
  return { ...partial, tournamentDigest: digest(partial) };
}

export function buildPromotionProposal({ tournament, preferences, harness }) {
  const validPreferences = preferences.filter(
    (item) =>
      item &&
      typeof item.matchId === 'string' &&
      (item.winner === 'A' || item.winner === 'B' || item.winner === 'tie') &&
      Array.isArray(item.reasons) &&
      item.reasons.length > 0,
  );
  const reviewed = new Set(validPreferences.map((item) => item.matchId));
  const eligibleMatches = tournament.matches.filter((match) => match.promotionEligible);
  const reviewCoverage = eligibleMatches.length
    ? eligibleMatches.filter((match) => reviewed.has(match.matchId)).length / eligibleMatches.length
    : 0;
  const blockers = [];
  if (eligibleMatches.length < harness.promotion.minimumMatchedCases) {
    blockers.push('insufficient_eligible_matches');
  }
  if (reviewCoverage < 1) blockers.push('human_review_incomplete');
  if (harness.promotion.autoApply !== false) blockers.push('auto_apply_must_remain_disabled');
  const partial = {
    schemaVersion: 'nodeslide.deck-gym-promotion-proposal/v1',
    generatedAt: new Date().toISOString(),
    tournamentDigest: tournament.tournamentDigest,
    reviewedMatches: reviewed.size,
    eligibleMatches: eligibleMatches.length,
    reviewCoverage: round(reviewCoverage),
    decision: blockers.length ? 'blocked' : 'ready_for_operator_analysis',
    blockers,
    autoApply: false,
    proposedChanges: [],
    rollbackRequired: true,
  };
  return { ...partial, proposalDigest: digest(partial) };
}

function parseSlideXml(xml, entry) {
  const elements = [];
  const blockPattern = /<p:(sp|pic|graphicFrame|cxnSp)\b[\s\S]*?<\/p:\1>/gu;
  for (const match of xml.matchAll(blockPattern)) {
    const block = match[0];
    const type = match[1];
    const off = block.match(/<a:off\b[^>]*\bx="(\d+)"[^>]*\by="(\d+)"/u);
    const ext = block.match(/<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/u);
    if (!off || !ext) continue;
    const text = [...block.matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)]
      .map((item) => decodeXml(item[1] ?? ''))
      .join(' ')
      .trim();
    const kind =
      type === 'pic'
        ? 'image'
        : type === 'cxnSp'
          ? 'connector'
          : /<c:chart\b/u.test(block)
            ? 'chart'
            : text
              ? 'text'
              : 'shape';
    const bbox = {
      x: Number(off[1]),
      y: Number(off[2]),
      width: Number(ext[1]),
      height: Number(ext[2]),
    };
    if (!Object.values(bbox).every(Number.isFinite) || bbox.width <= 0 || bbox.height <= 0)
      continue;
    const fontSizes = [...block.matchAll(/\bsz="(\d+)"/gu)]
      .map((item) => Number(item[1]) / 100)
      .filter((value) => Number.isFinite(value) && value > 0);
    const estimatedTextOverflow = kind === 'text' && estimateTextOverflow(text, bbox, fontSizes);
    elements.push({
      kind,
      text,
      bbox,
      area: bbox.width * bbox.height,
      estimatedTextOverflow,
    });
  }
  const maxX = Math.max(1, ...elements.map((element) => element.bbox.x + element.bbox.width));
  const maxY = Math.max(1, ...elements.map((element) => element.bbox.y + element.bbox.height));
  const canvasArea = maxX * maxY;
  const important = elements.filter(
    (element) =>
      element.kind !== 'connector' &&
      element.area / canvasArea > 0.002 &&
      element.area / canvasArea < 0.85,
  );
  const collisions = [];
  for (let leftIndex = 0; leftIndex < important.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < important.length; rightIndex += 1) {
      const left = important[leftIndex];
      const right = important[rightIndex];
      if (!left || !right || containedPair(left, right)) continue;
      const overlap = overlapRatio(left.bbox, right.bbox);
      if (overlap > 0.08)
        collisions.push({ left: leftIndex, right: rightIndex, overlap: round(overlap) });
    }
  }
  const text = elements
    .map((element) => element.text)
    .filter(Boolean)
    .join(' ');
  const textAreaRatio = Math.min(
    1,
    elements
      .filter((element) => element.kind === 'text')
      .reduce((sum, element) => sum + element.area / canvasArea, 0),
  );
  const estimatedTextOverflows = elements
    .map((element, index) => ({ element, index }))
    .filter(({ element }) => element.estimatedTextOverflow)
    .map(({ element, index }) => ({
      element: index,
      characters: element.text.length,
      width: element.bbox.width,
      height: element.bbox.height,
    }));
  const counts = Object.fromEntries(
    ['text', 'shape', 'connector', 'chart', 'image'].map((kind) => [
      kind,
      elements.filter((element) => element.kind === kind).length,
    ]),
  );
  const formula = /(?:=|÷|\bdivided by\b|\bper\b)/iu.test(text);
  const code = /\b(?:interface|function|export|const|class|Promise<|=>)\b/u.test(text);
  const diagram = counts.connector >= 1 && counts.shape >= 2;
  const meaningfulVisual = counts.chart > 0 || counts.image > 0 || diagram || formula || code;
  const layoutTokens = important.map((element) => {
    const bx = Math.round((element.bbox.x / maxX) * 5);
    const by = Math.round((element.bbox.y / maxY) * 5);
    const bw = Math.round((element.bbox.width / maxX) * 5);
    const bh = Math.round((element.bbox.height / maxY) * 5);
    return `${element.kind}:${bx}:${by}:${bw}:${bh}`;
  });
  return {
    entry,
    text,
    counts,
    formula,
    code,
    diagram,
    meaningfulVisual,
    textAreaRatio,
    collisions,
    estimatedTextOverflows,
    layoutTokens,
    digest: digest({ text: normalizeText(text), counts, layoutTokens }),
  };
}

function estimateTextOverflow(text, bbox, fontSizes) {
  if (!text || text.length < 32) return false;
  const widthPoints = (bbox.width / 914400) * 72;
  const heightPoints = (bbox.height / 914400) * 72;
  if (widthPoints <= 0 || heightPoints <= 0) return false;
  const sortedSizes = [...fontSizes].sort((left, right) => left - right);
  const fontSize = sortedSizes[Math.floor(sortedSizes.length / 2)] ?? 18;
  const charactersPerLine = Math.max(4, Math.floor(widthPoints / (fontSize * 0.52)));
  const availableLines = Math.max(1, Math.floor(heightPoints / (fontSize * 1.15)));
  const requiredLines = wrappedLineEstimate(text, charactersPerLine);
  return requiredLines > availableLines + 1;
}

function wrappedLineEstimate(text, charactersPerLine) {
  const words = text.trim().split(/\s+/u);
  let lines = 1;
  let lineLength = 0;
  for (const word of words) {
    const width = Math.max(1, word.length);
    if (lineLength > 0 && lineLength + 1 + width > charactersPerLine) {
      lines += 1;
      lineLength = width;
    } else {
      lineLength += (lineLength ? 1 : 0) + width;
    }
  }
  return lines;
}

function aggregateArtifacts(slides) {
  return {
    charts: slides.reduce((sum, slide) => sum + slide.counts.chart, 0),
    images: slides.reduce((sum, slide) => sum + slide.counts.image, 0),
    connectors: slides.reduce((sum, slide) => sum + slide.counts.connector, 0),
    shapes: slides.reduce((sum, slide) => sum + slide.counts.shape, 0),
    diagrams: slides.filter((slide) => slide.diagram).length,
    formulas: slides.filter((slide) => slide.formula).length,
    codeSlides: slides.filter((slide) => slide.code).length,
  };
}

function artifactSatisfied(presence, artifact) {
  if (artifact === 'chart') return presence.charts > 0;
  if (artifact === 'image' || artifact === 'screenshot') return presence.images > 0;
  if (artifact === 'formula') return presence.formulas > 0;
  if (artifact === 'code') return presence.codeSlides > 0;
  if (['diagram', 'architecture', 'sequence', 'timeline'].includes(artifact)) {
    return presence.diagrams > 0;
  }
  return true;
}

function clusterLayouts(signatures, similarityThreshold) {
  const clusters = [];
  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index] ?? [];
    const cluster = clusters.find((candidate) =>
      candidate.some(
        (memberIndex) => jaccard(signatures[memberIndex] ?? [], signature) >= similarityThreshold,
      ),
    );
    if (cluster) cluster.push(index);
    else clusters.push([index]);
  }
  return clusters;
}

function jaccard(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 1;
}

function containedPair(left, right) {
  const contains = (outer, inner) =>
    outer.bbox.x <= inner.bbox.x &&
    outer.bbox.y <= inner.bbox.y &&
    outer.bbox.x + outer.bbox.width >= inner.bbox.x + inner.bbox.width &&
    outer.bbox.y + outer.bbox.height >= inner.bbox.y + inner.bbox.height;
  return (
    (left.kind === 'shape' && contains(left, right)) ||
    (right.kind === 'shape' && contains(right, left))
  );
}

function overlapRatio(left, right) {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller > 0 ? (width * height) / smaller : 0;
}

function claimMatches(deckText, claim) {
  const tokens = normalizeText(claim).split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => deckText.includes(token));
}

function normalizeText(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/%/gu, ' percent ')
    .replace(/[_-]+/gu, ' ')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function naturalSlideSort(left, right) {
  const number = (value) => Number(value.match(/slide(\d+)\.xml$/u)?.[1] ?? Number.NaN);
  return number(left) - number(right);
}

function modelSlug(value) {
  return cleanId(value).replace(/[/.]+/gu, '-').replace(/-+/gu, '-').toLocaleLowerCase();
}

function cleanId(value) {
  return typeof value === 'string' ? value.replace(/[^A-Za-z0-9._:/+-]/gu, '').slice(0, 180) : '';
}

function ratioScore(actual, target) {
  return target > 0 ? Math.min(1, actual / target) : 1;
}

function mean(values) {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function round(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

export function digest(value) {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}

function stableSerialize(value) {
  return JSON.stringify(canonical(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return value;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
