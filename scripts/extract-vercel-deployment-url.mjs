#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Extracts one immutable Vercel deployment origin from CLI output while
 * excluding the canonical production alias. Repeated mentions of the same
 * immutable URL are allowed; multiple distinct immutable URLs fail closed.
 */
export function extractVercelDeploymentUrl(output, canonicalUrl) {
  const canonicalOrigin = cleanVercelOrigin(canonicalUrl, 'canonical production URL');
  const matches = String(output).match(/https:\/\/[A-Za-z0-9.-]+\.vercel\.app\b/gi) ?? [];
  const candidates = [
    ...new Set(
      matches
        .map((value) => cleanVercelOrigin(value, 'Vercel CLI output URL'))
        .filter((origin) => origin !== canonicalOrigin),
    ),
  ];
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? 'Vercel CLI output did not contain an immutable deployment URL.'
        : 'Vercel CLI output contained multiple immutable deployment URLs.',
    );
  }
  return candidates[0];
}

function cleanVercelOrigin(value, label) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !/^[A-Za-z0-9.-]+\.vercel\.app$/i.test(url.hostname)
  ) {
    throw new Error(`${label} must be a clean HTTPS vercel.app origin.`);
  }
  return url.origin;
}

async function main() {
  const [logPath, canonicalUrl] = process.argv.slice(2);
  if (!logPath || !canonicalUrl) {
    throw new Error('Usage: extract-vercel-deployment-url.mjs <cli-log> <canonical-url>');
  }
  process.stdout.write(
    `${extractVercelDeploymentUrl(await readFile(logPath, 'utf8'), canonicalUrl)}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
