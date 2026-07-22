#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const FAILURE_MAP = {
  claimCoverage: 'BRIEF_MISS',
  forbiddenClaims: 'UNSUPPORTED_CLAIM',
  layoutRepetition: 'LAYOUT_REPETITION',
  textAreaRatio: 'TEXT_DENSITY',
  meaningfulVisuals: 'WRONG_PRIMITIVE',
  internalCollisions: 'INTERNAL_OVERLAP',
  requiredArtifacts: 'WRONG_PRIMITIVE',
  renderedPptx: 'EXPORT_FAILURE',
  slideCount: 'BRIEF_MISS',
  liveModelTrace: 'GENERIC_FALLBACK',
};

const MODEL_POLICIES = {
  'moonshotai/kimi-k3': {
    slug: 'kimi-k3',
    label: 'Kimi K3',
    bestRoles: ['bounded deck executor', 'evidence-preserving slide repairer'],
    avoidRoles: ['unconstrained visual art director', 'sole final taste judge'],
    scaffolding: [
      'enforce-density-budget',
      'require-visual-artifacts',
      'repair-internal-overlap',
      'source-every-claim',
    ],
  },
  'anthropic/claude-sonnet-5': {
    slug: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    bestRoles: ['story-direction candidate', 'independent deck critic candidate'],
    avoidRoles: ['unbounded direct slide compositor', 'sole final taste judge'],
    scaffolding: [
      'enforce-density-budget',
      'require-visual-artifacts',
      'repair-internal-overlap',
      'source-every-claim',
    ],
  },
  'google/gemini-3.5-flash': {
    slug: 'gemini-3-5-flash',
    label: 'Gemini 3.5 Flash',
    bestRoles: ['no full-deck role until a live-route ablation passes'],
    avoidRoles: ['full-deck generator', 'fallback authority', 'final taste judge'],
    scaffolding: ['no-generic-fallback', 'independent route verification'],
  },
};

export async function buildModelCapabilityLedger({ artifactDir, outputDir }) {
  const matrix = await readJson(path.join(artifactDir, 'matrix.json'));
  const runDirs = await discoverRunDirs(path.join(artifactDir, 'runs'));
  const runRecords = await Promise.all(
    runDirs.map((runDir) => readJson(path.join(runDir, 'run.json'))),
  );
  const evaluations = (
    await Promise.all(
      runDirs.map((runDir) => readJson(path.join(runDir, 'evaluation.json')).catch(() => null)),
    )
  ).filter(Boolean);
  await mkdir(outputDir, { recursive: true });

  const cards = [];
  for (const [model, policy] of Object.entries(MODEL_POLICIES)) {
    const attempted = matrix.runs.filter((run) => run.model === model);
    const modelRuns = runRecords.filter((run) => run.model === model);
    const modelEvaluations = evaluations.filter((evaluation) => evaluation.model === model);
    const card = summarizeModel({
      model,
      policy,
      attempted,
      modelRuns,
      evaluations: modelEvaluations,
      harnessVersion: matrix.harnessVersion,
    });
    cards.push(card);
    const modelDir = path.join(outputDir, policy.slug);
    await mkdir(modelDir, { recursive: true });
    await writeFile(path.join(modelDir, 'capability-card.yaml'), capabilityCardYaml(card), 'utf8');
    await writeFile(path.join(modelDir, 'benchmark-summary.md'), benchmarkSummary(card), 'utf8');
    const findings = modelEvaluations.flatMap((evaluation) =>
      classifyEvaluationFailures(evaluation).map((failureClass) => ({
        schemaVersion: 'nodeslide.model-finding/v1',
        findingId: `${policy.slug}-${failureClass.toLowerCase().replaceAll('_', '-')}-${evaluation.runId}`,
        model,
        harnessVersion: evaluation.harnessVersion,
        briefId: evaluation.briefId,
        directionId: evaluation.directionId,
        runId: evaluation.runId,
        failureClass,
        severity: failureClass === 'GENERIC_FALLBACK' ? 'P1' : 'P2',
        evidence: `artifacts/deck-gym/deck-gym-v1/runs/${evaluation.runId}/evaluation.json`,
        repair: null,
        status: 'observed',
      })),
    );
    await writeFile(
      path.join(modelDir, 'findings.jsonl'),
      `${findings.map((finding) => JSON.stringify(finding)).join('\n')}\n`,
      'utf8',
    );
  }

  await writeFile(path.join(outputDir, 'routing-matrix.yaml'), routingMatrixYaml(cards), 'utf8');
  return { cards, evaluationCount: evaluations.length };
}

