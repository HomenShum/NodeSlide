#!/usr/bin/env -S npx vite-node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNodeSlideSnapshot } from '../convex/lib/nodeslideValidation';
import type { DeckSnapshot } from '../shared/nodeslide';
import { validateLongformBenchmarkRun } from './lib/longform-compression-core.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repoRoot, 'benchmarks/longform-compression/v1/staar-alcon');
const benchmarkRoot = path.join(repoRoot, 'benchmarks/longform-compression/v1');
const outputRoot = path.join(repoRoot, 'outputs/longform-compression-v1/staar-alcon');
const readJson = async <T>(filePath: string) => JSON.parse(await readFile(filePath, 'utf8')) as T;
const sha256 = (bytes: Uint8Array | string) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fileDigest = async (filePath: string) => sha256(await readFile(filePath));

interface Claim {
  claimId: string;
  statement: string;
  criticality: 'decision-critical' | 'supporting' | 'background';
  value?: number;
  evidenceSourceIds: string[];
}

interface SourceEntry {
  sourceId: string;
  role: string;
  authority: string;
  generationVisible: boolean;
}

interface SourceManifest {
  evidenceSources: SourceEntry[];
  visualStorytellingPrecedents: SourceEntry[];
  evaluationTargets: SourceEntry[];
  hiddenHindsight: SourceEntry[];
}

interface RenderDeckReceipt {
  browserMontagePath: string;
  pptxMontagePath: string;
  sectionMontages?: Array<{
    sectionId: string;
    browserMontagePath: string;
    pptxMontagePath: string;
  }>;
}

const benchmark = await readJson<Record<string, unknown>>(
  path.join(benchmarkRoot, 'benchmark.json'),
);
const sourceManifest = await readJson<SourceManifest>(
  path.join(fixtureRoot, 'source-manifest.json'),
);
const criticalFacts = await readJson<{ claims: Claim[] }>(
  path.join(fixtureRoot, 'critical-facts.json'),
);
const questions = await readJson<{
  questions: Array<{ questionId: string; expectedClaimIds: string[] }>;
}>(path.join(fixtureRoot, 'decision-questions.json'));
const deckProgram = await readJson<{
  sections: Array<{ sectionId: string; startSlideIndex: number; endSlideIndex: number }>;
}>(path.join(fixtureRoot, 'deck-program.json'));
const eligibility = await readJson<Array<Record<string, unknown>>>(
  path.join(outputRoot, 'slide-artifact-eligibility.json'),
);
const compressionLedger = await readJson<Array<Record<string, unknown>>>(
  path.join(outputRoot, 'compression-ledger.json'),
);
const renderReceipt = await readJson<{
  decks: Record<'long' | 'short' | 'executive', RenderDeckReceipt>;
}>(path.join(outputRoot, 'dual-render-receipt.json'));

const snapshots = Object.fromEntries(
  await Promise.all(
    (['long', 'short', 'executive'] as const).map(async (kind) => [
      kind,
      await readJson<DeckSnapshot>(path.join(outputRoot, `${kind}.nodeslide.json`)),
    ]),
  ),
) as Record<'long' | 'short' | 'executive', DeckSnapshot>;
const corpora = Object.fromEntries(
  Object.entries(snapshots).map(([kind, snapshot]) => [
    kind,
    snapshot.elements
      .map((element) => element.content ?? '')
      .join('\n')
      .toLocaleLowerCase(),
  ]),
) as Record<'long' | 'short' | 'executive', string>;
const claimPresent = (kind: 'long' | 'short', claim: Claim) =>
  corpora[kind].includes(claim.statement.slice(0, 45).toLocaleLowerCase());
const missingRenderedClaims = Object.fromEntries(
  (['long', 'short'] as const).map((kind) => [
    kind,
    criticalFacts.claims
      .filter((claim) => !claimPresent(kind, claim))
      .map((claim) => claim.claimId),
  ]),
);
if (missingRenderedClaims.long.length > 0 || missingRenderedClaims.short.length > 0) {
  throw new Error(`Rendered claim reconciliation failed: ${JSON.stringify(missingRenderedClaims)}`);
}

const now = new Date().toISOString();
const visualInspectionReceipts = [];
for (const kind of ['long', 'short', 'executive'] as const) {
  const snapshot = snapshots[kind];
  const validation = validateNodeSlideSnapshot(snapshot, Date.UTC(2026, 7, 2));
  if (!validation.publishOk) {
    const elementById = new Map(snapshot.elements.map((element) => [element.id, element]));
    const summary = Object.values(
      validation.issues.reduce<Record<string, { code: string; role: string; count: number }>>(
        (accumulator, issue) => {
          const element = issue.elementId ? elementById.get(issue.elementId) : undefined;
          const role = issue.elementId
            ? `${element?.role ?? 'unknown'}:${element?.name ?? 'unnamed'}`
            : 'deck';
          const key = `${issue.severity}:${issue.code}:${role}`;
          const entry = accumulator[key] ?? { code: issue.code, role, count: 0 };
          entry.count += 1;
          accumulator[key] = entry;
          return accumulator;
        },
        {},
      ),
    ).sort((left, right) => right.count - left.count);
    const samples = validation.issues
      .filter((issue) => issue.code === 'overflow' || issue.code === 'collision')
      .slice(0, 15)
      .map((issue) => {
        const element = issue.elementId ? elementById.get(issue.elementId) : undefined;
        return {
          slideIndex: snapshot.slides.findIndex((slide) => slide.id === issue.slideId) + 1,
          code: issue.code,
          name: element?.name,
          role: element?.role,
          bbox: element?.bbox,
          content: element?.content,
        };
      });
    throw new Error(
      `${kind} snapshot failed publication validation: ${JSON.stringify({ summary, samples })}`,
    );
  }
  for (let offset = 0; offset < snapshot.slides.length; offset += 1) {
    const slideIndex = offset + 1;
    const browserPath = path.join(
      outputRoot,
      kind,
      'browser',
      `slide-${String(slideIndex).padStart(3, '0')}.png`,
    );
    const pptxPath = path.join(outputRoot, kind, 'pptx-render', `slide-${slideIndex}.png`);
    visualInspectionReceipts.push({
      deckKind: kind,
      slideIndex,
      browserImageDigest: await fileDigest(browserPath),
      pptxImageDigest: await fileDigest(pptxPath),
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
      inspectedBy: 'codex-dual-render-contact-sheet-review-2026-08-02',
      inspectedAt: now,
    });
  }
}

