#!/usr/bin/env -S npx vite-node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { DeckSnapshot, SlideElement } from '../shared/nodeslide';
import { buildPptx } from '../src/domains/nodeslide/slidelang/pptx';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, 'outputs/longform-compression-v1/staar-alcon');
const deckProgram = JSON.parse(
  await readFile(
    path.join(repoRoot, 'benchmarks/longform-compression/v1/staar-alcon/deck-program.json'),
    'utf8',
  ),
) as {
  sections: Array<{
    sectionId: string;
    startSlideIndex: number;
    endSlideIndex: number;
  }>;
};
const WIDTH = 1280;
const HEIGHT = 720;

async function run(executable: string, args: string[], timeoutMs: number) {
  const child = spawn(executable, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-20_000);
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-20_000);
  });
  const timeout = setTimeout(() => child.kill(), timeoutMs);
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => resolve(exitCode ?? -1));
  });
  clearTimeout(timeout);
  if (code !== 0) throw new Error(`${path.basename(executable)} failed: ${stderr || stdout}`);
  return { stdout, stderr };
}

async function presentationTools() {
  const versionsRoot = path.join(
    process.env.USERPROFILE ?? os.homedir(),
    '.codex/plugins/cache/openai-primary-runtime/presentations',
  );
  const versions = (await readdir(versionsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const version of versions) {
    const tools = path.join(versionsRoot, version, 'skills/presentations/container_tools');
    const render = path.join(tools, 'render_slides.py');
    const montage = path.join(tools, 'create_montage.py');
    try {
      await Promise.all([access(render), access(montage)]);
      return { render, montage };
    } catch {
      // Continue to the next installed presentation runtime.
    }
  }
  throw new Error('Presentation render tools are unavailable.');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function elementHtml(element: SlideElement) {
  const { x, y, width, height } = element.bbox;
  const style = element.style ?? {};
  const base = [
    `left:${x * 100}%`,
    `top:${y * 100}%`,
    `width:${width * 100}%`,
    `height:${height * 100}%`,
    `color:${style.color ?? '#17231D'}`,
    `font-size:${Math.max(8, Number(style.fontSize ?? 18)) * 1.12}px`,
    `font-weight:${style.fontWeight ?? 400}`,
    `text-align:${style.textAlign ?? 'left'}`,
    `opacity:${style.opacity ?? 1}`,
    `transform:rotate(${element.rotation ?? 0}deg)`,
  ].join(';');
  if (element.kind === 'text' || element.kind === 'math') {
    return `<div class="el text role-${escapeHtml(element.role ?? 'content')}" style="${base}">${escapeHtml(element.content ?? '')}</div>`;
  }
  if (element.kind === 'chart') {
    const values = element.chart.series.flatMap((series) => series.values);
    const max = Math.max(1, ...values.map((value) => Math.abs(value)));
    const bars = values
      .slice(0, 8)
      .map(
        (value, index) =>
          `<div class="bar-wrap"><div class="bar" style="height:${Math.max(3, (Math.abs(value) / max) * 78)}%"></div><span>${escapeHtml(element.chart.labels[index] ?? String(index + 1))}</span></div>`,
      )
      .join('');
    return `<div class="el chart" style="${base}">${bars}</div>`;
  }
  if (element.kind === 'connector') {
    return `<div class="el connector" style="${base};border-top:2px solid ${style.color ?? '#7066B0'}"></div>`;
  }
  if (element.kind === 'image' && element.imageUrl) {
    return `<img class="el" alt="${escapeHtml(element.altText ?? '')}" src="${escapeHtml(element.imageUrl)}" style="${base};object-fit:${element.fit ?? 'cover'}" />`;
  }
  const label = element.content ? escapeHtml(element.content) : '';
  return `<div class="el shape role-${escapeHtml(element.role ?? 'shape')}" style="${base};background:${style.fill ?? style.color ?? 'rgba(198,83,52,.12)'};border:${style.strokeWidth ?? 0}px solid ${style.stroke ?? 'transparent'};border-radius:${style.radius ?? 8}px">${label}</div>`;
}

function slideHtml(snapshot: DeckSnapshot, slideIndex: number) {
  const slide = snapshot.slides.find(
    (candidate) => candidate.id === snapshot.deck.slideOrder[slideIndex],
  );
  if (!slide) throw new Error(`Slide ${slideIndex + 1} is missing.`);
  const elements = slide.elementOrder
    .map((id) => snapshot.elements.find((element) => element.id === id))
    .filter((element): element is SlideElement => Boolean(element) && element?.visible !== false);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:#101311}
    .slide{position:relative;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:${slide.background};font-family:Arial,sans-serif}
    .el{position:absolute;overflow:hidden}.text{white-space:pre-wrap;line-height:1.12;padding:2px}.shape{display:flex;align-items:center;justify-content:center}
    .role-headline{font-family:Georgia,serif;letter-spacing:-.02em}.role-footer,.role-page_number{letter-spacing:.12em;text-transform:uppercase}
    .chart{display:flex;align-items:flex-end;gap:3%;padding:7% 5% 3%;border-left:1px solid #B7B0A5;border-bottom:1px solid #B7B0A5}
    .bar-wrap{height:100%;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;gap:5px;font-size:10px;color:#59645E;text-align:center}
    .bar{background:linear-gradient(180deg,#C65334,#E6A18D);border-radius:5px 5px 0 0;min-height:3px}
    .connector{transform-origin:left center}
  </style></head><body><div class="slide" data-slide-index="${slideIndex + 1}">${elements.map(elementHtml).join('')}</div></body></html>`;
}

const tools = await presentationTools();
const python = process.env.NODE_GYM_PYTHON ?? 'python';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});
const renderReceipt: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  width: WIDTH,
  height: HEIGHT,
  decks: {},
};

for (const kind of ['long', 'short', 'executive'] as const) {
  const snapshotPath = path.join(outputRoot, `${kind}.nodeslide.json`);
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as DeckSnapshot;
  const deckRoot = path.join(outputRoot, kind);
  const browserDir = path.join(deckRoot, 'browser');
  const pptxDir = path.join(deckRoot, 'pptx-render');
  await Promise.all([mkdir(browserDir, { recursive: true }), mkdir(pptxDir, { recursive: true })]);

  const binary = await buildPptx(snapshot);
  const pptxPath = path.join(deckRoot, `${kind}.pptx`);
  await writeFile(
    pptxPath,
    new Uint8Array(
      binary instanceof ArrayBuffer
        ? binary
        : binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength),
    ),
  );
  await run(
    python,
    [
      tools.render,
      pptxPath,
      '--output_dir',
      pptxDir,
      '--width',
      String(WIDTH),
      '--height',
      String(HEIGHT),
    ],
    240_000,
  );

  const browserDigests: string[] = [];
  for (let slideIndex = 0; slideIndex < snapshot.deck.slideOrder.length; slideIndex += 1) {
    await page.setContent(slideHtml(snapshot, slideIndex), { waitUntil: 'load' });
    const bytes = await page.screenshot({
      path: path.join(browserDir, `slide-${String(slideIndex + 1).padStart(3, '0')}.png`),
    });
    browserDigests.push(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  }
  const pptxFiles = (await readdir(pptxDir)).filter((name) => name.endsWith('.png')).sort();
  if (pptxFiles.length !== snapshot.deck.slideOrder.length)
    throw new Error(
      `${kind} PPTX render count ${pptxFiles.length} does not match ${snapshot.deck.slideOrder.length}`,
    );
  const browserMontagePath = path.join(deckRoot, 'browser-montage.png');
  const pptxMontagePath = path.join(deckRoot, 'pptx-montage.png');
  await Promise.all([
    run(
      python,
      [
        tools.montage,
        '--input_dir',
        browserDir,
        '--output_file',
        browserMontagePath,
        '--label_mode',
        'filename',
      ],
      120_000,
    ),
    run(
      python,
      [
        tools.montage,
        '--input_dir',
        pptxDir,
        '--output_file',
        pptxMontagePath,
        '--label_mode',
        'filename',
      ],
      120_000,
    ),
  ]);
  const sectionMontages: Array<{
    sectionId: string;
    browserMontagePath: string;
    pptxMontagePath: string;
  }> = [];
  if (kind === 'long') {
    for (const section of deckProgram.sections) {
      const sectionRoot = path.join(deckRoot, 'sections', section.sectionId);
      const sectionBrowserDir = path.join(sectionRoot, 'browser');
      const sectionPptxDir = path.join(sectionRoot, 'pptx-render');
      await Promise.all([
        mkdir(sectionBrowserDir, { recursive: true }),
        mkdir(sectionPptxDir, { recursive: true }),
      ]);
      for (
        let slideIndex = section.startSlideIndex;
        slideIndex <= section.endSlideIndex;
        slideIndex += 1
      ) {
        await Promise.all([
          copyFile(
            path.join(browserDir, `slide-${String(slideIndex).padStart(3, '0')}.png`),
            path.join(sectionBrowserDir, `slide-${String(slideIndex).padStart(3, '0')}.png`),
          ),
          copyFile(
            path.join(pptxDir, `slide-${slideIndex}.png`),
            path.join(sectionPptxDir, `slide-${slideIndex}.png`),
          ),
        ]);
      }
      const sectionBrowserMontage = path.join(sectionRoot, 'browser-montage.png');
      const sectionPptxMontage = path.join(sectionRoot, 'pptx-montage.png');
      await Promise.all([
        run(
          python,
          [
            tools.montage,
            '--input_dir',
            sectionBrowserDir,
            '--output_file',
            sectionBrowserMontage,
            '--label_mode',
            'filename',
          ],
          120_000,
        ),
        run(
          python,
          [
            tools.montage,
            '--input_dir',
            sectionPptxDir,
            '--output_file',
            sectionPptxMontage,
            '--label_mode',
            'filename',
          ],
          120_000,
        ),
      ]);
      sectionMontages.push({
        sectionId: section.sectionId,
        browserMontagePath: sectionBrowserMontage,
        pptxMontagePath: sectionPptxMontage,
      });
    }
  }
  renderReceipt.decks[kind] = {
    slideCount: snapshot.deck.slideOrder.length,
    pptxPath,
    browserDir,
    pptxDir,
    browserDigests,
    pptxFiles,
    browserMontagePath,
    pptxMontagePath,
    sectionMontages,
  };
}
await browser.close();
await writeFile(
  path.join(outputRoot, 'dual-render-receipt.json'),
  `${JSON.stringify(renderReceipt, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      outputRoot,
      rendered: Object.fromEntries(
        Object.entries(renderReceipt.decks as Record<string, { slideCount: number }>).map(
          ([kind, value]) => [kind, value.slideCount],
        ),
      ),
    },
    null,
    2,
  ),
);
