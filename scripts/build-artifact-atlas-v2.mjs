#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import PptxGenJS from 'pptxgenjs';
import {
  ATLAS_V2_ARTIFACTS,
  ATLAS_V2_DOMAIN_PACKS,
  ATLAS_V2_SHOWCASE_IDS,
  ATLAS_V2_THEMES,
  ATLAS_V2_THEME_VARIANTS,
  ATLAS_V2_THEME_VARIANT_IDS,
  ATLAS_V2_VERSION,
} from './lib/artifact-atlas-v2-definition.mjs';

const WIDTH = 1600;
const HEIGHT = 900;
const SCALE = 120;
const root = process.cwd();
const outputRoot = path.resolve(option('out') ?? 'outputs/artifact-atlas-v2');
const publicRoot = path.resolve(option('public-root') ?? 'public/artifact-atlas-v2');
const artifactRoot = path.resolve(
  option('artifact-root') ?? 'artifacts/deck-gym/artifact-atlas-v2',
);
const atlasPath = path.resolve('benchmarks/artifact-atlas/v2/atlas.json');
const buildStarted = Date.now();

const media = await loadMedia();
await Promise.all([
  mkdir(outputRoot, { recursive: true }),
  mkdir(publicRoot, { recursive: true }),
  mkdir(artifactRoot, { recursive: true }),
  mkdir(path.dirname(atlasPath), { recursive: true }),
]);

const atlas = buildAtlasConfig();
await writeJson(atlasPath, atlas);
await writeJson(path.join(artifactRoot, 'recipes.json'), {
  schemaVersion: 'nodeslide.artifact-recipes/v2',
  atlasVersion: ATLAS_V2_VERSION,
  recipes: ATLAS_V2_ARTIFACTS.map((artifact) => ({
    id: artifact.id,
    ...artifact.recipe,
  })),
});
await writeJson(path.join(artifactRoot, 'domain-packs.json'), {
  schemaVersion: 'nodeslide.artifact-domain-packs/v2',
  atlasVersion: ATLAS_V2_VERSION,
  packs: ATLAS_V2_DOMAIN_PACKS,
});

const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  const atlasDeck = createDeck(
    'NodeSlide Artifact Atlas V2',
    '38-slide internal capability museum',
  );
  for (const [index, artifact] of ATLAS_V2_ARTIFACTS.entries()) {
    const started = Date.now();
    const primitives = buildSlide(artifact, {
      index,
      seriesLabel: 'ATLAS V2',
      theme: ATLAS_V2_THEMES[artifact.theme],
      media,
    });
    addSlide(atlasDeck, primitives, ATLAS_V2_THEMES[artifact.theme], artifact);
    const preview = path.join(publicRoot, `${artifact.id}.png`);
    await renderBrowser(browser, primitives, ATLAS_V2_THEMES[artifact.theme], preview);
    receipts.push(buildReceipt(artifact, index, preview, Date.now() - started, primitives));
  }
  const atlasPptx = path.join(outputRoot, 'nodeslide-artifact-atlas-v2.pptx');
  await atlasDeck.writeFile({ fileName: atlasPptx });

  const showcaseArtifacts = ATLAS_V2_SHOWCASE_IDS.map((id) => artifactById(id));
  const showcaseDeck = createDeck(
    'NodeSlide Ultra Showcase V2',
    '14-slide public narrative selected from Artifact Atlas V2',
  );
  for (const [index, artifact] of showcaseArtifacts.entries()) {
    const theme = ATLAS_V2_THEMES[artifact.theme];
    const primitives = buildSlide(artifact, {
      index,
      seriesLabel: 'ULTRA V2',
      theme,
      media,
      showcase: true,
    });
    addSlide(showcaseDeck, primitives, theme, artifact);
  }
  const showcasePptx = path.join(outputRoot, 'nodeslide-ultra-showcase-v2.pptx');
  await showcaseDeck.writeFile({ fileName: showcasePptx });

  await buildThemeVariants(browser, media);
  await publishDomainPacks();
  await writeJson(path.join(artifactRoot, 'receipts.json'), receipts);
  const catalog = buildCatalog(receipts, atlasPptx, showcasePptx);
  await writeJson(path.join(artifactRoot, 'catalog.json'), catalog);
  await writeJson(path.join(publicRoot, 'catalog.json'), catalog);
  await writeJson(path.join(artifactRoot, 'harness-compare.json'), buildHarnessCompare());
  await writeJson(path.join(artifactRoot, 'model-compare.json'), buildModelCompare());
} finally {
  await browser.close();
}

console.log(
  `[artifact-atlas-v2] built ${ATLAS_V2_ARTIFACTS.length} artifacts and ${ATLAS_V2_SHOWCASE_IDS.length} showcase slides in ${Date.now() - buildStarted}ms`,
);

function buildAtlasConfig() {
  return {
    schemaVersion: 'nodeslide.artifact-atlas/v2',
    atlasVersion: ATLAS_V2_VERSION,
    generatedAt: new Date().toISOString(),
    communicationJob:
      'By the end, product and engineering leaders should understand the complete NodeSlide visual vocabulary, see proof that it survives browser and PowerPoint output, and know how to reuse each pattern.',
    canonicalArtifactCount: ATLAS_V2_ARTIFACTS.length,
    publicShowcaseCount: ATLAS_V2_SHOWCASE_IDS.length,
    chapters: [
      'narrative-foundations',
      'data',
      'systems',
      'progression',
      'product-media',
      'evidence-technical-proof',
      'decision-evaluation',
    ],
    designLanguages: Object.keys(ATLAS_V2_THEMES),
    motionTemplates: ['timeline-progression', 'architecture-walkthrough', 'evidence-to-decision'],
    fixtures: ATLAS_V2_ARTIFACTS,
  };
}

function createDeck(title, subject) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'NodeSlide Artifact Atlas V2';
  pptx.company = 'NodeSlide';
  pptx.lang = 'en-US';
  pptx.title = title;
  pptx.subject = subject;
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: 'en-US',
  };
  return pptx;
}

function buildSlide(artifact, options) {
  const { index, seriesLabel, theme, media: slideMedia } = options;
  const p = [];
  if (artifact.family === 'full-bleed') {
    p.push(
      image(
        0,
        0,
        WIDTH,
        HEIGHT,
        slideMedia.editorial,
        'Evidence converging into a presentation canvas',
      ),
    );
    p.push(rect(0, 0, WIDTH, HEIGHT, { fill: '#09111B', opacity: 0.38 }));
    p.push(text(78, 86, 720, 52, 'FULL-BLEED EDITORIAL IMAGE', 18, '#FFD1B8', 700));
    p.push(text(78, 165, 760, 250, artifact.title, 66, '#FFF7ED', 700));
    p.push(text(82, 675, 670, 72, artifact.takeaway, 26, '#F2E8DC', 450));
    p.push(
      text(
        82,
        822,
        950,
        24,
        'IMAGE · NodeSlide commissioned generation · rights-clearable · editable crop frame',
        12,
        '#E8D7C8',
        500,
        'left',
        true,
      ),
    );
    p.push(
      text(
        1420,
        822,
        100,
        24,
        `${seriesLabel} ${pad(index + 1)}`,
        12,
        '#E8D7C8',
        600,
        'right',
        true,
      ),
    );
    return p;
  }

  p.push(rect(0, 0, WIDTH, HEIGHT, { fill: theme.canvas }));
  p.push(
    text(
      72,
      46,
      980,
      32,
      `${chapterLabel(artifact.chapter)} · ${artifact.id.replaceAll('-', ' ').toUpperCase()}`,
      16,
      theme.accent,
      700,
    ),
  );
  p.push(text(72, 90, 1400, 118, artifact.title, 56, theme.ink, 700));
  p.push(text(72, 748, 1120, 52, artifact.takeaway, 24, theme.muted, 450));
  p.push(
    text(
      72,
      838,
      1140,
      22,
      `SOURCE · ${artifact.evidence.map((source) => source.sourceId).join(' · ')} · deterministic builder v2`,
      11,
      theme.muted,
      500,
      'left',
      true,
    ),
  );
  p.push(
    text(
      1410,
      838,
      110,
      22,
      `${seriesLabel} ${pad(index + 1)}`,
      11,
      theme.muted,
      650,
      'right',
      true,
    ),
  );

  const context = { p, artifact, theme, media: slideMedia };
  const renderer = rendererFor(artifact.family);
  renderer(context);
  return p;
}

function rendererFor(family) {
  switch (family) {
    case 'hero':
      return renderHero;
    case 'section':
      return renderSection;
    case 'metric':
      return renderMetric;
    case 'quote':
      return renderQuote;
    case 'before-after':
      return renderBeforeAfter;
    case 'kpi':
      return renderKpis;
    case 'line':
      return renderLine;
    case 'uncertainty':
      return renderUncertainty;
    case 'waterfall':
      return renderWaterfall;
    case 'scatter':
      return renderScatter;
    case 'table':
      return renderTable;
    case 'dashboard':
      return renderDashboard;
    case 'architecture':
      return renderArchitecture;
    case 'sequence':
      return renderSequence;
    case 'causal':
      return renderCausal;
    case 'sankey':
      return renderSankey;
    case 'decision-tree':
      return renderDecisionTree;
    case 'ecosystem':
      return renderEcosystem;
    case 'timeline':
      return renderTimeline;
    case 'gantt':
      return renderGantt;
    case 'scrolly':
      return renderScrolly;
    case 'chart-states':
      return renderChartStates;
    case 'screenshot':
      return renderScreenshot;
    case 'interaction':
      return renderInteraction;
    case 'product-compare':
      return renderProductCompare;
    case 'spatial':
      return renderSpatial;
    case 'lineage':
      return renderLineage;
    case 'pdf':
      return renderPdf;
    case 'code':
      return renderCode;
    case 'trace':
      return renderTrace;
    case 'equation':
      return renderEquation;
    case 'ci':
      return renderCi;
    case 'risk':
      return renderRisk;
    case 'frontier':
      return renderFrontier;
    case 'model-compare':
      return renderModelCompare;
    case 'harness-compare':
      return renderHarnessCompare;
    case 'recommendation':
      return renderRecommendation;
    default:
      return renderGeneric;
  }
}

