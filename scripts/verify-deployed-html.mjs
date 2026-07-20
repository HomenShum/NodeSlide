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
  const expectedEntry = hashedEntry(distHtml, 'locally gated dist HTML');
  const deployedEntry = hashedEntry(deployedHtml, 'authenticated deployment HTML');
  if (deployedEntry !== expectedEntry) {
    throw new Error('Authenticated immutable deployment served a different bundle entry.');
  }
  return expectedEntry;
}

function hashedEntry(html, label) {
  const match = String(html).match(/\/assets\/index-[\w-]+\.js/);
  if (!match) throw new Error(`${label} did not reference a hashed application entry.`);
  return match[0];
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
