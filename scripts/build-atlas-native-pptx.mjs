/**
 * Native Atlas PPTX builder — the compile-per-target step v1..v3 never had.
 *
 * v3 was produced by importing a template and driving the @oai/artifact-tool / Walnut *visual*
 * exporter, which lays every artifact out as vector autoshapes. The parity topology gate correctly
 * fails those slides: a "chart" made of 49 autoshapes carries no chart semantics.
 *
 * This builder compiles a semantic ArtifactSpec into NATIVE OOXML objects instead:
 *   - data.*        -> PptxGenJS addChart  -> a real ppt/charts/chartN.xml part
 *   - data.table    -> PptxGenJS addTable  -> a real <a:tbl> grid
 *   - technical.equation -> injected OMML   -> a real <m:oMath> (PptxGenJS has no equation API,
 *                                              so the OMML is spliced into the slide XML post-write)
 *
 * "Compile per target, validate per target" (the council's replacement for "layout once, emit
 * twice"): each artifact is compiled to the PPTX target's own object model, and the emitted file is
 * meant to be validated by the same deep inspector + topology gate that judged v3 — not asserted.
 *
 * Usage:
 *   node scripts/build-atlas-native-pptx.mjs [--out <file.pptx>]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import Pptx from 'pptxgenjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The semantic input. Each entry is what the slide MEANS; the builder decides the native object.
 * This is deliberately small — enough to prove native emission across the three families v3 flattens.
 */
const ARTIFACT_SPECS = [
  {
    archetype: 'data.bar-comparison',
    title: 'Model cost per accepted slide',
    kind: 'bar',
    series: [
      {
        name: 'Cost (¢)',
        labels: ['Kimi K3', 'Claude', 'Gemma', 'Free route'],
        values: [0.42, 0.51, 0.09, 0.0],
      },
    ],
  },
  {
    archetype: 'data.trend-line',
    title: 'Repair count by harness version',
    kind: 'line',
    series: [{ name: 'Repairs', labels: ['v1', 'v2', 'v3', 'v4', 'v5'], values: [9, 6, 5, 3, 1] }],
  },
  {
    archetype: 'data.table',
    title: 'Atlas gate outcomes on v3',
    kind: 'table',
    rows: [
      ['Status', 'Slides', 'Meaning'],
      ['passed', '6', 'native artifact present'],
      ['flattened', '25', 'autoshapes, no semantics'],
      ['indeterminate', '3', 'inspection cannot decide'],
    ],
  },
  {
    archetype: 'technical.equation',
    title: 'Cost/quality objective',
    kind: 'equation',
    // OMML for:  Q = (Σ wᵢ pᵢ) / c   — a minimal but real <m:oMath> block.
    ommlBody:
      '<m:oMathPara><m:oMath>' +
      '<m:r><m:t>Q = </m:t></m:r>' +
      '<m:f><m:num><m:r><m:t>∑ wᵢ pᵢ</m:t></m:r></m:num>' +
      '<m:den><m:r><m:t>c</m:t></m:r></m:den></m:f>' +
      '</m:oMath></m:oMathPara>',
  },
  {
    archetype: 'systems.architecture',
    title: 'Source to evidence to claim to slide to export',
    kind: 'diagram',
    nodes: [
      { id: 'source', label: 'Source' },
      { id: 'evidence', label: 'Evidence' },
      { id: 'claim', label: 'Claim' },
      { id: 'slide', label: 'Slide' },
      { id: 'export', label: 'Export' },
    ],
    edges: [
      ['source', 'evidence'],
      ['evidence', 'claim'],
      ['claim', 'slide'],
      ['slide', 'export'],
    ],
  },
];

const BRAND = { bg: 'FAF7F3', ink: '221F1C', accent: 'C76D54', muted: '6D635A' };

