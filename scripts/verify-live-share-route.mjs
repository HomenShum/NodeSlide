#!/usr/bin/env node
/**
 * Fail-closed live probe for the public share route.
 *
 * The pre-deploy gate proves the function's module graph links. This proves the
 * deployed route answers. They are different claims, and PR #74 is the reason
 * the difference matters: its build was green, its tests were green, and every
 * live request returned the platform's FUNCTION_INVOCATION_FAILED page because
 * the function never got past import.
 *
 * A share slug that does not resolve must produce NodeSlide's own rendered
 * refusal — a real page, with a real reason, that a reader and a link preview
 * can both understand. A platform error page is not a refusal: it means the
 * route is broken, not that the link is unavailable.
 *
 * Usage: node scripts/verify-live-share-route.mjs https://nodeslide.vercel.app
 */
import process from 'node:process';

const REQUEST_TIMEOUT_MS = 20_000;
/** Retry briefly: an alias can point at the new deployment a moment late. */
const RETRY_TIMEOUT_MS = boundedInteger(process.env.SHARE_PROBE_RETRY_TIMEOUT_MS, 120_000, {
  min: 5_000,
  max: 300_000,
});

/** Marks the platform's own failure page rather than an answer from our code. */
const PLATFORM_FAILURES = [
  'FUNCTION_INVOCATION_FAILED',
  'FUNCTION_INVOCATION_TIMEOUT',
  'DEPLOYMENT_NOT_FOUND',
  'NO_RESPONSE_FROM_FUNCTION',
];

/** Rendered by `refusalPage` in the share projection, and by nothing else. */
const REFUSAL_MARKERS = ['This presentation link is unavailable', 'Open NodeSlide'];

function boundedInteger(raw, fallback, { min, max }) {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function fail(message) {
  console.error(`[share-probe] FAIL ${message}`);
  process.exit(1);
}

function origin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`not a URL: ${raw}`);
  }
  if (url.protocol !== 'https:') fail(`share probe requires https: ${raw}`);
  return url.origin;
}

/** Strip tags and collapse whitespace, so "rendered reason" is measurable. */
function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function get(url) {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    bytes: Buffer.byteLength(body, 'utf8'),
    body,
    text: visibleText(body),
  };
}

/** A syntactically valid slug that cannot resolve to a publication. */
function unresolvableSlug() {
  return `share-${'0'.repeat(8)}${Date.now().toString(36)}probe`;
}

async function withRetry(label, attempt) {
  const deadline = Date.now() + RETRY_TIMEOUT_MS;
  let lastError;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  fail(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function assertRealRefusal(label, result) {
  const platform = PLATFORM_FAILURES.find((marker) => result.body.includes(marker));
  if (platform) {
    throw new Error(
      `${label} returned the platform error page (${platform}) with status ${result.status}. The function did not run.`,
    );
  }
  if (result.status !== 404) {
    throw new Error(`${label} returned ${result.status}, expected 404 for an unresolvable slug`);
  }
  if (!result.contentType.includes('text/html')) {
    throw new Error(`${label} returned content-type '${result.contentType}', expected text/html`);
  }
  const missing = REFUSAL_MARKERS.filter((marker) => !result.body.includes(marker));
  if (missing.length > 0) {
    throw new Error(`${label} did not render the refusal page (missing: ${missing.join(', ')})`);
  }
  if (result.text.length < 80) {
    throw new Error(
      `${label} rendered only ${result.text.length} characters of visible text; a refusal must state a reason a reader can act on`,
    );
  }
}

const base = origin(process.argv[2] ?? 'https://nodeslide.vercel.app');
const slug = unresolvableSlug();

const routes = [
  { label: `${base}/s/<slug>`, url: `${base}/s/${slug}` },
  { label: `${base}/api/share?share=<slug>`, url: `${base}/api/share?share=${slug}` },
];

for (const route of routes) {
  const result = await withRetry(route.label, async () => {
    const attempt = await get(route.url);
    assertRealRefusal(route.label, attempt);
    return attempt;
  });
  console.log(
    `[share-probe] PASS ${route.label} -> ${result.status}, ${result.bytes} bytes, ` +
      `${result.text.length} chars of visible text`,
  );
}

// A published slug is optional: CI has no fixture. When one is supplied, the
// probe requires real deck HTML rather than a refusal.
const publishedSlug = process.env.SHARE_PROBE_PUBLISHED_SLUG;
if (publishedSlug) {
  const label = `${base}/s/${'<published>'}`;
  const result = await withRetry(label, async () => {
    const attempt = await get(`${base}/s/${encodeURIComponent(publishedSlug)}`);
    const platform = PLATFORM_FAILURES.find((marker) => attempt.body.includes(marker));
    if (platform) throw new Error(`${label} returned the platform error page (${platform})`);
    if (attempt.status !== 200)
      throw new Error(`${label} returned ${attempt.status}, expected 200`);
    if (attempt.text.length < 200) {
      throw new Error(`${label} rendered only ${attempt.text.length} characters of visible text`);
    }
    return attempt;
  });
  console.log(
    `[share-probe] PASS ${label} -> 200, ${result.bytes} bytes, ` +
      `${result.text.length} chars of visible text`,
  );
} else {
  console.log('[share-probe] no SHARE_PROBE_PUBLISHED_SLUG supplied: published-deck check skipped');
}
