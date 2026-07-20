#!/usr/bin/env node
/**
 * A5 production acceptance: complete fresh live-model deck generations and
 * score the persisted snapshots with NodeSlide's canonical validator.
 *
 * The written receipt is intentionally bounded. It never contains deck ids,
 * owner capabilities, browser storage, prompts, provider credentials, or raw
 * provider/browser errors.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ConvexHttpClient } from 'convex/browser';
import { type Browser, type Page, chromium } from 'playwright';
import { api } from '../convex/_generated/api';
import { validateNodeSlideSnapshot } from '../convex/lib/nodeslideValidation';
import type { AgentTrace, NodeSlideWorkspace, ValidationIssue } from '../shared/nodeslide';

const MODEL = 'moonshotai/kimi-k3';
const EXPECTED_PROVIDER = 'openrouter';
const PROD_URL = productionUrl(process.env.NODESLIDE_A5_URL ?? 'https://nodeslide.vercel.app');
const CONVEX_URL = productionUrl(
  process.env.NODESLIDE_A5_CONVEX_URL ?? 'https://agile-stoat-411.convex.cloud',
);
const REPORT_PATH = path.resolve(
  process.env.NODESLIDE_A5_REPORT ?? 'artifacts/prod-proof-20260720/a5-generations.json',
);
const PARALLELISM = boundedInteger(process.env.NODESLIDE_A5_PARALLELISM, 2, 1, 3);
const CREATE_TIMEOUT_MS = boundedInteger(
  process.env.NODESLIDE_A5_CREATE_TIMEOUT_MS,
  300_000,
  60_000,
  360_000,
);

const briefs = [
  ['AsterGrid', 'distributed energy operations'],
  ['BlueHarbor', 'port logistics planning'],
  ['CinderPay', 'B2B payment reconciliation'],
  ['Driftline', 'regional freight resilience'],
  ['EmberDesk', 'support-team knowledge routing'],
  ['Fieldglass', 'agricultural water forecasting'],
  ['GrovePath', 'clinic capacity coordination'],
  ['Hearthway', 'multifamily retrofit planning'],
  ['IonLedger', 'industrial maintenance records'],
  ['JuniperWorks', 'supplier quality operations'],
  ['Kiteframe', 'construction schedule risk'],
  ['LumenCart', 'retail inventory allocation'],
  ['MosaicRail', 'transit service reliability'],
  ['Northstar Labs', 'research portfolio prioritization'],
] as const;

interface GenerationResult {
  label: string;
  attempt: number;
  status: 'passed' | 'failed';
  durationMs: number;
  failureCode?: string;
  slideCount?: number;
  distinctArchetypes?: string[];
  adjacentArchetypeRepeats?: number;
  geometryErrors?: number;
  geometryWarnings?: number;
  publishOk?: boolean;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number;
}

const startedAt = new Date();
const report = {
  schemaVersion: 1,
  acceptance: 'A5-live-production-generation',
  status: 'running' as 'running' | 'passed' | 'failed',
  sourceSha: process.env.NODESLIDE_SOURCE_SHA ?? null,
  origin: PROD_URL.origin,
  convexOrigin: CONVEX_URL.origin,
  requestedModel: MODEL,
  requiredFreshPasses: briefs.length,
  maxAttemptsPerBrief: 2,
  startedAt: startedAt.toISOString(),
  completedAt: null as string | null,
  results: [] as GenerationResult[],
};

let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  const queue = briefs.map(([label, subject]) => ({ label, subject }));
  const workers = Array.from({ length: PARALLELISM }, (_, index) =>
    runWorker(browser as Browser, queue, index + 1),
  );
  await Promise.all(workers);
  const passingLabels = new Set(
    report.results.filter((result) => result.status === 'passed').map((result) => result.label),
  );
  report.status = passingLabels.size === briefs.length ? 'passed' : 'failed';
  if (report.status === 'failed') process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  report.completedAt = new Date().toISOString();
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `[a5] ${report.status.toUpperCase()} ${report.results.filter((result) => result.status === 'passed').length}/${briefs.length} sanitized receipt: ${path.relative(process.cwd(), REPORT_PATH)}`,
  );
}

async function runWorker(
  activeBrowser: Browser,
  queue: Array<{ label: string; subject: string }>,
  worker: number,
): Promise<void> {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    let passed = false;
    for (let attempt = 1; attempt <= 2 && !passed; attempt += 1) {
      console.log(`[a5] worker ${worker} starting ${item.label} attempt ${attempt}`);
      const result = await generateAndScore(activeBrowser, item, attempt);
      report.results.push(result);
      passed = result.status === 'passed';
      console.log(`[a5] ${result.status.toUpperCase()} ${item.label} attempt ${attempt}`);
    }
  }
}

async function generateAndScore(
  activeBrowser: Browser,
  item: { label: string; subject: string },
  attempt: number,
): Promise<GenerationResult> {
  const started = Date.now();
  const context = await activeBrowser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  page.setDefaultTimeout(45_000);
  page.setDefaultNavigationTimeout(45_000);
  page.on('pageerror', () => runtimeErrors.push('pageerror'));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push('console.error');
  });
  try {
    await openLanding(page);
    await page.getByTestId('landing-model-select').selectOption(MODEL);
    await page.getByLabel('Reasoning effort').selectOption('high');
    await page.getByLabel('Presentation brief').fill(syntheticBrief(item.label, item.subject));
    await page.getByLabel('Create presentation').click();
    await page.getByTestId('nodeslide-studio').waitFor({
      state: 'visible',
      timeout: CREATE_TIMEOUT_MS,
    });
    await page.getByTestId('slide-canvas').waitFor({ state: 'visible' });
    if (runtimeErrors.length > 0) throw codedError('browser-runtime');

    const deckId = new URL(page.url()).searchParams.get('deck');
    if (!deckId) throw codedError('deck-route');
    const ownerAccessKey = await readOwnerCapability(page, deckId);
    if (!ownerAccessKey) throw codedError('owner-capability');

    const client = new ConvexHttpClient(CONVEX_URL.href.replace(/\/$/, ''));
    const workspace = (await client.query(api.nodeslide.getWorkspace, {
      deckId,
      ownerAccessKey,
    })) as NodeSlideWorkspace | null;
    if (!workspace) throw codedError('workspace-query');
    const validation = validateNodeSlideSnapshot(workspace, Date.now());
    const archetypes = workspace.slides.map((slide) => slide.archetype).filter(isString);
    const distinctArchetypes = [...new Set(archetypes)].sort();
    const adjacentArchetypeRepeats = archetypes.filter(
      (archetype, index) => index > 0 && archetype === archetypes[index - 1],
    ).length;
    const geometryErrors = geometryIssues(validation.issues, 'error').length;
    const geometryWarnings = geometryIssues(validation.issues, 'warning').length;
    const providerTrace = creationProviderTrace(workspace.traces);

    if (workspace.slides.length !== 6) throw codedError('slide-count');
    if (archetypes.length !== workspace.slides.length || distinctArchetypes.length < 3) {
      throw codedError('archetype-variety');
    }
    if (geometryErrors !== 0 || geometryWarnings !== 0 || !validation.publishOk) {
      throw codedError('validation');
    }
    if (
      providerTrace.provider !== EXPECTED_PROVIDER ||
      providerTrace.model !== MODEL ||
      /fallback/i.test(providerTrace.model ?? '') ||
      !/supplied the narrative plan through pi-ai/i.test(providerTrace.summary)
    ) {
      throw codedError('provider-fallback');
    }

    return {
      label: item.label,
      attempt,
      status: 'passed',
      durationMs: Date.now() - started,
      slideCount: workspace.slides.length,
      distinctArchetypes,
      adjacentArchetypeRepeats,
      geometryErrors,
      geometryWarnings,
      publishOk: validation.publishOk,
      provider: providerTrace.provider,
      model: providerTrace.model,
      ...(providerTrace.reasoningEffort ? { reasoningEffort: providerTrace.reasoningEffort } : {}),
      ...(providerTrace.inputTokens !== undefined
        ? { inputTokens: providerTrace.inputTokens }
        : {}),
      ...(providerTrace.outputTokens !== undefined
        ? { outputTokens: providerTrace.outputTokens }
        : {}),
      ...(providerTrace.costMicroUsd !== undefined
        ? { costMicroUsd: providerTrace.costMicroUsd }
        : {}),
    };
  } catch (error) {
    return {
      label: item.label,
      attempt,
      status: 'failed',
      durationMs: Date.now() - started,
      failureCode: failureCode(error),
    };
  } finally {
    await context.close();
  }
}

async function openLanding(page: Page): Promise<void> {
  const response = await page.goto(PROD_URL.href, { waitUntil: 'domcontentloaded' });
  if (response?.status() !== 200) throw codedError('landing-http');
  await page.getByTestId('nodeslide-landing').waitFor({ state: 'visible' });
  if ((await page.getByTestId('deployment-configuration-error').count()) !== 0) {
    throw codedError('deployment-guard');
  }
}

async function readOwnerCapability(page: Page, deckId: string): Promise<string | null> {
  return await page.evaluate((id) => {
    try {
      const raw = window.localStorage.getItem('nodeslide.deckAccess.v1');
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const value = (parsed as Record<string, unknown>)[id];
      return typeof value === 'string' && value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }, deckId);
}

function syntheticBrief(label: string, subject: string): string {
  return `Create an exactly six-slide decision deck for the synthetic company ${label}, which works on ${subject}. Use only illustrative planning numbers and visibly label them as illustrative. Structure the story as: opening thesis, stat-led problem, comparison, editable chart, unit-economics formula, and image-led closing roadmap. Include a clearly credited illustrative image placeholder rather than inventing a licensed asset. Keep every slide concise, export-clean, and visually distinct.`;
}

function creationProviderTrace(traces: AgentTrace[]): AgentTrace {
  const trace = [...traces]
    .sort((left, right) => right.createdAt - left.createdAt)
    .find((candidate) => candidate.provider || candidate.model);
  if (!trace) throw codedError('provider-trace');
  return trace;
}

function geometryIssues(
  issues: ValidationIssue[],
  severity: ValidationIssue['severity'],
): ValidationIssue[] {
  return issues.filter(
    (issue) =>
      issue.severity === severity && (issue.code === 'collision' || issue.code === 'overflow'),
  );
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function codedError(code: string): Error {
  const error = new Error(code);
  error.name = 'NodeSlideAcceptanceError';
  return error;
}

function failureCode(error: unknown): string {
  if (error instanceof Error && error.name === 'NodeSlideAcceptanceError') return error.message;
  if (error instanceof Error && /timeout/i.test(error.message)) return 'creation-timeout';
  return 'unexpected';
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Expected an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function productionUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Production URLs must be clean HTTPS origins.');
  }
  return url;
}
