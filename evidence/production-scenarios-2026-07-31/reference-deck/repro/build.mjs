import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const W = 1280;
const H = 720;
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
const OUT = path.resolve(HERE, '..');
const HERO = path.join(HERE, 'assets', 'signal-threshold.png');
const C = {
  ink: '#07101f',
  ink2: '#0d1b31',
  paper: '#f6f1e7',
  white: '#fffaf0',
  muted: '#9aa8bb',
  mutedDark: '#4b5a6d',
  amber: '#ffb45b',
  coral: '#ff6b57',
  cyan: '#5ed7e8',
  green: '#7bd39a',
  line: '#24344d',
  red: '#ff6a6a',
};

function shape(slide, geometry, x, y, w, h, fill, line = 'none', radius) {
  return slide.shapes.add({
    geometry,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: 'solid', fill: line, width: line === 'none' ? 0 : 1 },
    ...(radius ? { borderRadius: radius } : {}),
  });
}

function text(slide, value, x, y, w, h, size, color = C.white, bold = false, align = 'left') {
  const box = shape(slide, 'textbox', x, y, w, h, 'none');
  box.text = value;
  box.text.style = {
    fontSize: size,
    fontFamily: bold ? 'Aptos Display' : 'Aptos',
    bold,
    color,
    alignment: align,
    verticalAlignment: 'middle',
  };
  return box;
}

function rule(slide, x, y, w, h, color) {
  return shape(slide, 'rect', x, y, w, h, color);
}

function dot(slide, x, y, r, color) {
  return shape(slide, 'ellipse', x - r, y - r, r * 2, r * 2, color);
}

function baseSlide(presentation, titleValue, kicker, page, dark = true) {
  const slide = presentation.slides.add();
  slide.background.fill = dark ? C.ink : C.paper;
  text(slide, kicker.toUpperCase(), 64, 34, 420, 26, 14, dark ? C.cyan : C.coral, true);
  text(slide, titleValue, 64, 70, 1110, 78, 42, dark ? C.white : C.ink, true);
  rule(slide, 64, 678, 1152, 1, dark ? C.line : '#d8d0c2');
  text(slide, 'NODESLIDE  /  SIGNAL → DECISION', 64, 684, 580, 20, 11, dark ? C.muted : C.mutedDark, true);
  text(slide, String(page).padStart(2, '0'), 1160, 684, 56, 20, 11, dark ? C.amber : C.coral, true, 'right');
  return slide;
}

function label(slide, value, x, y, w, color = C.muted) {
  text(slide, value.toUpperCase(), x, y, w, 24, 13, color, true);
}

async function addImage(slide, imagePath, x, y, w, h, fit = 'cover') {
  const bytes = await fs.readFile(imagePath);
  slide.images.add({
    blob: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    contentType: 'image/png',
    alt: 'Scattered evidence converges through a trust threshold into reusable decision paths',
    fit,
    position: { left: x, top: y, width: w, height: h },
  });
}

function arrow(slide, x1, y1, x2, y2, color = C.cyan, weight = 3) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.max(1, Math.abs(x2 - x1));
  const height = Math.max(1, Math.abs(y2 - y1));
  slide.shapes.add({
    geometry: 'line',
    position: { left, top, width, height },
    fill: 'none',
    line: { style: 'solid', fill: color, width: weight, endArrowType: 'triangle' },
  });
}

const p = Presentation.create({ slideSize: { width: W, height: H } });

