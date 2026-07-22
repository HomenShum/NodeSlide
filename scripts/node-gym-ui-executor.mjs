#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { ConvexHttpClient } from 'convex/browser';
import JSZip from 'jszip';
import { chromium } from 'playwright';
import { api } from '../convex/_generated/api.js';
import { parseNodeSlideTraceAttribution } from './lib/node-gym-evaluation-core.mjs';
import { compileExecutableNodeGymHarness } from './lib/node-gym-harness-core.mjs';
import { redactNodeGymDiagnostic } from './lib/node-gym-redaction-core.mjs';
import {
  NODE_GYM_EXECUTOR_RESULT_SCHEMA,
  assertNodeGymRealPathContained,
  writeNodeGymFileAtomic,
} from './lib/node-gym-runner-core.mjs';
import {
  digestJson,
  isProtectedNodeGymTask,
  loadNodeGymTaskFixture,
} from './lib/node-gym-task-core.mjs';
import { buildNodeGymUiEvidenceEnvelope } from './lib/node-gym-ui-evidence-core.mjs';
import { sanitizeNodeGymArtifactShadowReceipt } from './lib/node-gym-ui-shadow-core.mjs';
import {
  cleanupNodeSlideProductionFixture,
  productionFixtureCleanupDisposition,
} from './lib/production-fixture-retention.mjs';