function addHeader(slide, spec, index) {
  slide.background = { color: BRAND.bg };
  slide.addText(spec.archetype.toUpperCase(), {
    x: 0.5,
    y: 0.35,
    w: 9,
    h: 0.3,
    fontSize: 11,
    color: BRAND.muted,
    charSpacing: 2,
  });
  slide.addText(spec.title, {
    x: 0.5,
    y: 0.65,
    w: 9,
    h: 0.7,
    fontSize: 26,
    bold: true,
    color: BRAND.ink,
  });
  slide.addText(`${index + 1}`, {
    x: 9.2,
    y: 0.35,
    w: 0.5,
    h: 0.3,
    fontSize: 11,
    color: BRAND.muted,
  });
}

function buildChart(pptx, slide, spec) {
  const type = spec.kind === 'line' ? pptx.ChartType.line : pptx.ChartType.bar;
  const data = spec.series.map((s) => ({ name: s.name, labels: s.labels, values: s.values }));
  slide.addChart(type, data, {
    x: 0.5,
    y: 1.6,
    w: 9,
    h: 3.6,
    chartColors: [BRAND.accent, '4F7A52', 'B8862A'],
    showTitle: false,
    showLegend: true,
    legendPos: 'b',
    catAxisLabelColor: BRAND.muted,
    valAxisLabelColor: BRAND.muted,
  });
}

function buildTable(slide, spec) {
  const [head, ...body] = spec.rows;
  const rows = [
    head.map((c) => ({
      text: c,
      options: { bold: true, color: 'FFFFFF', fill: { color: BRAND.accent } },
    })),
    ...body.map((r) => r.map((c) => ({ text: String(c), options: { color: BRAND.ink } }))),
  ];
  slide.addTable(rows, {
    x: 0.5,
    y: 1.6,
    w: 9,
    border: { type: 'solid', color: 'E0D9D1', pt: 1 },
    fontSize: 14,
    valign: 'middle',
  });
}

const EMU_PER_INCH = 914_400;

/**
 * Lay out a left-to-right pipeline and place each node as a native rounded rect. A production build
 * would use ELK here; a deterministic layered layout is enough to prove native connector emission.
 * Node geometry (in EMU) is returned so the post-processor can bind connectors to real shape ids.
 */
function buildDiagramNodes(slide, spec) {
  const count = spec.nodes.length;
  const h = 0.9;
  const y = 2.4;
  // Fixed gutter, derived width — not fixed width, derived gutter. The old formula was
  // `gap = (10 - count * 1.5) / (count + 1)`, which goes NEGATIVE at seven nodes: an eight-node
  // graph laid its boxes on top of each other and off both slide edges, with every connector
  // struck through a label. Deriving the width instead means the row always fits, whatever the
  // node count, and only the boxes get smaller.
  const MARGIN = 0.5;
  const GUTTER = 0.25;
  const usable = 10 - MARGIN * 2;
  const w = Math.min(1.5, (usable - (count - 1) * GUTTER) / count);
  const x0 = (10 - (count * w + (count - 1) * GUTTER)) / 2;
  // Type has to come down with the box or it wraps onto a dangling single character.
  const fontSize = w >= 1.4 ? 14 : w >= 1.1 ? 12 : 10;
  const geometry = [];
  spec.nodes.forEach((node, index) => {
    const x = x0 + index * (w + GUTTER);
    // The shape name is how the post-processor finds this node's assigned cNvPr id.
    slide.addShape('roundRect', {
      x,
      y,
      w,
      h,
      fill: { color: 'FDFCFA' },
      line: { color: 'C76D54', width: 1.5 },
      objectName: `node-${node.id}`,
    });
    slide.addText(node.label, {
      x,
      y,
      w,
      h,
      align: 'center',
      valign: 'middle',
      fontSize,
      color: '221F1C',
    });
    geometry.push({
      id: node.id,
      xEmu: Math.round(x * EMU_PER_INCH),
      yEmu: Math.round(y * EMU_PER_INCH),
      wEmu: Math.round(w * EMU_PER_INCH),
      hEmu: Math.round(h * EMU_PER_INCH),
    });
  });
  return { geometry, edges: spec.edges };
}