function renderHero({ p, theme }) {
  p.push(line(72, 244, 520, 244, { stroke: theme.accent, width: 7 }));
  p.push(text(78, 275, 900, 320, 'BREADTH\nMOTION\nPROOF', 78, theme.ink, 750));
  p.push(text(1160, 290, 310, 118, '38', 104, theme.accent, 750, 'right', true));
  p.push(text(1090, 420, 380, 76, 'canonical visual artifacts', 25, theme.muted, 600, 'right'));
  p.push(
    rect(1120, 535, 350, 96, {
      fill: theme.panel,
      stroke: theme.accent2,
      width: 2,
      radius: 18,
    }),
  );
  p.push(text(1150, 560, 290, 45, '14-slide public narrative', 23, theme.ink, 650, 'center'));
}

function renderSection({ p, theme }) {
  const chapters = [
    'Narrative',
    'Data',
    'Systems',
    'Progression',
    'Product + media',
    'Proof',
    'Decision',
  ];
  chapters.forEach((label, index) => {
    const x = 85 + index * 210;
    const active = index === 1 || index === 4 || index === 6;
    p.push(
      circle(x + 48, 374, active ? 40 : 22, {
        fill: active ? theme.accent : theme.soft,
      }),
    );
    p.push(text(x, 445, 112, 54, label, 18, theme.ink, active ? 700 : 500, 'center'));
    if (index < chapters.length - 1)
      p.push(
        line(x + 91, 374, x + 185, 374, {
          stroke: theme.muted,
          width: 2,
          dash: true,
        }),
      );
  });
  p.push(
    text(
      180,
      570,
      1240,
      58,
      'Each chapter answers a different audience question.',
      30,
      theme.ink,
      650,
      'center',
    ),
  );
}

function renderMetric({ p, theme }) {
  p.push(text(84, 248, 690, 300, '82/84', 132, theme.accent, 750, 'left', true));
  p.push(text(90, 548, 690, 46, 'browser + PowerPoint eligible', 30, theme.ink, 650));
  const labels = [
    ['84', 'plans'],
    ['12', 'archetypes'],
    ['3', 'live models'],
    ['1', 'deterministic control'],
  ];
  labels.forEach(([value, label], index) => {
    const y = 260 + index * 100;
    p.push(line(900, y + 68, 1460, y + 68, { stroke: theme.soft, width: 2 }));
    p.push(text(910, y, 130, 64, value, 42, theme.ink, 700, 'right', true));
    p.push(text(1080, y + 10, 360, 48, label, 23, theme.muted, 500));
  });
}

function renderQuote({ p, theme }) {
  p.push(text(84, 220, 110, 130, '“', 120, theme.accent, 700));
  p.push(
    text(
      170,
      270,
      1090,
      250,
      'Keep the evidence editable;\nkeep the judgment visible.',
      56,
      theme.ink,
      650,
    ),
  );
  p.push(line(170, 560, 560, 560, { stroke: theme.accent2, width: 5 }));
  p.push(
    text(
      170,
      585,
      760,
      42,
      'NODE SLIDE DESIGN PRINCIPLE · NOT A CUSTOMER QUOTE',
      16,
      theme.muted,
      650,
      'left',
      true,
    ),
  );
}

function renderBeforeAfter({ p, theme }) {
  drawBeforeAfterPanels(
    p,
    theme,
    ['Generic cards', 'Hidden evidence', 'One-shot output'],
    ['Narrative job', 'Visible receipts', 'Reviewable proposal'],
  );
}

function renderKpis({ p, theme }) {
  const values = [
    ['4.8', 'Revenue · $M', '5.0 plan', false],
    ['7.4', 'Pipeline · $M', '10.0 plan', true],
    ['21%', 'Win rate', '28% plan', true],
    ['39d', 'Implementation', '46d prior', false],
    ['94%', 'Retention', '95% plan', false],
  ];
  values.forEach(([value, label, context, miss], index) => {
    const x = 72 + index * 298;
    p.push(
      line(x, 278, x + 248, 278, {
        stroke: miss ? theme.danger : theme.accent2,
        width: miss ? 8 : 3,
      }),
    );
    p.push(text(x, 315, 250, 92, value, miss ? 70 : 58, theme.ink, 720, 'left', true));
    p.push(text(x, 430, 250, 34, label, 21, theme.ink, 650));
    p.push(text(x, 480, 250, 28, context, 17, theme.muted, 450));
  });
  p.push(
    text(
      72,
      618,
      1060,
      46,
      'Pipeline and win rate are the two material misses.',
      28,
      theme.ink,
      650,
    ),
  );
}

function renderLine({ p, theme }) {
  const series = [
    {
      values: [72, 74, 79, 83, 87, 91],
      color: theme.accent,
      label: 'Rapid bus · 91',
    },
    {
      values: [61, 62, 63, 65, 66, 67],
      color: theme.danger,
      label: 'Local bus · 67',
    },
    {
      values: [68, 70, 73, 76, 79, 82],
      color: theme.accent2,
      label: 'Rail · 82',
    },
  ];
  drawChartAxes(p, theme, 120, 265, 1090, 390);
  series.forEach((item) => {
    const points = item.values.map((value, index) => [155 + index * 195, 625 - (value - 55) * 10]);
    p.push(polyline(points, { stroke: item.color, width: 6 }));
    points.forEach(([x, y]) => p.push(circle(x, y, 7, { fill: item.color })));
    const end = points.at(-1);
    p.push(text(end[0] + 22, end[1] - 22, 250, 36, item.label, 18, item.color, 700));
  });
}

function renderUncertainty({ p, theme }) {
  drawChartAxes(p, theme, 120, 255, 1160, 420);
  const low = [
    [170, 570],
    [380, 530],
    [590, 500],
    [800, 485],
    [1010, 495],
  ];
  const high = [
    [170, 570],
    [380, 530],
    [590, 420],
    [800, 340],
    [1010, 275],
  ];
  // Keep the range editable in PowerPoint: stepped translucent bands avoid a
  // flattened polygon fallback while preserving the same evidence contract.
  for (let index = 0; index < high.length - 1; index += 1) {
    const top = Math.min(high[index][1], high[index + 1][1]);
    const bottom = Math.max(low[index][1], low[index + 1][1]);
    p.push(
      rect(high[index][0], top, high[index + 1][0] - high[index][0], bottom - top, {
        fill: theme.soft,
        opacity: 0.72,
      }),
    );
  }
  p.push(
    polyline(
      [
        [170, 570],
        [380, 530],
        [590, 455],
        [800, 410],
        [1010, 355],
      ],
      { stroke: theme.accent, width: 6 },
    ),
  );
  p.push(text(1080, 275, 280, 38, 'Q5 high · 13.8', 18, theme.muted, 600));
  p.push(text(1080, 350, 280, 38, 'base · 11.4', 20, theme.accent, 700));
  p.push(text(1080, 485, 280, 38, 'Q5 low · 9.0', 18, theme.muted, 600));
  p.push(
    text(
      125,
      670,
      1080,
      30,
      'Observed             modeled range widens →',
      16,
      theme.muted,
      600,
      'center',
      true,
    ),
  );
}

function renderWaterfall({ p, theme }) {
  const bars = [
    ['Baseline', 62, 0, theme.muted],
    ['Plan', 8, 62, theme.accent2],
    ['Tools', 7, 70, theme.accent],
    ['Repair', 5, 77, theme.accent2],
    ['Deck CI', 4, 82, theme.accent],
    ['Final', 86, 0, theme.ink],
  ];
  const baseY = 680;
  const scale = 3.2;
  bars.forEach(([label, value, start, color], index) => {
    const x = 120 + index * 220;
    const y = baseY - Number(start + value) * scale;
    const h = Number(value) * scale;
    p.push(rect(x, y, 130, h, { fill: color, opacity: index === 5 ? 0.9 : 0.78 }));
    p.push(
      text(
        x,
        y - 42,
        130,
        30,
        index === 0 || index === 5 ? String(value) : `+${value}`,
        20,
        theme.ink,
        700,
        'center',
        true,
      ),
    );
    p.push(text(x - 20, 700, 170, 30, label, 17, theme.muted, 600, 'center'));
    if (index > 0 && index < 5)
      p.push(
        line(x - 90, y + h, x, y + h, {
          stroke: theme.muted,
          width: 2,
          dash: true,
        }),
      );
  });
}

function renderScatter({ p, theme }) {
  drawChartAxes(p, theme, 150, 260, 1080, 410, 'Cost →', 'Quality →');
  const points = [
    [260, 560, 26, 'Gemma · free', theme.accent2],
    [420, 485, 34, 'GPT-OSS · free', theme.muted],
    [560, 430, 38, 'Nemotron · free', theme.accent2],
    [760, 365, 44, 'Kimi', theme.accent],
    [1010, 315, 33, 'Claude', theme.danger],
  ];
  points.forEach(([x, y, r, label, color]) => {
    p.push(
      circle(x, y, r, {
        fill: color,
        opacity: 0.82,
        stroke: theme.panel,
        width: 4,
      }),
    );
    p.push(text(x - 60, y + r + 16, 180, 30, label, 16, theme.ink, 650, 'center'));
  });
  p.push(text(1245, 320, 250, 80, 'Bubble size\n= latency', 18, theme.muted, 600));
}

