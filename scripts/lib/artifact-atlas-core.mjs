import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const ARTIFACT_ATLAS_SCHEMA_VERSION = 'nodeslide.artifact-atlas/v1';
export const ARTIFACT_ARENA_HARNESS_SCHEMA_VERSION = 'nodeslide.artifact-arena-harness/v1';
export const ARTIFACT_ARENA_CANDIDATE_SCHEMA_VERSION = 'nodeslide.artifact-arena-candidate/v1';
export const ARTIFACT_SHOWCASE_RECEIPT_SCHEMA_VERSION = 'nodeslide.artifact-showcase-receipt/v1';

const REQUIRED_CATEGORIES = new Set([
  'narrative',
  'data',
  'systems',
  'time',
  'product-proof',
  'technical',
  'evidence',
  'decisions',
]);

const READING_DIRECTIONS = new Set(['left-to-right', 'top-to-bottom', 'radial', 'focal']);
const EDITABILITY_LEVELS = new Set(['native', 'grouped-editable', 'static-fallback']);

export async function readArtifactAtlasConfig(root, options = {}) {
  const atlasPath = path.resolve(
    root,
    options.atlasPath ?? path.join('benchmarks', 'artifact-atlas', 'v1', 'atlas.json'),
  );
  const harnessPath = path.resolve(
    root,
    options.harnessPath ?? path.join('benchmarks', 'artifact-atlas', 'v1', 'harness.json'),
  );
  const [atlas, harness] = await Promise.all([readJson(atlasPath), readJson(harnessPath)]);
  return { atlas, harness, atlasPath, harnessPath };
}

export function validateArtifactAtlasConfig(atlas, harness) {
  const failures = [];
  if (atlas?.schemaVersion !== ARTIFACT_ATLAS_SCHEMA_VERSION) {
    failures.push('atlas_schema_invalid');
  }
  if (harness?.schemaVersion !== ARTIFACT_ARENA_HARNESS_SCHEMA_VERSION) {
    failures.push('harness_schema_invalid');
  }
  if (!Array.isArray(atlas?.fixtures) || atlas.fixtures.length !== 12) {
    failures.push('atlas_v1_requires_12_fixtures');
  }
  if (!Array.isArray(harness?.models) || harness.models.length !== 3) {
    failures.push('arena_requires_exactly_3_representative_models');
  }
  if (!Array.isArray(harness?.directions) || harness.directions.length !== 2) {
    failures.push('arena_v1_requires_exactly_2_directions');
  }
  if (!cleanId(harness?.deterministicBaseline?.id)) {
    failures.push('deterministic_baseline_missing');
  }

  const fixtureIds = new Set();
  const artifactTypes = new Set();
  const categories = new Set();
  for (const [index, fixture] of (atlas?.fixtures ?? []).entries()) {
    const label = fixture?.id ?? index + 1;
    if (!cleanId(fixture?.id)) failures.push(`fixture_id_invalid:${label}`);
    if (fixtureIds.has(fixture?.id)) failures.push(`fixture_id_duplicate:${label}`);
    fixtureIds.add(fixture?.id);
    if (!cleanId(fixture?.artifactType)) failures.push(`artifact_type_invalid:${label}`);
    if (artifactTypes.has(fixture?.artifactType)) {
      failures.push(`artifact_type_duplicate:${fixture.artifactType}`);
    }
    artifactTypes.add(fixture?.artifactType);
    if (!REQUIRED_CATEGORIES.has(fixture?.category)) {
      failures.push(`fixture_category_invalid:${label}`);
    }
    categories.add(fixture?.category);
    if (!cleanId(fixture?.slideArchetype)) failures.push(`slide_archetype_invalid:${label}`);
    if (typeof fixture?.narrativeJob !== 'string' || fixture.narrativeJob.length < 20) {
      failures.push(`narrative_job_invalid:${label}`);
    }
    if (typeof fixture?.prompt !== 'string' || fixture.prompt.length < 160) {
      failures.push(`fixture_prompt_invalid:${label}`);
    }
    if (!READING_DIRECTIONS.has(fixture?.artifactContract?.readingDirection)) {
      failures.push(`reading_direction_invalid:${label}`);
    }
    if (!EDITABILITY_LEVELS.has(fixture?.artifactContract?.editability?.web)) {
      failures.push(`web_editability_invalid:${label}`);
    }
    if (!EDITABILITY_LEVELS.has(fixture?.artifactContract?.editability?.pptx)) {
      failures.push(`pptx_editability_invalid:${label}`);
    }
    if (!Array.isArray(fixture?.artifactContract?.requiredOperations)) {
      failures.push(`required_operations_missing:${label}`);
    }
    if (!Array.isArray(fixture?.evidence) || fixture.evidence.length === 0) {
      failures.push(`evidence_missing:${label}`);
    }
    const sourceIds = new Set();
    for (const source of fixture?.evidence ?? []) {
      if (!cleanId(source?.sourceId)) failures.push(`source_id_invalid:${label}`);
      if (sourceIds.has(source?.sourceId)) failures.push(`source_id_duplicate:${label}`);
      sourceIds.add(source?.sourceId);
      if (typeof source?.content !== 'string' || source.content.length === 0) {
        failures.push(`source_content_missing:${label}`);
      }
    }
    if (!Array.isArray(fixture?.allowedClaims) || fixture.allowedClaims.length === 0) {
      failures.push(`allowed_claims_missing:${label}`);
    }
    if (!Array.isArray(fixture?.forbiddenClaims)) {
      failures.push(`forbidden_claims_missing:${label}`);
    }
    if (!Array.isArray(fixture?.referenceIds) || fixture.referenceIds.length === 0) {
      failures.push(`references_missing:${label}`);
    }
  }
  for (const category of REQUIRED_CATEGORIES) {
    if (!categories.has(category)) failures.push(`category_not_covered:${category}`);
  }

  const modelCandidates =
    (atlas?.fixtures?.length ?? 0) *
    (harness?.models?.length ?? 0) *
    (harness?.directions?.length ?? 0);
  const baselineCandidates = atlas?.fixtures?.length ?? 0;
  const candidateCount = modelCandidates + baselineCandidates;
  if (candidateCount !== (harness?.expectedCandidateCount ?? 0)) {
    failures.push(
      `expected_${harness?.expectedCandidateCount ?? 0}_candidates_received_${candidateCount}`,
    );
  }
  if (candidateCount > (harness?.budgets?.maxCandidates ?? 0)) {
    failures.push('candidate_matrix_exceeds_budget');
  }
  if (harness?.promotion?.autoApply !== false) failures.push('auto_apply_must_remain_disabled');

  return {
    ok: failures.length === 0,
    failures: [...new Set(failures)].sort(),
    fixtureCount: atlas?.fixtures?.length ?? 0,
    artifactTypeCount: artifactTypes.size,
    categoryCount: categories.size,
    modelCount: harness?.models?.length ?? 0,
    directionCount: harness?.directions?.length ?? 0,
    modelCandidateCount: modelCandidates,
    deterministicBaselineCount: baselineCandidates,
    candidateCount,
    atlasDigest: digest(atlas),
    harnessDigest: digest(harness),
  };
}

