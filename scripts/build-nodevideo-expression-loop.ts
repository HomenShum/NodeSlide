#!/usr/bin/env -S npx vite-node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { chromium } from 'playwright';
import { nodeslideStableId } from '../convex/lib/nodeslideIds';
import { type NodeSlidePlannedSlide, buildBriefNodeSlide } from '../convex/lib/nodeslideSeed';
import { validateNodeSlideSnapshot } from '../convex/lib/nodeslideValidation';
import type { DeckSnapshot, SourceRecord } from '../shared/nodeslide';
import { buildPptx, renderDeckHtml } from '../src/domains/nodeslide/slidelang';

interface ApprovedSection {
  role: 'problem' | 'architecture' | 'data-flow' | 'tradeoff' | 'proof';
  title: string;
  visualLines: string[];
  claim: string;
  narration: string;
  evidenceArtifactIds: string[];
}

interface ApprovedExplanation {
  schemaVersion: 'nodeagent.approved-explanation/v1';
  id: string;
  thesis: string;
  objective: { question: string; desiredOutcome: string };
  sections: ApprovedSection[];
  disclosure: { unsupportedClaims: string[] };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeVideoRoot = path.resolve(repoRoot, '..', 'NodeVideo');
const approvedPath = path.join(
  nodeVideoRoot,
  'evidence/youtube-expression-loop-2026-08-02/approved-explanation.json',
);
const outputRoot = path.join(repoRoot, 'outputs/nodevideo-expression-loop-2026-08-02');
const now = Date.UTC(2026, 7, 2);
const width = 1280;
const height = 720;

function sha256(value: Uint8Array | string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function slidesFromApproved(sections: ApprovedSection[]): NodeSlidePlannedSlide[] {
  const byRole = new Map(sections.map((section) => [section.role, section]));
  const section = (role: ApprovedSection['role']) => {
    const found = byRole.get(role);
    if (!found) throw new Error(`Approved explanation is missing the ${role} section.`);
    return found;
  };
  const problem = section('problem');
  const architecture = section('architecture');
  const dataFlow = section('data-flow');
  const tradeoff = section('tradeoff');
  const proof = section('proof');
  return [
    {
      title: problem.title,
      section: '01 / Problem',
      headline: 'The model may propose. Media output must reproduce.',
      body: problem.claim,
      bullets: problem.visualLines,
    },
    {
      title: architecture.title,
      section: '02 / System boundary',
      headline: 'Intent, state, execution — one typed handoff.',
      body: 'EDIT PLAN → FIXED MEDIA TOOLS',
      bullets: architecture.visualLines.slice(0, 2),
      metric: '3',
      metricLabel: 'planes · one typed handoff',
    },
    {
      title: dataFlow.title,
      section: '03 / Plan → execute',
      headline: 'Approval binds the plan before media code runs.',
      body: 'No shell commands. No arbitrary FFmpeg graph.',
      bullets: dataFlow.visualLines,
      diagram: {
        kind: 'process',
        direction: 'horizontal',
        nodes: [
          { id: 'brief-proposal', label: 'Brief → typed proposal', kind: 'step' },
          { id: 'approval', label: 'Approval', kind: 'decision' },
          { id: 'hash', label: 'Hash-bound plan', kind: 'milestone' },
          { id: 'render-receipt', label: 'Deterministic render → receipt', kind: 'system' },
        ],
        edges: [
          { from: 'brief-proposal', to: 'approval' },
          { from: 'approval', to: 'hash' },
          { from: 'hash', to: 'render-receipt', label: 'replay or recovery' },
        ],
      },
    },
    {
      title: tradeoff.title,
      section: '04 / Tradeoff + failure',
      headline: 'Less model freedom buys an inspectable execution boundary.',
      body: 'Rejected: arbitrary renderer code. Accepted: versioned typed operations. Fail closed on stale or ambiguous state.',
      bullets: tradeoff.visualLines,
    },
    {
      title: proof.title,
      section: '05 / Proof + next',
      headline: 'Mechanics pass. Quality is unproven.',
      body: '22 targeted tests pass. Strict editorial audit failed: 1/5 cuts within ±2 frames.',
      bullets: [
        '22 TARGETED TESTS PASS',
        'STRICT EDITORIAL AUDIT FAILED: 1/5 CUTS WITHIN ±2 FRAMES',
        'MANUAL SYNTHETIC DOGFOOD — NOT THE FULL EXPRESSION LOOP',
      ],
    },
  ];
}

function sourceRecords(
  deckId: string,
  sections: ApprovedSection[],
): { records: SourceRecord[]; idsBySlide: string[][] } {
  const records = new Map<string, SourceRecord>();
  const idsBySlide = sections.map((section) =>
    section.evidenceArtifactIds.map((artifactId) => {
      const id = nodeslideStableId('source', deckId, artifactId);
      if (!records.has(id)) {
        records.set(id, {
          id,
          deckId,
          title: artifactId,
          sourceType: 'internal',
          retrievedAt: now,
          citation: artifactId,
          format: artifactId.endsWith('.md') || artifactId.includes('.md:') ? 'md' : 'txt',
          provider: 'NodeVideo frozen approved explanation',
          retention: 'until_deleted',
          status: 'ready',
        });
      }
      return id;
    }),
  );
  return { records: [...records.values()], idsBySlide };
}

async function presentationTools() {
  const root = path.join(
    process.env.USERPROFILE ?? os.homedir(),
    '.codex/plugins/cache/openai-primary-runtime/presentations',
  );
  const versions = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const version of versions) {
    const tools = path.join(root, version, 'skills/presentations/container_tools');
    const render = path.join(tools, 'render_slides.py');
    const montage = path.join(tools, 'create_montage.py');
    try {
      await Promise.all([access(render), access(montage)]);
      return { render, montage };
    } catch {
      // Continue to the next installed runtime.
    }
  }
  throw new Error('Presentation render tools are unavailable.');
}

async function run(executable: string, args: string[], timeoutMs: number) {
  const child = spawn(executable, args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  });
  child.stderr.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  });
  const timeout = setTimeout(() => child.kill(), timeoutMs);
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => resolve(exitCode ?? -1));
  });
  clearTimeout(timeout);
  if (code !== 0) throw new Error(`${path.basename(executable)} failed: ${output}`);
  return output;
}

