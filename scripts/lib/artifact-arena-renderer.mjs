import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import katex from 'katex';
import PptxGenJS from 'pptxgenjs';

const WIDTH = 1600;
const HEIGHT = 900;
const SCALE = 120;

const THEMES = {
  'evidence-editorial': {
    canvas: '#F5F0E7',
    ink: '#17241E',
    muted: '#677169',
    accent: '#C45538',
    accent2: '#2B7A78',
    soft: '#E2DDD3',
    panel: '#FBF8F2',
    danger: '#A63B32',
  },
  'expressive-technical': {
    canvas: '#101723',
    ink: '#F7F2E7',
    muted: '#A4B1C1',
    accent: '#B6E36B',
    accent2: '#A98BFF',
    soft: '#253044',
    panel: '#172132',
    danger: '#FF7A70',
  },
  'deterministic-baseline': {
    canvas: '#F3F6F7',
    ink: '#17242B',
    muted: '#64747C',
    accent: '#287A8D',
    accent2: '#8B5E3C',
    soft: '#DCE8EB',
    panel: '#FFFFFF',
    danger: '#B3473F',
  },
};

export async function renderArtifactArenaCandidate({ candidate, result, outputDir, browser }) {
  const theme = THEMES[candidate.directionId] ?? THEMES['deterministic-baseline'];
  const primitives = buildArtifactArenaPrimitives(candidate, result.plan, theme);
  await mkdir(outputDir, { recursive: true });
  const browserRender = path.join(outputDir, 'browser.png');
  const pptxFile = path.join(outputDir, 'artifact.pptx');
  const svg = primitivesToSvg(primitives, theme);
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  try {
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${theme.canvas};overflow:hidden}svg{display:block}</style>${svg}`,
    );
    await page.screenshot({ path: browserRender, type: 'png' });
  } finally {
    await page.close();
  }

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'NodeSlide Artifact Arena';
  pptx.subject = `${candidate.artifactType} benchmark candidate`;
  pptx.title = result.plan.title;
  pptx.company = 'NodeSlide';
  pptx.lang = 'en-US';
  pptx.theme = {
    headFontFace: 'Aptos Display',
    bodyFontFace: 'Aptos',
    lang: 'en-US',
  };
  const slide = pptx.addSlide();
  slide.background = { color: theme.canvas.slice(1) };
  addPrimitivesToPptx(slide, primitives, pptx.ShapeType);
  await pptx.writeFile({ fileName: pptxFile });
  return {
    browserRender,
    pptxFile,
    visibleText: primitives
      .filter((item) => item.kind === 'text' || item.kind === 'math')
      .map((item) => item.text),
    primitiveKinds: [...new Set(primitives.map((item) => item.semantic ?? item.kind))],
  };
}

export function buildArtifactArenaPrimitives(candidate, plan, themeOverride) {
  const theme = themeOverride ?? THEMES[candidate.directionId] ?? THEMES['deterministic-baseline'];
  const p = [];
  p.push(rect(0, 0, WIDTH, HEIGHT, { fill: theme.canvas }));
  p.push(text(72, 54, 1040, 44, eyebrow(candidate.artifactType), 18, theme.accent, 700));
  p.push(text(72, 98, 1280, 112, plan.title, 44, theme.ink, 700));
  p.push(text(72, 790, 1050, 34, plan.takeaway, 18, theme.muted, 400));
  p.push(text(72, 842, 1100, 24, sourceLine(candidate), 12, theme.muted, 400, 'left', true));
  p.push(text(1430, 842, 90, 24, 'ATLAS 01', 12, theme.muted, 600, 'right', true));

  switch (candidate.artifactType) {
    case 'hero-thesis':
      hero(p, plan, theme);
      break;
    case 'kpi-strip':
      kpis(p, theme);
      break;
    case 'multi-series-chart':
      multiSeries(p, theme);
      break;
    case 'uncertainty-range':
      uncertainty(p, theme);
      break;
    case 'architecture-diagram':
      architecture(p, theme);
      break;
    case 'sequence-diagram':
      sequence(p, theme);
      break;
    case 'timeline':
      timeline(p, theme);
      break;
    case 'screenshot-callouts':
      screenshotCallouts(p, theme);
      break;
    case 'claim-source-lineage':
      lineage(p, theme);
      break;
    case 'katex-equation':
      equation(p, theme);
      break;
    case 'code-runtime-proof':
      codeRuntime(p, theme);
      break;
    case 'risk-matrix':
      riskMatrix(p, theme);
      break;
    default:
      genericArtifact(p, candidate, plan, theme);
  }
  p.push(
    text(
      72,
      748,
      1448,
      28,
      `VERIFIED EVIDENCE · ${candidate.allowedClaims.join(' · ')}`,
      11,
      theme.muted,
      550,
      'left',
      true,
    ),
  );
  // Reserve a real annotation band above the evidence footer. The previous
  // 36px footer box clipped multi-line annotations in browser and PPTX output.
  p.push(text(1110, 690, 410, 48, plan.annotation, 12, theme.ink, 500, 'right'));
  return p;
}

function hero(p, plan, theme) {
  p.push(line(72, 250, 460, 250, { stroke: theme.accent, width: 5 }));
  p.push(text(72, 285, 940, 335, plan.takeaway, 56, theme.ink, 700));
  p.push(text(1190, 292, 280, 100, '52s', 82, theme.accent, 700, 'right', true));
  p.push(text(1120, 395, 350, 44, 'to human acceptance', 18, theme.muted, 500, 'right'));
}

function kpis(p, theme) {
  const values = [
    ['4.8', 'Revenue · $M', 'vs 5.0 target'],
    ['7.4', 'Pipeline · $M', 'vs 10.0 target'],
    ['21%', 'Win rate', 'vs 28% target'],
    ['39d', 'Implementation', 'down from 46d'],
    ['94%', 'Retention', 'vs 95% target'],
  ];
  values.forEach(([value, label, context], index) => {
    const x = 72 + index * 300;
    const color = index < 3 ? theme.danger : theme.accent2;
    p.push(line(x, 272, x + 250, 272, { stroke: color, width: index === 1 ? 8 : 3 }));
    p.push(text(x, 310, 260, 92, value, index === 1 ? 72 : 58, theme.ink, 700, 'left', true));
    p.push(text(x, 420, 260, 34, label, 21, theme.ink, 600));
    p.push(text(x, 468, 260, 28, context, 15, theme.muted, 400));
  });
  p.push(
    text(
      72,
      610,
      930,
      44,
      'Pipeline and win rate are the binding Q3 constraints.',
      28,
      theme.ink,
      650,
    ),
  );
}

function multiSeries(p, theme) {
  const left = 145;
  const top = 260;
  const w = 1210;
  const h = 390;
  p.push(line(left, top + h, left + w, top + h, { stroke: theme.muted, width: 2 }));
  p.push(line(left, top, left, top + h, { stroke: theme.muted, width: 2 }));
  const series = [
    { name: 'Rapid bus', values: [72, 74, 79, 83, 87, 91], color: theme.accent },
    { name: 'Local bus', values: [61, 62, 63, 65, 66, 67], color: theme.danger },
    { name: 'Rail', values: [68, 70, 73, 76, 79, 82], color: theme.accent2 },
  ];
  for (const item of series) {
    const points = item.values.map((value, index) => [
      left + (index / 5) * w,
      top + h - ((value - 55) / 40) * h,
    ]);
    p.push(polyline(points, { stroke: item.color, width: item.name === 'Local bus' ? 6 : 4 }));
    const end = points.at(-1);
    p.push(
      text(
        end[0] + 16,
        end[1] - 14,
        180,
        28,
        `${item.name} ${item.values.at(-1)}`,
        16,
        item.color,
        700,
      ),
    );
  }
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].forEach((label, index) => {
    p.push(
      text(
        left - 24 + (index / 5) * w,
        top + h + 24,
        70,
        24,
        label,
        13,
        theme.muted,
        500,
        'center',
      ),
    );
  });
  p.push(rect(850, 285, 470, 78, { fill: theme.panel, stroke: theme.soft, radius: 16 }));
  p.push(text(874, 303, 420, 44, 'Local bus recovered least: 67', 22, theme.ink, 650));
}

function uncertainty(p, theme) {
  const left = 150;
  const top = 260;
  const w = 1180;
  const h = 390;
  const xs = [0, 1, 2, 3, 4].map((index) => left + (index / 4) * w);
  const scaleY = (value) => top + h - ((value - 7) / 8) * h;
  const low = [8.1, 8.8, 8.9, 9.1, 9.0];
  const high = [8.1, 8.8, 10.6, 12.0, 13.8];
  for (let segment = 0; segment < xs.length - 1; segment += 1) {
    const steps = 8;
    for (let step = 0; step < steps; step += 1) {
      const progress = (step + 0.5) / steps;
      const x = xs[segment] + ((xs[segment + 1] - xs[segment]) * step) / steps;
      const highValue = high[segment] + (high[segment + 1] - high[segment]) * progress;
      const lowValue = low[segment] + (low[segment + 1] - low[segment]) * progress;
      const y = scaleY(highValue);
      p.push(
        rect(x, y, (xs[segment + 1] - xs[segment]) / steps + 1, scaleY(lowValue) - y, {
          fill: theme.soft,
          opacity: 0.72,
        }),
      );
    }
  }
  p.push(
    polyline(
      [8.1, 8.8, 9.7, 10.5, 11.4].map((v, i) => [xs[i], scaleY(v)]),
      { stroke: theme.accent, width: 5 },
    ),
  );
  p.push(
    polyline(
      [8.2, 9.0].map((v, i) => [xs[i], scaleY(v)]),
      { stroke: theme.ink, width: 7 },
    ),
  );
  p.push(line(xs[1], top - 10, xs[1], top + h + 12, { stroke: theme.muted, width: 2, dash: true }));
  p.push(text(xs[1] + 20, top - 4, 260, 30, 'Forecast begins', 15, theme.muted, 600));
  p.push(text(1040, 320, 300, 44, 'Q5 range', 16, theme.muted, 600));
  p.push(text(1040, 362, 330, 66, '9.0—13.8', 40, theme.ink, 700, 'left', true));
  ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].forEach((label, index) =>
    p.push(text(xs[index] - 26, top + h + 24, 60, 24, label, 13, theme.muted, 500, 'center')),
  );
}

function architecture(p, theme) {
  const nodes = [
    { x: 80, y: 390, w: 190, label: 'Client', fill: theme.panel },
    { x: 345, y: 330, w: 270, label: 'Portable protocol', fill: theme.soft },
    { x: 685, y: 330, w: 250, label: 'Validation engine', fill: theme.panel },
    { x: 1035, y: 255, w: 420, label: 'Adapter boundary', fill: theme.panel },
  ];
  p.push(line(270, 445, 345, 405, { stroke: theme.accent, width: 5, arrowEnd: true }));
  p.push(line(615, 405, 685, 405, { stroke: theme.accent, width: 5, arrowEnd: true }));
  p.push(line(935, 405, 1035, 405, { stroke: theme.accent, width: 5, arrowEnd: true }));
  for (const node of nodes) {
    p.push(
      rect(node.x, node.y, node.w, 145, { fill: node.fill, stroke: theme.accent, radius: 20 }),
    );
    p.push(
      text(node.x + 20, node.y + 48, node.w - 40, 42, node.label, 21, theme.ink, 650, 'center'),
    );
  }
  for (const [index, label] of ['Memory', 'Convex', 'Postgres'].entries()) {
    const y = 335 + index * 95;
    p.push(rect(1090, y, 300, 68, { fill: theme.soft, stroke: theme.accent2, radius: 14 }));
    p.push(text(1110, y + 20, 260, 30, label, 18, theme.ink, 600, 'center'));
  }
  p.push(line(1005, 220, 1005, 650, { stroke: theme.danger, width: 3, dash: true }));
  p.push(text(955, 665, 270, 28, 'backend-specific trust boundary', 14, theme.danger, 600));
}

function sequence(p, theme) {
  const actors = ['User', 'Client', 'Planning model', 'Validator', 'Adapter'];
  actors.forEach((actor, index) => {
    const x = 120 + index * 300;
    p.push(rect(x, 240, 190, 64, { fill: theme.panel, stroke: theme.accent2, radius: 14 }));
    p.push(text(x + 12, 258, 166, 30, actor, 16, theme.ink, 650, 'center'));
    p.push(line(x + 95, 304, x + 95, 690, { stroke: theme.muted, width: 2, dash: true }));
  });
  const messages = [
    [0, 1, 350, 'submit brief', theme.accent],
    [1, 2, 410, 'bounded context', theme.accent],
    [2, 3, 470, 'typed plan', theme.accent2],
    [3, 1, 530, 'issues / review', theme.danger],
    [1, 4, 600, 'accepted commit', theme.accent],
    [4, 0, 660, 'versioned receipt', theme.accent2],
  ];
  for (const [from, to, y, label, color] of messages) {
    const x1 = 215 + from * 300;
    const x2 = 215 + to * 300;
    p.push(line(x1, y, x2, y, { stroke: color, width: 3, arrowEnd: true }));
    p.push(
      text(
        Math.min(x1, x2) + 12,
        y - 26,
        Math.abs(x2 - x1) - 24,
        22,
        label,
        13,
        color,
        600,
        'center',
      ),
    );
  }
}

function timeline(p, theme) {
  const events = [
    ['Jul 1', 'Question frozen'],
    ['Jul 3', 'Evidence collected'],
    ['Jul 6', 'Candidates generated'],
    ['Jul 9', 'Blind review'],
    ['Jul 11', 'Update approved'],
  ];
  p.push(line(130, 470, 1450, 470, { stroke: theme.soft, width: 12 }));
  events.forEach(([date, label], index) => {
    const x = 140 + index * 325;
    const highlight = index === 3;
    p.push(
      circle(x, 470, highlight ? 24 : 16, {
        fill: highlight ? theme.accent : theme.accent2,
        stroke: theme.canvas,
        width: 5,
      }),
    );
    p.push(
      text(x - 70, index % 2 === 0 ? 350 : 520, 140, 30, date, 17, theme.ink, 700, 'center', true),
    );
    p.push(
      text(
        x - 110,
        index % 2 === 0 ? 386 : 558,
        220,
        54,
        label,
        17,
        highlight ? theme.accent : theme.ink,
        highlight ? 700 : 550,
        'center',
      ),
    );
  });
  p.push(
    text(1075, 270, 360, 44, 'Review is the gate—not generation.', 25, theme.ink, 650, 'right'),
  );
}

function screenshotCallouts(p, theme) {
  p.push(rect(120, 230, 1060, 500, { fill: theme.panel, stroke: theme.soft, radius: 22 }));
  p.push(rect(150, 260, 1000, 440, { fill: theme.soft, stroke: theme.muted, radius: 12 }));
  p.push(
    text(
      310,
      430,
      680,
      58,
      'REPLACE WITH VERIFIED PRODUCT SCREENSHOT',
      25,
      theme.muted,
      700,
      'center',
      true,
    ),
  );
  p.push(
    text(
      390,
      492,
      520,
      32,
      'No bitmap was supplied to this fixture',
      16,
      theme.muted,
      450,
      'center',
    ),
  );
  const calls = [
    [1250, 290, '1', 'Model selection'],
    [1310, 445, '2', 'Validation status'],
    [1220, 610, '3', 'Trace receipt'],
  ];
  for (const [x, y, number, label] of calls) {
    p.push(circle(x, y, 28, { fill: theme.accent, stroke: theme.canvas, width: 4 }));
    p.push(text(x - 18, y - 16, 36, 32, number, 18, theme.canvas, 700, 'center', true));
    p.push(text(x + 44, y - 18, 230, 36, label, 18, theme.ink, 600));
    p.push(line(x - 28, y, 1130, y, { stroke: theme.accent, width: 2 }));
  }
}

function lineage(p, theme) {
  const nodes = [
    [90, 380, 220, 'Source receipt'],
    [380, 380, 220, 'Extracted fact'],
    [670, 380, 220, 'Bounded claim'],
    [960, 380, 220, 'Slide element'],
    [1250, 380, 220, 'Export receipt'],
  ];
  nodes.slice(0, -1).forEach((node, index) => {
    p.push(
      line(node[0] + 220, 445, nodes[index + 1][0], 445, {
        stroke: theme.accent,
        width: 4,
        arrowEnd: true,
      }),
    );
  });
  nodes.forEach(([x, y, w, label], index) => {
    p.push(
      rect(x, y, w, 130, {
        fill: index === 2 ? theme.soft : theme.panel,
        stroke: theme.accent2,
        radius: 18,
      }),
    );
    p.push(text(x + 18, y + 28, w - 36, 34, label, 18, theme.ink, 650, 'center'));
    p.push(
      text(
        x + 18,
        y + 76,
        w - 36,
        26,
        index === 2 ? '52 seconds' : `${index + 1}`,
        15,
        theme.muted,
        500,
        'center',
        true,
      ),
    );
  });
  p.push(line(780, 510, 780, 650, { stroke: theme.danger, width: 3, arrowEnd: true }));
  p.push(rect(660, 650, 240, 70, { fill: theme.panel, stroke: theme.danger, radius: 14 }));
  p.push(text(680, 670, 200, 30, '“zero errors” rejected', 16, theme.danger, 650, 'center'));
}

function equation(p, theme) {
  p.push(rect(100, 250, 920, 440, { fill: theme.panel, stroke: theme.soft, radius: 28 }));
  p.push(math(155, 330, 810, 150, String.raw`\frac{Q}{C}=\frac{0.75}{0.038}`, 58, theme.ink));
  p.push(math(155, 500, 810, 90, String.raw`\approx 19.74`, 62, theme.accent));
  p.push(line(1080, 300, 1080, 650, { stroke: theme.accent2, width: 3 }));
  p.push(text(1130, 340, 340, 40, 'Q  Quality score', 23, theme.ink, 650, 'left', true));
  p.push(text(1130, 410, 340, 40, 'C  Cost in USD', 23, theme.ink, 650, 'left', true));
  p.push(
    text(
      1130,
      510,
      340,
      90,
      'A comparison measure—not a statistical significance claim.',
      20,
      theme.muted,
      450,
    ),
  );
}

function codeRuntime(p, theme) {
  p.push(rect(90, 240, 930, 470, { fill: '#10151C', stroke: theme.soft, radius: 20 }));
  p.push(line(1060, 260, 1060, 690, { stroke: theme.accent2, width: 3 }));
  const code = [
    'interface CaseflowAdapter {',
    '  stage(input): Promise<Proposal>;',
    '  commit(input): Promise<Receipt>;',
    '  restore(versionId): Promise<Receipt>;',
    '}',
  ];
  code.forEach((row, index) =>
    p.push(
      text(
        135,
        290 + index * 62,
        830,
        38,
        row,
        21,
        index === 0 || index === 4 ? theme.accent : '#E6EDF3',
        500,
        'left',
        true,
      ),
    ),
  );
  const metrics = [
    ['38 ms', 'p50 latency'],
    ['92 ms', 'p95 latency'],
    ['1,160 B', 'receipt size'],
  ];
  metrics.forEach(([value, label], index) => {
    p.push(
      text(
        1110,
        275 + index * 145,
        360,
        66,
        value,
        45,
        index === 1 ? theme.accent : theme.ink,
        700,
        'right',
        true,
      ),
    );
    p.push(text(1110, 343 + index * 145, 360, 28, label, 16, theme.muted, 500, 'right'));
  });
}

function riskMatrix(p, theme) {
  const left = 250;
  const top = 235;
  const size = 500;
  p.push(rect(left, top, size, size, { fill: theme.panel, stroke: theme.muted }));
  for (let i = 1; i < 5; i += 1) {
    p.push(
      line(left + (i * size) / 5, top, left + (i * size) / 5, top + size, {
        stroke: theme.soft,
        width: 2,
      }),
    );
    p.push(
      line(left, top + (i * size) / 5, left + size, top + (i * size) / 5, {
        stroke: theme.soft,
        width: 2,
      }),
    );
  }
  for (const [column, row] of [
    [3, 0],
    [4, 0],
    [4, 1],
  ]) {
    p.push(
      rect(left + column * 100, top + row * 100, 100, 100, {
        fill: theme.danger,
        opacity: 0.15,
      }),
    );
  }
  p.push(
    text(
      left + 170,
      top + size + 38,
      260,
      28,
      'LIKELIHOOD →',
      15,
      theme.muted,
      700,
      'center',
      true,
    ),
  );
  p.push(text(100, top + 205, 120, 80, 'IMPACT ↑', 15, theme.muted, 700, 'center', true));
  const risks = [
    [4, 5, 'Pipeline coverage', theme.danger],
    [3, 4, 'Implementation capacity', theme.accent],
    [2, 5, 'Retention concentration', theme.accent2],
  ];
  for (const [likelihood, impact, label, color] of risks) {
    const x = left + ((likelihood - 0.5) / 5) * size;
    const y = top + size - ((impact - 0.5) / 5) * size;
    p.push(circle(x, y, 22, { fill: color, stroke: theme.canvas, width: 4 }));
    p.push(text(x + 32, y - 15, 270, 30, label, 15, theme.ink, 650));
  }
  p.push(
    text(
      900,
      290,
      540,
      70,
      'Pipeline coverage is the highest-priority operating risk.',
      31,
      theme.ink,
      700,
    ),
  );
  p.push(
    text(
      900,
      400,
      510,
      120,
      'It combines the highest likelihood observed in the register with maximum impact.',
      22,
      theme.muted,
      450,
    ),
  );
  p.push(rect(900, 570, 470, 84, { fill: theme.soft, stroke: theme.accent, radius: 16 }));
  p.push(text(930, 592, 410, 38, 'Decision: intervene before Q3 planning', 20, theme.ink, 650));
}

function genericArtifact(p, candidate, plan, theme) {
  plan.operations.forEach((operation, index) => {
    const x = 110 + index * 440;
    p.push(rect(x, 300, 360, 250, { fill: theme.panel, stroke: theme.accent2, radius: 22 }));
    p.push(text(x + 26, 330, 308, 44, operation.label, 21, theme.ink, 650));
    p.push(text(x + 26, 405, 308, 92, operation.value, 19, theme.muted, 450));
  });
  p.push(text(110, 620, 1180, 44, candidate.narrativeJob, 25, theme.ink, 600));
}

function primitivesToSvg(primitives, theme) {
  const body = primitives.map(svgPrimitive).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img"><rect width="${WIDTH}" height="${HEIGHT}" fill="${theme.canvas}"/>${body}</svg>`;
}