// 1 — cinematic opening
{
  const s = p.slides.add();
  s.background.fill = C.ink;
  await addImage(s, HERO, 0, 0, W, H);
  shape(s, 'rect', 0, 0, 620, H, '#07101fcc');
  label(s, 'Product decision deck', 66, 54, 320, C.cyan);
  text(s, 'NodeSlide', 66, 126, 520, 82, 66, C.white, true);
  text(s, 'From signal to\ndefensible decision', 66, 202, 520, 150, 48, C.white, true);
  text(s, 'A production case for research, finance, startup, operating, and governance work.', 70, 385, 430, 92, 22, '#d7deea');
  rule(s, 70, 522, 210, 6, C.amber);
  text(s, 'The deck is not done when it renders.\nIt is done when the decision job finishes.', 70, 548, 470, 72, 20, C.amber, true);
  text(s, '2026 · REFERENCE DECK', 70, 665, 300, 18, 11, C.muted, true);
}

// 2 — the missing middle
{
  const s = baseSlide(p, 'Plausible slides are not decision-ready', 'The gap', 2);
  text(s, 'A prompt can produce fluent copy and still fail the job.', 64, 158, 620, 42, 22, C.muted);
  const left = [
    ['Looks finished', C.coral],
    ['Generic narrative', C.muted],
    ['Unbound claims', C.muted],
    ['Repeated layout', C.muted],
  ];
  left.forEach(([v, color], i) => {
    dot(s, 108 + i * 118, 392 + (i % 2) * 52, 8, color);
    rule(s, 116 + i * 118, 391 + (i % 2) * 52, 86, 2, color);
  });
  text(s, 'PLAUSIBLE', 72, 510, 470, 40, 30, C.coral, true);
  shape(s, 'roundRect', 560, 238, 190, 318, C.ink2, C.line, 'rounded-2xl');
  text(s, 'THE\nMISSING\nMIDDLE', 584, 274, 142, 152, 28, C.amber, true, 'center');
  text(s, 'truth\nstory\nreview\ncompletion', 598, 442, 114, 86, 17, C.muted, false, 'center');
  arrow(s, 760, 397, 930, 397, C.green, 4);
  text(s, 'DECISION-READY', 914, 510, 300, 40, 30, C.green, true, 'right');
  text(s, 'Source-bound', 900, 278, 240, 30, 20, C.white, true);
  text(s, 'Narrative advances', 930, 328, 260, 30, 20, C.white, true);
  text(s, 'Visually legible', 900, 378, 240, 30, 20, C.white, true);
  text(s, 'Exported + owned', 930, 428, 260, 30, 20, C.white, true);
}

// 3 — five jobs, one system
{
  const s = baseSlide(p, 'One engine must finish five different jobs', 'Production scenarios', 3, false);
  text(s, 'The truth constraint changes by domain. The completion contract does not.', 64, 154, 850, 36, 21, C.mutedDark);
  const items = [
    ['RESEARCH', 'Contradiction\n+ uncertainty', C.cyan],
    ['FINANCE', 'Units +\nreconciliation', C.coral],
    ['STARTUP', 'Retellable\nwithout fiction', C.amber],
    ['OPERATING', 'Owner +\ncheckpoint', '#7f8cff'],
    ['GOVERNANCE', 'Evidence-bound\nrelease state', C.green],
  ];
  items.forEach(([name, sub, color], i) => {
    const x = 64 + i * 228;
    rule(s, x, 240, 174, 8, color);
    text(s, name, x, 270, 190, 30, 17, C.ink, true);
    text(s, sub, x, 316, 184, 76, 19, C.mutedDark, false);
    rule(s, x, 432, 174, 1, '#cfc6b7');
    text(s, 'Brief fidelity\nSource truth\nStory progression\nEditable delivery', x, 450, 190, 112, 16, C.ink, false);
  });
  text(s, 'Same gate. Different evidence.', 64, 590, 1110, 52, 34, C.ink, true, 'center');
}

