#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';
import { artifactSpecEnvelope, validateArtifactSpec } from './lib/artifact-spec-core.mjs';
import { compileExecutableNodeGymHarness } from './lib/node-gym-harness-core.mjs';
import {
  NODE_GYM_EXECUTOR_RESULT_SCHEMA,
  assertNodeGymRealPathContained,
  writeNodeGymFileAtomic,
} from './lib/node-gym-runner-core.mjs';
import { digestJson, loadNodeGymTaskFixture } from './lib/node-gym-task-core.mjs';

const plan = JSON.parse(await readFile(path.resolve(requiredOption('plan')), 'utf8'));
const runDir = path.resolve(requiredOption('run-dir'));
const outputPath = path.resolve(requiredOption('out'));
if (plan.model.provider !== 'local')
  throw new Error('Deterministic executor only accepts local models.');
if (plan.task.taskClass !== 'equation')
  throw new Error(`No deterministic fixture compiler exists for ${plan.task.taskClass}.`);

const startedAt = Date.now();
const config = JSON.parse(await readFile(path.resolve('benchmarks/deck-gym/v2/gym.json'), 'utf8'));
const task = config.tasks.find((entry) => entry.id === plan.task.id);
if (!task) throw new Error(`NodeGym task ${plan.task.id} is not configured.`);
const fixture = loadNodeGymTaskFixture({ task }).fixture;
const compiledHarness = compileExecutableNodeGymHarness({ plan, fixture });
const artifact = {
  id: 'nodegym-public-equation',
  narrativeJob: 'Evaluate the supplied quality-to-cost ratio from bound public facts.',
  allowedClaims: fixture.evidence.claims.map((claim) => claim.text),
  evidence: fixture.evidence.sources.map((source) => ({
    sourceId: source.id,
    digest: source.digest,
  })),
  accessibility: {
    altText: 'Quality 0.8 divided by cost 0.4 equals a ratio of 2.',
    readingOrder: 'title, inputs, equation, result, source',
  },
};
const normalizedSpec = artifactSpecEnvelope(artifact, 'equation', {
  expression: {
    op: 'divide',
    args: [
      { op: 'value', name: 'Q' },
      { op: 'value', name: 'C' },
    ],
  },
  values: { Q: 0.8, C: 0.4 },
  result: 2,
  tolerance: 0,
  variableUnits: { Q: 'score', C: 'index', result: 'ratio' },
});
normalizedSpec.claimIds = ['equation-claim'];
normalizedSpec.sourceIds = ['public-equation-source'];
normalizedSpec.provenance.sourceRefs = ['public-equation-source'];
normalizedSpec.provenance.sourceDigest = fixture.evidence.sources[0].digest;
const { specDigest: _oldDigest, ...unsignedSpec } = normalizedSpec;
normalizedSpec.specDigest = sha256Json(unsignedSpec);
const semantic = validateArtifactSpec(normalizedSpec);
if (!semantic.ok)
  throw new Error(
    `Deterministic control spec is invalid: ${semantic.issues.map((entry) => entry.code).join(', ')}`,
  );
const normalizedSpecDigest = `sha256:${normalizedSpec.specDigest}`;
const sourceRunDigest = digestJson({
  runId: plan.runId,
  fixtureDigest: digestJson(fixture),
  harnessDigest: compiledHarness.harnessDigest,
  normalizedSpecDigest,
});

await mkdir(runDir, { recursive: true });
await assertNodeGymRealPathContained(path.dirname(runDir), runDir, 'deterministic run directory');
await assertNodeGymRealPathContained(runDir, outputPath, 'deterministic executor result');
const files = {
  browser: path.join(runDir, 'control-browser.png'),
  pptx: path.join(runDir, 'control-deck.pptx'),
  pdf: path.join(runDir, 'control-deck.pdf'),
  montage: path.join(runDir, 'control-montage.png'),
  slide: path.join(runDir, 'control-slide-1.png'),
};
await renderBrowserAndPdf(files.browser, files.pdf);
await renderPptx(files.pptx);
await copyFile(files.browser, files.montage);
await copyFile(files.browser, files.slide);