function buildEquationPlaceholder(slide, spec) {
  // A marked text box the post-processor replaces with the OMML paragraph. PptxGenJS has no
  // equation API, so this reserves the shape; the <m:oMath> is spliced into the run afterward.
  slide.addText('[[OMML]]', {
    x: 0.5,
    y: 2.2,
    w: 9,
    h: 1.4,
    fontSize: 32,
    color: BRAND.ink,
    align: 'center',
  });
}

/**
 * Splice each equation's OMML into its slide XML, replacing the [[OMML]] marker's run. This is the
 * only way to get a native <m:oMath> into a PptxGenJS deck.
 */
async function injectOmml(buffer, equationSpecs) {
  if (equationSpecs.length === 0) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort();
  let injected = 0;
  for (const slidePath of slidePaths) {
    let xml = await zip.file(slidePath).async('string');
    if (!xml.includes('[[OMML]]')) continue;
    const omml = equationSpecs[injected]?.ommlBody;
    if (!omml) continue;
    // Replace the whole <a:p>...[[OMML]]...</a:p> paragraph with one carrying the oMath.
    //
    // The <a14:m> wrapper is not decoration. A bare <m:oMath> sitting directly inside <a:p> is
    // well-formed and passes a presence count, and no renderer draws it: PowerPoint showed the
    // fraction only because it is lenient, and LibreOffice deleted all ten <m:t> runs outright,
    // leaving a shape that still advertised an equation and rendered blank. a14:m is the element
    // both PowerPoint and LibreOffice actually WRITE, and it is what makes the maths survive.
    xml = xml.replace(
      /<a:p>(?:(?!<a:p>).)*?\[\[OMML\]\](?:(?!<\/a:p>).)*?<\/a:p>/s,
      `<a:p><a14:m>${omml}</a14:m><a:endParaRPr lang="en-US" dirty="0"/></a:p>`,
    );
    // Declare the math namespaces on the root if absent, so the part is well-formed. mc:Ignorable
    // lets a consumer that does not understand a14 skip the element instead of rejecting the file.
    if (!/xmlns:m=/.test(xml)) {
      xml = xml.replace(
        '<p:sld ',
        '<p:sld xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
          'xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" ' +
          'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="a14" ',
      );
    }
    zip.file(slidePath, xml);
    injected += 1;
  }
  if (injected !== equationSpecs.length) {
    throw new Error(`Expected to inject ${equationSpecs.length} equations, injected ${injected}.`);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Inject native <p:cxnSp> connectors for each diagram, bound to the node shapes via a:stCxn /
 * a:endCxn. A connector bound this way is a real relationship object — PowerPoint reroutes it when
 * a node moves — which is exactly what distinguishes it from a floating autoshape line.
 *
 * idx 3 = right connection site, idx 1 = left connection site of a roundRect (12 o'clock is 0,
 * clockwise). The xfrm is a bounding hint; PowerPoint recomputes the path from the bindings.
 */
async function injectConnectors(buffer, diagrams) {
  if (diagrams.length === 0) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort(
      (a, b) => Number.parseInt(a.match(/(\d+)/)[1], 10) - Number.parseInt(b.match(/(\d+)/)[1], 10),
    );

  let diagramIndex = 0;
  for (const slidePath of slidePaths) {
    let xml = await zip.file(slidePath).async('string');
    // A diagram slide is the one carrying our named node shapes.
    if (!/name="node-/.test(xml)) continue;
    const diagram = diagrams[diagramIndex];
    diagramIndex += 1;

    // Map each node id -> its assigned cNvPr id, read straight from the emitted XML.
    const idByNode = new Map();
    for (const m of xml.matchAll(/<p:cNvPr id="(\d+)" name="node-([a-z0-9-]+)"/g)) {
      idByNode.set(m[2], Number.parseInt(m[1], 10));
    }
    const geoById = new Map(diagram.geometry.map((g) => [g.id, g]));

    let nextId =
      Math.max(
        0,
        ...[...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => Number.parseInt(m[1], 10)),
      ) + 1;
    const connectors = diagram.edges
      .map(([from, to]) => {
        const fromId = idByNode.get(from);
        const toId = idByNode.get(to);
        const fromGeo = geoById.get(from);
        const toGeo = geoById.get(to);
        if (!fromId || !toId || !fromGeo || !toGeo) return '';
        const offX = fromGeo.xEmu + fromGeo.wEmu;
        const offY = fromGeo.yEmu + Math.round(fromGeo.hEmu / 2);
        const cx = Math.max(1, toGeo.xEmu - offX);
        const cy = 1;
        const id = nextId++;
        const nvPr = `<p:nvCxnSpPr><p:cNvPr id="${id}" name="edge-${from}-${to}"/><p:cNvCxnSpPr><a:stCxn id="${fromId}" idx="3"/><a:endCxn id="${toId}" idx="1"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>`;
        const spPr = `<p:spPr><a:xfrm><a:off x="${offX}" y="${offY}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="221F1C"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr>`;
        const style = `<p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>`;
        return `<p:cxnSp>${nvPr}${spPr}${style}</p:cxnSp>`;
      })
      .join('');

    // Connectors belong in the same spTree, after the shapes, before </p:spTree>.
    xml = xml.replace('</p:spTree>', `${connectors}</p:spTree>`);
    zip.file(slidePath, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Build the native deck into a buffer. Exported so tests can assert emission without file I/O. */
export async function buildNativeAtlasDeck(specs = ARTIFACT_SPECS) {
  const pptx = new Pptx();
  pptx.defineLayout({ name: 'A16x9', width: 10, height: 5.63 });
  pptx.layout = 'A16x9';

  const equationSpecs = [];
  const diagrams = [];
  specs.forEach((spec, index) => {
    const slide = pptx.addSlide();
    addHeader(slide, spec, index);
    if (spec.kind === 'bar' || spec.kind === 'line') buildChart(pptx, slide, spec);
    else if (spec.kind === 'table') buildTable(slide, spec);
    else if (spec.kind === 'equation') {
      buildEquationPlaceholder(slide, spec);
      equationSpecs.push(spec);
    } else if (spec.kind === 'diagram') {
      diagrams.push(buildDiagramNodes(slide, spec));
    }
  });

  const rawBuffer = await pptx.write('nodebuffer');
  const withOmml = await injectOmml(rawBuffer, equationSpecs);
  return injectConnectors(withOmml, diagrams);
}

export {
  ARTIFACT_SPECS,
  addHeader,
  buildChart,
  buildTable,
  buildDiagramNodes,
  buildEquationPlaceholder,
  injectOmml,
  injectConnectors,
  BRAND,
};

async function main() {
  const outFlagIndex = process.argv.indexOf('--out');
  const outPath =
    outFlagIndex >= 0 && process.argv[outFlagIndex + 1]
      ? path.resolve(process.argv[outFlagIndex + 1])
      : path.join(repoRoot, 'outputs/atlas-native/nodeslide-atlas-native.pptx');

  const finalBuffer = await buildNativeAtlasDeck();
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, finalBuffer);

  const check = await JSZip.loadAsync(finalBuffer);
  const chartParts = Object.keys(check.files).filter((p) => /ppt\/charts\/chart\d+\.xml$/.test(p));
  const slideXml = async (n) => check.file(`ppt/slides/slide${n}.xml`)?.async('string');
  const cxn = ((await slideXml(5)) ?? '').match(/<p:cxnSp>/g)?.length ?? 0;
  process.stdout.write(
    `Built ${ARTIFACT_SPECS.length} native artifact slides -> ${path.relative(repoRoot, outPath)}\n` +
      `  native chart parts: ${chartParts.length}; ` +
      `a:tbl=${/<a:tbl\b/.test((await slideXml(3)) ?? '')}; ` +
      `m:oMath=${/<m:oMath\b/.test((await slideXml(4)) ?? '')}; ` +
      `bound connectors=${cxn}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
