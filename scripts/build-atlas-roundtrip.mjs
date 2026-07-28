/**
 * Build the Atlas round-trip artefact — the missing owned generator.
 *
 * `outputs/atlas-v3-native/roundtrip-ppt.pptx` is the shipped v3 native deck after a pass through
 * LibreOffice, and it is the evidence behind every portability fact in `shared/nodeslideAtlas.ts`
 * (chart series survival, connector bindings, OMML survival). Until now it had NO generator: it
 * was produced by typing `soffice --headless --convert-to pptx` by hand (commit 2000458).
 *
 * That is why the playback canary found all 38 of its slides carrying an effect-less
 * <p:transition spd="slow" p14:dur="2000"/>. Nothing in this repo emitted them — the shipped deck
 * contains zero <p:transition>. LibreOffice's PPTX filter injects the pair onto every slide
 * unconditionally, and because no code produced the artefact, no code could inspect what the
 * converter had added. An ad-hoc command inherits a foreign tool's defaults silently.
 *
 * This script is that inspection stage, written down and repeatable:
 *
 *   stage 1  convert   soffice --headless --convert-to pptx      (skipped by --normalize-only)
 *   stage 2  normalize strip converter-injected effect-less <p:transition>   (always)
 *   stage 3  verify    re-read the result and report what it now contains
 *
 * Usage:
 *   node scripts/build-atlas-roundtrip.mjs                  # convert + normalize + verify
 *   node scripts/build-atlas-roundtrip.mjs --normalize-only # stage 2+3 on the committed artefact
 *   node scripts/build-atlas-roundtrip.mjs --check          # verify only; exit 1 if defects remain
 *
 * WHY --normalize-only IS THE DEFAULT WAY TO REFRESH THE COMMITTED FILE
 * ---------------------------------------------------------------------
 * Re-running stage 1 re-measures the deck, and the shipped deck has moved on since the artefact
 * was last cut (342 shapes today against the artefact's 340). A fresh conversion would therefore
 * change the portability counts recorded in shared/nodeslideAtlas.ts as a side effect of fixing a
 * transition defect — two unrelated changes in one diff, and a silent rewrite of measurements
 * nobody asked to re-measure. Stage 2 alone changes only the converter's injected noise and
 * leaves every measured count identical, which stage 3 asserts.
 *
 * Exit codes (read these, not the summary line):
 *   0  the artefact was written (or checked) and carries no effect-less transition
 *   1  defects remain after normalization, or --check found some
 *   2  not-run — soffice is unavailable, or the source deck is missing
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { analyzeSlide } from './lib/pptx-playback-structure.mjs';
import { stripVacuousTransitions } from './lib/pptx-transition-normalize.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(
  repoRoot,
  'outputs',
  'atlas-v3-native',
  'nodeslide-artifact-atlas-v3-native.pptx',
);
const OUT = path.join(repoRoot, 'outputs', 'atlas-v3-native', 'roundtrip-ppt.pptx');
const SOFFICE = process.env.SOFFICE || 'C:/Program Files/LibreOffice/program/soffice.com';

function flag(name, argv) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

/** Slide parts, in slide order. */
function slidePaths(zip) {
  return Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
}

/**
 * Read the facts that matter about a package, so a claim of "no defects" can be told apart from
 * "nothing was read". Every count below is observed; none is assumed.
 */
export async function surveyDeck(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const paths = slidePaths(zip);
  const survey = {
    slides: paths.length,
    shapes: 0,
    timingSlides: [],
    motionSlides: [],
    clickEffects: 0,
    transitionSlides: [],
    vacuousTransitionSlides: [],
    effectTransitionSlides: [],
  };
  for (const p of paths) {
    const n = Number(p.match(/\d+/)[0]);
    const s = analyzeSlide(await zip.file(p).async('string'), n);
    survey.shapes += s.shapes.length;
    if (s.hasTiming) survey.timingSlides.push(n);
    if (s.motionScenes.length > 0) survey.motionSlides.push(n);
    survey.clickEffects += s.clickEffects;
    if (s.transitions.length > 0) {
      survey.transitionSlides.push(n);
      const effects = s.transitions.flatMap((t) => t.effects);
      if (effects.length === 0) survey.vacuousTransitionSlides.push(n);
      else survey.effectTransitionSlides.push(n);
    }
  }
  return survey;
}

/** Stage 2 — strip converter-injected effect-less transitions from every slide part. */
export async function normalizePackage(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let removed = 0;
  let kept = 0;
  const touched = [];
  for (const p of slidePaths(zip)) {
    const before = await zip.file(p).async('string');
    const r = stripVacuousTransitions(before);
    removed += r.removed;
    kept += r.kept;
    if (r.xml !== before) {
      touched.push(Number(p.match(/\d+/)[0]));
      // createFolders:false — JSZip otherwise adds `ppt/` and `ppt/slides/` directory entries that
      // were not in the source package. They are inert, but an artefact diff should contain only
      // what the fix intended; two unexplained new ZIP entries are noise a reviewer must discount.
      zip.file(p, r.xml, { createFolders: false });
    }
  }
  const out = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  return { buffer: out, removed, kept, touched };
}

