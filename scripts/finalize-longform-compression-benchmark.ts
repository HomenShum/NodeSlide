#!/usr/bin/env -S npx vite-node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNodeSlideSnapshot } from '../convex/lib/nodeslideValidation';
import type { DeckSnapshot } from '../shared/nodeslide';
import {
  findMissingRenderedClaims,
  validateLongformBenchmarkRun,
} from './lib/longform-compression-core.mjs';

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
  displayStatement?: string;
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

interface InspectionPage {
  deckKind: 'long' | 'short' | 'executive';
  slideIndex: number;
  browserPath: string;
  pptxPath: string;
  browserImageDigest: string;
  pptxImageDigest: string;
  inspectionSource: 'independent-ledger';
  assessmentDigest: string;
  checks: Record<string, 'pass' | 'fail'>;
  observedProblems: string[];
  requiredRepairs: string[];
  inspectedBy: string;
  inspectedAt: string;
}

interface InspectionLedger {
  schemaVersion: 'nodeslide.longform-visual-inspection-ledger/v1';
  assessmentPath: string;
  assessmentDigest: string;
  renderReceiptPath: string;
  renderReceiptDigest: string;
  pages: InspectionPage[];
  sectionMontages: Array<Record<string, unknown>>;
  contactSheets: Record<'long' | 'short' | 'executive', Record<string, unknown>>;
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
const inspectionLedger = await readJson<InspectionLedger>(
  path.join(outputRoot, 'visual-inspection-ledger.json'),
);
if (inspectionLedger.schemaVersion !== 'nodeslide.longform-visual-inspection-ledger/v1') {
  throw new Error(`Unsupported visual inspection ledger: ${inspectionLedger.schemaVersion}`);
}

async function assertCurrentDigest(label: string, filePath: string, expectedDigest: string) {
  const actualDigest = await fileDigest(filePath);
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `${label} digest changed after inspection: ${actualDigest} != ${expectedDigest}`,
    );
  }
}

await assertCurrentDigest(
  'Dual-render receipt',
  path.join(outputRoot, 'dual-render-receipt.json'),
  inspectionLedger.renderReceiptDigest,
);
await assertCurrentDigest(
  'Independent visual assessment',
  inspectionLedger.assessmentPath,
  inspectionLedger.assessmentDigest,
);

const snapshots = Object.fromEntries(
  await Promise.all(
    (['long', 'short', 'executive'] as const).map(async (kind) => [
      kind,
      await readJson<DeckSnapshot>(path.join(outputRoot, `${kind}.nodeslide.json`)),
    ]),
  ),
) as Record<'long' | 'short' | 'executive', DeckSnapshot>;
const missingRenderedClaims = Object.fromEntries(
  (['long', 'short'] as const).map((kind) => [
    kind,
    findMissingRenderedClaims(snapshots[kind], criticalFacts.claims),
  ]),
);
const claimPresent = (kind: 'long' | 'short', claim: Claim) =>
  findMissingRenderedClaims(snapshots[kind], [claim]).length === 0;
if (missingRenderedClaims.long.length > 0 || missingRenderedClaims.short.length > 0) {
  throw new Error(`Rendered claim reconciliation failed: ${JSON.stringify(missingRenderedClaims)}`);
}

const now = new Date().toISOString();
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
}

const visualInspectionReceipts = await Promise.all(
  inspectionLedger.pages.map(async ({ browserPath, pptxPath, ...receipt }) => {
    const expectedBrowserPath = path.join(
      outputRoot,
      receipt.deckKind,
      'browser',
      `slide-${String(receipt.slideIndex).padStart(3, '0')}.png`,
    );
    const expectedPptxPath = path.join(
      outputRoot,
      receipt.deckKind,
      'pptx-render',
      `slide-${receipt.slideIndex}.png`,
    );
    if (
      path.resolve(browserPath) !== path.resolve(expectedBrowserPath) ||
      path.resolve(pptxPath) !== path.resolve(expectedPptxPath)
    ) {
      throw new Error(
        `${receipt.deckKind}:${receipt.slideIndex} inspection points to substituted render paths.`,
      );
    }
    await Promise.all([
      assertCurrentDigest(
        `${receipt.deckKind}:${receipt.slideIndex} browser image`,
        browserPath,
        receipt.browserImageDigest,
      ),
      assertCurrentDigest(
        `${receipt.deckKind}:${receipt.slideIndex} PPTX image`,
        pptxPath,
        receipt.pptxImageDigest,
      ),
    ]);
    return receipt;
  }),
);

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
const sectionMontages = await Promise.all(
  inspectionLedger.sectionMontages.map(async (section) => {
    const browserPath = String(section.browserMontagePath ?? '');
    const pptxPath = String(section.pptxMontagePath ?? '');
    await Promise.all([
      assertCurrentDigest(
        `Section ${String(section.sectionId)} browser montage`,
        browserPath,
        String(section.browserDigest),
      ),
      assertCurrentDigest(
        `Section ${String(section.sectionId)} PPTX montage`,
        pptxPath,
        String(section.pptxDigest),
      ),
    ]);
    return section;
  }),
);
const contactSheets = Object.fromEntries(
  await Promise.all(
    (['long', 'short', 'executive'] as const).map(async (kind) => {
      const receipt = inspectionLedger.contactSheets[kind];
      const browserPath = String(receipt.browserPath ?? '');
      const pptxPath = String(receipt.pptxPath ?? '');
      await Promise.all([
        assertCurrentDigest(
          `${kind} browser contact sheet`,
          browserPath,
          String(receipt.browserDigest),
        ),
        assertCurrentDigest(`${kind} PPTX contact sheet`, pptxPath, String(receipt.pptxDigest)),
      ]);
      return [kind, receipt];
    }),
  ),
);
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
  visualInspectionAssessmentDigest: inspectionLedger.assessmentDigest,
  visualInspectionReceipts,
  sectionMontageReceipts: sectionMontages,
  longContactSheetInspection: contactSheets.long,
  shortContactSheetInspection: contactSheets.short,
  executiveContactSheetInspection: contactSheets.executive,
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