function unsupportedMatches(snapshot: DeckSnapshot, prohibited: string[]) {
  const corpus = [
    ...snapshot.slides.flatMap((slide) => [slide.title, slide.section ?? '', slide.notes ?? '']),
    ...snapshot.elements.map((element) => element.content ?? ''),
  ]
    .join('\n')
    .toLowerCase();
  return prohibited.filter((claim) => corpus.includes(claim.toLowerCase()));
}

function benchmarkClaimMatches(corpus: string) {
  const patterns = [
    /\b\d{1,3}(?:,\d{3})+\s+held-out requests\b/giu,
    /\b\d+(?:\.\d+)?%\s+(?:review|abstain)\b/giu,
  ];
  return [...new Set(patterns.flatMap((pattern) => corpus.match(pattern) ?? []))];
}

function snapshotCorpus(snapshot: DeckSnapshot) {
  return [
    ...snapshot.slides.flatMap((slide) => [slide.title, slide.section ?? '', slide.notes ?? '']),
    ...snapshot.elements.map((element) => element.content ?? ''),
  ].join('\n');
}

function assertNoBenchmarkShorthand(label: string, corpus: string) {
  const matches = benchmarkClaimMatches(corpus);
  if (matches.length > 0) {
    throw new Error(`${label} contains prohibited benchmark shorthand: ${matches.join(', ')}`);
  }
  return matches;
}

const approved = JSON.parse(await readFile(approvedPath, 'utf8')) as ApprovedExplanation;
if (approved.schemaVersion !== 'nodeagent.approved-explanation/v1') {
  throw new Error(`Unsupported approved explanation schema: ${approved.schemaVersion}`);
}
if (approved.sections.length !== 5) {
  throw new Error(`Expected exactly five approved sections; received ${approved.sections.length}.`);
}

const plannedSlides = slidesFromApproved(approved.sections);
const plannedBenchmarkMatches = assertNoBenchmarkShorthand(
  'Planned slides',
  JSON.stringify(plannedSlides),
);
const deckId = `nodevideo-expression-loop-${approved.id}`;
const built = buildBriefNodeSlide({
  deckId,
  projectId: 'nodevideo-expression-loop-2026-08-02',
  title: 'NodeVideo Expression Loop — trust through typed execution',
  brief: {
    prompt: `Create exactly 5 slides. ${approved.objective.question}`,
    audience: 'Backend engineer interviewer',
    purpose: approved.objective.desiredOutcome,
    successCriteria: [
      'Preserve the approved five-part explanation exactly',
      'Keep planning and execution boundaries visually explicit',
      'Include failed proof and honest non-success states',
    ],
  },
  themeId: 'editorial-signal',
  rawSpec: {
    title: 'NodeVideo Expression Loop — trust through typed execution',
    narrative: approved.sections.map((section) => section.role),
    slides: plannedSlides,
  },
  now,
});