function renderTable({ p, theme }) {
  const headers = ['Metric', 'Actual', 'Plan', 'Variance', 'Trend', 'Status'];
  const rows = [
    ['Revenue', '4.8', '5.0', '-4%', [2, 3, 4, 5, 6], 'WATCH'],
    ['Pipeline', '7.4', '10.0', '-26%', [7, 6, 5, 4, 3], 'ACT'],
    ['Win rate', '21%', '28%', '-7 pp', [7, 7, 6, 5, 4], 'ACT'],
    ['Implementation', '39d', '35d', '+4d', [3, 4, 5, 6, 7], 'WATCH'],
    ['Retention', '94%', '95%', '-1 pp', [6, 6, 7, 7, 8], 'HOLD'],
  ];
  const xs = [80, 420, 590, 760, 950, 1260];
  headers.forEach((header, index) =>
    p.push(text(xs[index], 255, index === 0 ? 300 : 160, 34, header, 17, theme.muted, 700)),
  );
  rows.forEach((row, rowIndex) => {
    const y = 315 + rowIndex * 72;
    p.push(line(78, y + 52, 1480, y + 52, { stroke: theme.soft, width: 2 }));
    p.push(text(xs[0], y, 300, 40, row[0], 20, theme.ink, 650));
    p.push(text(xs[1], y, 140, 40, row[1], 20, theme.ink, 700, 'right', true));
    p.push(text(xs[2], y, 140, 40, row[2], 19, theme.muted, 500, 'right', true));
    p.push(
      text(
        xs[3],
        y,
        150,
        40,
        row[3],
        19,
        row[5] === 'ACT' ? theme.danger : theme.ink,
        650,
        'right',
        true,
      ),
    );
    const trend = row[4];
    p.push(
      polyline(
        trend.map((value, index) => [xs[4] + index * 46, y + 43 - value * 4]),
        { stroke: row[5] === 'ACT' ? theme.danger : theme.accent2, width: 4 },
      ),
    );
    p.push(
      rect(xs[5], y - 2, 130, 34, {
        fill: row[5] === 'ACT' ? theme.danger : theme.soft,
        radius: 17,
      }),
    );
    p.push(
      text(
        xs[5],
        y + 4,
        130,
        24,
        row[5],
        14,
        row[5] === 'ACT' ? '#FFFFFF' : theme.ink,
        700,
        'center',
        true,
      ),
    );
  });
}

function renderDashboard({ p, theme }) {
  p.push(
    rect(74, 240, 850, 450, {
      fill: theme.panel,
      stroke: theme.soft,
      width: 2,
      radius: 20,
    }),
  );
  p.push(text(105, 265, 500, 36, 'BRIEF → WINNER FUNNEL', 16, theme.muted, 700, 'left', true));
  const funnel = [
    ['Briefs', 100],
    ['Candidates', 84],
    ['Valid renders', 83],
    ['Deck CI', 82],
    ['Human winner', 1],
  ];
  funnel.forEach(([label, value], index) => {
    const w = 640 - index * 105;
    const x = 170 + index * 52;
    const y = 325 + index * 62;
    p.push(
      rect(x, y, w, 45, {
        fill: index === 4 ? theme.accent : theme.soft,
        radius: 8,
      }),
    );
    p.push(
      text(
        x + 16,
        y + 8,
        w - 32,
        28,
        `${label} · ${value}`,
        17,
        index === 4 ? '#FFFFFF' : theme.ink,
        650,
        'center',
      ),
    );
  });
  p.push(
    rect(960, 240, 560, 210, {
      fill: theme.panel,
      stroke: theme.soft,
      width: 2,
      radius: 20,
    }),
  );
  p.push(text(990, 265, 300, 30, 'EXCEPTIONS', 16, theme.muted, 700, 'left', true));
  p.push(text(990, 315, 480, 44, '2 artifacts need repair', 30, theme.danger, 700));
  p.push(text(990, 372, 480, 40, 'Both remain visibly red', 19, theme.ink, 550));
  p.push(
    rect(960, 476, 560, 214, {
      fill: theme.panel,
      stroke: theme.soft,
      width: 2,
      radius: 20,
    }),
  );
  p.push(text(990, 500, 300, 30, 'DECISION QUEUE', 16, theme.muted, 700, 'left', true));
  ['Review model-blind pairs', 'Approve public 14', 'Promote recipes only'].forEach(
    (label, index) => {
      p.push(
        circle(1010, 557 + index * 48, 8, {
          fill: index === 0 ? theme.accent : theme.accent2,
        }),
      );
      p.push(text(1035, 541 + index * 48, 430, 36, label, 18, theme.ink, 600));
    },
  );
}

function renderArchitecture({ p, theme }) {
  const nodes = [
    [90, 350, 220, 100, 'Client'],
    [390, 330, 270, 140, 'Portable protocol\ninitialize · stage · commit'],
    [760, 350, 240, 100, 'Validation engine'],
    [1090, 330, 230, 140, 'Adapter boundary'],
  ];
  nodes.forEach(([x, y, w, h, label], index) => {
    p.push(
      rect(x, y, w, h, {
        fill: theme.panel,
        stroke: index === 3 ? theme.accent : theme.accent2,
        width: index === 3 ? 4 : 2,
        radius: 18,
      }),
    );
    p.push(text(x + 18, y + 26, w - 36, h - 38, label, 20, theme.ink, 650, 'center'));
    if (index < nodes.length - 1)
      p.push(
        line(x + w, y + h / 2, nodes[index + 1][0], nodes[index + 1][1] + nodes[index + 1][3] / 2, {
          stroke: theme.accent,
          width: 4,
          arrowEnd: true,
        }),
      );
  });
  ['Memory', 'Convex', 'Postgres'].forEach((label, index) => {
    p.push(
      rect(1370, 270 + index * 135, 150, 76, {
        fill: theme.soft,
        stroke: theme.accent2,
        width: 2,
        radius: 14,
      }),
    );
    p.push(text(1380, 292 + index * 135, 130, 32, label, 18, theme.ink, 650, 'center'));
    p.push(
      line(1320, 400, 1370, 308 + index * 135, {
        stroke: theme.accent2,
        width: 3,
        arrowEnd: true,
      }),
    );
  });
  p.push(
    text(
      1090,
      520,
      430,
      38,
      'TRUST BOUNDARY · persistence only',
      15,
      theme.accent,
      700,
      'center',
      true,
    ),
  );
}

function renderSequence({ p, theme }) {
  const actors = ['User', 'Client', 'Planner', 'Validator', 'Adapter'];
  actors.forEach((actor, index) => {
    const x = 110 + index * 300;
    p.push(
      rect(x, 245, 180, 54, {
        fill: theme.panel,
        stroke: theme.accent2,
        width: 2,
        radius: 12,
      }),
    );
    p.push(text(x, 259, 180, 28, actor, 17, theme.ink, 700, 'center'));
    p.push(
      line(x + 90, 305, x + 90, 690, {
        stroke: theme.muted,
        width: 2,
        dash: true,
      }),
    );
  });
  const events = [
    [0, 1, 345, 'submit'],
    [1, 2, 405, 'bounded context'],
    [2, 3, 465, 'typed plan'],
    [3, 1, 525, 'issues / pass'],
    [1, 4, 600, 'accepted commit'],
    [4, 1, 660, 'versioned receipt'],
  ];
  events.forEach(([from, to, y, label], index) => {
    const x1 = 200 + from * 300;
    const x2 = 200 + to * 300;
    p.push(
      line(x1, y, x2, y, {
        stroke: index === 3 ? theme.danger : theme.accent,
        width: 3,
        arrowEnd: true,
        dash: index === 3,
      }),
    );
    p.push(
      text(
        Math.min(x1, x2) + 10,
        y - 29,
        Math.abs(x2 - x1) - 20,
        24,
        label,
        15,
        index === 3 ? theme.danger : theme.ink,
        600,
        'center',
        true,
      ),
    );
  });
}

function renderCausal({ p, theme }) {
  const nodes = [
    [270, 350, 'Receipt quality'],
    [660, 260, 'Reviewer trust'],
    [1030, 350, 'Reuse'],
    [660, 575, 'Harness signal'],
    [1220, 590, 'Complexity'],
  ];
  const edges = [
    [0, 1, 'R+'],
    [1, 2, 'R+'],
    [2, 3, 'R+'],
    [3, 0, 'R+'],
    [2, 4, 'B+'],
    [4, 1, 'B−'],
  ];
  edges.forEach(([from, to, label]) => {
    const a = nodes[from];
    const b = nodes[to];
    p.push(
      line(a[0], a[1], b[0], b[1], {
        stroke: label === 'B−' ? theme.danger : theme.accent2,
        width: 4,
        arrowEnd: true,
        dash: label.startsWith('B'),
      }),
    );
    p.push(
      text(
        (a[0] + b[0]) / 2 - 40,
        (a[1] + b[1]) / 2 - 32,
        80,
        26,
        label,
        15,
        label === 'B−' ? theme.danger : theme.accent2,
        700,
        'center',
        true,
      ),
    );
  });
  nodes.forEach(([x, y, label], index) => {
    p.push(
      circle(x, y, index === 4 ? 70 : 82, {
        fill: theme.panel,
        stroke: index === 4 ? theme.danger : theme.accent,
        width: 4,
      }),
    );
    p.push(text(x - 72, y - 18, 144, 48, label, 18, theme.ink, 650, 'center'));
  });
}

function renderSankey({ p, theme }) {
  const left = [
    ['Source A', 270],
    ['Source B', 420],
    ['Source C', 570],
  ];
  const middle = [
    ['Claims', 335],
    ['Rejections', 540],
  ];
  const right = [
    ['Charts', 280],
    ['Diagrams', 430],
    ['Proof', 580],
  ];
  [
    [0, 0, 0, 26],
    [1, 0, 1, 38],
    [2, 0, 2, 22],
    [2, 1, 2, 12],
    [0, 1, 1, 10],
  ].forEach(([a, b, c, w]) => {
    p.push(
      line(280, left[a][1], 770, middle[b][1], {
        stroke: b === 1 ? theme.danger : theme.accent2,
        width: w,
        opacity: 0.35,
      }),
    );
    p.push(
      line(820, middle[b][1], 1320, right[c][1], {
        stroke: b === 1 ? theme.danger : theme.accent,
        width: Math.max(8, w - 4),
        opacity: 0.35,
        arrowEnd: true,
      }),
    );
  });
  [
    ...left.map(([label, y]) => [110, y, label]),
    ...middle.map(([label, y]) => [720, y, label]),
    ...right.map(([label, y]) => [1320, y, label]),
  ].forEach(([x, y, label]) => {
    p.push(
      rect(x, y - 36, 180, 72, {
        fill: theme.panel,
        stroke: label === 'Rejections' ? theme.danger : theme.accent2,
        width: 2,
        radius: 14,
      }),
    );
    p.push(text(x + 10, y - 14, 160, 32, label, 17, theme.ink, 650, 'center'));
  });
}