// 4 — research convergence
{
  const s = baseSlide(p, 'Research must preserve disagreement', 'Scenario 01 · Research', 4);
  text(s, 'Synthesis is not consensus. The unresolved edge stays visible.', 64, 154, 760, 38, 21, C.muted);
  const sources = [
    ['PAPER SET', 86, 262, C.cyan],
    ['EVAL NOTES', 86, 356, C.amber],
    ['INTERVIEWS', 86, 450, C.coral],
  ];
  sources.forEach(([v, x, y, c]) => {
    dot(s, x, y, 10, c);
    text(s, v, x + 24, y - 18, 170, 36, 16, C.white, true);
    arrow(s, x + 178, y, 430, 356, c, 2);
  });
  shape(s, 'ellipse', 430, 268, 190, 176, C.ink2, C.cyan);
  text(s, 'CLAIM\nMAP', 470, 308, 110, 76, 28, C.white, true, 'center');
  arrow(s, 620, 356, 780, 356, C.cyan, 4);
  shape(s, 'roundRect', 790, 250, 330, 212, C.white, C.white, 'rounded-2xl');
  text(s, 'PILOT DECISION', 824, 282, 260, 30, 16, C.ink, true);
  text(s, 'Adopt for six weeks', 824, 326, 260, 44, 29, C.ink, true);
  text(s, 'Owner · metric · stop condition', 824, 390, 260, 28, 16, C.mutedDark);
  shape(s, 'roundRect', 970, 492, 220, 70, '#311a28', C.coral, 'rounded-xl');
  text(s, 'UNRESOLVED\n2 conflicting claims', 990, 502, 180, 48, 15, C.coral, true, 'center');
}

// 5 — finance reconciliation
{
  const s = baseSlide(p, 'Finance needs a bridge, not decoration', 'Scenario 02 · Finance', 5, false);
  text(s, 'Every number keeps its unit, source, and status as it becomes an outlook.', 64, 154, 870, 38, 21, C.mutedDark);
  const bars = [
    ['REPORTED', 150, C.ink],
    ['NON-GAAP', 210, C.coral],
    ['ASSUMPTION', 125, C.amber],
    ['OUTLOOK', 275, C.green],
  ];
  let x = 76;
  bars.forEach(([name, h, color]) => {
    rule(s, x, 554 - h, 116, h, color);
    text(s, name, x - 4, 566, 124, 28, 14, C.ink, true, 'center');
    x += 150;
  });
  rule(s, 64, 554, 630, 2, '#bdb3a5');
  shape(s, 'roundRect', 760, 230, 430, 334, C.ink, C.ink, 'rounded-2xl');
  label(s, 'Reconciliation gate', 798, 260, 300, C.amber);
  text(s, 'Observed ≠ forward-looking', 798, 306, 340, 40, 28, C.white, true);
  const rules = ['Units survive', 'Totals reconcile', 'Missing ≠ zero', 'Guidance is labeled'];
  rules.forEach((v, i) => {
    dot(s, 812, 390 + i * 40, 5, i === 3 ? C.green : C.cyan);
    text(s, v, 832, 376 + i * 40, 280, 28, 17, C.white);
  });
}

// 6 — startup rise
{
  const s = baseSlide(p, 'A startup story must become retellable', 'Scenario 03 · Startup', 6);
  text(s, 'The shape changes as belief compounds; the synthetic label never disappears.', 64, 154, 870, 38, 21, C.muted);
  const beats = [
    ['PAIN', 82, 518, 120, 56],
    ['PRODUCT', 248, 452, 150, 78],
    ['PROOF', 440, 372, 160, 110],
    ['WEDGE', 646, 290, 180, 144],
    ['ASK', 878, 208, 260, 186],
  ];
  beats.forEach(([name, x, y, w, h], i) => {
    shape(s, 'roundRect', x, y, w, h, i === 4 ? C.amber : C.ink2, i === 4 ? C.amber : C.line, 'rounded-xl');
    text(s, name, x, y + 8, w, 30, 17, i === 4 ? C.ink : C.white, true, 'center');
    if (i < beats.length - 1) arrow(s, x + w, y + h / 2, beats[i + 1][1] - 12, beats[i + 1][2] + beats[i + 1][4] / 2, C.cyan, 2);
  });
  shape(s, 'roundRect', 420, 548, 370, 48, '#291f16', C.amber, 'rounded-xl');
  text(s, 'SYNTHETIC TEST DATA · ALWAYS VISIBLE', 438, 556, 334, 30, 14, C.amber, true, 'center');
}