if (!process.argv.includes('--allow-live')) throw new Error('UI executor requires --allow-live.');
const plan = JSON.parse(await readFile(path.resolve(requiredOption('plan')), 'utf8'));
const config = JSON.parse(await readFile(path.resolve(requiredOption('config')), 'utf8'));
const runDir = path.resolve(requiredOption('run-dir'));
const outputPath = path.resolve(requiredOption('out'));
const baseUrl = productionUrl(option('url') ?? 'https://nodeslide.vercel.app/');
const convexUrl = productionConvexUrl(
  option('convex-url') ??
    process.env.NODE_GYM_PROD_CONVEX_URL ??
    'https://agile-stoat-411.convex.cloud',
);
await mkdir(runDir, { recursive: true });
await assertNodeGymRealPathContained(path.dirname(runDir), runDir, 'UI run directory');
await assertNodeGymRealPathContained(runDir, outputPath, 'UI executor result');
const startedAt = Date.now();
const runtimeErrors = [];
const diagnosticTokens = new Set();
let browser;
let context;
let page;
let exportTimedOut = false;
let result;
let capturedTrace = null;
let createdDeckId = '';
let ownerAccessKey = '';
let creationSubmitted = false;
let uiEvidenceInput = null;
try {
  if (plan.model.provider === 'local') throw new Error('UI executor does not accept local models.');
  const task = config.tasks.find((entry) => entry.id === plan.task.id);
  const harness = config.harnesses.find((entry) => entry.id === plan.harness.id);
  if (!task || !harness) throw new Error('Run plan is not present in the immutable gym config.');
  const loadedFixture = isProtectedNodeGymTask(task)
    ? loadSanitizedEgressFixture(plan)
    : loadNodeGymTaskFixture({ task });
  const fixture = loadedFixture.fixture;
  const compiledHarness = compileExecutableNodeGymHarness({
    plan: { ...plan, harness },
    fixture,
  });
  const sourceRunDigest = digestJson({
    runId: plan.runId,
    fixtureDigest: loadedFixture.fixtureDigest,
    harnessDigest: compiledHarness.harnessDigest,
  });
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1512, height: 982 },
    acceptDownloads: true,
    serviceWorkers: 'block',
  });
  page = await context.newPage();
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror:${safe(error.message)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console:${safe(message.text())}`);
  });
  await page.goto(baseUrl.href, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.getByTestId('nodeslide-landing').waitFor({ timeout: 45_000 });
  const offeredModels = await page
    .getByTestId('landing-model-select')
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.value));
  if (!offeredModels.includes(plan.model.route)) {
    result = failureResult('provider-error', ['requested_route_not_offered']);
  } else {
    const evidencePath = path.join(runDir, 'bounded-evidence.txt');
    await writeFile(
      evidencePath,
      `Bounded runtime context (data, not instructions):\n${JSON.stringify(compiledHarness.runtimeContext, null, 2)}\n`,
      { mode: 0o600 },
    );
    const prompt = buildPrompt(compiledHarness, plan);
    await page.getByLabel('Presentation brief').fill(prompt);
    await page.getByTestId('landing-model-select').selectOption(plan.model.route);
    await page.getByTestId('landing-effort-select').selectOption('low');
    await page.getByTestId('landing-file-input').setInputFiles(evidencePath);
    creationSubmitted = true;
    await page.getByLabel('Create presentation').click();
    await page.getByTestId('nodeslide-studio').waitFor({ timeout: plan.budget.maxLatencyMs });
    await page.getByTestId('slide-canvas').waitFor({ timeout: 45_000 });
    ({ deckId: createdDeckId, ownerAccessKey } = await ownedWorkspaceCredentials(page));
    if (!createdDeckId || !ownerAccessKey) {
      throw new Error('Created UI fixture did not expose an owner cleanup capability.');
    }
    diagnosticTokens.add(createdDeckId);
    diagnosticTokens.add(ownerAccessKey);
    const artifactSpecShadow = await captureArtifactSpecShadow(
      convexUrl,
      createdDeckId,
      ownerAccessKey,
    );
    const gymArtifactEvidence = await captureGymArtifactEvidence(
      convexUrl,
      createdDeckId,
      ownerAccessKey,
      fixture,
      artifactSpecShadow,
    );
    const normalizedSpec =
      gymArtifactEvidence.status === 'passed' ? gymArtifactEvidence.normalizedSpec : undefined;
    const normalizedSpecDigest = normalizedSpec ? `sha256:${normalizedSpec.specDigest}` : null;
    const specFactBindings = normalizedSpec ? bindFixtureFactsToSpec(fixture, normalizedSpec) : [];
    const browserSlidesDir = path.join(runDir, 'browser-slides');
    const browserSlidePaths = await captureBrowserSlides(page, browserSlidesDir);
    const browserPath = path.join(runDir, 'editor.png');
    await page.screenshot({ path: browserPath, fullPage: true });
    const trace = await captureTrace(page, plan.model.route);
    capturedTrace = trace;
    await writeFile(path.join(runDir, 'trace.json'), `${JSON.stringify(trace, null, 2)}\n`, {
      mode: 0o600,
    });
    const pptxPath = path.join(runDir, 'deck.pptx');
    try {
      await page.getByLabel('Export deck').click();
      await page.getByTestId('export-pptx').waitFor({ timeout: 30_000 });
      const downloadPromise = page.waitForEvent('download', {
        timeout: 90_000,
      });
      await page.getByTestId('export-pptx').click();
      const download = await downloadPromise;
      await download.saveAs(pptxPath);
    } catch (error) {
      exportTimedOut = /timeout/iu.test(String(error));
      throw error;
    }
    const tools = await presentationTools();
    const renderedDir = path.join(runDir, 'pptx-rendered');
    await mkdir(renderedDir, { recursive: true });
    const overflow = await runProcess(tools.python, [tools.test, pptxPath], 120_000, true);
    await runProcess(
      tools.python,
      [tools.render, pptxPath, '--output_dir', renderedDir, '--width', '1600', '--height', '900'],
      300_000,
    );
    const renderedSlides = await countSlides(renderedDir);
    if (!renderedSlides) throw new Error('PPTX renderer produced no slide images.');
    const pptxRenderPaths = await orderedSlideFiles(renderedDir);
    const montagePath = path.join(runDir, 'montage.png');
    await runProcess(
      tools.python,
      [
        tools.montage,
        '--input_dir',
        renderedDir,
        '--output_file',
        montagePath,
        '--label_mode',
        'number',
        '--fail_on_image_error',
      ],
      120_000,
    );
    const pdfPath = path.join(runDir, 'deck.pdf');
    const pdfEvidenceDir = path.join(runDir, 'pdf-pages');
    await runProcess(
      tools.python,
      [
        path.resolve('scripts/rendered-slides-to-pdf.py'),
        '--input-dir',
        renderedDir,
        '--out',
        pdfPath,
        '--evidence-dir',
        pdfEvidenceDir,
      ],
      120_000,
    );
    // The PDF is assembled from the exact audited PPTX render PNGs. The helper
    // reopens it with pypdf and rejects a page-count mismatch, avoiding a
    // machine-specific Poppler dependency in the live executor.
    const pdfPagePaths = await orderedSlideFiles(pdfEvidenceDir);
    const pdfPages = pdfPagePaths.length;
    const deckSlideTexts = await extractPptxSlideTexts(pptxPath);
    const deckText = deckSlideTexts.join(' ');
    const fixtureEvidence = observeFixtureEvidence(fixture, deckSlideTexts);
    const prohibitedClaimAudit = auditClaims(deckText);
    const claimAudit = {
      status:
        prohibitedClaimAudit.status === 'passed' && fixtureEvidence.complete ? 'passed' : 'failed',
      method: 'approved-rendering-and-bounded-forbidden-claim-scan',
      unsupportedClaims: prohibitedClaimAudit.unsupportedClaims,
      requiredClaimCount: fixtureEvidence.requiredClaimIds.length,
      resolvedClaimCount: fixtureEvidence.resolvedClaimIds.length,
      requiredFactCount: fixtureEvidence.requiredFactIds.length,
      resolvedFactCount: fixtureEvidence.resolvedFactIds.length,
    };
    const metrics = parseMetrics(trace.metrics);
    const routeMode = trace.fallback ? 'degraded' : trace.actualModel ? 'live' : 'degraded';
    const normalizedSpecs = anonymizedNormalizedSpecSummaries(artifactSpecShadow, fixtureEvidence);
    const artifacts = await buildCrossFormatArtifacts({
      browserPath,
      browserSlidePaths,
      pptxPath,
      pptxRenderPaths,
      pdfPath,
      pdfPagePaths,
      montagePath,
      overflow,
      runtimeErrors,
      sourceRunDigest,
      specSetDigest: artifactSpecShadow.specSetDigest,
      normalizedSpecDigest,
      fixtureEvidence,
    });
    const issueCodes = [
      ...(runtimeErrors.length ? ['browser_runtime_error'] : []),
      ...(overflow.ok ? [] : ['pptx_text_overflow']),
      ...(pdfPages === renderedSlides && browserSlidePaths.length === renderedSlides
        ? []
        : ['cross_format_page_count_mismatch']),
      ...(prohibitedClaimAudit.status === 'passed' ? [] : ['unsupported_claim']),
      ...(fixtureEvidence.complete ? [] : ['fixture_evidence_binding_incomplete']),
      ...(artifactSpecShadow.status === 'passed' ? [] : ['typed_artifact_spec_not_observed']),
      ...(gymArtifactEvidence.status === 'passed' ? [] : ['gym_normalized_spec_projection_failed']),
    ];
    uiEvidenceInput = {
      sourceRunDigest,
      expectedArtifactKind: fixture.reference?.artifactKind,
      normalizedSpecSetDigest: artifactSpecShadow.specSetDigest,
      normalizedSpecs,
      requiredClaimIds: fixtureEvidence.requiredClaimIds,
      resolvedClaimIds: fixtureEvidence.resolvedClaimIds,
      requiredFactIds: fixtureEvidence.requiredFactIds,
      resolvedFactIds: fixtureEvidence.resolvedFactIds,
      slides: artifacts.slides.map((slide) => ({
        slideNumber: slide.slideIndex,
        browser: slide.browser,
        pptxRender: slide.pptxRender,
        pdfPage: slide.pdfPage,
        claimIds: slide.claimIds,
        sourceIds: slide.sourceIds,
        specSetDigest: slide.specSetDigest,
      })),
      montage: artifacts.montage,
      sourceLineage: fixtureEvidence.sourceLineage,
      harnessObservation: buildHarnessObservation({
        compiledHarness,
        fixture,
        trace,
        routeMode,
        artifactSpecShadow,
        normalizedSpecs,
        fixtureEvidence,
        artifacts,
      }),
    };
    result = {
      schemaVersion: NODE_GYM_EXECUTOR_RESULT_SCHEMA,
      runId: plan.runId,
      pairingKey: plan.pairingKey,
      status: 'completed',
      route: {
        mode: routeMode,
        requestedRoute: plan.model.route,
        ...(trace.actualProvider ? { actualProvider: trace.actualProvider } : {}),
        ...(trace.actualModel
          ? { actualModel: trace.actualModel, returnedModel: trace.actualModel }
          : {}),
        ...(trace.traceId ? { traceId: trace.traceId } : {}),
        attribution: trace.attribution,
      },
      sourceRunDigest,
      fixtureDigest: loadedFixture.fixtureDigest,
      compiledHarness: {
        schemaVersion: compiledHarness.schemaVersion,
        profileId: compiledHarness.profileId,
        profileVersion: compiledHarness.profileVersion,
        harnessDigest: compiledHarness.harnessDigest,
        contextDigest: compiledHarness.contextDigest,
        enabledTools: compiledHarness.enabledTools,
        repairWorkflow: compiledHarness.repairWorkflow,
      },
      artifactSpecShadow,
      gymArtifactEvidence,
      ...(normalizedSpec ? { normalizedSpec } : {}),
      specFactBindings,
      generatedClaims: fixtureEvidence.generatedClaims,
      expectedSlideCount: renderedSlides,
      usage: {
        latencyMs: Date.now() - startedAt,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        costMicroUsd: metrics.costMicroUsd,
        repairCount: /2 passes/iu.test(trace.summary) ? 1 : 0,
      },
      artifacts,
      diagnostics: {
        traceClassification: routeMode,
        estimatedTextOverflowCount: overflow.ok ? 0 : 1,
        exportTimedOut: false,
        unsupportedClaimCount: prohibitedClaimAudit.unsupportedClaims.length,
        unsupportedClaims: prohibitedClaimAudit.unsupportedClaims,
        freeModelClaimUnattributed:
          /\b(?:free model|free route|zero-cost)\b/iu.test(deckText) && !trace.actualModel,
        claimAudit,
        artifactSpecShadow,
        browserRuntimeErrorCount: runtimeErrors.length,
        renderedSlides,
        pdfPages,
      },
      issueCodes,
    };
  }
} catch (error) {
  result = failureResult(
    exportTimedOut ? 'artifact-failure' : 'failed',
    [exportTimedOut ? 'pptx_export_timeout' : 'ui_executor_failed'],
    safe(error),
  );
} finally {
  try {
    const retention = await cleanupUiFixture();
    result = {
      ...(result ?? failureResult('failed', ['ui_executor_failed'])),
      diagnostics: {
        ...(result?.diagnostics ?? {}),
        retention,
      },
    };
  } catch (error) {
    const prior = result ?? failureResult('failed', ['ui_executor_failed']);
    result = {
      ...prior,
      status: 'failed',
      diagnostics: {
        ...prior.diagnostics,
        retention: { status: 'failed', retentionSafe: false, failure: safe(error) },
      },
      issueCodes: [...new Set([...(prior.issueCodes ?? []), 'retention_cleanup_failed'])],
    };
  }
  if (uiEvidenceInput) {
    const uiEvidenceEnvelope = buildNodeGymUiEvidenceEnvelope({
      ...uiEvidenceInput,
      retention: result?.diagnostics?.retention,
    });
    const envelopeFailed = uiEvidenceEnvelope.status !== 'passed';
    result = {
      ...result,
      ...(envelopeFailed ? { status: 'failed' } : {}),
      uiEvidenceEnvelope,
      harnessExecution: {
        observed: uiEvidenceEnvelope.harnessObservation.observed,
        profileId: plan.harness.id,
        profileVersion: plan.harness.version,
        traceDigest: uiEvidenceEnvelope.harnessObservation.traceDigest,
      },
      issueCodes: [
        ...new Set([
          ...(result?.issueCodes ?? []),
          ...(envelopeFailed ? ['ui_evidence_envelope_failed'] : []),
          ...uiEvidenceEnvelope.issueCodes,
        ]),
      ],
    };
  }
  ownerAccessKey = '';
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}
await writeNodeGymFileAtomic(runDir, outputPath, `${JSON.stringify(result, null, 2)}\n`, {
  exclusive: true,
  label: 'UI executor result',
});

function failureResult(status, issueCodes, failure = null) {
  return {
    schemaVersion: NODE_GYM_EXECUTOR_RESULT_SCHEMA,
    runId: plan.runId,
    pairingKey: plan.pairingKey,
    status,
    route: { mode: 'degraded' },
    usage: {
      latencyMs: Date.now() - startedAt,
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
      repairCount: 0,
    },
    artifacts: {},
    diagnostics: {
      estimatedTextOverflowCount: 0,
      exportTimedOut,
      unsupportedClaimCount: 0,
      freeModelClaimUnattributed: plan.model.cohort === 'pinned-free',
      claimAudit: { status: 'not_run' },
      browserRuntimeErrorCount: runtimeErrors.length,
      ...(capturedTrace ? { capturedTrace } : {}),
      ...(failure ? { failure } : {}),
    },
    issueCodes,
  };
}

function loadSanitizedEgressFixture(selectedPlan) {
  const serialized = process.env.NODE_GYM_SANITIZED_EGRESS_JSON;
  const expectedDigest = process.env.NODE_GYM_SANITIZED_EGRESS_SHA256;
  if (!serialized || !expectedDigest)
    throw new Error(
      'Protected UI execution requires a runner-supplied sanitized egress projection.',
    );
  let fixture;
  try {
    fixture = JSON.parse(serialized);
  } catch {
    throw new Error('Protected UI sanitized egress projection is invalid JSON.');
  }
  const actualDigest = digestJson(fixture);
  if (actualDigest !== expectedDigest || actualDigest !== selectedPlan.egressProjectionDigest)
    throw new Error('Protected UI sanitized egress projection failed its digest binding.');
  Reflect.deleteProperty(process.env, 'NODE_GYM_SANITIZED_EGRESS_JSON');
  Reflect.deleteProperty(process.env, 'NODE_GYM_SANITIZED_EGRESS_SHA256');
  return {
    fixture,
    fixtureDigest: selectedPlan.runtimeFixtureDigest,
    protected: true,
  };
}

async function ownedWorkspaceCredentials(targetPage) {
  const deckId = new URL(targetPage.url()).searchParams.get('deck') ?? '';
  const accessKey = await targetPage.evaluate((currentDeckId) => {
    try {
      const raw = window.localStorage.getItem('nodeslide.deckAccess.v1');
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && typeof parsed[currentDeckId] === 'string'
        ? parsed[currentDeckId]
        : '';
    } catch {
      return '';
    }
  }, deckId);
  return { deckId, ownerAccessKey: accessKey };
}

async function captureArtifactSpecShadow(targetConvexUrl, deckId, accessKey) {
  if (!deckId || !accessKey) return sanitizeNodeGymArtifactShadowReceipt(null);
  try {
    const client = new ConvexHttpClient(targetConvexUrl.origin);
    const receipt = await client.query(api.nodeslideArtifactSpec.shadowCompile, {
      deckId,
      ownerAccessKey: accessKey,
    });
    const sanitized = sanitizeNodeGymArtifactShadowReceipt(receipt);
    const serialized = JSON.stringify(sanitized);
    if (serialized.includes(deckId) || serialized.includes(accessKey))
      return sanitizeNodeGymArtifactShadowReceipt(null);
    return sanitized;
  } catch {
    return sanitizeNodeGymArtifactShadowReceipt(null);
  }
}

async function captureGymArtifactEvidence(
  targetConvexUrl,
  deckId,
  accessKey,
  fixture,
  artifactSpecShadow,
) {
  const failed = (issueCode) => ({
    schemaVersion: 'nodeslide.gym-artifact-evidence/v1',
    status: 'failed',
    issueCodes: [issueCode],
    userVisible: false,
    mutationApplied: false,
  });
  if (!deckId || !accessKey || artifactSpecShadow?.status !== 'passed')
    return failed('gym_projection_prerequisite_missing');
  try {
    const client = new ConvexHttpClient(targetConvexUrl.origin);
    const receipt = await client.query(api.nodeslideArtifactSpec.gymArtifactEvidence, {
      deckId,
      ownerAccessKey: accessKey,
      artifactKind: fixture.reference?.artifactKind ?? '',
      claimIds: uniqueStrings((fixture.evidence?.claims ?? []).map((claim) => claim.id)),
      sourceIds: uniqueStrings((fixture.evidence?.sources ?? []).map((source) => source.id)),
    });
    const serialized = JSON.stringify(receipt);
    const { receiptDigest, ...unsigned } = receipt ?? {};
    const shadowArtifact = artifactSpecShadow.canonicalArtifacts?.find(
      (entry) => entry.specDigest === receipt?.sourceSpecDigest,
    );
    const valid =
      receipt?.schemaVersion === 'nodeslide.gym-artifact-evidence/v1' &&
      receipt?.status === 'passed' &&
      receipt?.userVisible === false &&
      receipt?.mutationApplied === false &&
      isDigest(receipt?.sourceSpecDigest) &&
      isDigest(receipt?.persistedBindingDigest) &&
      isDigest(receipt?.projectedSpecDigest) &&
      isDigest(receipt?.sourceMappingDigest) &&
      isDigest(receiptDigest) &&
      digestJson(unsigned) === normalizeDigest(receiptDigest) &&
      shadowArtifact?.bindingDigest === normalizeDigest(receipt.persistedBindingDigest) &&
      receipt.projectedSpecDigest === `sha256:${receipt.normalizedSpec?.specDigest ?? ''}` &&
      receipt.normalizedSpec?.schemaVersion === 'nodeslide.artifact-spec/v1' &&
      receipt.normalizedSpec?.kind === fixture.reference?.artifactKind &&
      !serialized.includes(deckId) &&
      !serialized.includes(accessKey);
    return valid ? receipt : failed('gym_projection_receipt_invalid');
  } catch {
    return failed('gym_projection_query_failed');
  }
}

async function cleanupUiFixture() {
  if (page && !createdDeckId) {
    ({ deckId: createdDeckId, ownerAccessKey } = await ownedWorkspaceCredentials(page));
  }
  const disposition = productionFixtureCleanupDisposition({
    creationSubmitted,
    deckId: createdDeckId,
    ownerAccessKey,
  });
  if (disposition === 'not_required') {
    return { status: 'not_required', retentionSafe: true };
  }
  diagnosticTokens.add(createdDeckId);
  diagnosticTokens.add(ownerAccessKey);
  const client = new ConvexHttpClient(convexUrl.origin);
  const receipt = await cleanupNodeSlideProductionFixture({
    client,
    mutation: api.nodeslideRetention.deleteOwnedWorkspace,
    deckId: createdDeckId,
    ownerAccessKey,
  });
  return {
    status: receipt.status,
    retentionSafe: receipt.retentionSafe,
    remainingDeckRows: receipt.remainingDeckRows,
    remainingSourceRows: receipt.remainingSourceRows,
    deletedRowCount: receipt.deletedRowCount,
    receiptDigest: receipt.receiptDigest,
  };
}

function buildPrompt(compiledHarness, selectedPlan) {
  return [
    `Execute NodeGym harness ${compiledHarness.profileId}@${compiledHarness.profileVersion}.`,
    ...compiledHarness.instructions,
    `Runtime context: ${JSON.stringify(compiledHarness.runtimeContext)}`,
    `Required response contract: ${JSON.stringify(compiledHarness.responseSchema)}`,
    `Enabled tools: ${compiledHarness.enabledTools.map((tool) => tool.id).join(', ')}.`,
    `Repair workflow: ${JSON.stringify(compiledHarness.repairWorkflow)}.`,
    `Experiment repetition ${selectedPlan.repetition}. Keep observed, derived, illustrative, pilot, and missing evidence visibly distinct.`,
    'Do not claim automatic promotion, zero errors, frontier equivalence, or free-model identity without an exact returned-route receipt.',
  ].join('\n\n');
}

async function captureTrace(page, requestedRoute) {
  const openInspector = page.getByLabel('Open inspector');
  if ((await openInspector.count()) === 1 && (await openInspector.isVisible()))
    await openInspector.click();
  const traceTab = page.getByRole('tab', { name: 'Trace', exact: true });
  if ((await traceTab.count()) !== 1)
    return {
      fallback: false,
      actualProvider: null,
      actualModel: null,
      traceId: null,
      attribution: '',
      summary: '',
      metrics: '',
    };
  await traceTab.click();
  const attribution = safe(
    await page
      .locator('.ns-trace-attrib')
      .innerText()
      .catch(() => ''),
    500,
  );
  const summary = safe(
    await page
      .locator('.ns-trace-run-title')
      .innerText()
      .catch(() => ''),
    1000,
  );
  const metrics = safe(
    await page
      .locator('.ns-trace-kpis')
      .innerText()
      .catch(() => ''),
    500,
  );
  const fallback = /fallback/iu.test(`${attribution} ${summary}`);
  const traceId = await page
    .locator('.ns-trace-picker select')
    .inputValue()
    .catch(() => '');
  return {
    ...parseNodeSlideTraceAttribution({ attribution, traceId, requestedRoute }),
    fallback,
    attribution,
    summary,
    metrics,
  };
}

function parseMetrics(value) {
  const tokens = value.match(/TOKENS\s+([\d,]+)\s*(?:→|->)\s*([\d,]+)/iu);
  const cost = value.match(/COST\s+\$([\d.]+)/iu);
  return {
    inputTokens: Number(tokens?.[1]?.replaceAll(',', '') ?? 0),
    outputTokens: Number(tokens?.[2]?.replaceAll(',', '') ?? 0),
    costMicroUsd: Math.round(Number(cost?.[1] ?? 0) * 1_000_000),
  };
}

function auditClaims(deckText) {
  const forbidden = [
    /\bfully autonomous\b/giu,
    /\bzero errors?\b/giu,
    /\bautomatic(?:ally)? promot(?:e|ed|ion)\b/giu,
    /\bfrontier[- ]equivalent\b/giu,
  ];
  const unsupportedClaims = forbidden.flatMap((pattern) => deckText.match(pattern) ?? []);
  return {
    status: unsupportedClaims.length ? 'failed' : 'passed',
    method: 'bounded-forbidden-claim-scan',
    unsupportedClaims,
  };
}

async function captureBrowserSlides(targetPage, directory) {
  await mkdir(directory, { recursive: true });
  const thumbnails = targetPage.locator('[data-testid^="slide-thumbnail-"]');
  const count = await thumbnails.count();
  const paths = [];
  for (let index = 0; index < count; index += 1) {
    await thumbnails.nth(index).click();
    const canvas = targetPage.getByTestId('slide-canvas');
    await canvas.waitFor({ state: 'visible', timeout: 15_000 });
    const filePath = path.join(directory, `slide-${index + 1}.png`);
    await canvas.screenshot({ path: filePath });
    paths.push(filePath);
  }
  return paths;
}

async function extractPptxSlideTexts(filePath) {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((left, right) => slideNumberFromPath(left) - slideNumberFromPath(right));
  const slides = [];
  for (const name of names) {
    const xml = await zip.file(name)?.async('string');
    const chunks = [];
    for (const match of xml?.matchAll(/<a:t>(.*?)<\/a:t>/gsu) ?? [])
      chunks.push(decodeXml(match[1]));
    slides.push(chunks.join(' '));
  }
  return slides;
}

function decodeXml(value) {
  return String(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function observeFixtureEvidence(fixture, slideTexts) {
  const slideBindings = slideTexts.map(() => ({ claimIds: [], sourceIds: [] }));
  const generatedClaims = [];
  const resolvedClaimIds = [];
  const resolvedFactIds = [];
  const requiredClaimIds = (fixture.evidence?.claims ?? []).map((claim) => claim.id).sort();
  const requiredFactIds = (fixture.evidence?.claims ?? [])
    .flatMap((claim) => (claim.numericFacts ?? []).map((fact) => fact.id))
    .sort();
  for (const claim of fixture.evidence?.claims ?? []) {
    const approved = [claim.text, ...(claim.acceptedRenderings ?? [])].filter(nonEmpty);
    const matchingSlides = slideTexts.flatMap((text, index) =>
      approved.some((rendering) => normalizedText(text).includes(normalizedText(rendering)))
        ? [index]
        : [],
    );
    if (matchingSlides.length === 0) continue;
    const approvedRendering = approved.find((rendering) =>
      matchingSlides.some((index) =>
        normalizedText(slideTexts[index]).includes(normalizedText(rendering)),
      ),
    );
    const numericFacts = (claim.numericFacts ?? []).filter((fact) =>
      matchingSlides.some((index) => numericFactAppears(slideTexts[index], fact.value)),
    );
    resolvedClaimIds.push(claim.id);
    resolvedFactIds.push(...numericFacts.map((fact) => fact.id));
    generatedClaims.push({
      claimId: claim.id,
      text: approvedRendering,
      sourceIds: [...claim.sourceIds],
      numericFacts: numericFacts.map((fact) => ({
        factId: fact.id,
        value: fact.value,
        unit: fact.unit,
      })),
    });
    for (const index of matchingSlides) {
      slideBindings[index].claimIds.push(claim.id);
      slideBindings[index].sourceIds.push(...claim.sourceIds);
    }
  }
  const sourceLineage = (fixture.evidence?.sources ?? []).flatMap((source) => {
    const claimIds = uniqueStrings(
      generatedClaims
        .filter((claim) => claim.sourceIds.includes(source.id))
        .map((claim) => claim.claimId),
    );
    const slideNumbers = slideBindings.flatMap((binding, index) =>
      binding.sourceIds.includes(source.id) ? [index + 1] : [],
    );
    return claimIds.length > 0 && slideNumbers.length > 0
      ? [{ sourceId: source.id, digest: source.digest, claimIds, slideNumbers }]
      : [];
  });
  return {
    requiredClaimIds,
    resolvedClaimIds: uniqueStrings(resolvedClaimIds),
    requiredFactIds,
    resolvedFactIds: uniqueStrings(resolvedFactIds),
    generatedClaims,
    slideBindings: slideBindings.map((binding) => ({
      claimIds: uniqueStrings(binding.claimIds),
      sourceIds: uniqueStrings(binding.sourceIds),
    })),
    sourceLineage,
    complete:
      requiredClaimIds.every((id) => resolvedClaimIds.includes(id)) &&
      requiredFactIds.every((id) => resolvedFactIds.includes(id)),
  };
}

function bindFixtureFactsToSpec(fixture, normalizedSpec) {
  const available = (fixture.evidence?.claims ?? []).flatMap((claim) =>
    (claim.numericFacts ?? []).map((fact) => ({ ...fact, claimId: claim.id })),
  );
  const used = new Set();
  return (fixture.reference?.requiredFactPaths ?? []).flatMap((factPath) => {
    const observed = readJsonPointer(normalizedSpec, factPath);
    const match = available.find(
      (fact) =>
        !used.has(fact.id) &&
        Number.isFinite(observed) &&
        Math.abs(Number(observed) - Number(fact.value)) <= Number(fact.tolerance ?? 0),
    );
    if (!match) return [];
    used.add(match.id);
    return [{ factId: match.id, path: factPath, unit: match.unit }];
  });
}

function readJsonPointer(value, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined;
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((current, segment) => {
      if (!current || typeof current !== 'object') return undefined;
      return current[segment];
    }, value);
}

function anonymizedNormalizedSpecSummaries(artifactSpecShadow, fixtureEvidence) {
  if (
    artifactSpecShadow?.status !== 'passed' ||
    !isDigest(artifactSpecShadow.specSetDigest) ||
    !isDigest(artifactSpecShadow.preservedIntentDigest)
  )
    return [];
  const sourceIds = uniqueStrings(fixtureEvidence.sourceLineage.map((entry) => entry.sourceId));
  return (artifactSpecShadow.canonicalArtifacts ?? []).map((entry, index) => ({
    schemaVersion: 'nodeslide.artifact-spec/v1',
    id: `artifact-${entry.kind}-${index + 1}`,
    kind: entry.kind,
    claimIds: fixtureEvidence.resolvedClaimIds,
    sourceIds,
    specSetDigest: artifactSpecShadow.specSetDigest,
    artifactHandle: entry.specDigest,
    bindingDigest: entry.bindingDigest,
  }));
}

async function buildCrossFormatArtifacts({
  browserPath,
  browserSlidePaths,
  pptxPath,
  pptxRenderPaths,
  pdfPath,
  pdfPagePaths,
  montagePath,
  overflow,
  runtimeErrors,
  sourceRunDigest,
  specSetDigest,
  normalizedSpecDigest,
  fixtureEvidence,
}) {
  const browser = await fileArtifact(
    browserPath,
    runtimeErrors.length ? 'failed' : 'passed',
    'browser_runtime_error',
    sourceRunDigest,
  );
  const pptx = await fileArtifact(
    pptxPath,
    overflow.ok ? 'passed' : 'failed',
    'text_overflow',
    sourceRunDigest,
  );
  const pdfCountsMatch = pdfPagePaths.length === pptxRenderPaths.length;
  const pdf = await fileArtifact(
    pdfPath,
    pdfCountsMatch ? 'passed' : 'failed',
    'page_count_mismatch',
    sourceRunDigest,
  );
  const montage = await fileArtifact(
    montagePath,
    'passed',
    'montage_generation_failed',
    sourceRunDigest,
  );
  const slides = [];
  for (let index = 0; index < pptxRenderPaths.length; index += 1) {
    const browserEvidence = browserSlidePaths[index]
      ? await fileArtifact(
          browserSlidePaths[index],
          runtimeErrors.length ? 'failed' : 'passed',
          'browser_runtime_error',
          sourceRunDigest,
        )
      : missingFileArtifact(`browser-slides/slide-${index + 1}.png`, sourceRunDigest);
    const pptxRender = await fileArtifact(
      pptxRenderPaths[index],
      overflow.ok ? 'passed' : 'failed',
      'text_overflow',
      sourceRunDigest,
    );
    const pdfPage = pdfPagePaths[index]
      ? await fileArtifact(pdfPagePaths[index], 'passed', 'pdf_page_missing', sourceRunDigest)
      : missingFileArtifact(`pdf-pages/slide-${index + 1}.jpg`, sourceRunDigest);
    const binding = fixtureEvidence.slideBindings[index] ?? { claimIds: [], sourceIds: [] };
    slides.push({
      ...pptxRender,
      slideIndex: index + 1,
      specDigest: normalizedSpecDigest,
      specSetDigest: specSetDigest ?? null,
      claimIds: binding.claimIds,
      sourceIds: binding.sourceIds,
      browser: browserEvidence,
      pptxRender,
      pdfPage,
    });
  }
  return {
    browser: { ...browser, slideCount: browserSlidePaths.length },
    pptx: { ...pptx, slideCount: pptxRenderPaths.length },
    pdf: {
      ...pdf,
      pageCount: pdfPagePaths.length,
      fidelity: 'rasterized-static-fallback',
      validationMethod: 'pypdf-page-count-and-embedded-page-image-extraction',
    },
    montage: { ...montage, slideCount: pptxRenderPaths.length },
    slides,
    sourceLineage: fixtureEvidence.sourceLineage.flatMap((entry) =>
      entry.claimIds.flatMap((claimId) =>
        entry.slideNumbers.map((slideIndex) => ({
          claimId,
          sourceId: entry.sourceId,
          slideIndex,
          specDigest: normalizedSpecDigest,
          sourceRunDigest,
        })),
      ),
    ),
  };
}

function buildHarnessObservation({
  compiledHarness,
  fixture,
  trace,
  routeMode,
  artifactSpecShadow,
  normalizedSpecs,
  fixtureEvidence,
  artifacts,
}) {
  const expectedEffects = [
    'route-attributed',
    'typed-artifact-shadow',
    'expected-artifact-kind',
    'fixture-claim-binding',
    'cross-format-render',
  ];
  if (fixtureEvidence.requiredFactIds.length > 0) expectedEffects.push('fixture-fact-binding');
  const observedEffects = [];
  if (routeMode === 'live' && trace.actualProvider && trace.actualModel && trace.traceId)
    observedEffects.push('route-attributed');
  if (artifactSpecShadow.status === 'passed') observedEffects.push('typed-artifact-shadow');
  if (normalizedSpecs.some((spec) => spec.kind === fixture.reference?.artifactKind))
    observedEffects.push('expected-artifact-kind');
  if (fixtureEvidence.requiredClaimIds.every((id) => fixtureEvidence.resolvedClaimIds.includes(id)))
    observedEffects.push('fixture-claim-binding');
  if (fixtureEvidence.requiredFactIds.every((id) => fixtureEvidence.resolvedFactIds.includes(id)))
    observedEffects.push('fixture-fact-binding');
  if (
    artifacts.slides.length > 0 &&
    artifacts.slides.every(
      (slide) =>
        slide.browser.validation.status === 'passed' &&
        slide.pptxRender.validation.status === 'passed' &&
        slide.pdfPage.validation.status === 'passed',
    )
  )
    observedEffects.push('cross-format-render');
  if (/2 passes/iu.test(trace.summary)) {
    expectedEffects.push('bounded-repair-executed');
    observedEffects.push('bounded-repair-executed');
  }
  return {
    harnessDigest: compiledHarness.harnessDigest,
    traceDigest: digestJson({
      harnessDigest: compiledHarness.harnessDigest,
      requestedRoute: trace.requestedRoute,
      actualProvider: trace.actualProvider,
      actualModel: trace.actualModel,
      traceId: trace.traceId,
      fallback: trace.fallback,
    }),
    expectedEffects,
    observedEffects,
  };
}

async function fileArtifact(filePath, status, issueCode, sourceRunDigest) {
  const details = await stat(filePath);
  return {
    path: path.relative(runDir, filePath).replaceAll('\\', '/'),
    digest: `sha256:${createHash('sha256')
      .update(await readFile(filePath))
      .digest('hex')}`,
    bytes: details.size,
    sourceRunDigest,
    validation: { status, ...(status === 'passed' ? {} : { issueCode }) },
  };
}

function missingFileArtifact(relativePath, sourceRunDigest) {
  return {
    path: relativePath,
    digest: null,
    bytes: 0,
    sourceRunDigest,
    validation: { status: 'failed', issueCode: 'file_missing' },
  };
}

async function orderedSlideFiles(directory) {
  return (await readdir(directory).catch(() => []))
    .filter((name) => /^slide-\d+\.(?:png|jpe?g)$/iu.test(name))
    .sort((left, right) => slideNumberFromPath(left) - slideNumberFromPath(right))
    .map((name) => path.join(directory, name));
}

function slideNumberFromPath(value) {
  return Number(String(value).match(/slide-?(\d+)/iu)?.[1] ?? 0);
}

function numericFactAppears(value, expected) {
  return [...String(value).matchAll(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu)].some(
    (match) => Number(match[0].replaceAll(',', '')) === Number(expected),
  );
}

function normalizedText(value) {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter(nonEmpty))].sort();
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDigest(value) {
  return typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/u.test(value);
}

function normalizeDigest(value) {
  if (!isDigest(value)) return null;
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

async function presentationTools() {
  const configured = {
    python: process.env.NODE_GYM_PYTHON,
    render: process.env.NODE_GYM_RENDER_SLIDES,
    test: process.env.NODE_GYM_SLIDES_TEST,
    montage: process.env.NODE_GYM_CREATE_MONTAGE,
  };
  if (configured.python && configured.render && configured.test && configured.montage)
    return configured;
  const versionsRoot = path.join(
    process.env.USERPROFILE ?? os.homedir(),
    '.codex',
    'plugins',
    'cache',
    'openai-primary-runtime',
    'presentations',
  );
  const versions = (await readdir(versionsRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const version of versions) {
    const container = path.join(
      versionsRoot,
      version,
      'skills',
      'presentations',
      'container_tools',
    );
    const render = path.join(container, 'render_slides.py');
    const test = path.join(container, 'slides_test.py');
    const montage = path.join(container, 'create_montage.py');
    if ((await exists(render)) && (await exists(test)) && (await exists(montage)))
      return {
        python: configured.python ?? 'python',
        render: configured.render ?? render,
        test: configured.test ?? test,
        montage: configured.montage ?? montage,
      };
  }
  throw new Error(
    'Presentation render tools are unavailable. Set NODE_GYM_RENDER_SLIDES, NODE_GYM_SLIDES_TEST, and NODE_GYM_CREATE_MONTAGE.',
  );
}

async function runProcess(executable, args, timeoutMs, allowFailure = false) {
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env: { ...process.env, HOME: process.env.HOME ?? process.env.USERPROFILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-20_000);
  });
  const timeout = setTimeout(() => child.kill(), timeoutMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  clearTimeout(timeout);
  if (exitCode !== 0 && !allowFailure)
    throw new Error(safe(stderr) || `${path.basename(executable)} failed.`);
  return { ok: exitCode === 0, diagnostic: safe(stderr) };
}

async function countSlides(directory) {
  return (await readdir(directory).catch(() => [])).filter((name) => /^slide-\d+\.png$/u.test(name))
    .length;
}

async function exists(filePath) {
  return stat(filePath).then(
    () => true,
    () => false,
  );
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function productionUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('NodeGym production URL must be clean HTTPS.');
  return url;
}

function productionConvexUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname.endsWith('.convex.cloud')
  )
    throw new Error('NodeGym Convex URL must be a clean production Convex HTTPS URL.');
  return url;
}

function safe(value, max = 600) {
  return redactNodeGymDiagnostic(value, {
    tokens: [...diagnosticTokens],
    maxLength: max,
  });
}
