/**
 * Knockout proof for DECLARED STATIC INTENT.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `not-run: exporter emits no timing structure` is a correct verdict and an open question. It
 * cannot distinguish "motion was never intended here" from "motion was intended and got lost".
 * A recipe may now answer that question with a `nodeslide.motion-intent/v1` declaration, and the
 * canary reports an affirmative `not-applicable` (exit 3) when the artefact agrees with it.
 *
 * WHAT MUST STAY TRUE, AND IS PROVED BELOW BY BREAKING IT
 * ------------------------------------------------------
 *   K1  a deck declared static that DOES contain timing FAILS. A declaration is a claim, and a
 *       claim contradicted by its own artefact is a defect, never a pass.
 *   K2  an UNDECLARED deck with no timing still reports not-run. Declaring is opt-in; silence must
 *       never be read as a declaration, or the honest open question becomes a default pass.
 *   K3  a marker naming a scene no declaration knows about FAILS. An excuse nobody authored is a
 *       sticker that silences the gate.
 *   K4  a declared scene with no marker in the deck FAILS. The decision has to live INSIDE the
 *       artefact; recorded only in a sidecar file, the exported slide still shows nothing.
 *   K5  a marker on the wrong slide FAILS.
 *   K6  a declaration bound to another deck, or one the parser cannot honour, FAILS.
 *   K7  not-applicable is exit 3 — its own code, distinguishable from not-run's 2 by a shell that
 *       reads only the exit status and never the English reason line.
 *
 * ARMING THE SENSOR
 * -----------------
 * Every assertion about a marker is preceded by an assertion that the deck parsed and carries
 * slides and shapes. "No marker found" and "the deck never parsed" are different printed reasons,
 * and the tests below prove they stay different — a sensor that cannot fail to find things is not
 * a sensor.
 *
 * Fixture decks are synthesised in memory from OOXML strings, so the proof is repeatable from a
 * clean checkout and there is no binary to drift. The declarations under fixtures/motion-intent/
 * are real committed files, because the declaration IS the thing under test.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXIT,
  analyzeSlide,
  decidePlayback,
  exitCodeFor,
  parseMotionIntent,
} from '../lib/pptx-playback-structure.mjs';
import { readDeckSlides } from '../nodeslide-pptx-playback-canary.mjs';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const CANARY = path.join(repoRoot, 'scripts', 'nodeslide-pptx-playback-canary.mjs');
const FIXTURES = path.join(here, 'fixtures', 'motion-intent');

// --- deck synthesis -----------------------------------------------------------------------------

/** One shape, exactly as pptxgenjs names them. */
const shape = (id, name) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/></p:nvSpPr></p:sp>`;

/** A real step-build timing tree: one clickEffect targeting a shape that exists. */
const timing = (spid) =>
  `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq>${'<p:cTn id="2" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" nodeType="clickEffect">'}<p:childTnLst><p:set><p:cBhvr><p:cTn id="4"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:set></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;

const slideXml = (shapes, tail = '') =>
  `<p:sld><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld>${tail}</p:sld>`;

/** Parse a list of slide XML strings the same way the runner does. */
const decideOver = (xmls, opts = {}) =>
  decidePlayback(
    xmls.map((xml, i) => analyzeSlide(xml, i + 1)),
    opts,
  );

/** Write a real .pptx so the CLI (and therefore the exit code) can be exercised end to end. */
async function writeDeck(dir, name, xmls) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  xmls.forEach((xml, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, xml));
  const file = path.join(dir, name);
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return file;
}

/** Run the real CLI and return its EXIT CODE, never a summary line. */
async function runCanary(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CANARY, ...args], {
      cwd: repoRoot,
      maxBuffer: 1 << 24,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

/** `file` is a fixture name, or an absolute path for the shipped declaration. */
const loadIntent = async (file, deck) =>
  parseMotionIntent(
    JSON.parse(await readFile(path.isAbsolute(file) ? file : path.join(FIXTURES, file), 'utf8')),
    { deck },
  );

// --- the decks the knockouts act on ---------------------------------------------------------------

const STATIC_DECK = [
  slideXml([shape(2, 'Title'), shape(3, 'Body')]),
  slideXml([shape(2, 'Title'), shape(3, 'Poster')]),
];
// Same deck, one slide given a genuine timing tree — the artefact contradicting the declaration.
const STATIC_DECK_WITH_TIMING = [
  STATIC_DECK[0],
  slideXml([shape(2, 'Title'), shape(3, 'Poster')], timing(3)),
];
const SCENE_DECK = [
  slideXml(
    [
      shape(2, 'ns:motion:real-scene:pinned:scene'),
      shape(3, 'ns:motion:real-scene:state-1:source'),
      shape(4, 'ns:motion:real-scene:state-2:claim'),
    ],
    timing(4),
  ),
  slideXml([shape(2, 'Title'), shape(3, 'ns:motion:poster-only:declared-static')]),
];

let tmp;
beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'ns-intent-'));
});
afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

