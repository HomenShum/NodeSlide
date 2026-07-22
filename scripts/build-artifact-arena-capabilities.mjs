#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const MODEL_LABELS = {
  'nodeslide-artifact-builder-v1': 'Deterministic baseline',
  'moonshotai/kimi-k3': 'Kimi K3',
  'anthropic/claude-sonnet-5': 'Claude Sonnet 5',
  'google/gemma-4-26b-a4b-it:free': 'Gemma 4 26B Free',
};

export function buildArtifactCapabilityCards(receipts) {
  const byModel = Map.groupBy(receipts, (receipt) => receipt.model);
  return [...byModel.entries()]
    .map(([model, modelReceipts]) => {
      const byArtifact = Map.groupBy(modelReceipts, (receipt) => receipt.artifactType);
      const artifactCapabilities = [...byArtifact.entries()]
        .map(([artifactType, artifactReceipts]) =>
          summarizeArtifact(artifactType, artifactReceipts),
        )
        .sort((left, right) => left.artifactType.localeCompare(right.artifactType));
      const eligible = modelReceipts.filter((receipt) => receipt.status === 'eligible');
      const live = model !== 'nodeslide-artifact-builder-v1';
      return {
        schemaVersion: 'nodeslide.artifact-capability-card/v1',
        model,
        label: MODEL_LABELS[model] ?? model,
        harnessVersion: modelReceipts[0]?.harnessVersion ?? 'unknown',
        evidenceWindow: {
          candidateCount: modelReceipts.length,
          eligibleCount: eligible.length,
          artifactTypes: artifactCapabilities.length,
          directions: new Set(modelReceipts.map((receipt) => receipt.directionId)).size,
        },
        observedMetrics: {
          eligibilityRate: ratio(eligible.length, modelReceipts.length),
          meanGenerationMs: average(
            modelReceipts.map((receipt) => receipt.evaluation.generationMs),
          ),
          meanInputTokens: average(modelReceipts.map((receipt) => receipt.evaluation.inputTokens)),
          meanOutputTokens: average(
            modelReceipts.map((receipt) => receipt.evaluation.outputTokens),
          ),
          totalCostMicroUsd: sum(modelReceipts.map((receipt) => receipt.evaluation.costMicroUsd)),
          freeRoute:
            live && sum(modelReceipts.map((receipt) => receipt.evaluation.costMicroUsd)) === 0,
        },
        artifactCapabilities,
        preferredArtifactTypes: artifactCapabilities
          .filter((entry) => entry.repeatedEvidence && entry.eligibilityRate === 1)
          .map((entry) => entry.artifactType),
        confidence: modelReceipts.length >= 24 ? 'medium' : 'low',
        status: 'provisional',
        autoApply: false,
        limitation:
          'Observed artifact execution only. Human pairwise preference and skill-on/skill-off ablation remain separate gates.',
      };
    })
    .sort((left, right) => left.model.localeCompare(right.model));
}

export function buildArtifactRoutingRecommendations(cards) {
  const artifactTypes = new Set(
    cards.flatMap((card) => card.artifactCapabilities.map((entry) => entry.artifactType)),
  );
  return [...artifactTypes].sort().map((artifactType) => {
    const candidates = cards
      .filter((card) => card.model !== 'nodeslide-artifact-builder-v1')
      .map((card) => ({
        model: card.model,
        label: card.label,
        ...card.artifactCapabilities.find((entry) => entry.artifactType === artifactType),
      }))
      .filter((entry) => entry.repeatedEvidence)
      .sort(
        (left, right) =>
          right.eligibilityRate - left.eligibilityRate ||
          left.meanGenerationMs - right.meanGenerationMs ||
          left.model.localeCompare(right.model),
      );
    return {
      artifactType,
      recommendedModel: candidates[0]?.model ?? null,
      evidence: candidates,
      confidence: candidates.length >= 3 ? 'provisional-medium' : 'provisional-low',
      autoApply: false,
    };
  });
}

function summarizeArtifact(artifactType, receipts) {
  const eligible = receipts.filter((receipt) => receipt.status === 'eligible');
  return {
    artifactType,
    candidateCount: receipts.length,
    eligibleCount: eligible.length,
    eligibilityRate: ratio(eligible.length, receipts.length),
    meanGenerationMs: average(receipts.map((receipt) => receipt.evaluation.generationMs)),
    meanClaimCoverage: average(receipts.map((receipt) => receipt.claimCoverage)),
    repeatedEvidence: receipts.length >= 2,
    failureClasses: [...new Set(receipts.flatMap(classifyFailures))].sort(),
  };
}

function classifyFailures(receipt) {
  const failures = [];
  if (!receipt.evaluation.briefAdherence) failures.push('BRIEF_MISS');
  if (!receipt.evaluation.visualPassed) failures.push('VISUAL_FAILURE');
  if (!receipt.evaluation.evidencePassed) failures.push('EVIDENCE_FAILURE');
  if (!receipt.evaluation.exportPassed) failures.push('EXPORT_FAILURE');
  if (!receipt.evaluation.editabilityPassed) failures.push('EDITABILITY_FAILURE');
  return failures;
}

function average(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  return numeric.length ? round(sum(numeric) / numeric.length) : null;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function ratio(numerator, denominator) {
  return denominator ? round(numerator / denominator) : 0;
}

function round(value) {
  return Number(value.toFixed(4));
}

async function main() {
  const artifactRoot = path.resolve(
    option('artifact-root') ?? 'artifacts/deck-gym/artifact-atlas-v1',
  );
  const receipts = JSON.parse(await readFile(path.join(artifactRoot, 'receipts.json'), 'utf8'));
  const cards = buildArtifactCapabilityCards(receipts);
  const recommendations = buildArtifactRoutingRecommendations(cards);
  const output = {
    schemaVersion: 'nodeslide.artifact-capability-ledger/v1',
    generatedAt: new Date().toISOString(),
    harnessVersion: receipts[0]?.harnessVersion ?? 'unknown',
    cards,
    recommendations,
    policy: { autoApply: false, humanPreferenceRequiredForShowcase: true },
  };
  await writeJson(path.join(artifactRoot, 'capability-cards.json'), output);
  for (const card of cards) {
    const slug = card.model
      .replace(/[^a-z0-9]+/giu, '-')
      .replace(/^-|-$/gu, '')
      .toLowerCase();
    const modelDir = path.resolve('.qa/models', slug);
    await mkdir(modelDir, { recursive: true });
    await writeJson(path.join(modelDir, 'artifact-arena-card.json'), card);
  }
  console.log(
    `[artifact-capabilities] wrote ${cards.length} cards and ${recommendations.length} recommendations`,
  );
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