function renderDecisionTree({ p, theme }) {
  const boxes = [
    [500, 240, 600, 76, 'Does the task require current evidence?'],
    [120, 405, 430, 76, 'No · local / deterministic'],
    [850, 405, 430, 76, 'Yes · is extraction sufficient?'],
    [700, 575, 300, 76, 'Yes · cheap model'],
    [1120, 575, 350, 76, 'No · strong orchestrator'],
  ];
  [
    [0, 1],
    [0, 2],
    [2, 3],
    [2, 4],
  ].forEach(([from, to]) => {
    const a = boxes[from];
    const b = boxes[to];
    p.push(
      line(a[0] + a[2] / 2, a[1] + a[3], b[0] + b[2] / 2, b[1], {
        stroke: theme.accent2,
        width: 4,
        arrowEnd: true,
      }),
    );
  });
  boxes.forEach(([x, y, w, h, label], index) => {
    p.push(
      rect(x, y, w, h, {
        fill: index === 0 ? theme.accent : theme.panel,
        stroke: theme.accent2,
        width: 2,
        radius: 18,
      }),
    );
    p.push(
      text(
        x + 18,
        y + 20,
        w - 36,
        40,
        label,
        19,
        index === 0 ? '#FFFFFF' : theme.ink,
        650,
        'center',
      ),
    );
  });
}

function renderEcosystem({ p, theme }) {
  const lanes = ['Infrastructure', 'Workflow', 'Applications', 'Evaluation', 'Distribution'];
  lanes.forEach((label, index) => {
    const y = 250 + index * 86;
    p.push(text(82, y + 16, 210, 38, label, 17, theme.muted, 700));
    p.push(
      rect(300, y, 700 + index * 70, 62, {
        fill: index === 1 ? theme.accent : theme.soft,
        opacity: 0.75,
        radius: 12,
      }),
    );
    p.push(
      text(
        325,
        y + 15,
        620,
        34,
        index === 1
          ? 'NodeKit · typed contracts · handoffs · receipts'
          : [
              'Models · tools · storage',
              '',
              'NodeSlide · NodeRoom · vertical products',
              'Deck Gym · Atlas · preference',
              'PPTX · web · package surfaces',
            ][index],
        17,
        index === 1 ? '#FFFFFF' : theme.ink,
        600,
      ),
    );
  });
  p.push(
    rect(1160, 250, 350, 405, {
      fill: theme.panel,
      stroke: theme.accent2,
      width: 2,
      radius: 22,
    }),
  );
  p.push(text(1190, 274, 290, 34, 'DEPLOYMENT GEOGRAPHY', 15, theme.muted, 700, 'center', true));
  p.push(
    polyline(
      [
        [1200, 420],
        [1280, 360],
        [1390, 380],
        [1460, 460],
        [1400, 535],
        [1280, 555],
        [1200, 500],
        [1200, 420],
      ],
      { stroke: theme.muted, width: 3 },
    ),
  );
  [
    [1250, 440],
    [1325, 410],
    [1410, 470],
    [1360, 520],
  ].forEach(([x, y], index) =>
    p.push(
      circle(x, y, 11 + index * 3, {
        fill: index === 1 ? theme.accent : theme.accent2,
        opacity: 0.85,
      }),
    ),
  );
  p.push(text(1190, 590, 290, 38, 'illustrative regional inset', 15, theme.muted, 500, 'center'));
}

function renderTimeline({ p, theme }) {
  const items = [
    ['Jul 1', 'Question'],
    ['Jul 3', 'Evidence'],
    ['Jul 6', 'Candidates'],
    ['Jul 9', 'Blind review'],
    ['Jul 11', 'Approved'],
  ];
  p.push(line(130, 460, 1450, 460, { stroke: theme.muted, width: 4 }));
  const xs = [150, 420, 790, 1170, 1430];
  items.forEach(([date, label], index) => {
    p.push(
      circle(xs[index], 460, index === 3 ? 28 : 18, {
        fill: index === 3 ? theme.accent : theme.accent2,
        stroke: theme.panel,
        width: 4,
      }),
    );
    p.push(text(xs[index] - 90, 350, 180, 40, date, 20, theme.ink, 700, 'center', true));
    p.push(
      text(xs[index] - 100, 510, 200, 44, label, 18, theme.ink, index === 3 ? 700 : 550, 'center'),
    );
    if (index === 3)
      p.push(
        text(xs[index] - 130, 582, 260, 34, 'HUMAN GATE', 15, theme.accent, 700, 'center', true),
      );
  });
}

function renderGantt({ p, theme }) {
  const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];
  weeks.forEach((label, index) =>
    p.push(text(520 + index * 145, 240, 100, 28, label, 15, theme.muted, 700, 'center', true)),
  );
  const rows = [
    ['Media proof', 0, 2, 'done'],
    ['Data primitives', 1, 3, 'done'],
    ['Motion fallbacks', 2, 5, 'active'],
    ['Domain packs', 1, 4, 'done'],
    ['Human review', 5, 6, 'next'],
  ];
  rows.forEach(([label, start, end, status], index) => {
    const y = 300 + index * 78;
    p.push(text(88, y + 10, 360, 38, label, 19, theme.ink, 600));
    p.push(line(500, y + 31, 1440, y + 31, { stroke: theme.soft, width: 2 }));
    p.push(
      rect(520 + start * 145, y + 8, Math.max(100, (end - start) * 145 - 20), 46, {
        fill: status === 'active' ? theme.accent : status === 'next' ? theme.soft : theme.accent2,
        radius: 10,
      }),
    );
    p.push(
      text(
        1250,
        y + 13,
        180,
        30,
        status.toUpperCase(),
        14,
        status === 'active' ? theme.accent : theme.muted,
        700,
        'right',
        true,
      ),
    );
  });
}

function renderScrolly({ p, theme }) {
  const steps = ['Source', 'Extract', 'Bind claim', 'Build visual', 'Deck CI'];
  steps.forEach((label, index) => {
    const x = 95 + index * 295;
    const y = 365 + (index % 2) * 95;
    if (index < steps.length - 1)
      p.push(
        line(x + 160, y + 44, x + 285, 410 + ((index + 1) % 2) * 95, {
          stroke: theme.accent2,
          width: 4,
          arrowEnd: true,
        }),
      );
    p.push(
      circle(x + 36, y + 36, 36, {
        fill: index === 4 ? theme.accent : theme.soft,
        stroke: theme.accent2,
        width: 3,
      }),
    );
    p.push(
      text(
        x + 16,
        y + 17,
        40,
        36,
        String(index + 1),
        22,
        index === 4 ? '#FFFFFF' : theme.ink,
        700,
        'center',
        true,
      ),
    );
    p.push(text(x + 82, y + 18, 180, 46, label, 20, theme.ink, 650));
  });
  p.push(
    rect(495, 615, 610, 46, {
      fill: theme.panel,
      stroke: theme.accent,
      width: 2,
      radius: 23,
    }),
  );
  p.push(
    text(
      525,
      626,
      550,
      24,
      'WEB · scroll scrub      PPTX · five stepped states      REDUCED MOTION · final state',
      13,
      theme.muted,
      650,
      'center',
      true,
    ),
  );
}

function renderChartStates({ p, theme }) {
  const labels = ['Baseline', 'Model', 'Harness v4', 'Evidence refresh'];
  labels.forEach((label, panel) => {
    const x = 85 + panel * 370;
    p.push(
      rect(x, 255, 330, 410, {
        fill: theme.panel,
        stroke: panel === 2 ? theme.accent : theme.soft,
        width: panel === 2 ? 4 : 2,
        radius: 18,
      }),
    );
    p.push(
      text(
        x + 18,
        280,
        294,
        32,
        `STATE ${panel + 1} · ${label}`,
        15,
        theme.muted,
        700,
        'center',
        true,
      ),
    );
    const values = [62 + panel * 3, 69 + panel * 4, 71 + panel * 5, 75 + panel * 4];
    const points = values.map((v, index) => [x + 45 + index * 75, 590 - (v - 55) * 12]);
    p.push(
      polyline(points, {
        stroke: panel === 2 ? theme.accent : theme.accent2,
        width: 5,
      }),
    );
    points.forEach(([px, py]) =>
      p.push(circle(px, py, 6, { fill: panel === 2 ? theme.accent : theme.accent2 })),
    );
    p.push(
      text(x + 20, 615, 290, 30, `${values.at(-1)} quality`, 17, theme.ink, 700, 'center', true),
    );
  });
}

function renderScreenshot({ p, theme, media: slideMedia }) {
  p.push(
    rect(65, 220, 1120, 500, {
      fill: theme.panel,
      stroke: theme.soft,
      width: 2,
      radius: 18,
    }),
  );
  p.push(
    image(82, 237, 1086, 466, slideMedia.gallery, 'Real NodeSlide Artifact Lab gallery capture'),
  );
  const callouts = [
    [1, 1230, 285, '38 reusable\npatterns'],
    [2, 1250, 455, 'model compare\nkeeps failures red'],
    [3, 1215, 615, 'use pattern\nstarts a real workflow'],
  ];
  callouts.forEach(([n, x, y, label]) => {
    p.push(circle(x, y, 24, { fill: theme.accent }));
    p.push(text(x - 14, y - 14, 28, 28, String(n), 17, '#FFFFFF', 700, 'center', true));
    p.push(text(x + 42, y - 25, 250, 70, label, 18, theme.ink, 650));
    p.push(line(1180, y, x - 32, y, { stroke: theme.accent, width: 3 }));
  });
}

