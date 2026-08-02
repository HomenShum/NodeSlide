#!/usr/bin/env -S npx vite-node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, 'outputs/longform-compression-v1/staar-alcon');
const renderReceiptPath = path.join(outputRoot, 'dual-render-receipt.json');
const ledgerPath = path.join(outputRoot, 'visual-inspection-ledger.json');
const REQUIRED_CHECKS = [
  'overlap',
  'clipping',
  'minimumType',
  'sourceLegibility',
  'visualHierarchy',
  'semanticVisualFit',
  'density',
  'exportParity',
] as const;
const requiredCounts = { long: 72, short: 12, executive: 4 } as const;

const sha256 = (bytes: Uint8Array | string) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const digestFile = async (filePath: string) => sha256(await readFile(filePath));
const readJson = async <T>(filePath: string) => JSON.parse(await readFile(filePath, 'utf8')) as T;

const assessmentArgIndex = process.argv.indexOf('--assessment');
const assessmentPathValue =
  assessmentArgIndex >= 0 ? process.argv[assessmentArgIndex + 1] : undefined;
if (!assessmentPathValue) {
  throw new Error('Usage: record-longform-compression-inspection.ts --assessment <path>');
}
const assessmentPath = path.resolve(repoRoot, assessmentPathValue);
const assessmentBytes = await readFile(assessmentPath);
const assessment = JSON.parse(assessmentBytes.toString('utf8')) as {
  schemaVersion: string;
  reviewer: string;
  reviewedAt: string;
  renderReceiptDigest: string;
  reviewedPageKeys: string[];
  sectionIds: string[];
  contactSheetKinds: string[];
  checks: Record<(typeof REQUIRED_CHECKS)[number], 'pass' | 'fail'>;
  observedProblems?: Record<string, string[]>;
  requiredRepairs?: Record<string, string[]>;
};
if (assessment.schemaVersion !== 'nodeslide.longform-visual-assessment/v1') {
  throw new Error(`Unsupported visual assessment schema: ${assessment.schemaVersion}`);
}
if (!assessment.reviewer?.trim() || !assessment.reviewedAt) {
  throw new Error('Visual assessment requires a reviewer and reviewedAt timestamp.');
}
for (const check of REQUIRED_CHECKS) {
  if (!['pass', 'fail'].includes(assessment.checks?.[check])) {
    throw new Error(`Visual assessment is missing check ${check}.`);
  }
}

const renderReceiptBytes = await readFile(renderReceiptPath);
const renderReceiptDigest = sha256(renderReceiptBytes);
if (assessment.renderReceiptDigest !== renderReceiptDigest) {
  throw new Error(
    `Visual assessment targets ${assessment.renderReceiptDigest}; current render receipt is ${renderReceiptDigest}.`,
  );
}
const renderReceipt = JSON.parse(renderReceiptBytes.toString('utf8')) as {
  decks: Record<
    keyof typeof requiredCounts,
    {
      browserDir: string;
      pptxDir: string;
      browserMontagePath: string;
      pptxMontagePath: string;
      sectionMontages: Array<{
        sectionId: string;
        browserMontagePath: string;
        pptxMontagePath: string;
      }>;
    }
  >;
};
const expectedPageKeys = Object.entries(requiredCounts).flatMap(([kind, count]) =>
  Array.from({ length: count }, (_, offset) => `${kind}:${offset + 1}`),
);
if (
  assessment.reviewedPageKeys.length !== expectedPageKeys.length ||
  new Set(assessment.reviewedPageKeys).size !== expectedPageKeys.length ||
  expectedPageKeys.some((key) => !assessment.reviewedPageKeys.includes(key))
) {
  throw new Error('Visual assessment must explicitly name every one of the 88 required pages.');
}
const expectedSectionIds = renderReceipt.decks.long.sectionMontages.map(
  (section) => section.sectionId,
);
if (
  assessment.sectionIds.length !== expectedSectionIds.length ||
  expectedSectionIds.some((sectionId) => !assessment.sectionIds.includes(sectionId))
) {
  throw new Error('Visual assessment must explicitly name all 14 long-deck section montages.');
}
if (
  assessment.contactSheetKinds.length !== 3 ||
  (Object.keys(requiredCounts) as Array<keyof typeof requiredCounts>).some(
    (kind) => !assessment.contactSheetKinds.includes(kind),
  )
) {
  throw new Error('Visual assessment must explicitly name all three full-deck contact sheets.');
}

const assessmentDigest = sha256(assessmentBytes);
const pages = [];
for (const [kind, count] of Object.entries(requiredCounts) as Array<
  [keyof typeof requiredCounts, number]
>) {
  for (let slideIndex = 1; slideIndex <= count; slideIndex += 1) {
    const key = `${kind}:${slideIndex}`;
    const browserPath = path.join(
      renderReceipt.decks[kind].browserDir,
      `slide-${String(slideIndex).padStart(3, '0')}.png`,
    );
    const pptxPath = path.join(renderReceipt.decks[kind].pptxDir, `slide-${slideIndex}.png`);
    pages.push({
      deckKind: kind,
      slideIndex,
      browserPath,
      pptxPath,
      browserImageDigest: await digestFile(browserPath),
      pptxImageDigest: await digestFile(pptxPath),
      inspectionSource: 'independent-ledger',
      assessmentDigest,
      checks: assessment.checks,
      observedProblems: assessment.observedProblems?.[key] ?? [],
      requiredRepairs: assessment.requiredRepairs?.[key] ?? [],
      inspectedBy: assessment.reviewer,
      inspectedAt: assessment.reviewedAt,
    });
  }
}
const sectionMontages = await Promise.all(
  renderReceipt.decks.long.sectionMontages.map(async (section) => ({
    ...section,
    inspected: true,
    inspectionSource: 'independent-ledger',
    assessmentDigest,
    browserDigest: await digestFile(section.browserMontagePath),
    pptxDigest: await digestFile(section.pptxMontagePath),
    inspectedBy: assessment.reviewer,
    inspectedAt: assessment.reviewedAt,
  })),
);
const contactSheets = Object.fromEntries(
  await Promise.all(
    (Object.keys(requiredCounts) as Array<keyof typeof requiredCounts>).map(async (kind) => [
      kind,
      {
        inspected: true,
        inspectionSource: 'independent-ledger',
        assessmentDigest,
        browserPath: renderReceipt.decks[kind].browserMontagePath,
        browserDigest: await digestFile(renderReceipt.decks[kind].browserMontagePath),
        pptxPath: renderReceipt.decks[kind].pptxMontagePath,
        pptxDigest: await digestFile(renderReceipt.decks[kind].pptxMontagePath),
        inspectedBy: assessment.reviewer,
        inspectedAt: assessment.reviewedAt,
      },
    ]),
  ),
);
const ledger = {
  schemaVersion: 'nodeslide.longform-visual-inspection-ledger/v1',
  assessmentPath,
  assessmentDigest,
  renderReceiptPath,
  renderReceiptDigest,
  pages,
  sectionMontages,
  contactSheets,
};
await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      ledgerPath,
      assessmentDigest,
      renderReceiptDigest,
      pages: pages.length,
      sectionMontages: sectionMontages.length,
      contactSheets: Object.keys(contactSheets).length,
    },
    null,
    2,
  ),
);