export function buildArtifactArenaMatrix(atlas, harness, filters = {}) {
  const validation = validateArtifactAtlasConfig(atlas, harness);
  if (!validation.ok) {
    throw new Error(`Artifact Atlas configuration failed: ${validation.failures[0]}`);
  }
  const fixtureFilter = new Set(filters.fixtures ?? []);
  const modelFilter = new Set(filters.models ?? []);
  const directionFilter = new Set(filters.directions ?? []);
  const fixtures = atlas.fixtures.filter(
    (fixture) => !fixtureFilter.size || fixtureFilter.has(fixture.id),
  );
  const models = harness.models.filter((model) => !modelFilter.size || modelFilter.has(model.id));
  const directions = harness.directions.filter(
    (direction) => !directionFilter.size || directionFilter.has(direction.id),
  );
  const candidates = [];
  for (const fixture of fixtures) {
    const invariant = buildInvariant(fixture, harness);
    if (!modelFilter.size && !directionFilter.size) {
      candidates.push(
        buildCandidate({
          fixture,
          harness,
          invariant,
          candidateKind: 'deterministic-baseline',
          model: harness.deterministicBaseline,
          direction: {
            id: 'deterministic-baseline',
            label: 'Deterministic baseline',
            instruction: harness.deterministicBaseline.instruction,
          },
        }),
      );
    }
    for (const direction of directions) {
      for (const model of models) {
        candidates.push(
          buildCandidate({
            fixture,
            harness,
            invariant,
            candidateKind: 'model',
            model,
            direction,
          }),
        );
      }
    }
  }
  const partial = {
    schemaVersion: 'nodeslide.artifact-arena-matrix/v1',
    atlasVersion: atlas.atlasVersion,
    harnessVersion: harness.harnessVersion,
    generatedAt: new Date().toISOString(),
    atlasDigest: validation.atlasDigest,
    harnessDigest: validation.harnessDigest,
    candidateCount: candidates.length,
    candidateDigests: candidates.map((candidate) => candidate.candidateDigest),
    candidates,
  };
  return { ...partial, matrixDigest: digest(partial) };
}