// -------------------------------------------------------------------------------------------------

describe('declared static — the sensor is armed before any marker is claimed absent', () => {
  it('reports "deck never parsed" and "no marker found" as DIFFERENT reasons', async () => {
    // A deck that never parsed: zero slides.
    const unparsed = decidePlayback([], { deck: 'not-a-deck' });
    expect(unparsed.verdict).toBe('not-run');
    expect(unparsed.reason).toMatch(/no slides/);
    expect(unparsed.slideCount).toBe(0);

    // A deck that parsed fine and simply carries no marker.
    const parsed = decideOver(STATIC_DECK, { deck: 'static' });
    expect(parsed.verdict).toBe('not-run');
    expect(parsed.reason).toMatch(/exporter emits no timing structure/);
    // The distinguishing evidence: this one counted real slides and real shapes.
    expect(parsed.slideCount).toBe(2);
    expect(parsed.shapeCount).toBe(4);
    expect(parsed.reason).not.toMatch(/no slides/);
  });

  it('refuses to reach the intent branch at all when it cannot see shapes', async () => {
    const intent = (
      await loadIntent('static-deck.motion-intent.json', 'declared-static-fixture.pptx')
    ).intent;
    const blind = decidePlayback([analyzeSlide('<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>', 1)], {
      deck: 'declared-static-fixture.pptx',
      intent,
    });
    // A declaration must NOT be able to produce an affirmative verdict over a deck nothing was
    // read from. Arming the sensor outranks honouring the claim.
    expect(blind.verdict).toBe('not-run');
    expect(blind.reason).toMatch(/no shapes/);
    expect(blind.verdict).not.toBe('not-applicable');
  });

  it('the fixture decks really do parse, so every knockout below grades something real', async () => {
    const file = await writeDeck(tmp, 'declared-static-fixture.pptx', STATIC_DECK);
    const slides = await readDeckSlides(await readFile(file));
    expect(slides).toHaveLength(2);
    expect(slides.reduce((n, s) => n + s.shapes.length, 0)).toBe(4);
  });
});

describe('declared static — the affirmative verdict', () => {
  it('K7: a declared-static deck whose artefact agrees is not-applicable at exit 3', async () => {
    const file = await writeDeck(tmp, 'declared-static-fixture.pptx', STATIC_DECK);
    const { code, stdout } = await runCanary([
      '--pptx',
      file,
      '--intent',
      path.join(FIXTURES, 'static-deck.motion-intent.json'),
    ]);
    expect(code).toBe(3);
    expect(code).toBe(EXIT.notApplicable);
    expect(stdout).toMatch(/VERDICT not-applicable \(declared static\)/);
    // It must say so affirmatively — "no motion was intended" — not merely stay quiet.
    expect(stdout).toMatch(/No motion was intended here, so none is missing/);
    // And the sensor line must still be printed, so the reader can see it looked at something.
    expect(stdout).toMatch(/SENSOR\s+2 slide\(s\), 4 shape\(s\)/);
  });

  it('exit 3 is distinguishable from exit 2 without reading a single word of prose', async () => {
    const deck = await writeDeck(tmp, 'declared-static-fixture.pptx', STATIC_DECK);
    const declared = await runCanary([
      '--pptx',
      deck,
      '--intent',
      path.join(FIXTURES, 'static-deck.motion-intent.json'),
    ]);
    const undeclared = await runCanary(['--pptx', deck]);
    // The whole argument for a separate code: a gate may accept the first and must block the
    // second, using nothing but `$?`.
    expect(declared.code).toBe(3);
    expect(undeclared.code).toBe(2);
    expect(declared.code).not.toBe(undeclared.code);
  });

  it('not-applicable is never 0 — nothing was graded, so nothing was proven', () => {
    expect(exitCodeFor('not-applicable')).toBe(3);
    expect(exitCodeFor('not-applicable')).not.toBe(EXIT.pass);
    expect(exitCodeFor('pass')).toBe(0);
    expect(exitCodeFor('fail')).toBe(1);
    expect(exitCodeFor('not-run')).toBe(2);
  });
});