function svgPrimitive(item) {
  if (item.kind === 'rect') {
    return `<rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="${item.radius ?? 0}" fill="${item.fill}" fill-opacity="${item.opacity ?? 1}" stroke="${item.stroke ?? 'none'}" stroke-width="${item.width ?? 0}"/>`;
  }
  if (item.kind === 'circle') {
    return `<circle cx="${item.cx}" cy="${item.cy}" r="${item.r}" fill="${item.fill}" stroke="${item.stroke ?? 'none'}" stroke-width="${item.width ?? 0}"/>`;
  }
  if (item.kind === 'line') {
    return `<line x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="${item.stroke}" stroke-width="${item.width}" stroke-dasharray="${item.dash ? '10 8' : 'none'}" marker-end="${item.arrowEnd ? 'url(#arrow)' : ''}"/>`;
  }
  if (item.kind === 'polyline' || item.kind === 'polygon') {
    const tag = item.kind;
    return `<${tag} points="${item.points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="${item.fill ?? 'none'}" fill-opacity="${item.opacity ?? 1}" stroke="${item.stroke ?? 'none'}" stroke-width="${item.width ?? 0}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  if (item.kind === 'math') {
    const html = katex.renderToString(item.formula, {
      throwOnError: false,
      displayMode: true,
      output: 'mathml',
    });
    return `<foreignObject x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:serif;font-size:${item.fontSize}px;font-weight:600;color:${item.fill};overflow:hidden">${html}</div></foreignObject>`;
  }
  if (item.kind === 'text') {
    const anchor = item.align === 'center' ? 'middle' : item.align === 'right' ? 'end' : 'start';
    const x =
      item.align === 'center'
        ? item.x + item.w / 2
        : item.align === 'right'
          ? item.x + item.w
          : item.x;
    return `<foreignObject x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;align-items:flex-start;justify-content:${item.align === 'center' ? 'center' : item.align === 'right' ? 'flex-end' : 'flex-start'};font-family:${item.mono ? 'Consolas,monospace' : 'Arial,sans-serif'};font-size:${item.fontSize}px;font-weight:${item.weight};line-height:1.13;color:${item.fill};text-align:${item.align};overflow:hidden">${escapeXml(item.text)}</div></foreignObject><text x="${x}" y="${item.y + item.fontSize}" text-anchor="${anchor}" fill="transparent">${escapeXml(item.text)}</text>`;
  }
  return '';
}