export function createArtifactShowcaseReceipt({ candidate, evaluation, outputs, tools = [] }) {
  const checks = {
    briefAdherence: evaluation?.briefAdherence === true,
    visualPassed: evaluation?.visualPassed === true,
    evidencePassed: evaluation?.evidencePassed === true,
    exportPassed: evaluation?.exportPassed === true,
    artifactTypeMatched: evaluation?.artifactTypeMatched === true,
    editabilityPassed: evaluation?.editabilityPassed === true,
  };
  const completeOutputs =
    nonEmpty(outputs?.browserRender) &&
    nonEmpty(outputs?.pptxRender) &&
    nonEmpty(outputs?.pptxFile);
  const eligible = Object.values(checks).every(Boolean) && completeOutputs;
  const partial = {
    schemaVersion: ARTIFACT_SHOWCASE_RECEIPT_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    candidateDigest: candidate.candidateDigest,
    fixtureId: candidate.fixtureId,
    directionId: candidate.directionId,
    artifactType: candidate.artifactType,
    slideArchetype: candidate.slideArchetype,
    narrativeJob: candidate.narrativeJob,
    model: candidate.model,
    modelRole: candidate.modelRole,
    candidateKind: candidate.candidateKind,
    harnessVersion: candidate.harnessVersion,
    sourceIds: candidate.sourceIds,
    sourceDigest: candidate.sourceDigest,
    referenceIds: candidate.referenceIds,
    artifactRequirementDigest: candidate.artifactRequirementDigest,
    editability: candidate.editability,
    tools,
    evaluation: {
      ...checks,
      repairCount: Number.isInteger(evaluation?.repairCount) ? evaluation.repairCount : 0,
      generationMs: finiteOrNull(evaluation?.generationMs),
      inputTokens: finiteOrNull(evaluation?.inputTokens),
      outputTokens: finiteOrNull(evaluation?.outputTokens),
      costMicroUsd: finiteOrNull(evaluation?.costMicroUsd),
    },
    outputs: {
      browserRender: outputs?.browserRender ?? null,
      pptxRender: outputs?.pptxRender ?? null,
      pptxFile: outputs?.pptxFile ?? null,
      webPptxDifference: outputs?.webPptxDifference ?? null,
    },
    status: eligible ? 'eligible' : 'failed',
    generatedAt: new Date().toISOString(),
  };
  return { ...partial, receiptDigest: digest(partial) };
}

export function buildArtifactGallery(atlas, receipts) {
  const eligible = receipts.filter(
    (receipt) =>
      receipt?.schemaVersion === ARTIFACT_SHOWCASE_RECEIPT_SCHEMA_VERSION &&
      receipt.status === 'eligible',
  );
  const entries = atlas.fixtures.map((fixture) => {
    const winners = eligible
      .filter((receipt) => receipt.artifactType === fixture.artifactType)
      .sort((left, right) => compareReceipts(left, right));
    return {
      fixtureId: fixture.id,
      category: fixture.category,
      artifactType: fixture.artifactType,
      slideArchetype: fixture.slideArchetype,
      narrativeJob: fixture.narrativeJob,
      status: winners.length ? 'ready' : 'awaiting-passing-artifact',
      winnerReceiptDigest: winners[0]?.receiptDigest ?? null,
      eligibleReceiptDigests: winners.map((receipt) => receipt.receiptDigest),
    };
  });
  const partial = {
    schemaVersion: 'nodeslide.artifact-gallery/v1',
    atlasVersion: atlas.atlasVersion,
    generatedAt: new Date().toISOString(),
    readyCount: entries.filter((entry) => entry.status === 'ready').length,
    entries,
  };
  return { ...partial, galleryDigest: digest(partial) };
}

export function buildModelCompare(receipts, fixtureId) {
  const candidates = receipts
    .filter(
      (receipt) =>
        receipt?.fixtureId === fixtureId || receipt?.candidateId?.startsWith(`${fixtureId}__`),
    )
    .map((receipt) => ({
      candidateId: receipt.candidateId,
      receiptDigest: receipt.receiptDigest,
      model: receipt.model,
      modelRole: receipt.modelRole,
      status: receipt.status,
      outputs: receipt.outputs,
      evaluation: receipt.evaluation,
    }));
  return {
    schemaVersion: 'nodeslide.model-compare/v1',
    fixtureId,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates,
  };
}

