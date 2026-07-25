/**
 * Assemble the NodeKit showcase deck from candidates that were already verified.
 *
 * The Arena ran the matrix the design thread specified — "15 artifact types x 3 models x 2
 * directions = 90 candidate slides" — and wrote every result to disk. 84 runs exist, each a
 * one-slide PPTX beside a `nodeslide.artifact-showcase-receipt/v1` and a browser render. What was
 * never built is the deck that puts them in one place, so the only NodeKit showcase on disk was a
 * 10-slide file and the work looked undone.
 *
 * This assembles rather than regenerates. The candidates were produced by models that would answer
 * differently today; re-running them would produce a deck nobody has verified, and the receipts on
 * disk would no longer describe its slides. Copying the exact bytes that passed keeps every slide
 * the thing its receipt attests to.
 *
 * Usage:
 *   node scripts/build-nodekit-showcase.mjs [--runs <dir>] [--out <file>] [--limit N]
 *
 * Exits non-zero if the assembled slide count does not match the number of candidates taken, which
 * is the one failure a merge can hide — a slide that silently did not make it.
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const runsDir = String(
  flag('runs', 'artifacts/deck-gym/artifact-atlas-v1/runs'),
);
const outFile = String(flag('out', 'outputs/nodekit-showcase/nodekit-showcase-full.pptx'));
const limit = Number(flag('limit', 0)) || Infinity;

/** Read every run that has both an artifact and a receipt. A run missing either is not evidence. */
async function loadCandidates() {
  const entries = await readdir(runsDir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(runsDir, entry.name);
    const pptx = path.join(dir, 'artifact.pptx');
    const receiptPath = path.join(dir, 'receipt.json');
    if (!existsSync(pptx) || !existsSync(receiptPath)) continue;
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    out.push({ id: entry.name, pptx, receipt });
  }
  // Group by artifact type, then direction, then model — so the deck reads as a matrix walk rather
  // than as directory order, which is alphabetical by accident.
  out.sort(
    (a, b) =>
      String(a.receipt.artifactType).localeCompare(String(b.receipt.artifactType)) ||
      String(a.receipt.directionId).localeCompare(String(b.receipt.directionId)) ||
      String(a.receipt.model).localeCompare(String(b.receipt.model)),
  );
  return out;
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/**
 * Copy one candidate's slide, and everything that slide points at, into the target deck.
 *
 * Every part is renamed with a per-candidate prefix. Two candidates both shipping `chart1.xml` or
 * `image1.png` is the normal case, not the exception, and without namespacing the second silently
 * overwrites the first — which looks like a successful merge and renders the wrong chart.
 */
async function copySlide(target, sourceZip, index, state) {
  const slideName = 'ppt/slides/slide1.xml';
  const slideXml = await sourceZip.file(slideName)?.async('string');
  if (!slideXml) return null;

  const slideNo = index + 1;
  const relsName = 'ppt/slides/_rels/slide1.xml.rels';
  const relsXml = (await sourceZip.file(relsName)?.async('string')) ?? '';

  // Rewrite each relationship target that points at a real part we must carry across.
  let nextRels = relsXml;
  const targets = [...relsXml.matchAll(/Target="([^"]+)"/g)].map((m) => m[1]);
  for (const rawTarget of targets) {
    if (rawTarget.startsWith('http') || rawTarget.includes('slideLayout')) continue;
    const resolved = path.posix.normalize(path.posix.join('ppt/slides', rawTarget));
    const file = sourceZip.file(resolved);
    if (!file) continue;
    const ext = path.posix.extname(resolved);
    const dir = path.posix.dirname(resolved);
    const renamed = `${dir}/c${slideNo}_${path.posix.basename(resolved, ext)}${ext}`;
    target.file(renamed, await file.async('nodebuffer'));
    state.parts.add(renamed);
    const rel = path.posix.relative('ppt/slides', renamed);
    nextRels = nextRels.split(`Target="${rawTarget}"`).join(`Target="${rel}"`);

    // A chart carries its own rels (embedded workbook, colours, style). Carry those too.
    const childRels = sourceZip.file(`${dir}/_rels/${path.posix.basename(resolved)}.rels`);
    if (childRels) {
      let childXml = await childRels.async('string');
      for (const childTarget of [...childXml.matchAll(/Target="([^"]+)"/g)].map((m) => m[1])) {
        const childResolved = path.posix.normalize(path.posix.join(dir, childTarget));
        const childFile = sourceZip.file(childResolved);
        if (!childFile) continue;
        const childExt = path.posix.extname(childResolved);
        const childDir = path.posix.dirname(childResolved);
        const childRenamed = `${childDir}/c${slideNo}_${path.posix.basename(childResolved, childExt)}${childExt}`;
        target.file(childRenamed, await childFile.async('nodebuffer'));
        state.parts.add(childRenamed);
        childXml = childXml
          .split(`Target="${childTarget}"`)
          .join(`Target="${path.posix.relative(childDir, childRenamed)}"`);
      }
      target.file(`${dir}/_rels/${path.posix.basename(renamed)}.rels`, childXml);
    }
  }

  const outSlide = `ppt/slides/slide${slideNo}.xml`;
  target.file(outSlide, slideXml);
  target.file(`ppt/slides/_rels/slide${slideNo}.xml.rels`, nextRels);
  state.parts.add(outSlide);
  return outSlide;
}

const candidates = (await loadCandidates()).slice(0, limit);
if (candidates.length === 0) {
  process.stderr.write(`No candidates with both artifact.pptx and receipt.json under ${runsDir}\n`);
  process.exit(1);
}

// The first candidate donates the masters, layouts, and theme. Every candidate came from the same
// harness version, so their layouts are the same shape — asserted below rather than assumed.
const baseZip = await JSZip.loadAsync(await readFile(candidates[0].pptx));
const harnessVersions = new Set(candidates.map((c) => String(c.receipt.harnessVersion)));
if (harnessVersions.size > 1) {
  process.stderr.write(
    `Refusing to merge: candidates come from ${harnessVersions.size} harness versions (${[...harnessVersions].join(', ')}). Their layouts are not guaranteed to match, and a merged deck would render some slides against the wrong master.\n`,
  );
  process.exit(1);
}

const target = new JSZip();
const state = { parts: new Set() };

// Carry everything that is not a slide: masters, layouts, theme, props.
for (const [name, file] of Object.entries(baseZip.files)) {
  if (file.dir) continue;
  if (name.startsWith('ppt/slides/')) continue;
  if (name === '[Content_Types].xml') continue;
  if (name === 'ppt/_rels/presentation.xml.rels') continue;
  if (name === 'ppt/presentation.xml') continue;
  target.file(name, await file.async('nodebuffer'));
}

const slideNames = [];
for (let i = 0; i < candidates.length; i += 1) {
  const zip = i === 0 ? baseZip : await JSZip.loadAsync(await readFile(candidates[i].pptx));
  const name = await copySlide(target, zip, i, state);
  if (name) slideNames.push(name);
}

// presentation.xml.rels — one relationship per slide, plus whatever the base deck already had.
const baseRels = await baseZip.file('ppt/_rels/presentation.xml.rels').async('string');
const kept = [...baseRels.matchAll(/<Relationship[^>]*\/>/g)]
  .map((m) => m[0])
  .filter((r) => !r.includes('/slide') || r.includes('slideMaster'));
const slideRels = slideNames.map(
  (name, i) =>
    `<Relationship Id="rIdSlide${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/${path.posix.basename(name)}"/>`,
);
target.file(
  'ppt/_rels/presentation.xml.rels',
  `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${kept.join('')}${slideRels.join('')}</Relationships>`,
);

// presentation.xml — rebuild the slide id list; keep everything else the base deck declared.
const basePres = await baseZip.file('ppt/presentation.xml').async('string');
const sldIdLst = `<p:sldIdLst>${slideNames
  .map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdSlide${i + 1}"/>`)
  .join('')}</p:sldIdLst>`;
const nextPres = /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/.test(basePres)
  ? basePres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, sldIdLst)
  : basePres.replace(/(<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>)/, `$1${sldIdLst}`);
target.file('ppt/presentation.xml', nextPres);

// [Content_Types].xml — every part needs a declared type or PowerPoint refuses the file.
const baseTypes = await baseZip.file('[Content_Types].xml').async('string');
const defaults = [...baseTypes.matchAll(/<Default[^>]*\/>/g)].map((m) => m[0]);
const nonSlideOverrides = [...baseTypes.matchAll(/<Override[^>]*\/>/g)]
  .map((m) => m[0])
  .filter((o) => !o.includes('/ppt/slides/slide'));
const typeFor = (name) =>
  name.includes('/charts/chart')
    ? 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'
    : name.includes('/charts/colors')
      ? 'application/vnd.ms-office.chartcolorstyle+xml'
      : name.includes('/charts/style')
        ? 'application/vnd.ms-office.chartstyle+xml'
        : null;
const extraOverrides = [...state.parts]
  .filter((n) => n.endsWith('.xml') && !n.startsWith('ppt/slides/slide'))
  .map((n) => (typeFor(n) ? `<Override PartName="/${n}" ContentType="${typeFor(n)}"/>` : ''))
  .filter(Boolean);
const slideOverrides = slideNames.map(
  (n) =>
    `<Override PartName="/${n}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
);
target.file(
  '[Content_Types].xml',
  `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join('')}${nonSlideOverrides.join('')}${extraOverrides.join('')}${slideOverrides.join('')}</Types>`,
);