// 7 — operating bottleneck
{
  const s = baseSlide(p, 'Operating reviews must expose the constraint', 'Scenario 04 · Operating', 7, false);
  text(s, 'Metrics matter when they point to an owned intervention and the next cadence.', 64, 154, 900, 38, 21, C.mutedDark);
  const stages = [
    ['DEMAND', 70, 268, 180, 80, C.cyan],
    ['CAPACITY', 320, 268, 180, 80, C.ink],
    ['BOTTLENECK', 570, 248, 190, 120, C.coral],
    ['INTERVENTION', 830, 268, 180, 80, C.green],
  ];
  stages.forEach(([name, x, y, w, h, color], i) => {
    shape(s, 'roundRect', x, y, w, h, color, color, 'rounded-xl');
    text(s, name, x, y + 22, w, 34, 17, color === C.ink ? C.white : C.ink, true, 'center');
    if (i < stages.length - 1) arrow(s, x + w + 8, y + h / 2, stages[i + 1][1] - 8, stages[i + 1][2] + stages[i + 1][4] / 2, C.ink, 3);
  });
  rule(s, 1010, 307, 126, 3, C.green);
  dot(s, 1146, 308, 10, C.green);
  text(s, '30-DAY\nCADENCE', 1040, 372, 170, 66, 24, C.ink, true, 'center');
  const meta = [
    ['OWNER', 'COO'],
    ['LEADING SIGNAL', 'Cycle time'],
    ['CHECKPOINT', 'Weekly'],
  ];
  meta.forEach(([k, v], i) => {
    label(s, k, 98 + i * 330, 500, 220, C.coral);
    text(s, v, 98 + i * 330, 530, 250, 38, 24, C.ink, true);
  });
}

// 8 — governance threshold
{
  const s = baseSlide(p, 'Governance culminates in a visible release state', 'Scenario 05 · Governance', 8);
  text(s, 'A failed control cannot hide behind a green quality badge.', 64, 154, 760, 38, 21, C.muted);
  const funcs = [
    ['MAP', 94, 264],
    ['MEASURE', 94, 354],
    ['MANAGE', 94, 444],
  ];
  funcs.forEach(([v, x, y]) => {
    shape(s, 'roundRect', x, y, 170, 62, C.ink2, C.line, 'rounded-xl');
    text(s, v, x, y + 14, 170, 30, 17, C.white, true, 'center');
    arrow(s, x + 178, y + 31, 470, 355, C.cyan, 2);
  });
  shape(s, 'roundRect', 428, 244, 250, 226, C.ink2, C.cyan, 'rounded-2xl');
  text(s, 'GOVERN', 458, 274, 190, 36, 22, C.cyan, true, 'center');
  text(s, 'cross-cutting\nowners · policy\nexceptions · evidence', 468, 334, 170, 92, 18, C.white, false, 'center');
  rule(s, 752, 214, 10, 330, C.amber);
  text(s, 'TRUST\nGATE', 700, 334, 110, 72, 22, C.amber, true, 'center');
  shape(s, 'roundRect', 842, 240, 340, 246, '#16291f', C.green, 'rounded-2xl');
  label(s, 'Decision state', 878, 270, 220, C.green);
  text(s, 'CONDITIONALLY\nAPPROVE', 878, 320, 270, 80, 30, C.white, true);
  text(s, '2 controls due · owner named\nnext checkpoint · 14 days', 878, 420, 260, 48, 17, '#c8e9d3');
}