describe('declared static — K1: the declaration is a claim, and the artefact outranks it', () => {
  it('a deck declared static that DOES carry timing fails, and names the slide', async () => {
    const intent = (
      await loadIntent('static-deck.motion-intent.json', 'declared-static-fixture.pptx')
    ).intent;
    const result = decideOver(STATIC_DECK_WITH_TIMING, {
      deck: 'declared-static-fixture.pptx',
      intent,
    });
    expect(result.verdict).toBe('fail');
    expect(result.reason).toMatch(/declared static, but the artefact animates/);
    const failures = result.assertions.flatMap((a) => a.failures);
    expect(failures.some((f) => f.defect === 'declared-static-contradicted')).toBe(true);
    expect(failures.map((f) => f.slide)).toContain(2);
  });

  it('and it fails through the real CLI at exit 1, not 3', async () => {
    const file = await writeDeck(tmp, 'declared-static-fixture.pptx', STATIC_DECK_WITH_TIMING);
    const { code } = await runCanary([
      '--pptx',
      file,
      '--intent',
      path.join(FIXTURES, 'static-deck.motion-intent.json'),
    ]);
    expect(code).toBe(1);
    expect(code).not.toBe(EXIT.notApplicable);
  });

  it('positive control: the SAME declaration over the untimed deck is not-applicable', async () => {
    const intent = (
      await loadIntent('static-deck.motion-intent.json', 'declared-static-fixture.pptx')
    ).intent;
    // Proves the red above came from the timing tree, not from the declaration or the harness.
    expect(decideOver(STATIC_DECK, { deck: 'declared-static-fixture.pptx', intent }).verdict).toBe(
      'not-applicable',
    );
  });
});

describe('declared static — K2: silence is never a declaration', () => {
  it('an undeclared deck with no timing still reports the open-question not-run', () => {
    const result = decideOver(STATIC_DECK, { deck: 'undeclared.pptx' });
    expect(result.verdict).toBe('not-run');
    expect(result.verdict).not.toBe('not-applicable');
    expect(result.intent).toBeNull();
    // The reason must point at the opt-in, so a reader knows the verdict is answerable.
    expect(result.reason).toMatch(/no motion-intent declaration was supplied/);
    expect(result.reason).toMatch(/silence is not a declaration/);
  });

  it('an undeclared EMPTY deck is not-run too, and says which sensor found nothing', () => {
    const empty = decidePlayback([], { deck: 'empty.pptx' });
    expect(empty.verdict).toBe('not-run');
    expect(empty.reason).toMatch(/no slides/);
  });

  it('through the CLI, an undeclared static deck exits 2', async () => {
    const file = await writeDeck(tmp, 'undeclared.pptx', STATIC_DECK);
    const { code, stdout } = await runCanary(['--pptx', file]);
    expect(code).toBe(2);
    expect(stdout).toMatch(/INTENT\s+none supplied/);
  });
});

