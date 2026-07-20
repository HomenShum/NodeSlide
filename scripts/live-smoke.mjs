#!/usr/bin/env node
/**
 * Verify that one or more live URLs serve the exact locally-gated production
 * bundle and mount the real landing DOM with zero browser errors.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const distDir = path.resolve(process.env.LIVE_SMOKE_DIST_DIR ?? 'dist');
const htmlPath = path.join(distDir, 'index.html');
const expectedConvexUrl = process.env.EXPECTED_CONVEX_URL;
const expectedConvexSiteUrl = process.env.EXPECTED_CONVEX_SITE_URL;
const retryTimeoutMs = boundedInteger(process.env.LIVE_SMOKE_RETRY_TIMEOUT_MS, 90_000, {
  min: 5_000,
  max: 300_000,
});

if (!existsSync(htmlPath)) fail(`dist/index.html not found at ${htmlPath}`);
if (!expectedConvexUrl || !expectedConvexSiteUrl) {
  fail('EXPECTED_CONVEX_URL and EXPECTED_CONVEX_SITE_URL are required');
}
if (expectedConvexSiteUrl !== expectedConvexUrl.replace('.convex.cloud', '.convex.site')) {
  fail('the expected Convex WebSocket and HTTP URLs do not describe the same deployment');
}

const urls = process.argv.slice(2).map(liveUrl);
if (urls.length === 0) fail('pass at least one live URL to verify');

const distHtml = readFileSync(htmlPath, 'utf8');
const entryMatch = distHtml.match(/\/assets\/index-[\w-]+\.js/);
if (!entryMatch) fail('local dist does not reference a hashed /assets/index-*.js entry');
const expectedEntry = entryMatch[0];
const entryPath = path.join(distDir, expectedEntry.replace(/^\//, '').replaceAll('/', path.sep));
if (!existsSync(entryPath)) fail(`local entry file is missing: ${expectedEntry}`);
const javascriptSources = javascriptFiles(distDir).map((file) => readFileSync(file, 'utf8'));
if (!javascriptSources.some((source) => source.includes(expectedConvexUrl))) {
  fail('local production bundle is not pinned to EXPECTED_CONVEX_URL');
}
// Vite currently tree-shakes convexHttpUrl(), so the HTTP/site URL may not be
// present in output. The workflow still supplies it explicitly, and the
// relationship check above prevents a mismatched deployment pair.
if (javascriptSources.some((source) => source.includes('ci-placeholder.convex'))) {
  fail('local production bundle still contains the CI placeholder Convex binding');
}

const browser = await chromium.launch();
let failed = false;
try {
  for (const url of urls) {
    try {
      await waitForMatchingHtml(url, expectedEntry, retryTimeoutMs);
      await verifyDom(browser, url);
      console.log(`[live-smoke] PASS ${url.origin} serves ${expectedEntry} and mounts cleanly`);
    } catch (error) {
      failed = true;
      console.error(
        `[live-smoke] FAIL ${url.origin}: ${redact(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }
} finally {
  await browser.close();
}

if (failed) process.exit(1);

async function waitForMatchingHtml(url, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
      });
      const html = await response.text();
      if (response.status === 200 && html.includes(expected)) return;
      last =
        response.status === 200
          ? 'served a different bundle entry'
          : `returned HTTP ${response.status}`;
    } catch (error) {
      last = redact(error instanceof Error ? error.message : String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`did not serve the gated bundle within ${timeoutMs}ms (last: ${last})`);
}

async function verifyDom(browserInstance, url) {
  const context = await browserInstance.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${redact(error.message)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${redact(message.text())}`);
  });
  try {
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (response?.status() !== 200)
      throw new Error(`browser navigation returned HTTP ${response?.status() ?? 'none'}`);
    const contentSecurityPolicy = response.headers()['content-security-policy'] ?? '';
    if (!contentSecurityPolicy.includes('https://api.openai.com')) {
      throw new Error('production CSP does not allow the explicit BYOK image-generation endpoint');
    }
    await page.getByTestId('nodeslide-landing').waitFor({ state: 'visible', timeout: 30_000 });
    if ((await page.getByTestId('deployment-configuration-error').count()) > 0) {
      throw new Error('deployment configuration guard rendered instead of the product');
    }
    await page.locator('.ns-landing-sample').waitFor({ state: 'visible' });
    await page.waitForTimeout(2_000);
    if (errors.length > 0) {
      throw new Error(
        `browser reported ${errors.length} runtime error(s): ${errors.slice(0, 3).join(' | ')}`,
      );
    }
  } finally {
    await context.close();
  }
}

function liveUrl(value) {
  const url = new URL(value);
  const allowHttp = process.env.LIVE_SMOKE_ALLOW_HTTP === '1';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    fail('live smoke URLs must use HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) {
    fail('live smoke URLs must not contain credentials, query parameters, or fragments');
  }
  return url;
}

function boundedInteger(value, fallback, { min, max }) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`LIVE_SMOKE_RETRY_TIMEOUT_MS must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function javascriptFiles(directory) {
  const assetsDirectory = path.join(directory, 'assets');
  if (!existsSync(assetsDirectory)) fail('local dist/assets directory is missing');
  return readdirSync(assetsDirectory)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(assetsDirectory, name));
}

function redact(value) {
  return String(value)
    .replace(/([?&](?:token|key|secret|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{64,}\b/g, '[REDACTED_LONG_VALUE]')
    .slice(0, 1_500);
}

function fail(message) {
  console.error(`[live-smoke] FAIL ${message}`);
  process.exit(1);
}
