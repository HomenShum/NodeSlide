import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.NODESLIDE_PROOF_URL ?? 'https://nodeslide.vercel.app/';
const outputDir = resolve(process.argv[2] ?? 'artifacts/web-research-proof');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1512, height: 900 },
  recordVideo: { dir: outputDir, size: { width: 1512, height: 900 } },
});
const page = await context.newPage();
const video = page.video();
const browserIssues = [];
page.on('console', (message) => {
  if (message.type() === 'error') browserIssues.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => browserIssues.push(`pageerror: ${error.message}`));

const instruction =
  'Research the official OpenAI Responses API migration guide. Replace the selected text exactly with "Migrate to the Responses API." Cite the retrieved source that supports this claim.';

let receipt;
let failure;
try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  const firstRunExplore = page.getByTestId('first-run-explore');
  if (await firstRunExplore.isVisible().catch(() => false)) {
    await firstRunExplore.click();
  } else {
    await page.getByRole('button', { name: 'Explore the editable sample workspace' }).click();
  }
  await page.getByTestId('nodeslide-studio').waitFor({ timeout: 30_000 });

  const editableText = page
    .getByTestId('slide-canvas')
    .getByRole('button', { name: /text slide element/i })
    .first();
  await editableText.click();
  await page.getByTestId('inspector-tab-ai').click();

  await page.getByTestId('ai-model-select').click();
  await page.getByRole('option', { name: /Deterministic/ }).click();

  const webToggle = page.getByTestId('ai-web-research-toggle');
  await webToggle.click();
  if ((await webToggle.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('Web research did not remain enabled after explicit consent toggle.');
  }

  await page.getByRole('textbox', { name: 'AI instruction' }).fill(instruction);
  await page.screenshot({ path: join(outputDir, '01-consented-request.png') });
  const proposalCountBefore = await page.getByTestId('proposal-card').count();
  const errorCountBefore = await page.getByTestId('agent-thread-error').count();
  await page.getByTestId('ai-submit').click();

  await page.waitForFunction(
    ({ proposals, errors }) =>
      document.querySelectorAll('[data-testid="proposal-card"]').length > proposals ||
      document.querySelectorAll('[data-testid="agent-thread-error"]').length > errors,
    { proposals: proposalCountBefore, errors: errorCountBefore },
    { timeout: 180_000 },
  );
  const runErrors = page.getByTestId('agent-thread-error');
  if ((await runErrors.count()) > errorCountBefore) {
    throw new Error(`Research run failed: ${await runErrors.last().innerText()}`);
  }
  const proposal = page.getByTestId('proposal-card').last();
  await page.screenshot({ path: join(outputDir, '02-reviewable-proposal.png') });

  const candidateReceipt = page.getByTestId('candidate-receipt');
  await candidateReceipt.getByRole('button', { name: 'Accept', exact: true }).click();
  await candidateReceipt.waitFor({ state: 'hidden', timeout: 60_000 });

  await page.getByTestId('inspector-tab-data').click();
  const sourceArticles = page.locator('.ns-source-list article');
  await sourceArticles.first().waitFor({ timeout: 30_000 });
  const sourceCount = await sourceArticles.count();
  let provenArticle = null;
  for (let index = 0; index < sourceCount; index += 1) {
    const article = sourceArticles.nth(index);
    if (
      (await article.getByTestId('evidence-snapshot-toggle').count()) > 0 &&
      (await article.getByTestId('evidence-citing-element').count()) > 0
    ) {
      provenArticle = article;
      break;
    }
  }
  if (!provenArticle) {
    const candidates = await sourceArticles.evaluateAll((articles) =>
      articles.map((article) => ({
        title: article.querySelector('strong')?.textContent?.trim() ?? '',
        excerpt:
          article.querySelector('[data-testid="evidence-excerpt"]')?.textContent?.trim() ?? '',
        hasSnapshot: article.querySelector('[data-testid="evidence-snapshot-toggle"]') !== null,
        citingElements: article.querySelectorAll('[data-testid="evidence-citing-element"]').length,
      })),
    );
    throw new Error(
      `No persisted web source had both a snapshot and a citing slide element. Candidates: ${JSON.stringify(candidates)}`,
    );
  }

  const citingElement = provenArticle.getByTestId('evidence-citing-element').first();
  const citingElementText = (await citingElement.innerText()).trim();
  await citingElement.click();
  await page.getByTestId('inspector-tab-data').click();
  const reopenedArticle = page.locator('.ns-source-list article').filter({
    has: page.getByTestId('evidence-citing-element').filter({ hasText: citingElementText }),
  });
  await reopenedArticle.getByTestId('evidence-snapshot-toggle').click();
  const region = reopenedArticle.getByTestId('evidence-snapshot-region');
  await region.waitFor({ timeout: 30_000 });
  const highlightCount = await region.getByTestId('evidence-snapshot-highlight').count();
  const binding = (
    await reopenedArticle.getByTestId('evidence-snapshot-binding').innerText()
  ).trim();
  if (highlightCount < 1 || !binding.startsWith('Claim region bound to ')) {
    throw new Error(`Snapshot region was not claim-bound: ${binding}`);
  }

  await page.screenshot({
    path: join(outputDir, '03-snapshot-region-citing-element.png'),
    fullPage: true,
  });

  const articleText = await reopenedArticle.innerText();
  const provider = articleText.match(/immutable excerpt returned by ([^,]+),/i)?.[1] ?? 'unknown';
  const sourceTitle = (await reopenedArticle.locator('strong').first().innerText()).trim();
  receipt = {
    schemaVersion: 'nodeslide.web-research-proof/v1',
    capturedAt: new Date().toISOString(),
    productionUrl: page.url(),
    instruction,
    consent: {
      control: 'Toggle web research',
      enabledBeforeSubmit: true,
    },
    proposal: {
      reviewableBeforeMutation: true,
      acceptedExplicitly: true,
    },
    evidence: {
      sourceTitle,
      provider,
      snapshotOpenedFromCitingElement: true,
      citingElement: citingElementText,
      highlightedRegionCount: highlightCount,
      binding,
    },
    browserIssues,
    status: browserIssues.length === 0 ? 'passed' : 'passed_with_browser_issues',
    screenshots: [
      '01-consented-request.png',
      '02-reviewable-proposal.png',
      '03-snapshot-region-citing-element.png',
    ],
  };
} catch (error) {
  failure = error;
  await page
    .screenshot({ path: join(outputDir, 'failure.png'), fullPage: true })
    .catch(() => undefined);
  receipt = {
    schemaVersion: 'nodeslide.web-research-proof/v1',
    capturedAt: new Date().toISOString(),
    productionUrl: page.url(),
    instruction,
    browserIssues,
    status: 'failed',
    failure: error instanceof Error ? error.message : 'Unknown proof failure.',
    screenshots: ['failure.png'],
  };
} finally {
  await writeFile(join(outputDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  await context.close();
  await browser.close();
}

if (video) {
  const rawVideoPath = await video.path();
  await rename(rawVideoPath, join(outputDir, 'nodeslide-web-research-proof.webm'));
}

console.log(JSON.stringify(receipt, null, 2));
if (failure) throw failure;
