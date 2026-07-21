import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const repoRoot = resolve(import.meta.dirname, '..');
const outputDir = resolve(repoRoot, 'docs/demo');
const receiptPath = resolve(outputDir, 'nodeslide-k2-story-context-proof.receipt.json');
await mkdir(outputDir, { recursive: true });

const bundled = await build({
  absWorkingDir: repoRoot,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  write: false,
  stdin: {
    resolveDir: repoRoot,
    sourcefile: 'story-context-proof-entry.ts',
    loader: 'ts',
    contents: `
      import { buildBriefNodeSlide, deterministicBriefSpec } from './convex/lib/nodeslideSeed.ts';
      const brief = {
        prompt: 'Create a 7-slide launch review with a revenue chart, an architecture diagram, a product screenshot, a code sample, and an execution trace.',
        audience: 'engineering and product leaders',
        purpose: 'Decide whether the launch is ready to expand',
        successCriteria: ['Make the evidence boundary obvious', 'Name the rollout owner'],
      };
      const attachments = [
        { title: 'revenue.csv', format: 'csv' as const, content: 'quarter,revenue\\nQ1,120\\nQ2,180' },
        { title: 'renderer.ts', format: 'txt' as const, content: 'export function render() {}' },
      ];
      const spec = deterministicBriefSpec('Launch review', brief, attachments);
      const built = buildBriefNodeSlide({
        deckId: 'deck_k2_story_context_proof',
        projectId: 'project_k2_story_context_proof',
        title: spec.title,
        brief,
        themeId: 'editorial-signal',
        rawSpec: {
          ...spec,
          materialInventory: {
            materials: [{ id: 'provider-lie', kind: 'screenshot', status: 'available' }],
            availableKinds: ['screenshot'],
            constructibleKinds: [],
            blockedKinds: [],
          },
        },
        attachments,
        now: 1_700_000_000_000,
      });
      export const proof = {
        storySpec: built.spec.storySpec,
        materialInventory: built.spec.materialInventory,
      };
    `,
  },
});
const bundleText = bundled.outputFiles[0]?.text;
if (!bundleText) throw new Error('Story-context proof bundle was empty.');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundleText).toString('base64')}`;
const { proof } = await import(moduleUrl);

const materials = proof.materialInventory?.materials ?? [];
const screenshot = materials.find((material) => material.kind === 'screenshot');
const chart = materials.find((material) => material.kind === 'numeric-series');
const providerLieSurvived = materials.some((material) => material.id === 'provider-lie');
const pacingTotal = (proof.storySpec?.pacing ?? []).reduce(
  (sum, phase) => sum + phase.slideCount,
  0,
);
const checks = {
  storySpecPersisted: Boolean(proof.storySpec),
  narrativeJobRecorded: Boolean(proof.storySpec?.narrativeJob),
  materialInventoryPersisted: Boolean(proof.materialInventory),
  pacingTotalsSevenSlides: pacingTotal === 7,
  chartIsConstructibleFromSuppliedData: chart?.status === 'constructible',
  screenshotRemainsPlaceholder: screenshot?.status === 'placeholder',
  screenshotIsBlockedProof: (proof.storySpec?.proofObligations ?? []).some(
    (obligation) =>
      obligation.requiredMaterialKinds.includes('screenshot') &&
      obligation.fulfillment === 'blocked',
  ),
  providerCannotPromoteScreenshot: !providerLieSurvived,
};
const receipt = {
  schemaVersion: 'nodeslide.story-context-proof/v1',
  generatedAt: new Date().toISOString(),
  status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
  checks,
  storySpec: proof.storySpec,
  materialInventory: proof.materialInventory,
};
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
execFileSync(
  process.execPath,
  [resolve(repoRoot, 'node_modules/@biomejs/biome/bin/biome'), 'format', '--write', receiptPath],
  { cwd: repoRoot, stdio: 'ignore' },
);
console.log(JSON.stringify(receipt, null, 2));
if (receipt.status !== 'passed') process.exitCode = 1;