// 9 — architecture
{
  const s = baseSlide(p, 'Three front doors, one governed deck program', 'System architecture', 9, false);
  text(s, 'UI, CLI, and MCP converge before any mutation becomes durable.', 64, 154, 820, 38, 21, C.mutedDark);
  const doors = [
    ['UI', 78, C.coral],
    ['CLI', 78, C.cyan],
    ['MCP', 78, C.amber],
  ];
  doors.forEach(([v, x, c], i) => {
    const y = 250 + i * 104;
    shape(s, 'roundRect', x, y, 150, 64, c, c, 'rounded-xl');
    text(s, v, x, y + 16, 150, 30, 22, C.ink, true, 'center');
    arrow(s, x + 160, y + 32, 430, 356, C.ink, 2);
  });
  shape(s, 'roundRect', 420, 244, 320, 232, C.ink, C.ink, 'rounded-2xl');
  label(s, 'Canonical program', 454, 274, 250, C.cyan);
  text(s, 'DeckSnapshot', 454, 316, 252, 42, 30, C.white, true);
  text(s, 'typed elements\nsource bindings\nversion + scope', 454, 374, 250, 76, 18, C.muted);
  arrow(s, 750, 356, 916, 356, C.ink, 4);
  shape(s, 'roundRect', 930, 228, 280, 264, C.white, '#cfc6b7', 'rounded-2xl');
  text(s, 'ONE MUTATION PATH', 960, 260, 220, 28, 15, C.coral, true, 'center');
  text(s, 'propose', 976, 314, 188, 28, 20, C.ink, true, 'center');
  text(s, 'validate', 976, 358, 188, 28, 20, C.ink, true, 'center');
  text(s, 'review', 976, 402, 188, 28, 20, C.ink, true, 'center');
  text(s, 'accept', 976, 446, 188, 28, 20, C.green, true, 'center');
  text(s, 'Source · README / EXTERNAL_AGENT_ACCESS', 64, 632, 600, 20, 12, C.mutedDark);
}

// 10 — trust loop
{
  const s = baseSlide(p, 'Trust is a chain of independently checkable receipts', 'Proof model', 10);
  text(s, 'The UI badge is never the authority. The artifact and receipt are.', 64, 154, 850, 38, 21, C.muted);
  const chain = [
    ['SOURCE', C.cyan],
    ['CLAIM', C.white],
    ['ARTIFACT', C.amber],
    ['RENDER', C.coral],
    ['EXPORT', C.green],
  ];
  chain.forEach(([v, c], i) => {
    const x = 70 + i * 230;
    dot(s, x + 54, 324, 32, c);
    text(s, v, x, 382, 110, 30, 15, c, true, 'center');
    if (i < chain.length - 1) arrow(s, x + 92, 324, x + 204, 324, C.line, 3);
  });
  shape(s, 'roundRect', 250, 486, 780, 86, C.ink2, C.line, 'rounded-2xl');
  text(s, 'digest · model · cost · tokens · validation · version · publication', 284, 507, 712, 36, 20, C.white, true, 'center');
  text(s, 'Receipt completeness is the proof surface agents can reason over.', 284, 548, 712, 24, 15, C.cyan, false, 'center');
}

// 11 — current gap / production gate
{
  const s = baseSlide(p, 'Production readiness must fail closed', 'The gate', 11, false);
  text(s, 'The latest live run proved the remaining gap: the artifact completed, the brief did not.', 64, 154, 990, 38, 21, C.mutedDark);
  const rows = [
    ['Requested slide count', '6', 'Produced 7', C.red],
    ['Supporting points', 'Exactly 2', 'Drifted', C.red],
    ['Composition', 'Distinct', 'Improved', C.green],
    ['Metaphor progression', 'Visible change', 'Rail repeated', C.red],
    ['Quality state', 'Fail closed', 'Badge stayed green', C.red],
  ];
  label(s, 'Contract', 72, 230, 300, C.coral);
  label(s, 'Expected', 520, 230, 220, C.coral);
  label(s, 'Observed', 810, 230, 280, C.coral);
  rows.forEach(([name, expected, observed, color], i) => {
    const y = 274 + i * 62;
    rule(s, 64, y + 50, 1150, 1, '#d7cec0');
    text(s, name, 72, y, 400, 46, 18, C.ink, true);
    text(s, expected, 520, y, 220, 46, 18, C.mutedDark);
    text(s, observed, 810, y, 300, 46, 18, color, true);
    dot(s, 1165, y + 23, 7, color);
  });
  shape(s, 'roundRect', 790, 606, 424, 42, C.ink, C.ink, 'rounded-xl');
  text(s, 'READY = JOB COMPLETE × TRUTH × VISUAL PROOF', 806, 612, 392, 28, 14, C.white, true, 'center');
}

