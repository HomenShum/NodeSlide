import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.NODESLIDE_PROOF_URL ?? 'https://nodeslide.vercel.app/';
const outputDir = resolve(process.argv[2] ?? 'artifacts/e4-camera-proof');
const downloadsDir = join(outputDir, 'downloads');
await mkdir(downloadsDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1512, height: 900 },
  recordVideo: { dir: outputDir, size: { width: 1512, height: 900 } },
  acceptDownloads: true,
});
const page = await context.newPage();
const video = page.video();
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.error(`[browser:${message.type()}] ${message.text()}`);
  }
});
page.on('pageerror', (error) => console.error(`[browser:pageerror] ${error.message}`));

const pause = (milliseconds = 650) => page.waitForTimeout(milliseconds);
const shot = (name) => page.screenshot({ path: join(outputDir, `${name}.png`) });

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  const firstRunExplore = page.getByTestId('first-run-explore');
  if (await firstRunExplore.isVisible().catch(() => false)) {
    await firstRunExplore.click();
  } else {
    await page.getByRole('button', { name: 'Explore the editable sample workspace' }).click();
  }
  await page.getByTestId('nodeslide-studio').waitFor({ timeout: 30_000 });
  await pause();
  await shot('01-sample-workspace');

  await page.getByRole('button', { name: 'Slide 3: A deck is a typed system' }).click();
  await page.getByRole('button', { name: 'Editable image, image slide element' }).click();
  await page.getByRole('tab', { name: 'Design' }).click();
  await page.getByTestId('licensed-image-query').fill('circuit board');
  await pause();
  await shot('02-query-ready');

  await page.getByTestId('licensed-image-search-button').click();
  await page.getByTestId('licensed-image-results').waitFor({ timeout: 30_000 });
  await pause(900);
  await shot('03-licensed-results');

  const result = page.getByTestId('licensed-image-results').getByRole('button').first();
  await result.click();
  const credit = page.getByRole('textbox', { name: 'Credit' });
  await credit.waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const input = document.querySelector('input[name="credit"]');
      return input instanceof HTMLInputElement && input.value.includes('Twechie');
    },
    undefined,
    { timeout: 30_000 },
  );
  await page
    .getByTestId('slide-canvas')
    .getByText('Twechie · BY-SA 2.0 via Openverse', { exact: true })
    .waitFor();
  await pause(1_000);
  await shot('04-inserted-with-credit');

  await page.getByRole('button', { name: 'Export deck' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('export-pptx').click();
  const download = await downloadPromise;
  const pptxPath = join(downloadsDir, 'nodeslide-e4-licensed-image.pptx');
  await download.saveAs(pptxPath);
  await page.getByText('Validated PowerPoint export prepared.', { exact: true }).waitFor({
    timeout: 60_000,
  });
  await pause(1_000);
  await shot('05-clean-export');

  const pptx = await stat(pptxPath);
  await writeFile(
    join(outputDir, 'receipt.json'),
    `${JSON.stringify(
      {
        capability: 'E4',
        url: page.url(),
        query: 'circuit board',
        credit: await credit.inputValue(),
        validation: await page
          .getByRole('button', {
            name: 'Structure, presentation, and cleanup checks passed. Open validation details.',
          })
          .innerText(),
        export: { path: pptxPath, bytes: pptx.size },
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await context.close();
  await browser.close();
}

if (video) {
  const rawVideoPath = await video.path();
  await rename(rawVideoPath, join(outputDir, 'nodeslide-e4-camera.webm'));
}