const evidence = sourceRecords(deckId, approved.sections);
const snapshot: DeckSnapshot = {
  ...built.snapshot,
  sources: [...built.snapshot.sources, ...evidence.records],
  slides: built.snapshot.slides.map((slide, index) => {
    const section = approved.sections[index];
    if (!section) throw new Error(`No approved narration for slide ${index + 1}.`);
    return {
      ...slide,
      notes: `${section.narration}\n\nEvidence pointers: ${section.evidenceArtifactIds.join('; ')}\nApproved claim: ${section.claim}`,
    };
  }),
  elements: built.snapshot.elements.map((element) => {
    const slideIndex = built.snapshot.slides.findIndex((slide) => slide.id === element.slideId);
    const localIds = evidence.idsBySlide[slideIndex] ?? [];
    return { ...element, sourceIds: [...new Set([...element.sourceIds, ...localIds])] };
  }),
};

if (snapshot.slides.length !== 5)
  throw new Error(`Exact-count gate failed: ${snapshot.slides.length}.`);
if (!built.spec.deckDiversity?.passes) {
  throw new Error(`Diversity gate failed: ${JSON.stringify(built.spec.deckDiversity.failures)}`);
}
const validation = validateNodeSlideSnapshot(snapshot, now);
if (!validation.publishOk) {
  const diagnostics = validation.issues.map((issue) => {
    const slideIndex = snapshot.slides.findIndex((slide) => slide.id === issue.slideId);
    const element = snapshot.elements.find((candidate) => candidate.id === issue.elementId);
    const relatedElements = [...issue.message.matchAll(/"(element_[^"]+)"/gu)].map(([, id]) => {
      const related = snapshot.elements.find((candidate) => candidate.id === id);
      return { id, name: related?.name, bbox: related?.bbox, content: related?.content };
    });
    return {
      ...issue,
      slideIndex: slideIndex + 1,
      elementName: element?.name,
      elementContent: element?.content,
      relatedElements,
    };
  });
  throw new Error(`Overflow/publication gate failed: ${JSON.stringify(diagnostics)}`);
}
const prohibited = unsupportedMatches(snapshot, approved.disclosure.unsupportedClaims);
if (prohibited.length > 0) {
  throw new Error(`Unsupported-claim gate failed: ${prohibited.join(', ')}`);
}
if (snapshot.slides.some((slide) => !slide.notes?.includes('Evidence pointers:'))) {
  throw new Error('Speaker-note evidence gate failed.');
}
if (snapshot.elements.some((element) => !element.exportCapabilities.includes('pptx_editable'))) {
  throw new Error('Editability gate failed: a slide element lacks pptx_editable capability.');
}
const snapshotBenchmarkMatches = assertNoBenchmarkShorthand('Snapshot', snapshotCorpus(snapshot));