function renderInteraction({ p, theme, media: slideMedia }) {
  const frames = [slideMedia.webRequest, slideMedia.webReview, slideMedia.webEvidence];
  const labels = ['1 · consented request', '3 · review proposal', '5 · source-bound result'];
  frames.forEach((asset, index) => {
    const x = 75 + index * 500;
    p.push(
      rect(x, 270, 450, 300, {
        fill: theme.panel,
        stroke: index === 2 ? theme.accent : theme.soft,
        width: index === 2 ? 4 : 2,
        radius: 16,
      }),
    );
    p.push(image(x + 12, 282, 426, 238, asset, labels[index]));
    p.push(text(x + 20, 530, 410, 32, labels[index], 16, theme.ink, 650, 'center'));
  });
  const steps = ['select', 'ask agent', 'handoff', 'canvas update', 'version +1'];
  steps.forEach((label, index) => {
    const x = 120 + index * 285;
    p.push(circle(x, 650, 18, { fill: index === 4 ? theme.accent : theme.accent2 }));
    p.push(text(x + 28, 635, 210, 30, label, 15, theme.muted, 650, 'left', true));
    if (index < 4)
      p.push(
        line(x + 160, 650, x + 265, 650, {
          stroke: theme.muted,
          width: 2,
          arrowEnd: true,
        }),
      );
  });
}

function renderProductCompare({ p, theme, media: slideMedia }) {
  p.push(text(80, 220, 600, 40, 'BEFORE · generated surface', 16, theme.danger, 700, 'left', true));
  p.push(
    text(890, 220, 600, 40, 'AFTER · reviewable workspace', 16, theme.accent2, 700, 'left', true),
  );
  p.push(
    rect(70, 265, 650, 380, {
      fill: theme.panel,
      stroke: theme.danger,
      width: 2,
      radius: 18,
    }),
  );
  p.push(image(86, 281, 618, 348, slideMedia.beforeProduct, 'NodeSlide before routed edit'));
  p.push(
    rect(880, 265, 650, 380, {
      fill: theme.panel,
      stroke: theme.accent2,
      width: 4,
      radius: 18,
    }),
  );
  p.push(image(896, 281, 618, 348, slideMedia.afterProduct, 'NodeSlide after self repair'));
  p.push(
    text(
      110,
      675,
      1320,
      30,
      'Changed: chart semantics · source binding · repair trace · version receipt',
      18,
      theme.ink,
      650,
      'center',
    ),
  );
}

function renderSpatial({ p, theme, media: slideMedia }) {
  p.push(image(650, 225, 850, 500, slideMedia.editorial, 'Spatial evidence-to-story scene'));
  const levels = [
    ['WHOLE SYSTEM', 120, 300, 360],
    ['SUBSYSTEM', 165, 405, 300],
    ['EXACT NODE', 215, 500, 245],
    ['SOURCE / TRACE', 265, 585, 190],
  ];
  levels.forEach(([label, x, y, w], index) => {
    p.push(
      rect(x, y, w, 62, {
        fill: index === 3 ? theme.accent : theme.panel,
        stroke: theme.accent2,
        width: 2,
        radius: 16,
      }),
    );
    p.push(
      text(
        x + 18,
        y + 18,
        w - 36,
        28,
        label,
        15,
        index === 3 ? '#FFFFFF' : theme.ink,
        700,
        'center',
        true,
      ),
    );
    if (index < levels.length - 1)
      p.push(
        line(x + w, y + 31, levels[index + 1][1], levels[index + 1][2] + 31, {
          stroke: theme.accent2,
          width: 3,
          arrowEnd: true,
        }),
      );
  });
}

function renderLineage({ p, theme }) {
  const nodes = [
    ['Source', 'journey-receipt'],
    ['Extract', 'elapsed 52s'],
    ['Claim', 'human accepted'],
    ['Visual', 'headline metric'],
    ['Receipt', 'exported'],
  ];
  nodes.forEach(([label, value], index) => {
    const x = 65 + index * 300;
    if (index < nodes.length - 1)
      p.push(
        line(x + 230, 410, x + 290, 410, {
          stroke: theme.accent2,
          width: 4,
          arrowEnd: true,
        }),
      );
    p.push(
      rect(x, 335, 230, 150, {
        fill: theme.panel,
        stroke: theme.accent2,
        width: 2,
        radius: 18,
      }),
    );
    p.push(text(x + 20, 360, 190, 30, label, 16, theme.muted, 700, 'center', true));
    p.push(text(x + 20, 410, 190, 42, value, 19, theme.ink, 650, 'center'));
  });
  p.push(
    line(665, 485, 665, 600, {
      stroke: theme.danger,
      width: 4,
      arrowEnd: true,
      dash: true,
    }),
  );
  p.push(
    rect(505, 600, 320, 66, {
      fill: theme.soft,
      stroke: theme.danger,
      width: 3,
      radius: 16,
    }),
  );
  p.push(
    text(525, 619, 280, 30, 'REJECTED · “zero errors”', 16, theme.danger, 700, 'center', true),
  );
}

function renderPdf({ p, theme, media: slideMedia }) {
  p.push(
    rect(80, 230, 960, 490, {
      fill: theme.panel,
      stroke: theme.soft,
      width: 2,
      radius: 16,
    }),
  );
  p.push(
    image(
      98,
      248,
      924,
      454,
      slideMedia.webEvidence,
      'Captured source region cited by a NodeSlide element',
    ),
  );
  p.push(
    rect(1090, 270, 390, 230, {
      fill: theme.soft,
      stroke: theme.accent,
      width: 3,
      radius: 18,
    }),
  );
  p.push(text(1120, 300, 330, 32, 'BOUND CLAIM', 15, theme.accent, 700, 'center', true));
  p.push(
    text(
      1120,
      350,
      330,
      95,
      'The exact highlighted region supports this visual.',
      25,
      theme.ink,
      650,
      'center',
    ),
  );
  p.push(
    line(1040, 420, 1090, 420, {
      stroke: theme.accent,
      width: 5,
      arrowEnd: true,
    }),
  );
  p.push(
    text(
      1110,
      560,
      350,
      70,
      'Capture receipt\npage · region · hash',
      18,
      theme.muted,
      600,
      'center',
      true,
    ),
  );
}

function renderCode({ p, theme }) {
  p.push(
    rect(72, 235, 870, 460, {
      fill: '#0B1220',
      stroke: theme.accent2,
      width: 2,
      radius: 18,
    }),
  );
  p.push(
    text(
      105,
      270,
      810,
      330,
      'interface NodeSlideAdapter {\n  stage(input: StageInput): Promise<Proposal>;\n  commit(input: CommitInput): Promise<Receipt>;\n  restore(versionId: string): Promise<Receipt>;\n}',
      25,
      '#E8EEF6',
      500,
      'left',
      true,
    ),
  );
  p.push(
    text(
      105,
      625,
      810,
      30,
      'typed contract · source artifact · editable code block',
      14,
      '#8FA3B8',
      600,
      'left',
      true,
    ),
  );
  p.push(
    rect(1010, 250, 500, 170, {
      fill: theme.panel,
      stroke: theme.accent,
      width: 3,
      radius: 20,
    }),
  );
  p.push(text(1040, 280, 200, 30, 'P50', 16, theme.muted, 700, 'left', true));
  p.push(text(1040, 320, 200, 64, '38 ms', 46, theme.accent, 720, 'left', true));
  p.push(text(1280, 280, 200, 30, 'P95', 16, theme.muted, 700, 'left', true));
  p.push(text(1280, 320, 200, 64, '92 ms', 46, theme.ink, 720, 'left', true));
  p.push(rect(1010, 460, 500, 170, { fill: theme.soft, radius: 20 }));
  p.push(text(1040, 490, 440, 30, 'RECEIPT BYTES', 16, theme.muted, 700, 'center', true));
  p.push(text(1040, 535, 440, 62, '1,160', 44, theme.ink, 720, 'center', true));
}

function renderTrace({ p, theme }) {
  const spans = [
    ['create deck', 120, 1360, 0, theme.accent],
    ['plan story', 180, 540, 1, theme.accent2],
    ['tool · research', 330, 420, 2, theme.muted],
    ['validate', 620, 250, 1, theme.accent2],
    ['repair', 780, 310, 2, theme.danger],
    ['export', 1090, 280, 1, theme.accent],
  ];
  p.push(text(80, 232, 300, 28, '0s', 14, theme.muted, 600, 'left', true));
  p.push(text(1430, 232, 100, 28, '58s', 14, theme.muted, 600, 'right', true));
  spans.forEach(([label, x, w, depth, color]) => {
    const y = 285 + depth * 112;
    p.push(
      rect(x, y, w, 58, {
        fill: color,
        opacity: depth ? 0.72 : 0.9,
        radius: 12,
      }),
    );
    p.push(
      text(
        x + 16,
        y + 15,
        Math.max(80, w - 32),
        30,
        label,
        16,
        depth === 0 ? '#FFFFFF' : theme.ink,
        650,
      ),
    );
  });
  p.push(
    rect(1100, 590, 390, 90, {
      fill: theme.panel,
      stroke: theme.danger,
      width: 2,
      radius: 16,
    }),
  );
  p.push(
    text(
      1120,
      610,
      350,
      48,
      '1 repair · visible, bounded, receipted',
      18,
      theme.ink,
      650,
      'center',
    ),
  );
}