describe('declared static — K3/K4/K5: the marker and the declaration must countersign each other', () => {
  it('K3: a marker naming a scene no declaration knows about fails', async () => {
    const intent = (await loadIntent('scene-declared.motion-intent.json', 'scene-fixture.pptx'))
      .intent;
    // Rename the marker's scene to one the declaration has never heard of.
    const deck = [
      SCENE_DECK[0],
      SCENE_DECK[1].replace(
        'ns:motion:poster-only:declared-static',
        'ns:motion:ghost:declared-static',
      ),
    ];
    const result = decideOver(deck, { deck: 'scene-fixture.pptx', intent });
    expect(result.verdict).toBe('fail');
    const found = result.assertions
      .flatMap((a) => a.failures)
      .filter((f) => f.defect === 'declared-static-undeclared');
    expect(found).toHaveLength(1);
    expect(found[0].slide).toBe(2);
    expect(found[0].detail).toMatch(/countersigned by the recipe/);
  });

  it('K3b: the same marker with NO declaration at all fails — a marker is not self-authorising', () => {
    const result = decideOver(SCENE_DECK, { deck: 'scene-fixture.pptx' });
    expect(result.verdict).toBe('fail');
    const found = result.assertions
      .flatMap((a) => a.failures)
      .filter((f) => f.defect === 'declared-static-undeclared');
    expect(found).toHaveLength(1);
    expect(found[0].detail).toMatch(/no motion-intent declaration was supplied/);
  });

  it('K4: a declared scene whose marker is absent from the deck fails', async () => {
    const intent = (await loadIntent('scene-declared.motion-intent.json', 'scene-fixture.pptx'))
      .intent;
    const deck = [SCENE_DECK[0], slideXml([shape(2, 'Title'), shape(3, 'Poster')])];
    const result = decideOver(deck, { deck: 'scene-fixture.pptx', intent });
    expect(result.verdict).toBe('fail');
    const found = result.assertions
      .flatMap((a) => a.failures)
      .filter((f) => f.defect === 'declared-static-marker-absent');
    expect(found).toHaveLength(1);
    expect(found[0].slide).toBe(2);
    expect(found[0].detail).toMatch(/next to the artefact and not inside it/);
    // The subject count must still include it. A vanished marker must not shrink the count and
    // make its own disappearance invisible.
    const a3 = result.assertions.find((a) => a.id === 'A3');
    expect(a3.subjects).toBe(2);
    expect(a3.status).toBe('fail');
  });

  it('K5: a marker sitting on a slide the declaration did not name fails', async () => {
    const intent = (await loadIntent('scene-declared.motion-intent.json', 'scene-fixture.pptx'))
      .intent;
    // Declaration says slide 2; put the marker on slide 3 instead.
    const deck = [
      SCENE_DECK[0],
      slideXml([shape(2, 'Title')]),
      slideXml([shape(2, 'Title'), shape(3, 'ns:motion:poster-only:declared-static')]),
    ];
    const result = decideOver(deck, { deck: 'scene-fixture.pptx', intent });
    expect(result.verdict).toBe('fail');
    const found = result.assertions
      .flatMap((a) => a.failures)
      .filter((f) => f.defect === 'declared-static-slide-mismatch');
    expect(found).toHaveLength(1);
    expect(found[0].detail).toMatch(/disagree about which slide was examined/);
  });

  it('K5b: a marker on a slide that also animates fails — both cannot be true', async () => {
    const intent = (await loadIntent('scene-declared.motion-intent.json', 'scene-fixture.pptx'))
      .intent;
    const deck = [
      SCENE_DECK[0],
      slideXml([shape(2, 'Title'), shape(3, 'ns:motion:poster-only:declared-static')], timing(3)),
    ];
    const result = decideOver(deck, { deck: 'scene-fixture.pptx', intent });
    expect(result.verdict).toBe('fail');
    expect(
      result.assertions
        .flatMap((a) => a.failures)
        .some((f) => f.defect === 'declared-static-contradicted'),
    ).toBe(true);
  });

  it('positive control: marker + matching declaration is examined-and-excused, and passes', async () => {
    const intent = (await loadIntent('scene-declared.motion-intent.json', 'scene-fixture.pptx'))
      .intent;
    const result = decideOver(SCENE_DECK, { deck: 'scene-fixture.pptx', intent });
    expect(result.verdict).toBe('pass');
    const a3 = result.assertions.find((a) => a.id === 'A3');
    // TWO subjects: the animated scene AND the excused one. The excused slide is counted as
    // examined, which is the entire point — before the marker it was invisible to this count.
    expect(a3.subjects).toBe(2);
    expect(a3.status).toBe('pass');
    expect(a3.notes.join(' ')).toMatch(/examined and excused/);
    expect(result.excusedSlides).toEqual([2]);
    // And the excused slide is NOT counted as a slide declaring motion.
    expect(result.motionSlides).toEqual([1]);
  });

  it('a deck whose ONLY subject is an excused scene is not-applicable, never pass', async () => {
    const intent = (await loadIntent('scene-declared.motion-intent.json', 'scene-fixture.pptx'))
      .intent;
    const deck = [
      slideXml([shape(2, 'Title')]),
      slideXml([shape(2, 'Title'), shape(3, 'ns:motion:poster-only:declared-static')]),
    ];
    const result = decideOver(deck, { deck: 'scene-fixture.pptx', intent });
    // Exit 0 here would hand "motion verified" to a deck containing no motion whatsoever.
    expect(result.verdict).toBe('not-applicable');
    expect(exitCodeFor(result.verdict)).toBe(3);
  });
});