// 12 — decision and fan-out
{
  const s = p.slides.add();
  s.background.fill = C.ink;
  await addImage(s, HERO, 0, 0, W, H);
  shape(s, 'rect', 0, 0, W, H, '#07101fcf');
  label(s, 'Decision', 64, 48, 260, C.green);
  text(s, 'Pilot the jobs.\nDo not ship the illusion.', 64, 100, 680, 126, 50, C.white, true);
  text(s, 'Release each domain only when its complete job, truth rules, visual progression, export, and receipt pass together.', 66, 250, 620, 92, 22, '#d7deea');
  const lanes = [
    ['01', 'Research + governance', 'prove evidence and fail-closed decisions'],
    ['02', 'Finance + operating', 'prove numbers, owners, and cadence'],
    ['03', 'Startup + agent distribution', 'prove retellability and repeat use'],
  ];
  lanes.forEach(([n, title, sub], i) => {
    const y = 398 + i * 74;
    text(s, n, 70, y, 48, 34, 17, C.amber, true);
    text(s, title, 132, y, 270, 34, 20, C.white, true);
    text(s, sub, 410, y, 470, 34, 17, C.muted);
  });
  shape(s, 'roundRect', 930, 244, 280, 300, '#0d1b31dd', C.green, 'rounded-2xl');
  text(s, 'OWNER', 970, 274, 200, 28, 14, C.green, true, 'center');
  text(s, 'Product +\nEngineering', 958, 318, 224, 72, 28, C.white, true, 'center');
  rule(s, 972, 408, 196, 2, C.line);
  text(s, 'NEXT CHECKPOINT', 970, 426, 200, 24, 13, C.amber, true, 'center');
  text(s, '5 held-out decks\nall gates green', 970, 458, 200, 58, 17, C.white, true, 'center');
  text(s, 'MAKE THE DECISION ARTIFACT THE PRODUCT.', 64, 654, 760, 28, 16, C.cyan, true);
}

await fs.mkdir(OUT, { recursive: true });
for (const [index, slide] of p.slides.items.entries()) {
  const stem = `slide-${String(index + 1).padStart(2, '0')}`;
  const png = await p.export({ slide, format: 'png', scale: 1 });
  await fs.writeFile(path.join(OUT, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
  const layout = await slide.export({ format: 'layout' });
  await fs.writeFile(path.join(OUT, `${stem}.layout.json`), await layout.text());
}
const montage = await p.export({ format: 'webp', montage: true, scale: 1 });
await fs.writeFile(path.join(OUT, 'NodeSlide-reference-montage.webp'), new Uint8Array(await montage.arrayBuffer()));
const pptx = await PresentationFile.exportPptx(p);
await pptx.save(path.join(OUT, 'NodeSlide-From-Signal-to-Defensible-Decision.pptx'));
const inspect = await p.inspect({ kind: 'slide,textbox,shape,image', maxChars: 12000 });
await fs.writeFile(path.join(OUT, 'inspection.ndjson'), inspect.ndjson);
console.log(JSON.stringify({ slides: p.slides.items.length, output: OUT }, null, 2));