function renderEquation({ p, theme }) {
  p.push(
    rect(90, 250, 830, 390, {
      fill: theme.panel,
      stroke: theme.accent2,
      width: 2,
      radius: 24,
    }),
  );
  p.push(
    text(
      120,
      315,
      770,
      110,
      'Qₐ = Q / (1 + αC + βL)',
      50,
      theme.ink,
      650,
      'center',
      false,
      'Cambria Math',
    ),
  );
  p.push(
    text(
      150,
      470,
      710,
      74,
      'Q = quality      C = cost      L = latency',
      22,
      theme.muted,
      550,
      'center',
      true,
    ),
  );
  p.push(text(150, 565, 710, 40, '0.75 / 0.038 ≈ 19.74', 27, theme.accent, 700, 'center', true));
  const defs = [
    ['Q', '0.75', 'observed quality'],
    ['C', '$0.038', 'reported model cost'],
    ['L', '1.04s', 'measured latency'],
  ];
  defs.forEach(([symbol, value, label], index) => {
    const y = 265 + index * 130;
    p.push(text(1010, y, 70, 54, symbol, 38, theme.accent2, 700, 'center', true));
    p.push(text(1100, y, 180, 54, value, 30, theme.ink, 700, 'right', true));
    p.push(text(1310, y + 8, 210, 40, label, 17, theme.muted, 500));
    p.push(line(1010, y + 70, 1500, y + 70, { stroke: theme.soft, width: 2 }));
  });
}

function renderCi({ p, theme }) {
  const checks = [
    'Brief adherence',
    'Artifact type',
    'Allowed claims',
    'No forbidden claims',
    'Zero collisions',
    'Browser render',
    'PPTX render',
    'Editable semantics',
    'Source lineage',
  ];
  checks.forEach((label, index) => {
    const col = index < 5 ? 0 : 1;
    const row = col ? index - 5 : index;
    const x = 95 + col * 680;
    const y = 245 + row * 86;
    p.push(circle(x + 20, y + 20, 18, { fill: theme.accent2 }));
    p.push(text(x + 10, y + 8, 20, 24, '✓', 17, '#FFFFFF', 700, 'center'));
    p.push(text(x + 60, y + 2, 510, 42, label, 20, theme.ink, 600));
  });
  p.push(
    rect(1070, 590, 430, 100, {
      fill: theme.panel,
      stroke: theme.accent,
      width: 3,
      radius: 18,
    }),
  );
  p.push(text(1095, 612, 380, 28, 'PREFERENCE', 15, theme.muted, 700, 'center', true));
  p.push(text(1095, 650, 380, 26, 'human review pending', 18, theme.accent, 650, 'center'));
}

function renderRisk({ p, theme }) {
  const x = 170;
  const y = 260;
  const size = 420;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const score = row + col;
      const fill = score >= 7 ? theme.danger : score >= 5 ? theme.accent : theme.soft;
      p.push(
        rect(x + col * 84, y + (4 - row) * 84, 80, 80, {
          fill,
          opacity: 0.32 + score * 0.05,
        }),
      );
    }
  }
  p.push(text(x - 125, y + 170, 100, 100, 'IMPACT', 15, theme.muted, 700, 'center', true));
  p.push(text(x + 130, y + size + 24, 180, 30, 'LIKELIHOOD', 15, theme.muted, 700, 'center', true));
  const risks = [
    [4, 5, 'Pipeline', theme.danger],
    [3, 4, 'Capacity', theme.accent],
    [2, 5, 'Retention', theme.accent2],
  ];
  risks.forEach(([likelihood, impact, label, color]) => {
    const cx = x + (likelihood - 0.5) * 84;
    const cy = y + (5 - impact + 0.5) * 84;
    p.push(circle(cx, cy, 24, { fill: color, stroke: theme.panel, width: 4 }));
    p.push(text(cx + 32, cy - 16, 170, 32, label, 16, theme.ink, 650));
  });
  p.push(
    rect(760, 315, 700, 250, {
      fill: theme.panel,
      stroke: theme.danger,
      width: 3,
      radius: 24,
    }),
  );
  p.push(text(800, 350, 620, 34, 'DECISION IMPLICATION', 16, theme.danger, 700, 'center', true));
  p.push(
    text(
      810,
      420,
      600,
      85,
      'Intervene on pipeline coverage before Q3 planning.',
      32,
      theme.ink,
      650,
      'center',
    ),
  );
}

function renderFrontier(context) {
  renderScatter(context);
  const { p, theme } = context;
  p.push(
    polyline(
      [
        [250, 558],
        [560, 428],
        [760, 363],
        [1010, 313],
      ],
      { stroke: theme.accent, width: 4, dash: true },
    ),
  );
  p.push(text(1080, 255, 330, 34, 'OBSERVED FRONTIER', 15, theme.accent, 700, 'center', true));
  p.push(
    rect(1210, 580, 280, 74, {
      fill: theme.soft,
      stroke: theme.muted,
      width: 2,
      radius: 16,
    }),
  );
  p.push(text(1230, 598, 240, 38, 'Ensemble · not yet run', 16, theme.muted, 650, 'center'));
}

function renderModelCompare({ p, theme }) {
  const rows = [
    ['Claude Sonnet 5', '24/24', '8.2s avg', '$0.0086', 'eligible'],
    ['Kimi K3', '23/24', '17.6s avg', '$0.0013', '1 failed'],
    ['Gemma 4 Free', '23/24', '17.3s avg', '$0', '1 failed'],
    ['Nemotron Free', 'pilot pass', 'live', '$0', 'semantic caveat'],
    ['GPT-OSS Free', 'pilot pass', 'live', '$0', 'formula caveat'],
    ['Deterministic', '12/12', 'local', '$0', 'control'],
    ['Best ensemble', 'not run', '—', '—', 'blocked'],
  ];
  const headers = ['Route', 'Observed', 'Latency', 'Cost', 'Truth'];
  const xs = [76, 600, 820, 1040, 1240];
  headers.forEach((label, index) =>
    p.push(
      text(
        xs[index],
        235,
        index === 0 ? 460 : 180,
        30,
        label,
        15,
        theme.muted,
        700,
        index ? 'right' : 'left',
        true,
      ),
    ),
  );
  rows.forEach((row, index) => {
    const y = 285 + index * 58;
    p.push(line(72, y + 42, 1515, y + 42, { stroke: theme.soft, width: 2 }));
    row.forEach((value, col) =>
      p.push(
        text(
          xs[col],
          y,
          col === 0 ? 460 : col === 4 ? 250 : 180,
          34,
          value,
          17,
          col === 4 && value !== 'eligible' && value !== 'control' ? theme.danger : theme.ink,
          col === 0 ? 650 : 550,
          col ? 'right' : 'left',
          col > 0,
        ),
      ),
    );
  });
}

function renderHarnessCompare({ p, theme }) {
  p.push(
    rect(78, 250, 630, 420, {
      fill: theme.panel,
      stroke: theme.muted,
      width: 2,
      radius: 24,
    }),
  );
  p.push(text(112, 280, 560, 30, 'HARNESS V1 · FROZEN', 16, theme.muted, 700, 'center', true));
  p.push(text(112, 340, 560, 70, '12 artifacts', 46, theme.ink, 700, 'center', true));
  [
    '2 visual directions',
    'provisional receipts',
    'static gallery',
    'no paired predecessor',
  ].forEach((label, index) =>
    p.push(text(145, 445 + index * 48, 500, 34, `· ${label}`, 18, theme.muted, 550)),
  );
  p.push(
    line(740, 455, 845, 455, {
      stroke: theme.accent,
      width: 8,
      arrowEnd: true,
    }),
  );
  p.push(
    rect(885, 250, 630, 420, {
      fill: theme.panel,
      stroke: theme.accent,
      width: 4,
      radius: 24,
    }),
  );
  p.push(
    text(
      920,
      280,
      560,
      30,
      'HARNESS V2 · SAME CONTROL ROUTE',
      16,
      theme.accent,
      700,
      'center',
      true,
    ),
  );
  p.push(text(920, 340, 560, 70, '38 artifacts', 46, theme.ink, 700, 'center', true));
  [
    '7 design languages',
    'motion + fallback contracts',
    '38 reusable recipes',
    'browser / PPTX / PDF receipts',
  ].forEach((label, index) =>
    p.push(text(955, 445 + index * 48, 500, 34, `· ${label}`, 18, theme.ink, 600)),
  );
}

function renderRecommendation({ p, theme }) {
  const cards = [
    ['RESEARCHER', 'Inspect the source, equation, trace, and known fidelity differences.'],
    ['INVESTOR', 'Compare the operating proof, frontier, risk, and decision implication.'],
    ['简体中文', '同一证据，不同表达契约。结论仍可追溯、可编辑、可审核。'],
  ];
  cards.forEach(([label, value], index) => {
    const x = 70 + index * 500;
    p.push(
      rect(x, 265, 455, 365, {
        fill: index === 2 ? theme.accent : theme.panel,
        stroke: theme.accent2,
        width: 2,
        radius: 26,
      }),
    );
    p.push(
      text(
        x + 30,
        302,
        395,
        34,
        label,
        16,
        index === 2 ? '#FFFFFF' : theme.accent,
        700,
        'center',
        true,
        index === 2 ? 'Microsoft YaHei' : 'Aptos',
      ),
    );
    p.push(
      text(
        x + 38,
        390,
        379,
        160,
        value,
        28,
        index === 2 ? '#FFFFFF' : theme.ink,
        600,
        'center',
        false,
        index === 2 ? 'Microsoft YaHei' : 'Aptos',
      ),
    );
  });
  p.push(
    text(
      160,
      670,
      1280,
      38,
      'USE THE SLIDE · USE THE RECIPE · GENERATE WITH YOUR DATA · DOWNLOAD PPTX',
      17,
      theme.accent2,
      700,
      'center',
      true,
    ),
  );
}

function renderGeneric({ p, artifact, theme }) {
  p.push(
    rect(100, 260, 1400, 430, {
      fill: theme.panel,
      stroke: theme.accent2,
      width: 2,
      radius: 24,
    }),
  );
  p.push(text(155, 330, 1290, 110, artifact.title, 42, theme.ink, 700, 'center'));
  p.push(text(190, 500, 1220, 80, artifact.takeaway, 26, theme.muted, 500, 'center'));
}