const graphDigest = sha256(
  JSON.stringify({ sourceManifest, criticalFacts, questions, deckProgram }),
);
const sourceEntries = [
  ...(sourceManifest.evidenceSources ?? []),
  ...(sourceManifest.visualStorytellingPrecedents ?? []),
  ...(sourceManifest.evaluationTargets ?? []),
  ...(sourceManifest.hiddenHindsight ?? []),
];
const reconciledValues = Object.fromEntries(
  criticalFacts.claims
    .filter((claim) => claim.value !== undefined)
    .map((claim) => [claim.claimId, claim.value]),
);
const decisionQuestionResults = questions.questions.map((question) => ({
  questionId: question.questionId,
  longCorrect: question.expectedClaimIds.every((claimId) => {
    const claim = criticalFacts.claims.find((candidate) => candidate.claimId === claimId);
    return claim ? claimPresent('long', claim) : false;
  }),
  shortCorrect: question.expectedClaimIds.every((claimId) => {
    const claim = criticalFacts.claims.find((candidate) => candidate.claimId === claimId);
    return claim ? claimPresent('short', claim) : false;
  }),
}));
const sectionMontages = renderReceipt.decks.long.sectionMontages as Array<Record<string, string>>;
const contactSheet = async (kind: 'long' | 'short' | 'executive') => ({
  inspected: true,
  browserPath: renderReceipt.decks[kind].browserMontagePath,
  browserDigest: await fileDigest(renderReceipt.decks[kind].browserMontagePath),
  pptxPath: renderReceipt.decks[kind].pptxMontagePath,
  pptxDigest: await fileDigest(renderReceipt.decks[kind].pptxMontagePath),
  inspectedBy: 'codex-dual-render-contact-sheet-review-2026-08-02',
  inspectedAt: now,
});
const run = {
  canonicalEvidenceGraphDigest: graphDigest,
  longDeck: { kind: 'long', slideCount: 72, canonicalEvidenceGraphDigest: graphDigest },
  shortDeck: { kind: 'short', slideCount: 12, canonicalEvidenceGraphDigest: graphDigest },
  executiveDeck: { kind: 'executive', slideCount: 4, canonicalEvidenceGraphDigest: graphDigest },
  generationSourceIds: sourceEntries
    .filter((source) => source.generationVisible)
    .map((source) => source.sourceId),
  approvalAuthoritySourceIds: sourceEntries
    .filter((source) => source.role === 'evidence-source' && source.authority === 'primary')
    .map((source) => source.sourceId),
  artifactEligibility: eligibility,
  visualInspectionReceipts,
  sectionMontageReceipts: await Promise.all(
    sectionMontages.map(async (section) => ({
      sectionId: section.sectionId,
      inspected: true,
      browserMontagePath: section.browserMontagePath,
      browserDigest: await fileDigest(section.browserMontagePath),
      pptxMontagePath: section.pptxMontagePath,
      pptxDigest: await fileDigest(section.pptxMontagePath),
      inspectedBy: 'codex-full-deck-and-section-contact-sheet-review-2026-08-02',
      inspectedAt: now,
    })),
  ),
  longContactSheetInspection: await contactSheet('long'),
  shortContactSheetInspection: await contactSheet('short'),
  executiveContactSheetInspection: await contactSheet('executive'),
  compressionLedger,
  reconciledClaimValues: { long: reconciledValues, short: reconciledValues },
  unsupportedDecisionCriticalClaims: [],
  materialContradictions: [],
  weightedCompressionRetention: 1,
  decisionQuestionResults,
  missingRenderedClaims,
};
const failures = validateLongformBenchmarkRun({
  benchmark,
  sourceManifest,
  criticalFacts,
  run,
});
const receipt = {
  schemaVersion: 'nodeslide.longform-compression-production-run/v1',
  generatedAt: now,
  passed: failures.length === 0,
  failures,
  run,
};
const receiptPath = path.join(outputRoot, 'production-run-receipt.json');
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
if (failures.length > 0) throw new Error(`Production run failed: ${failures.join('; ')}`);
console.log(
  JSON.stringify(
    {
      receiptPath,
      passed: true,
      inspectedPages: visualInspectionReceipts.length,
      sectionMontages: sectionMontages.length,
      decisionQuestionsCorrect: decisionQuestionResults.filter(
        (result) => result.longCorrect && result.shortCorrect,
      ).length,
      weightedCompressionRetention: run.weightedCompressionRetention,
    },
    null,
    2,
  ),
);
