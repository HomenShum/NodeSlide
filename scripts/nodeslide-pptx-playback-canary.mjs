/**
 * PPTX playback canary — proves an exported deck's timing structure is ACTIVE in the file.
 *
 * The council's ruling that produced this instrument:
 *
 *   "The video judge reviews the playback. It does not prove that the PPTX timing structure is
 *    active."
 *
 * NodeSlide's entire output is a .pptx. A rendered MP4 walkthrough, and a browser preview, are
 * both downstream of the same assumption — that what the app draws is what PowerPoint will play.
 * Motion Deception Corpus fixture #7 is precisely that failure: a video showing motion the
 * artefact does not contain. This canary removes the renderer from the loop entirely. A .pptx is
 * a ZIP of OOXML, so the timing tree can be read and asserted directly.
 *
 * It is the structural complement to scripts/nodeslide-motion-canary.mjs, which drives a real
 * PowerPoint and watches frames. That one proves playback and needs Windows + PowerPoint. This
 * one proves the file and runs anywhere.
 *
 * Usage:
 *   node scripts/nodeslide-pptx-playback-canary.mjs --pptx <deck.pptx> [--intent <intent.json>]
 *                                                   [--json <out.json>] [--quiet]
 *
 * Exit codes (read these, not the summary line):
 *   0  pass            at least one assertion had a subject, and none failed
 *   1  fail            a named slide carries a named structural defect, OR a supplied declaration
 *                      is unusable, OR the artefact contradicts the declaration
 *   2  not-run         nothing gradeable; the reason says which sensor found nothing
 *   3  not-applicable  the recipe declared this deck static and the artefact agrees
 *
 * 2 and 3 are both "nothing was graded", and they are deliberately different codes. 2 is an open
 * question that must block; 3 is an answered one that a gate may choose to accept. A consumer must
 * be able to tell them apart without parsing English out of the reason line.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import {
  EXIT,
  MOTION_INTENT_SCHEMA,
  analyzeSlide,
  decidePlayback,
  exitCodeFor,
  parseMotionIntent,
} from './lib/pptx-playback-structure.mjs';

function flag(name, argv) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

/** What this instrument is, and — just as loudly — what it is not. */
const SCOPE = `SCOPE — what this canary proves, and what it does not
  PROVES   the exported .pptx file declares a timing structure that is active: a <p:timing> tree
           containing real animation behaviours, targeting shapes that exist on the slide, with
           enough click steps for every declared build state, and transitions that name an effect.
  DOES NOT PROVE that PowerPoint renders any of it as intended. That requires a real PowerPoint
           runtime observing real frames — scripts/nodeslide-motion-canary.mjs, which is a
           separate instrument and reports separately. "Timing structure present" must never be
           read as "the animation works".
  DOES NOT PROVE the animation is well-designed, on-brand, or perceptible. It proves the file is
           not lying about containing one.
  INTENT   with --intent <file>, a recipe may declare that a deck (or a single scene inside it) was
           meant to be static. That turns the open question "no timing — was any wanted?" into an
           answered one, and is reported as not-applicable (exit 3), never as a pass. Without the
           flag nothing changes: an undeclared deck with no timing is still not-run (exit 2).
           A declaration is a CLAIM. If the artefact contradicts it, that is a defect (exit 1).`;

export async function readDeckSlides(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const paths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const slides = [];
  for (const p of paths) {
    const xml = await zip.file(p).async('string');
    slides.push(analyzeSlide(xml, Number(p.match(/\d+/)[0])));
  }
  return slides;
}