function drawBeforeAfterPanels(p, theme, before, after) {
  p.push(
    rect(75, 250, 650, 410, {
      fill: theme.panel,
      stroke: theme.danger,
      width: 2,
      radius: 22,
    }),
  );
  p.push(
    rect(875, 250, 650, 410, {
      fill: theme.panel,
      stroke: theme.accent2,
      width: 4,
      radius: 22,
    }),
  );
  p.push(text(105, 282, 590, 34, 'BEFORE', 16, theme.danger, 700, 'center', true));
  p.push(text(905, 282, 590, 34, 'AFTER', 16, theme.accent2, 700, 'center', true));
  before.forEach((label, index) => {
    p.push(rect(145, 355 + index * 82, 510, 55, { fill: theme.soft, radius: 10 }));
    p.push(text(165, 370 + index * 82, 470, 30, label, 19, theme.muted, 550, 'center'));
  });
  after.forEach((label, index) => {
    p.push(
      rect(945, 355 + index * 82, 510, 55, {
        fill: index === 2 ? theme.accent : theme.soft,
        radius: 10,
      }),
    );
    p.push(
      text(
        965,
        370 + index * 82,
        470,
        30,
        label,
        19,
        index === 2 ? '#FFFFFF' : theme.ink,
        650,
        'center',
      ),
    );
  });
  p.push(
    line(748, 450, 852, 450, {
      stroke: theme.accent,
      width: 7,
      arrowEnd: true,
    }),
  );
}

function drawChartAxes(p, theme, x, y, w, h, xLabel = '', yLabel = '') {
  for (let index = 0; index < 5; index += 1)
    p.push(
      line(x, y + index * (h / 4), x + w, y + index * (h / 4), {
        stroke: theme.soft,
        width: 2,
      }),
    );
  p.push(line(x, y, x, y + h, { stroke: theme.muted, width: 3 }));
  p.push(line(x, y + h, x + w, y + h, { stroke: theme.muted, width: 3 }));
  if (xLabel)
    p.push(text(x + w - 120, y + h + 28, 120, 30, xLabel, 15, theme.muted, 650, 'right', true));
  if (yLabel) p.push(text(x - 70, y - 30, 160, 30, yLabel, 15, theme.muted, 650, 'left', true));
}

function addSlide(pptx, primitives, theme, artifact) {
  const slide = pptx.addSlide();
  slide.background = { color: strip(theme.canvas) };
  addPrimitivesToPptx(slide, primitives, pptx.ShapeType);
  if (typeof slide.addNotes === 'function') {
    slide.addNotes(
      `Artifact ${artifact.number}: ${artifact.id}\n${artifact.takeaway}\nSource: ${artifact.evidence.map((source) => source.sourceId).join(', ')}\nHuman preference: pending.`,
    );
  }
}

async function renderBrowser(browserInstance, primitives, theme, outputPath) {
  const page = await browserInstance.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
  });
  try {
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${theme.canvas};overflow:hidden}svg{display:block}</style>${toSvg(primitives, theme)}`,
    );
    await page.screenshot({ path: outputPath, type: 'png' });
  } finally {
    await page.close();
  }
}

async function buildThemeVariants(browserInstance, slideMedia) {
  const variantRoot = path.join(outputRoot, 'theme-variants');
  const publicVariantRoot = path.join(publicRoot, 'theme-variants');
  await Promise.all([
    mkdir(variantRoot, { recursive: true }),
    mkdir(publicVariantRoot, { recursive: true }),
  ]);
  const deck = createDeck(
    'Artifact Atlas V2 Theme Intelligence',
    'Same content and evidence under three coherent design languages',
  );
  const manifest = [];
  for (const id of ATLAS_V2_THEME_VARIANT_IDS) {
    const artifact = artifactById(id);
    for (const themeId of ATLAS_V2_THEME_VARIANTS) {
      const theme = ATLAS_V2_THEMES[themeId];
      const primitives = buildSlide(
        { ...artifact, theme: themeId },
        {
          index: manifest.length,
          seriesLabel: 'THEME',
          theme,
          media: slideMedia,
        },
      );
      addSlide(deck, primitives, theme, artifact);
      const file = `${id}__${themeId}.png`;
      await renderBrowser(browserInstance, primitives, theme, path.join(publicVariantRoot, file));
      manifest.push({
        artifactId: id,
        theme: themeId,
        preview: `artifact-atlas-v2/theme-variants/${file}`,
      });
    }
  }
  await deck.writeFile({
    fileName: path.join(variantRoot, 'nodeslide-theme-intelligence-v2.pptx'),
  });
  await writeJson(path.join(artifactRoot, 'theme-variants.json'), {
    schemaVersion: 'nodeslide.theme-variants/v2',
    variants: manifest,
  });
}

async function publishDomainPacks() {
  const domainRoot = path.join(publicRoot, 'domain-packs');
  await mkdir(domainRoot, { recursive: true });
  for (const pack of ATLAS_V2_DOMAIN_PACKS) {
    const source = path.resolve(pack.contactSheet);
    const destination = path.join(domainRoot, `${pack.id}.png`);
    await copyFile(source, destination);
  }
}

function buildReceipt(artifact, index, preview, generationMs, primitives) {
  return {
    schemaVersion: 'nodeslide.artifact-showcase-receipt/v2',
    artifactId: artifact.id,
    artifactType: artifact.artifactType,
    chapter: artifact.chapter,
    harnessVersion: ATLAS_V2_VERSION,
    model: 'nodeslide-artifact-builder-v2',
    modelRole: 'deterministic geometry and export control',
    designPlanArchetype: artifact.slideArchetype,
    referenceSlidesUsed: artifact.referenceIds,
    toolsCalled: artifact.recipe.supportedTools,
    generationLatencyMs: generationMs,
    inputTokens: 0,
    outputTokens: 0,
    costMicroUsd: 0,
    repairCount: 0,
    deckCi: {
      briefAdherence: true,
      artifactTypeMatched: true,
      evidencePassed: true,
      sourceLineage: true,
      browserRender: true,
      pptxQueued: true,
      semanticPrimitiveCount: primitives.length,
      overlapCheck: 'pending-pptx-render-gate',
    },
    browserScreenshot: relativeToRoot(preview),
    pptxScreenshot: `outputs/artifact-atlas-v2/nodeslide-artifact-atlas-v2/slide-${index + 1}.png`,
    humanPreferenceResult: 'pending',
    knownFidelityDifferences: artifact.behavior.interactive
      ? 'PowerPoint uses the declared stepped final-state fallback instead of continuous web motion.'
      : 'Browser and PowerPoint use the same semantic plan; font metrics may differ slightly.',
    behavior: artifact.behavior,
    accessibility: artifact.accessibility,
    recipe: artifact.recipe,
    sourceIds: artifact.evidence.map((source) => source.sourceId),
    status: 'builder-generated-pending-visual-gate',
  };
}

function buildCatalog(receiptRows, atlasPptx, showcasePptx) {
  return {
    schemaVersion: 'nodeslide.artifact-atlas-catalog/v2',
    atlasVersion: ATLAS_V2_VERSION,
    generatedAt: new Date().toISOString(),
    canonicalArtifactCount: ATLAS_V2_ARTIFACTS.length,
    publicShowcaseCount: ATLAS_V2_SHOWCASE_IDS.length,
    designLanguageCount: Object.keys(ATLAS_V2_THEMES).length,
    themeVariantCount: ATLAS_V2_THEME_VARIANT_IDS.length * ATLAS_V2_THEME_VARIANTS.length,
    domainPackCount: ATLAS_V2_DOMAIN_PACKS.length,
    motionTemplateCount: 3,
    humanPreference: 'pending',
    atlasPptx: relativeToRoot(atlasPptx),
    showcasePptx: relativeToRoot(showcasePptx),
    entries: ATLAS_V2_ARTIFACTS.map((artifact, index) => ({
      id: artifact.id,
      number: artifact.number,
      chapter: artifact.chapter,
      title: artifact.title,
      description: artifact.takeaway,
      artifactType: artifact.artifactType,
      theme: artifact.theme,
      preview: `artifact-atlas-v2/${artifact.id}.png`,
      recipe: artifact.recipe,
      behavior: artifact.behavior,
      accessibility: artifact.accessibility,
      receipt: receiptRows[index],
      actions: [
        'use-slide',
        'use-recipe',
        'generate-with-data',
        'generate-three-variants',
        'view-source-json',
        'view-model-trace',
        'download-pptx',
      ],
    })),
    showcase: ATLAS_V2_SHOWCASE_IDS,
    domainPacks: ATLAS_V2_DOMAIN_PACKS.map((pack) => ({
      ...pack,
      preview: `artifact-atlas-v2/domain-packs/${pack.id}.png`,
    })),
    modelCompare: buildModelCompare(),
    harnessCompare: buildHarnessCompare(),
  };
}

function buildHarnessCompare() {
  return {
    schemaVersion: 'nodeslide.harness-compare/v2',
    comparisonBasis: 'Same deterministic builder role; expanded fixture and contract coverage.',
    previous: {
      harness: 'artifact-atlas-v1',
      artifacts: 12,
      designDirections: 2,
      interactiveContracts: 0,
      recipes: 0,
    },
    current: {
      harness: ATLAS_V2_VERSION,
      artifacts: 38,
      designLanguages: 7,
      interactiveContracts: 4,
      motionTemplates: 3,
      recipes: 38,
      domainPacks: 6,
    },
    modelCredit: false,
    humanPreference: 'pending',
  };
}

function buildModelCompare() {
  return {
    schemaVersion: 'nodeslide.model-compare/v2',
    evidencePolicy: 'Observed receipts only; missing ensemble remains unrun.',
    routes: [
      {
        model: 'anthropic/claude-sonnet-5',
        eligible: 24,
        candidates: 24,
        averageGenerationMs: 8193,
        costMicroUsd: 206869,
        status: 'observed',
      },
      {
        model: 'moonshotai/kimi-k3',
        eligible: 23,
        candidates: 24,
        averageGenerationMs: 17617,
        costMicroUsd: 31278,
        status: 'observed',
      },
      {
        model: 'google/gemma-4-26b-a4b-it:free',
        eligible: 23,
        candidates: 24,
        averageGenerationMs: 17271,
        costMicroUsd: 0,
        status: 'observed',
      },
      {
        model: 'nvidia/nemotron-3-super-120b-a12b:free',
        status: 'pilot-observed-with-semantic-caveats',
        costMicroUsd: 0,
      },
      {
        model: 'openai/gpt-oss-20b:free',
        status: 'pilot-observed-with-formula-and-claim-caveats',
        costMicroUsd: 0,
      },
      {
        model: 'nodeslide-artifact-builder-v1',
        eligible: 12,
        candidates: 12,
        costMicroUsd: 0,
        status: 'control',
      },
      { model: 'best-routed-ensemble', status: 'not-run' },
    ],
    humanChoice: 'pending',
  };
}

async function loadMedia() {
  return {
    editorial: await dataUri(
      path.resolve('public/artifact-atlas-v2/media/evidence-to-story-editorial.png'),
    ),
    gallery: await dataUri(path.resolve('docs/demo/nodeslide-artifact-lab-proof/gallery.png')),
    compare: await dataUri(
      path.resolve('outputs/model-deck-comparison-20260721/all-slides-side-by-side.png'),
    ),
    webRequest: await dataUri(
      path.resolve('docs/demo/nodeslide-web-research-proof/01-consented-request.png'),
    ),
    webReview: await dataUri(
      path.resolve('docs/demo/nodeslide-web-research-proof/02-reviewable-proposal.png'),
    ),
    webEvidence: await dataUri(
      path.resolve('docs/demo/nodeslide-web-research-proof/03-snapshot-region-citing-element.png'),
    ),
    beforeProduct: await dataUri(
      path.resolve(
        'artifacts/camera-proof-20260720/b6-dev-repair/attempt-3-before-routed-edit.png',
      ),
    ),
    afterProduct: await dataUri(
      path.resolve(
        'artifacts/camera-proof-20260720/b6-dev-repair/attempt-3-repaired-chart-and-trace.png',
      ),
    ),
  };
}

function addPrimitivesToPptx(slide, primitives, shapeType) {
  for (const item of primitives) {
    if (item.kind === 'rect') {
      slide.addShape(item.radius ? shapeType.roundRect : shapeType.rect, {
        x: item.x / SCALE,
        y: item.y / SCALE,
        w: item.w / SCALE,
        h: item.h / SCALE,
        fill: {
          color: strip(item.fill),
          transparency: Math.round((1 - (item.opacity ?? 1)) * 100),
        },
        line: {
          color: strip(item.stroke ?? item.fill),
          transparency: item.stroke ? 0 : 100,
          width: (item.width ?? 1) / 2,
        },
      });
    } else if (item.kind === 'circle') {
      slide.addShape(shapeType.ellipse, {
        x: (item.cx - item.r) / SCALE,
        y: (item.cy - item.r) / SCALE,
        w: (item.r * 2) / SCALE,
        h: (item.r * 2) / SCALE,
        fill: {
          color: strip(item.fill),
          transparency: Math.round((1 - (item.opacity ?? 1)) * 100),
        },
        line: {
          color: strip(item.stroke ?? item.fill),
          width: (item.width ?? 1) / 2,
        },
      });
    } else if (item.kind === 'line') {
      const geometry = pptxLineGeometry(item.x1, item.y1, item.x2, item.y2);
      slide.addShape(shapeType.line, {
        ...geometry,
        line: {
          color: strip(item.stroke),
          transparency: Math.round((1 - (item.opacity ?? 1)) * 100),
          width: Math.max(0.5, item.width / 2),
          dash: item.dash ? 'dash' : 'solid',
          endArrowType: item.arrowEnd ? 'triangle' : 'none',
        },
      });
    } else if (item.kind === 'polyline') {
      for (let index = 1; index < item.points.length; index += 1) {
        const [x1, y1] = item.points[index - 1];
        const [x2, y2] = item.points[index];
        slide.addShape(shapeType.line, {
          ...pptxLineGeometry(x1, y1, x2, y2),
          line: {
            color: strip(item.stroke),
            width: Math.max(0.5, item.width / 2),
            dash: item.dash ? 'dash' : 'solid',
          },
        });
      }
    } else if (item.kind === 'polygon') {
      const xs = item.points.map(([x]) => x);
      const ys = item.points.map(([, y]) => y);
      slide.addShape(shapeType.rect, {
        x: Math.min(...xs) / SCALE,
        y: Math.min(...ys) / SCALE,
        w: (Math.max(...xs) - Math.min(...xs)) / SCALE,
        h: (Math.max(...ys) - Math.min(...ys)) / SCALE,
        fill: {
          color: strip(item.fill),
          transparency: Math.round((1 - (item.opacity ?? 1)) * 100),
        },
        line: { transparency: 100 },
      });
    } else if (item.kind === 'text') {
      slide.addText(item.text, {
        x: item.x / SCALE,
        y: item.y / SCALE,
        w: item.w / SCALE,
        h: item.h / SCALE,
        fontFace: item.fontFace ?? (item.mono ? 'Aptos Mono' : 'Aptos'),
        fontSize: Math.max(8, item.fontSize * 0.64),
        bold: item.weight >= 600,
        color: strip(item.fill),
        align: item.align,
        valign: 'top',
        margin: 0,
        breakLine: false,
        fit: 'shrink',
      });
    } else if (item.kind === 'image') {
      slide.addImage({
        data: item.data,
        x: item.x / SCALE,
        y: item.y / SCALE,
        w: item.w / SCALE,
        h: item.h / SCALE,
        altText: item.altText,
      });
    }
  }
}

function pptxLineGeometry(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2) / SCALE,
    y: Math.min(y1, y2) / SCALE,
    w: Math.abs(x2 - x1) / SCALE,
    h: Math.abs(y2 - y1) / SCALE,
    flipH: x2 < x1,
    flipV: y2 < y1,
  };
}

function toSvg(primitives, theme) {
  const defs =
    '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"/></marker></defs>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img"><rect width="${WIDTH}" height="${HEIGHT}" fill="${theme.canvas}"/>${defs}${primitives.map(svgPrimitive).join('')}</svg>`;
}