export function classifyEvaluationFailures(evaluation) {
  return [
    ...new Set(
      Object.entries(evaluation.checks ?? {})
        .filter(([, passed]) => !passed)
        .map(([check]) => FAILURE_MAP[check])
        .filter(Boolean),
    ),
  ].sort();
}

export function summarizeModel({
  model,
  policy,
  attempted,
  modelRuns,
  evaluations,
  harnessVersion,
}) {
  const live = evaluations.filter((entry) => entry.routeClassification === 'live');
  const degraded = evaluations.filter((entry) => entry.routeClassification === 'degraded');
  const completed = modelRuns.filter((run) => run.execution?.status === 'completed');
  const failureCounts = {};
  for (const evaluation of evaluations) {
    for (const failureClass of classifyEvaluationFailures(evaluation)) {
      failureCounts[failureClass] = (failureCounts[failureClass] ?? 0) + 1;
    }
  }
  const liveClaimPasses = live.filter((entry) => entry.checks.claimCoverage).length;
  return {
    schemaVersion: 'nodeslide.model-capability-card/v1',
    profileVersion: 1,
    model,
    label: policy.label,
    evidenceWindow: {
      attemptedRuns: attempted.length,
      evaluatedRuns: evaluations.length,
      completedExports: completed.length,
      briefs: new Set(attempted.map((run) => run.briefId)).size,
      directions: new Set(attempted.map((run) => run.directionId)).size,
      harnessVersion,
    },
    observedMetrics: {
      liveRoutes: live.length,
      degradedRoutes: degraded.length,
      liveClaimPasses,
      meanClaimCoverage: average(evaluations.map((entry) => entry.evidence.claimCoverage)),
      meanLiveClaimCoverage: average(live.map((entry) => entry.evidence.claimCoverage)),
      meanQualifiedScore: average(evaluations.map((entry) => entry.score)),
      meanRawScore: average(evaluations.map((entry) => entry.rawScore)),
      estimatedTextOverflows: sum(
        evaluations.map((entry) => entry.evidence.estimatedTextOverflowCount ?? 0),
      ),
      exportSuccessRate: attempted.length ? completed.length / attempted.length : 0,
    },
    failureCounts,
    bestRoles: policy.bestRoles,
    avoidRoles: policy.avoidRoles,
    requiredScaffolding: policy.scaffolding,
    confidence: {
      cognitiveBehavior: 'low — no plan or reasoning traces captured',
      toolExecution: 'low — only browser creation and export were observed',
      artifactQuality: evaluations.length >= 20 ? 'high' : 'medium',
      routingRecommendation: live.length >= 6 ? 'medium' : 'low',
    },
    status: 'provisional — requires skill-on versus skill-off ablation',
  };
}

function capabilityCardYaml(card) {
  const lines = [
    `schema_version: ${card.schemaVersion}`,
    `profile_version: ${card.profileVersion}`,
    `model: ${card.model}`,
    `label: ${card.label}`,
    'evidence_window:',
    ...yamlObject(card.evidenceWindow, 2),
    'observed_metrics:',
    ...yamlObject(card.observedMetrics, 2),
    'failure_counts:',
    ...yamlObject(card.failureCounts, 2),
    'best_roles:',
    ...yamlList(card.bestRoles, 2),
    'avoid_roles:',
    ...yamlList(card.avoidRoles, 2),
    'required_scaffolding:',
    ...yamlList(card.requiredScaffolding, 2),
    'confidence:',
    ...yamlObject(card.confidence, 2),
    `status: ${quoteYaml(card.status)}`,
  ];
  return `${lines.join('\n')}\n`;
}