export function compareHarnessReceipts(previousReceipts, currentReceipts) {
  const previousByKey = new Map(
    previousReceipts.map((receipt) => [comparisonKey(receipt), receipt]),
  );
  const comparisons = [];
  for (const current of currentReceipts) {
    const previous = previousByKey.get(comparisonKey(current));
    if (!previous) continue;
    comparisons.push({
      key: comparisonKey(current),
      model: current.model,
      artifactType: current.artifactType,
      previousHarnessVersion: previous.harnessVersion,
      currentHarnessVersion: current.harnessVersion,
      statusChanged: previous.status !== current.status,
      repairCountDelta:
        Number(current.evaluation?.repairCount ?? 0) -
        Number(previous.evaluation?.repairCount ?? 0),
      generationMsDelta: subtractNullable(
        current.evaluation?.generationMs,
        previous.evaluation?.generationMs,
      ),
      costMicroUsdDelta: subtractNullable(
        current.evaluation?.costMicroUsd,
        previous.evaluation?.costMicroUsd,
      ),
      checkDeltas: Object.fromEntries(
        [
          'briefAdherence',
          'visualPassed',
          'evidencePassed',
          'exportPassed',
          'artifactTypeMatched',
          'editabilityPassed',
        ].map((name) => [
          name,
          Number(current.evaluation?.[name] === true) -
            Number(previous.evaluation?.[name] === true),
        ]),
      ),
    });
  }
  const partial = {
    schemaVersion: 'nodeslide.harness-compare/v1',
    generatedAt: new Date().toISOString(),
    pairedCandidateCount: comparisons.length,
    comparisons,
  };
  return { ...partial, comparisonDigest: digest(partial) };
}

function buildInvariant(fixture, harness) {
  const sourceIds = fixture.evidence.map((source) => source.sourceId);
  return {
    sourceIds,
    sourceDigest: digest(fixture.evidence),
    referenceIds: fixture.referenceIds,
    referenceDigest: digest(fixture.referenceIds),
    artifactRequirementDigest: digest(fixture.artifactContract),
    budgetDigest: digest(harness.budgets.perCandidate),
  };
}

function buildCandidate({ fixture, harness, invariant, candidateKind, model, direction }) {
  const prompt = [
    fixture.prompt,
    `Required artifact: ${fixture.artifactType}.`,
    `Narrative job: ${fixture.narrativeJob}`,
    `Design direction: ${direction.instruction}`,
    'Use only the supplied evidence. Preserve editable semantics in web and PowerPoint.',
  ].join('\n\n');
  const seed = {
    fixtureId: fixture.id,
    candidateKind,
    model: model.id,
    directionId: direction.id,
    harnessVersion: harness.harnessVersion,
    sourceDigest: invariant.sourceDigest,
    artifactRequirementDigest: invariant.artifactRequirementDigest,
    budgetDigest: invariant.budgetDigest,
    promptDigest: digest(prompt),
  };
  return {
    schemaVersion: ARTIFACT_ARENA_CANDIDATE_SCHEMA_VERSION,
    candidateId: `${fixture.id}__${direction.id}__${modelSlug(model.id)}`,
    ...seed,
    candidateDigest: digest(seed),
    artifactType: fixture.artifactType,
    category: fixture.category,
    slideArchetype: fixture.slideArchetype,
    narrativeJob: fixture.narrativeJob,
    modelLabel: model.label,
    modelRole: model.provisionalRole,
    provider: model.provider,
    reasoningEffort: model.reasoningEffort ?? 'none',
    direction,
    prompt,
    evidence: fixture.evidence,
    sourceIds: invariant.sourceIds,
    sourceDigest: invariant.sourceDigest,
    allowedClaims: fixture.allowedClaims,
    forbiddenClaims: fixture.forbiddenClaims,
    referenceIds: invariant.referenceIds,
    referenceDigest: invariant.referenceDigest,
    artifactContract: fixture.artifactContract,
    artifactRequirementDigest: invariant.artifactRequirementDigest,
    editability: fixture.artifactContract.editability,
    budgets: harness.budgets.perCandidate,
    budgetDigest: invariant.budgetDigest,
    gates: harness.gates,
  };
}

function compareReceipts(left, right) {
  const leftRepairs = Number(left.evaluation?.repairCount ?? Number.MAX_SAFE_INTEGER);
  const rightRepairs = Number(right.evaluation?.repairCount ?? Number.MAX_SAFE_INTEGER);
  if (leftRepairs !== rightRepairs) return leftRepairs - rightRepairs;
  const leftCost = Number(left.evaluation?.costMicroUsd ?? Number.MAX_SAFE_INTEGER);
  const rightCost = Number(right.evaluation?.costMicroUsd ?? Number.MAX_SAFE_INTEGER);
  if (leftCost !== rightCost) return leftCost - rightCost;
  return left.receiptDigest.localeCompare(right.receiptDigest);
}

function comparisonKey(receipt) {
  return [
    receipt.artifactType,
    receipt.model,
    receipt.candidateKind,
    receipt.directionId ?? receipt.candidateId?.split('__')[1] ?? 'unknown',
  ].join('::');
}

function subtractNullable(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) ? left - right : null;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function modelSlug(value) {
  return String(value)
    .replace(/[^a-z0-9]+/giu, '-')
    .replace(/^-|-$/gu, '');
}

function cleanId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,79}$/u.test(value);
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
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