function render(result) {
  const lines = [];
  lines.push(`PPTX playback canary — ${result.deck}`);
  lines.push('='.repeat(72));
  lines.push(SCOPE);
  lines.push('');
  // ARM THE SENSOR FIRST. Every line below this one is a claim about what was or was not found;
  // this line is the proof that anything was looked at at all. "No marker found" and "the deck
  // never parsed" must never print the same way.
  lines.push(
    `SENSOR  ${result.slideCount} slide(s), ${result.shapeCount} shape(s) read from the archive.`,
  );
  lines.push(
    result.intent
      ? `INTENT  declared "${result.intent.mode}" by ${result.intent.source ?? result.intent.recipe ?? 'a supplied declaration'} for deck ${result.intent.deck}; ${result.intent.declaredStaticScenes.length} scene-level declaration(s).`
      : 'INTENT  none supplied (--intent absent). Silence is not a declaration: an undeclared deck with no timing stays not-run.',
  );
  if (result.verdict === 'not-run') {
    lines.push('');
    lines.push(`VERDICT not-run: ${result.reason}`);
    lines.push(
      'not-run is not a pass. Nothing was graded, so nothing about this deck is established.',
    );
    return lines.join('\n');
  }
  if (result.verdict === 'not-applicable' && result.assertions.length === 0) {
    lines.push('');
    lines.push(`VERDICT not-applicable (declared static): ${result.reason}`);
    lines.push(
      'not-applicable is not a pass either. It is an ANSWERED question — the recipe stated no motion',
    );
    lines.push(
      'was intended and the artefact agrees — where not-run is an open one. Exit 3, never 0.',
    );
    return lines.join('\n');
  }
  lines.push(
    `        slides carrying <p:timing>: ${(result.timedSlides ?? []).join(', ') || 'none'}`,
  );
  lines.push(
    `        slides declaring a motion scene: ${(result.motionSlides ?? []).join(', ') || 'none'}`,
  );
  lines.push(
    `        slides declared static (examined and excused): ${(result.excusedSlides ?? []).join(', ') || 'none'}`,
  );
  lines.push('');
  for (const a of result.assertions) {
    const mark = a.status === 'pass' ? 'PASS' : a.status === 'fail' ? 'FAIL' : 'NO-SUBJECT';
    lines.push(`${mark.padEnd(11)} ${a.id}  ${a.title}`);
    lines.push(`            subjects examined: ${a.subjects}`);
    for (const n of a.notes) lines.push(`            note: ${n}`);
    // Group by defect so 38 identical lines do not bury the one that differs. Every affected
    // slide is still named — a defect the reader cannot locate is not a reported defect.
    const byDefect = new Map();
    for (const f of a.failures) {
      if (!byDefect.has(f.defect)) byDefect.set(f.defect, { slides: [], detail: f.detail });
      byDefect.get(f.defect).slides.push(f.slide);
    }
    for (const [defect, g] of byDefect) {
      lines.push(
        `            [${defect}] slide(s) ${g.slides.join(', ')} (${g.slides.length}) — ${g.detail}`,
      );
    }
  }
  lines.push('');
  lines.push(`VERDICT ${result.verdict}: ${result.reason}`);
  if (result.assertions.some((a) => a.status === 'no-subject')) {
    lines.push(
      'Assertions marked NO-SUBJECT examined nothing. They are neither green nor red — they are silent.',
    );
  }
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const pptxPath = flag('pptx', argv);
  const intentPath = flag('intent', argv);
  const jsonPath = flag('json', argv);
  const quiet = argv.includes('--quiet');

  if (!pptxPath) {
    process.stderr.write(
      '--pptx <deck.pptx> is required.\n\n' +
        'This canary reads the exported artefact, not the source that produced it. Point it at a\n' +
        'file that shipped.\n',
    );
    process.exit(2);
  }

  let buffer;
  try {
    buffer = await readFile(pptxPath);
  } catch (error) {
    process.stderr.write(
      `not-run: cannot read ${pptxPath} (${error.code ?? error.message}).\nThe canary needs an exported deck. Build one first, e.g. \`npm run artifact-atlas:v3:finalize\`.\n`,
    );
    process.exit(2);
  }

  let slides;
  try {
    slides = await readDeckSlides(buffer);
  } catch (error) {
    process.stderr.write(
      `not-run: ${pptxPath} did not open as an OOXML package (${error.message}).\n`,
    );
    process.exit(2);
  }

  const deckName = path.basename(pptxPath);

  // A supplied-but-unusable declaration FAILS. It is not downgraded to not-run, because the caller
  // explicitly asked this canary to honour a statement of intent and it cannot: unreadable, wrong
  // schema, or written for a different deck. Quietly ignoring it would leave the operator believing
  // an intent was applied that never was — a blind gate that still prints a verdict.
  let intent = null;
  if (intentPath) {
    let raw;
    try {
      raw = JSON.parse(await readFile(intentPath, 'utf8'));
    } catch (error) {
      process.stderr.write(
        `fail: --intent ${intentPath} could not be read as JSON (${error.code ?? error.message}).\nThe declaration was applied but cannot be honoured, so no verdict about this deck is issued.\n`,
      );
      process.exit(EXIT.fail);
    }
    const parsed = parseMotionIntent(
      { ...raw, __source: path.basename(intentPath) },
      { deck: deckName },
    );
    if (!parsed.ok) {
      process.stderr.write(
        `fail: --intent ${intentPath} is not a usable ${MOTION_INTENT_SCHEMA} declaration for ${deckName}:\n${parsed.errors
          .map((e) => `  - ${e}\n`)
          .join(
            '',
          )}A declaration is a claim. An unusable claim is a defect, not a reason to grade softly.\n`,
      );
      process.exit(EXIT.fail);
    }
    intent = parsed.intent;
  }

  const result = decidePlayback(slides, { deck: deckName, intent });
  if (!quiet) process.stdout.write(`${render(result)}\n`);

  if (jsonPath) {
    await mkdir(path.dirname(path.resolve(jsonPath)), { recursive: true });
    await writeFile(
      jsonPath,
      `${JSON.stringify({ ...result, scope: SCOPE, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    if (!quiet) process.stdout.write(`\nJSON: ${jsonPath}\n`);
  }

  process.exit(exitCodeFor(result.verdict));
}

// Only run when invoked directly, so the test suite can import readDeckSlides.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('nodeslide-pptx-playback-canary.mjs')
) {
  await main();
}