function benchmarkSummary(card) {
  return `${[
    `# ${card.label} benchmark summary`,
    '',
    `Evidence: ${card.evidenceWindow.evaluatedRuns}/${card.evidenceWindow.attemptedRuns} evaluated runs across ${card.evidenceWindow.briefs} briefs and ${card.evidenceWindow.directions} directions on ${card.evidenceWindow.harnessVersion}.`,
    '',
    `- Live routes: ${card.observedMetrics.liveRoutes}`,
    `- Degraded routes: ${card.observedMetrics.degradedRoutes}`,
    `- Live claim gate: ${card.observedMetrics.liveClaimPasses}/${card.observedMetrics.liveRoutes}`,
    `- Mean claim coverage: ${card.observedMetrics.meanClaimCoverage}`,
    `- Qualified score: ${card.observedMetrics.meanQualifiedScore}`,
    `- Estimated text overflows: ${card.observedMetrics.estimatedTextOverflows}`,
    `- Export success: ${card.observedMetrics.exportSuccessRate}`,
    '',
    'These findings describe observed behavior only. Cognitive and tool-orchestration claims remain low confidence until plan and tool traces are captured.',
  ].join('\n')}\n`;
}

function routingMatrixYaml(cards) {
  const byModel = Object.fromEntries(cards.map((card) => [card.model, card]));
  const kimi = byModel['moonshotai/kimi-k3'];
  const claude = byModel['anthropic/claude-sonnet-5'];
  const gemini = byModel['google/gemini-3.5-flash'];
  return `${[
    'schema_version: nodeslide.model-routing-matrix/v1',
    `harness_version: ${kimi.evidenceWindow.harnessVersion}`,
    'policy: capability_before_brand',
    'routes:',
    '  full_deck_execution:',
    '    primary: moonshotai/kimi-k3',
    '    confidence: medium',
    '    requires: [no-generic-fallback, enforce-density-budget, require-visual-artifacts, repair-internal-overlap]',
    `    evidence: ${kimi.observedMetrics.liveClaimPasses}/${kimi.observedMetrics.liveRoutes} live runs passed claim coverage`,
    '  story_direction:',
    '    primary: anthropic/claude-sonnet-5',
    '    confidence: low',
    '    requires: [independent-executor, enforce-density-budget, source-every-claim]',
    '    evidence: artifact outputs only; story planning was not separately ablated',
    '  full_deck_gemini:',
    '    primary: blocked',
    '    confidence: high',
    '    requires: [verified-live-route]',
    `    evidence: ${gemini.observedMetrics.liveRoutes}/${gemini.evidenceWindow.evaluatedRuns} live routes`,
    '  final_taste_judge:',
    '    primary: human_pairwise_review',
    '    confidence: high',
    '    requires: [deterministic-gates, model-blind-candidates]',
    'limits:',
    '  cognitive_behavior: unmeasured',
    '  detailed_tool_orchestration: unmeasured',
    '  sonnet_story_advantage: hypothesis_only',
    '  gemini_extraction_advantage: not_tested_in_deck_gym',
    `  claude_live_routes: ${claude.observedMetrics.liveRoutes}`,
  ].join('\n')}\n`;
}

async function discoverRunDirs(runsDir) {
  const entries = await readdir(runsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDir, entry.name));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function average(values) {
  return values.length ? round(sum(values) / values.length) : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function round(value) {
  return Number(value.toFixed(6));
}

function yamlObject(value, indent) {
  return Object.entries(value).map(
    ([key, item]) => `${' '.repeat(indent)}${snake(key)}: ${quoteYaml(item)}`,
  );
}

function yamlList(values, indent) {
  return values.map((value) => `${' '.repeat(indent)}- ${quoteYaml(value)}`);
}

function snake(value) {
  if (/^[A-Z0-9_]+$/u.test(value)) return value.toLowerCase();
  return value.replace(/[A-Z]/gu, (match) => `_${match.toLowerCase()}`);
}

function quoteYaml(value) {
  if (typeof value === 'number') return String(value);
  return JSON.stringify(String(value));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const artifactDir = path.resolve(option('artifact-dir', 'artifacts/deck-gym/deck-gym-v1'));
  const outputDir = path.resolve(option('output-dir', '.qa/models'));
  const result = await buildModelCapabilityLedger({ artifactDir, outputDir });
  console.log(
    `[model-ledger] wrote ${result.cards.length} capability cards from ${result.evaluationCount} evaluations`,
  );
}