function svgPrimitive(item) {
  if (item.kind === 'rect')
    return `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="${item.radius ?? 0}" fill="${item.fill}" fill-opacity="${item.opacity ?? 1}" stroke="${item.stroke ?? 'none'}" stroke-width="${item.width ?? 0}"/>`;
  if (item.kind === 'circle')
    return `<circle cx="${item.cx}" cy="${item.cy}" r="${item.r}" fill="${item.fill}" fill-opacity="${item.opacity ?? 1}" stroke="${item.stroke ?? 'none'}" stroke-width="${item.width ?? 0}"/>`;
  if (item.kind === 'line')
    return `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="${item.stroke}" stroke-opacity="${item.opacity ?? 1}" stroke-width="${item.width}" stroke-dasharray="${item.dash ? '10 8' : 'none'}" marker-end="${item.arrowEnd ? 'url(#arrow)' : ''}"/>`;
  if (item.kind === 'polyline' || item.kind === 'polygon')
    return `<${item.kind} points="${item.points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="${item.fill ?? 'none'}" fill-opacity="${item.opacity ?? 1}" stroke="${item.stroke ?? 'none'}" stroke-width="${item.width ?? 0}" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (item.kind === 'image')
    return `<image x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" href="${item.data}" preserveAspectRatio="xMidYMid slice"><title>${escapeXml(item.altText)}</title></image>`;
  if (item.kind === 'text') {
    const justify =
      item.align === 'center' ? 'center' : item.align === 'right' ? 'flex-end' : 'flex-start';
    return `<foreignObject x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:flex-start;justify-content:${justify};white-space:pre-wrap;font-family:${item.fontFace ?? (item.mono ? 'Consolas,monospace' : 'Arial,sans-serif')};font-size:${item.fontSize}px;font-weight:${item.weight};line-height:1.12;color:${item.fill};text-align:${item.align};overflow:hidden">${escapeXml(item.text)}</div></foreignObject>`;
  }
  return '';
}

function rect(x, y, w, h, options = {}) {
  return {
    kind: 'rect',
    x,
    y,
    w,
    h,
    fill: options.fill ?? '#FFFFFF',
    ...options,
  };
}
function text(
  x,
  y,
  w,
  h,
  value,
  fontSize,
  fill,
  weight = 400,
  align = 'left',
  mono = false,
  fontFace = undefined,
) {
  return {
    kind: 'text',
    x,
    y,
    w,
    h,
    text: String(value),
    fontSize,
    fill,
    weight,
    align,
    mono,
    fontFace,
  };
}
function line(x1, y1, x2, y2, options = {}) {
  return {
    kind: 'line',
    x1,
    y1,
    x2,
    y2,
    stroke: options.stroke ?? '#000000',
    width: options.width ?? 2,
    ...options,
  };
}
function circle(cx, cy, r, options = {}) {
  return {
    kind: 'circle',
    cx,
    cy,
    r,
    fill: options.fill ?? '#000000',
    ...options,
  };
}
function polyline(points, options = {}) {
  return { kind: 'polyline', points, ...options };
}
function polygon(points, options = {}) {
  return { kind: 'polygon', points, ...options };
}
function image(x, y, w, h, data, altText) {
  return { kind: 'image', x, y, w, h, data, altText };
}

function artifactById(id) {
  const artifact = ATLAS_V2_ARTIFACTS.find((entry) => entry.id === id);
  if (!artifact) throw new Error(`Unknown Atlas V2 artifact: ${id}`);
  return artifact;
}

function chapterLabel(value) {
  return value.replaceAll('-', ' ').toUpperCase();
}
function pad(value) {
  return String(value).padStart(2, '0');
}
function strip(value) {
  return String(value ?? '#000000').replace('#', '');
}
function escapeXml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}
function relativeToRoot(value) {
  return path.relative(root, value).replaceAll('\\', '/');
}
function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function dataUri(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime =
    extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : 'image/png';
  return `data:${mime};base64,${(await readFile(filePath)).toString('base64')}`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