describe('declared static — K6: an unusable declaration fails rather than being ignored', () => {
  it('a declaration bound to a different deck is rejected on the binding', async () => {
    const parsed = await loadIntent(
      'wrong-deck.motion-intent.json',
      'declared-static-fixture.pptx',
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.errors.join(' ')).toMatch(/deck mismatch/);
  });

  it('and the CLI exits 1 on it — never 3, and never a silent pass', async () => {
    const file = await writeDeck(tmp, 'declared-static-fixture.pptx', STATIC_DECK);
    const { code, stderr } = await runCanary([
      '--pptx',
      file,
      '--intent',
      path.join(FIXTURES, 'wrong-deck.motion-intent.json'),
    ]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/deck mismatch/);
  });

  it('a malformed declaration names every reason it cannot be honoured', async () => {
    const parsed = await loadIntent('malformed.motion-intent.json', 'declared-static-fixture.pptx');
    expect(parsed.ok).toBe(false);
    const joined = parsed.errors.join(' | ');
    expect(joined).toMatch(/schemaVersion/);
    expect(joined).toMatch(/intent is null/);
    expect(joined).toMatch(/slide must be a positive integer/);
  });

  it('an unreadable --intent path fails; it does not degrade to not-run', async () => {
    const file = await writeDeck(tmp, 'declared-static-fixture.pptx', STATIC_DECK);
    const { code, stderr } = await runCanary([
      '--pptx',
      file,
      '--intent',
      path.join(FIXTURES, 'no-such-file.json'),
    ]);
    expect(code).toBe(1);
    expect(code).not.toBe(2);
    expect(stderr).toMatch(/could not be read as JSON/);
  });

  it('a declaration missing its rationale is rejected — an unexplained claim is not auditable', () => {
    const parsed = parseMotionIntent(
      { schemaVersion: 'nodeslide.motion-intent/v1', deck: 'd.pptx', intent: 'static' },
      { deck: 'd.pptx' },
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.errors.join(' ')).toMatch(/requires a rationale/);
  });
});

describe('declared static — the marker cannot be produced by accident', () => {
  it('an almost-right name does not count as an excuse', () => {
    for (const name of [
      'ns:motion:scene:declared-static:extra',
      'ns:motion:scene:declared_static',
      'ns:motion:declared-static',
      'declared-static',
      'Image 0',
    ]) {
      const slide = analyzeSlide(slideXml([shape(2, name)]), 1);
      expect(slide.declaredStaticScenes, `"${name}" must not register as a marker`).toEqual([]);
    }
    // ...and the exact name does.
    expect(
      analyzeSlide(slideXml([shape(2, 'ns:motion:scene:declared-static')]), 1).declaredStaticScenes,
    ).toEqual(['scene']);
  });

  it('a commented-out marker is not counted as structure', () => {
    const xml =
      '<p:sld><p:cSld><p:spTree><p:cNvPr id="2" name="Title"/>' +
      '<!-- <p:cNvPr id="3" name="ns:motion:scene:declared-static"/> --></p:spTree></p:cSld></p:sld>';
    expect(analyzeSlide(xml, 1).declaredStaticScenes).toEqual([]);
  });
});

describe('declared static — the shipped Atlas deck', () => {
  const DECK = path.join(
    repoRoot,
    'outputs',
    'atlas-v3-native',
    'nodeslide-artifact-atlas-v3-native.pptx',
  );
  const INTENT = path.join(repoRoot, 'benchmarks/artifact-atlas/v2/atlas.motion-intent.json');

  it('parses, and carries the marker on the consciously-degraded slide 25', async () => {
    const slides = await readDeckSlides(await readFile(DECK));
    // ARM THE SENSOR before asserting anything about the marker.
    expect(slides).toHaveLength(38);
    expect(slides.reduce((n, s) => n + s.shapes.length, 0)).toBeGreaterThan(300);
    const slide25 = slides.find((s) => s.slide === 25);
    expect(slide25.declaredStaticScenes).toEqual(['interaction-clip']);
    // The hard constraint: the excuse must not have been implemented as animation.
    expect(slide25.hasTiming).toBe(false);
    expect(slides.filter((s) => s.hasTiming).map((s) => s.slide)).toEqual([21, 22]);
  });

  it('with its declaration, A3 counts slide 25 as examined-and-excused', async () => {
    const slides = await readDeckSlides(await readFile(DECK));
    const intent = (await loadIntent(INTENT, 'nodeslide-artifact-atlas-v3-native.pptx')).intent;
    const result = decidePlayback(slides, {
      deck: 'nodeslide-artifact-atlas-v3-native.pptx',
      intent,
    });
    expect(result.verdict).toBe('pass');
    const a3 = result.assertions.find((a) => a.id === 'A3');
    expect(a3.subjects).toBe(3); // 2 animated scenes + 1 examined-and-excused
    expect(a3.status).toBe('pass');
    expect(result.excusedSlides).toEqual([25]);
  });

  it('without its declaration the same deck FAILS — the marker is not self-authorising', async () => {
    const { code, stdout } = await runCanary(['--pptx', DECK]);
    expect(code).toBe(1);
    expect(stdout).toMatch(/declared-static-undeclared/);
  });

  it('and with it, the CLI exits 0', async () => {
    const { code } = await runCanary(['--pptx', DECK, '--intent', INTENT]);
    expect(code).toBe(0);
  });
});