function addPrimitivesToPptx(slide, primitives, shapeType) {
  for (const item of primitives) {
    if (item.kind === 'rect') {
      slide.addShape(item.radius ? shapeType.roundRect : shapeType.rect, {
        x: item.x / SCALE,
        y: item.y / SCALE,
        w: item.w / SCALE,
        h: item.h / SCALE,
        rectRadius: item.radius ? 0.08 : undefined,
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
        fill: { color: strip(item.fill) },
        line: { color: strip(item.stroke ?? item.fill), width: (item.width ?? 1) / 2 },
      });
    } else if (item.kind === 'line') {
      slide.addShape(shapeType.line, {
        x: item.x1 / SCALE,
        y: item.y1 / SCALE,
        w: (item.x2 - item.x1) / SCALE,
        h: (item.y2 - item.y1) / SCALE,
        line: {
          color: strip(item.stroke),
          width: item.width / 2,
          dash: item.dash ? 'dash' : 'solid',
          endArrowType: item.arrowEnd ? 'triangle' : 'none',
        },
      });
    } else if (item.kind === 'polyline') {
      for (let index = 1; index < item.points.length; index += 1) {
        const [x1, y1] = item.points[index - 1];
        const [x2, y2] = item.points[index];
        slide.addShape(shapeType.line, {
          x: x1 / SCALE,
          y: y1 / SCALE,
          w: (x2 - x1) / SCALE,
          h: (y2 - y1) / SCALE,
          line: { color: strip(item.stroke), width: item.width / 2 },
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
        fontFace: item.mono ? 'Aptos Mono' : 'Aptos',
        fontSize: Math.max(8, item.fontSize * 0.64),
        bold: item.weight >= 600,
        color: strip(item.fill),
        align: item.align,
        valign: 'top',
        margin: 0,
        breakLine: false,
        fit: 'shrink',
      });
    } else if (item.kind === 'math') {
      slide.addText(item.pptxText, {
        x: item.x / SCALE,
        y: item.y / SCALE,
        w: item.w / SCALE,
        h: item.h / SCALE,
        fontFace: 'Cambria Math',
        fontSize: Math.max(8, item.fontSize * 0.64),
        bold: true,
        color: strip(item.fill),
        align: 'center',
        valign: 'mid',
        margin: 0,
        fit: 'shrink',
      });
    }
  }
}

function rect(x, y, w, h, options = {}) {
  return { kind: 'rect', x, y, w, h, fill: options.fill ?? '#FFFFFF', ...options };
}

function text(x, y, w, h, value, fontSize, fill, weight = 400, align = 'left', mono = false) {
  return { kind: 'text', x, y, w, h, text: String(value), fontSize, fill, weight, align, mono };
}

function math(x, y, w, h, formula, fontSize, fill) {
  const textValue = formula.includes('approx') ? '≈ 19.74' : 'Q / C = 0.75 / 0.038';
  return {
    kind: 'math',
    x,
    y,
    w,
    h,
    text: textValue,
    formula,
    pptxText: textValue,
    fontSize,
    fill,
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
  return { kind: 'circle', cx, cy, r, fill: options.fill ?? '#000000', ...options };
}

function polyline(points, options = {}) {
  return { kind: 'polyline', points, ...options };
}

function polygon(points, options = {}) {
  return { kind: 'polygon', points, ...options };
}

function eyebrow(value) {
  return value.replace(/-/gu, ' ').toUpperCase();
}

function sourceLine(candidate) {
  return `SOURCE · ${candidate.sourceIds.join(' · ')} · ${candidate.modelLabel}`;
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