await mkdir(path.dirname(outFile), { recursive: true });
const buffer = await target.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
await writeFile(outFile, buffer);

// Read the file back and count what is actually in it. A merge that drops a slide still writes a
// valid file, so counting the input is not evidence — only counting the output is.
const verify = await JSZip.loadAsync(await readFile(outFile));
const written = Object.keys(verify.files).filter((n) =>
  /^ppt\/slides\/slide\d+\.xml$/.test(n),
).length;

const byType = new Map();
for (const c of candidates) {
  const key = String(c.receipt.artifactType);
  byType.set(key, (byType.get(key) ?? 0) + 1);
}

process.stdout.write(
  `NodeKit showcase assembled\n` +
    `  out          ${outFile}\n` +
    `  candidates   ${candidates.length}\n` +
    `  slides in file ${written}\n` +
    `  size         ${(buffer.length / 1024 / 1024).toFixed(2)} MB\n` +
    `  artifact types ${byType.size}\n` +
    `  directions   ${new Set(candidates.map((c) => c.receipt.directionId)).size}\n` +
    `  models       ${new Set(candidates.map((c) => c.receipt.model)).size}\n`,
);

if (written !== candidates.length) {
  process.stderr.write(
    `Slide count mismatch: took ${candidates.length} candidates but the file holds ${written}. A merge that loses a slide still writes a valid file, so this fails rather than reports success.\n`,
  );
  process.exit(1);
}