await mkdir(outputRoot, { recursive: true });
const html = renderDeckHtml(snapshot);
const pptxBinary = await buildPptx(snapshot);
const pptx = Buffer.from(
  pptxBinary instanceof ArrayBuffer
    ? new Uint8Array(pptxBinary)
    : pptxBinary instanceof Uint8Array
      ? pptxBinary
      : new Uint8Array(await pptxBinary.arrayBuffer()),
);
const pptxZip = await JSZip.loadAsync(pptx);
const pptxTextParts = await Promise.all(
  Object.entries(pptxZip.files)
    .filter(
      ([name, entry]) => !entry.dir && /^ppt\/(?:slides|notesSlides)\/[^/]+\.xml$/u.test(name),
    )
    .map(([, entry]) => entry.async('string')),
);
const pptxBenchmarkMatches = assertNoBenchmarkShorthand('PPTX', pptxTextParts.join('\n'));
const snapshotPath = path.join(outputRoot, 'nodevideo-expression-loop.nodeslide.json');
const htmlPath = path.join(outputRoot, 'nodevideo-expression-loop.html');
const pptxPath = path.join(outputRoot, 'nodevideo-expression-loop.pptx');
await Promise.all([
  writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`),
  writeFile(htmlPath, html, 'utf8'),
  writeFile(pptxPath, pptx),
]);

const browserDir = path.join(outputRoot, 'browser');
const pptxDir = path.join(outputRoot, 'pptx-render');
await Promise.all([mkdir(browserDir, { recursive: true }), mkdir(pptxDir, { recursive: true })]);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
await page.goto(`file:///${htmlPath.replaceAll('\\', '/')}`, { waitUntil: 'load' });
const htmlBenchmarkMatches = assertNoBenchmarkShorthand(
  'HTML',
  (await page.locator('[data-slide-id]').allTextContents()).join('\n'),
);
const browserDigests: string[] = [];
for (let index = 0; index < snapshot.slides.length; index += 1) {
  await page.evaluate((activeIndex) => {
    document.querySelectorAll<HTMLElement>('[data-slide-id]').forEach((slide, slideIndex) => {
      slide.hidden = slideIndex !== activeIndex;
      slide.setAttribute('aria-hidden', String(slideIndex !== activeIndex));
    });
  }, index);
  const slide = page.locator('[data-slide-id]').nth(index);
  const bytes = await slide.screenshot({
    path: path.join(browserDir, `slide-${String(index + 1).padStart(3, '0')}.png`),
  });
  browserDigests.push(sha256(bytes));
}
await browser.close();

const tools = await presentationTools();
const python = process.env.NODE_GYM_PYTHON ?? 'python';
await run(
  python,
  [
    tools.render,
    pptxPath,
    '--output_dir',
    pptxDir,
    '--width',
    String(width),
    '--height',
    String(height),
  ],
  240_000,
);
const pptxImages = (await readdir(pptxDir)).filter((name) => name.endsWith('.png')).sort();
if (pptxImages.length !== 5) {
  throw new Error(`PPTX render count gate failed: ${pptxImages.length}.`);
}
const browserImages = (await readdir(browserDir)).filter((name) => name.endsWith('.png')).sort();
if (browserImages.length !== 5) {
  throw new Error(`Browser render count gate failed: ${browserImages.length}.`);
}
const montagePath = path.join(outputRoot, 'montage.png');
await run(
  python,
  [tools.montage, '--input_dir', browserDir, '--output_file', montagePath],
  120_000,
);
const pptxMontagePath = path.join(outputRoot, 'pptx-montage.png');
await run(
  python,
  [tools.montage, '--input_dir', pptxDir, '--output_file', pptxMontagePath],
  120_000,
);

const report = {
  schemaVersion: 'nodeslide.expression-loop-proof/v1',
  approvedSpec: approvedPath,
  approvedSpecDigest: sha256(await readFile(approvedPath)),
  generatedAt: new Date().toISOString(),
  slideCount: snapshot.slides.length,
  diversity: built.spec.deckDiversity,
  validation: {
    publishOk: validation.publishOk,
    cleanOk: validation.cleanOk,
    issues: validation.issues,
  },
  unsupportedClaimMatches: prohibited,
  prohibitedBenchmarkPercentagesAbsent:
    plannedBenchmarkMatches.length === 0 &&
    snapshotBenchmarkMatches.length === 0 &&
    htmlBenchmarkMatches.length === 0 &&
    pptxBenchmarkMatches.length === 0,
  prohibitedBenchmarkMatches: {
    plannedSlides: plannedBenchmarkMatches,
    snapshot: snapshotBenchmarkMatches,
    html: htmlBenchmarkMatches,
    pptx: pptxBenchmarkMatches,
  },
  editableElementCount: snapshot.elements.filter((element) =>
    element.exportCapabilities.includes('pptx_editable'),
  ).length,
  speakerNotes: snapshot.slides.map((slide, index) => ({
    slideIndex: index + 1,
    narrationDigest: sha256(approved.sections[index]?.narration ?? ''),
    notesDigest: sha256(slide.notes ?? ''),
    evidenceArtifactIds: approved.sections[index]?.evidenceArtifactIds ?? [],
  })),
  artifacts: {
    snapshotPath,
    htmlPath,
    pptxPath,
    browserDir,
    pptxDir,
    montagePath,
    pptxMontagePath,
  },
  browserDigests,
  pptxImages,
};
const reportPath = path.join(outputRoot, 'verification.json');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