/** Stage 1 — LibreOffice conversion. Returns null when soffice is unavailable. */
async function convert(sourcePath) {
  if (!existsSync(SOFFICE)) return null;
  const dir = path.join(os.tmpdir(), `atlas-roundtrip-${process.pid}`);
  await mkdir(dir, { recursive: true });
  const r = spawnSync(
    SOFFICE,
    ['--headless', '--convert-to', 'pptx', '--outdir', dir, sourcePath],
    {
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) return null;
  const produced = path.join(dir, path.basename(sourcePath));
  if (!existsSync(produced)) return null;
  return readFile(produced);
}

function report(label, survey) {
  const lines = [`${label}`];
  lines.push(
    `  SENSOR  ${survey.slides} slide(s), ${survey.shapes} shape(s) read from the archive.`,
  );
  if (survey.slides === 0 || survey.shapes === 0) {
    lines.push('  The package yielded no slides or no shapes — nothing below is established.');
    return lines.join('\n');
  }
  lines.push(
    `  timing slides: ${survey.timingSlides.join(', ') || 'none'}   motion scenes: ${
      survey.motionSlides.join(', ') || 'none'
    }   clickEffects: ${survey.clickEffects}`,
  );
  lines.push(
    `  slides carrying <p:transition>: ${survey.transitionSlides.length}` +
      `  (naming an effect: ${survey.effectTransitionSlides.length},` +
      ` effect-less: ${survey.vacuousTransitionSlides.length})`,
  );
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const sourcePath = flag('source', argv) ?? SOURCE;
  const outPath = flag('out', argv) ?? OUT;
  const normalizeOnly = argv.includes('--normalize-only');
  const checkOnly = argv.includes('--check');

  const readFrom = normalizeOnly || checkOnly ? outPath : sourcePath;
  if (!existsSync(readFrom)) {
    process.stderr.write(`not-run: ${readFrom} does not exist.\n`);
    process.exit(2);
  }

  if (checkOnly) {
    const survey = await surveyDeck(await readFile(outPath));
    process.stdout.write(`${report(`CHECK ${path.relative(repoRoot, outPath)}`, survey)}\n`);
    if (survey.slides === 0 || survey.shapes === 0) process.exit(2);
    process.exit(survey.vacuousTransitionSlides.length > 0 ? 1 : 0);
  }

  let input;
  if (normalizeOnly) {
    input = await readFile(outPath);
    process.stdout.write('stage 1 convert  SKIPPED (--normalize-only)\n');
  } else {
    input = await convert(sourcePath);
    if (!input) {
      process.stderr.write(
        `not-run: LibreOffice conversion unavailable (looked for ${SOFFICE}; set SOFFICE to override).
To fix the committed artefact without re-measuring the deck, use --normalize-only.\n`,
      );
      process.exit(2);
    }
    process.stdout.write('stage 1 convert  OK\n');
  }

  const before = await surveyDeck(input);
  process.stdout.write(`${report('BEFORE', before)}\n`);
  if (before.slides === 0 || before.shapes === 0) {
    process.stderr.write(
      'not-run: the package has no slides or no shapes; refusing to grade it.\n',
    );
    process.exit(2);
  }

  const { buffer, removed, kept, touched } = await normalizePackage(input);
  process.stdout.write(
    `stage 2 normalize  removed ${removed} effect-less <p:transition> across ${touched.length} slide(s); kept ${kept} that name an effect\n`,
  );

  const after = await surveyDeck(buffer);
  process.stdout.write(`${report('AFTER', after)}\n`);

  // Stage 3 — the normalizer is allowed to remove transitions and nothing else. If any other
  // count moved, the tool did more than it claimed and the artefact must not be written.
  const invariants = [
    ['slides', before.slides, after.slides],
    ['shapes', before.shapes, after.shapes],
    ['timing slides', before.timingSlides.join(','), after.timingSlides.join(',')],
    ['motion slides', before.motionSlides.join(','), after.motionSlides.join(',')],
    ['clickEffects', before.clickEffects, after.clickEffects],
    [
      'transitions naming an effect',
      before.effectTransitionSlides.join(','),
      after.effectTransitionSlides.join(','),
    ],
  ];
  const broken = invariants.filter(([, a, b]) => String(a) !== String(b));
  if (broken.length > 0) {
    for (const [name, a, b] of broken) {
      process.stderr.write(`INVARIANT BROKEN  ${name}: ${a} -> ${b}\n`);
    }
    process.stderr.write('Refusing to write the artefact.\n');
    process.exit(1);
  }
  process.stdout.write(
    `stage 3 verify  ${invariants.length} invariant(s) held: only transitions changed\n`,
  );

  if (after.vacuousTransitionSlides.length > 0) {
    process.stderr.write(
      `FAIL: ${after.vacuousTransitionSlides.length} slide(s) still carry an effect-less transition.\n`,
    );
    process.exit(1);
  }

  await writeFile(outPath, buffer);
  process.stdout.write(`WROTE ${path.relative(repoRoot, outPath)}\n`);
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('build-atlas-roundtrip.mjs')) {
  await main();
}