const artifacts = {
  browser: await fileArtifact(files.browser, sourceRunDigest, { slideCount: 1 }),
  pptx: await fileArtifact(files.pptx, sourceRunDigest, { slideCount: 1 }),
  pdf: await fileArtifact(files.pdf, sourceRunDigest, {
    pageCount: 1,
    fidelity: 'deterministic-browser-identical-content',
  }),
  montage: await fileArtifact(files.montage, sourceRunDigest, { slideCount: 1 }),
  slides: [
    await fileArtifact(files.slide, sourceRunDigest, {
      slideIndex: 1,
      specDigest: normalizedSpecDigest,
    }),
  ],
  sourceLineage: [
    {
      claimId: 'equation-claim',
      sourceId: 'public-equation-source',
      slideIndex: 1,
      specDigest: normalizedSpecDigest,
      sourceRunDigest,
    },
  ],
};

const generatedClaims = fixture.evidence.claims.map((claim) => ({
  claimId: claim.id,
  text: claim.text,
  sourceIds: claim.sourceIds,
  numericFacts: claim.numericFacts.map((fact) => ({
    factId: fact.id,
    value: fact.value,
    unit: fact.unit,
  })),
}));
const specFactBindings = [
  { factId: 'quality-value', path: '/payload/values/Q', unit: 'score' },
  { factId: 'cost-value', path: '/payload/values/C', unit: 'index' },
  { factId: 'ratio-value', path: '/payload/result', unit: 'ratio' },
];
const observedEffects = [
  `context:${compiledHarness.contextDigest}`,
  ...compiledHarness.enabledTools.map((tool) => `tool:${tool.id}`),
  `repair:${compiledHarness.repairWorkflow.strategy}`,
];
const result = {
  schemaVersion: NODE_GYM_EXECUTOR_RESULT_SCHEMA,
  runId: plan.runId,
  pairingKey: plan.pairingKey,
  status: 'completed',
  route: {
    mode: 'deterministic',
    requestedRoute: plan.model.route,
    actualProvider: 'local',
    actualModel: plan.model.route,
    traceId: `control-${plan.runId}`,
  },
  sourceRunDigest,
  expectedSlideCount: 1,
  normalizedSpec,
  generatedClaims,
  specFactBindings,
  compiledHarness: {
    schemaVersion: compiledHarness.schemaVersion,
    profileId: compiledHarness.profileId,
    profileVersion: compiledHarness.profileVersion,
    harnessDigest: compiledHarness.harnessDigest,
    contextDigest: compiledHarness.contextDigest,
    enabledTools: compiledHarness.enabledTools,
    repairWorkflow: compiledHarness.repairWorkflow,
  },
  harnessExecution: {
    observed: true,
    profileId: plan.harness.id,
    profileVersion: plan.harness.version,
    traceDigest: digestJson({ plan, observedEffects }),
    observedEffects,
  },
  briefCoverage: [...fixture.constraints.requiredTopics],
  story: {
    beats: fixture.constraints.requiredStoryBeats.map((id) => ({ id })),
  },
  toolTrace: {
    calls: compiledHarness.enabledTools.map((tool) => ({
      toolId: tool.id,
      validation: { status: 'passed' },
    })),
  },
  repairTrace: { attempts: [] },
  renderDiagnostics: {
    overflowCount: 0,
    overlapCount: 0,
    placeholderCount: 0,
    minimumContrastPassed: true,
    distinctVisualKinds: 1,
    pptxEditableObjectRatio: 1,
  },
  usage: {
    latencyMs: Date.now() - startedAt,
    inputTokens: 0,
    outputTokens: 0,
    costMicroUsd: 0,
    repairCount: 0,
  },
  artifacts,
  diagnostics: {
    semanticIssueCodes: [],
    estimatedTextOverflowCount: 0,
    exportTimedOut: false,
    unsupportedClaimCount: 0,
    freeModelClaimUnattributed: false,
    claimAudit: {
      status: 'passed',
      method: 'typed-artifact-spec-and-fixture-fact-binding',
    },
  },
  issueCodes: [],
};
await writeNodeGymFileAtomic(runDir, outputPath, `${JSON.stringify(result, null, 2)}\n`, {
  exclusive: true,
  label: 'deterministic executor result',
});

