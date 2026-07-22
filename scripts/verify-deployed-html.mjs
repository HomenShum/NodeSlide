#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Binds an authenticated immutable-deployment response to the exact bundle
 * entry that passed local build and smoke gates. A Vercel login page, stale
 * deployment, or malformed HTML all fail closed without logging response data.
 */
export function verifyDeployedHtml(distHtml, deployedHtml) {
  const expectedAssets = hashedAssets(distHtml, 'locally gated dist HTML');
  const deployedAssets = hashedAssets(deployedHtml, 'authenticated deployment HTML');
  if (JSON.stringify(deployedAssets) !== JSON.stringify(expectedAssets)) {
    throw new Error('Authenticated deployment served a different hashed asset manifest.');
  }
  return expectedAssets.find((asset) => asset.endsWith('.js'));
}

function hashedAssets(html, label) {
  const assets = [
    ...new Set(
      [
        ...String(html).matchAll(
          /(?:src|href)=["'](\/assets\/[A-Za-z0-9._/-]+\.(?:css|js))["']/giu,
        ),
      ].map((match) => match[1]),
    ),
  ].sort();
  if (!assets.some((asset) => asset.endsWith('.js'))) {
    throw new Error(`${label} did not reference a hashed application entry.`);
  }
  return assets;
}

async function main() {
  const [distHtmlPath, deployedHtmlPath] = process.argv.slice(2);
  if (!distHtmlPath || !deployedHtmlPath) {
    throw new Error('Usage: verify-deployed-html.mjs <dist-html> <downloaded-deployment-html>');
  }
  const expectedEntry = verifyDeployedHtml(
    await readFile(distHtmlPath, 'utf8'),
    await readFile(deployedHtmlPath, 'utf8'),
  );
  process.stdout.write(
    `[verify-deployed-html] PASS immutable deployment serves ${expectedEntry}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