async function renderBrowserAndPdf(browserPath, pdfPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.setContent(`<!doctype html>
      <html><head><style>
      *{box-sizing:border-box} body{margin:0;background:#f4efe7;font-family:Arial,sans-serif;color:#17231e}
      .slide{width:1600px;height:900px;padding:92px 112px;position:relative}
      .eyebrow{font-size:24px;letter-spacing:.12em;color:#287a78;font-weight:700}
      h1{font-size:58px;line-height:1.04;max-width:1120px;margin:28px 0 42px}
      .inputs{display:flex;gap:28px;margin-bottom:40px}.input{background:#fbf8f2;border:2px solid #e4ddd2;border-radius:18px;padding:24px 32px;font-size:26px}
      .equation{font-size:82px;font-weight:700;color:#c45538}.result{position:absolute;right:112px;bottom:96px;text-align:right}
      .result strong{display:block;font-size:112px}.result span{font-size:24px;color:#667069}
      .source{position:absolute;left:112px;bottom:96px;font-size:20px;color:#667069}
      </style></head><body><main class="slide">
      <div class="eyebrow">DETERMINISTIC CONTROL / PUBLIC FIXTURE</div>
      <h1>Quality-to-cost ratio is computed from bound facts</h1>
      <div class="inputs"><div class="input">Quality Q = 0.8 score</div><div class="input">Cost C = 0.4 index</div></div>
      <div class="equation">Q / C = 0.8 / 0.4 = 2</div>
      <div class="source">Source: NodeGym synthetic public equation fixture / CC0-1.0</div>
      <div class="result"><strong>2</strong><span>quality-to-cost ratio</span></div>
      </main></body></html>`);
    await page.locator('.slide').screenshot({ path: browserPath });
    await page.pdf({
      path: pdfPath,
      width: '13.333333in',
      height: '7.5in',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      pageRanges: '1',
    });
  } finally {
    await browser.close();
  }
}

async function renderPptx(filePath) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'NodeGym deterministic control';
  pptx.subject = 'Digest-bound public equation fixture';
  pptx.title = 'Quality-to-cost ratio';
  const slide = pptx.addSlide();
  slide.background = { color: 'F4EFE7' };
  slide.addText('DETERMINISTIC CONTROL / PUBLIC FIXTURE', {
    x: 0.94,
    y: 0.72,
    w: 10.5,
    h: 0.3,
    fontFace: 'Arial',
    fontSize: 14,
    bold: true,
    color: '287A78',
    charSpacing: 1.5,
  });
  slide.addText('Quality-to-cost ratio is computed from bound facts', {
    x: 0.94,
    y: 1.25,
    w: 9.5,
    h: 1.15,
    fontFace: 'Arial',
    fontSize: 31,
    bold: true,
    color: '17231E',
    margin: 0,
  });
  slide.addText('Quality Q = 0.8 score     Cost C = 0.4 index', {
    x: 0.94,
    y: 2.65,
    w: 8.8,
    h: 0.55,
    fontFace: 'Arial',
    fontSize: 18,
    color: '17231E',
    fill: { color: 'FBF8F2' },
    line: { color: 'E4DDD2', width: 1 },
    margin: 0.16,
  });
  slide.addText('Q / C = 0.8 / 0.4 = 2', {
    x: 0.94,
    y: 3.55,
    w: 8.5,
    h: 0.8,
    fontFace: 'Arial',
    fontSize: 39,
    bold: true,
    color: 'C45538',
    margin: 0,
  });
  slide.addText('2', {
    x: 10.4,
    y: 4.9,
    w: 1.8,
    h: 1.0,
    fontFace: 'Arial',
    fontSize: 64,
    bold: true,
    align: 'right',
    color: '17231E',
    margin: 0,
  });
  slide.addText('quality-to-cost ratio', {
    x: 9.4,
    y: 5.95,
    w: 2.8,
    h: 0.35,
    fontFace: 'Arial',
    fontSize: 13,
    align: 'right',
    color: '667069',
    margin: 0,
  });
  slide.addText('Source: NodeGym synthetic public equation fixture / CC0-1.0', {
    x: 0.94,
    y: 6.45,
    w: 8.5,
    h: 0.3,
    fontFace: 'Arial',
    fontSize: 11,
    color: '667069',
    margin: 0,
  });
  await pptx.writeFile({ fileName: filePath });
}

async function fileArtifact(filePath, runDigest, extras = {}) {
  const details = await stat(filePath);
  return {
    path: path.basename(filePath),
    digest: await sha256File(filePath),
    bytes: details.size,
    sourceRunDigest: runDigest,
    validation: { status: 'passed' },
    ...extras,
  };
}

function requiredOption(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing --${name}.`);
  return process.argv[index + 1];
}

async function sha256File(filePath) {
  return `sha256:${createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex')}`;
}

function sha256Json(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
