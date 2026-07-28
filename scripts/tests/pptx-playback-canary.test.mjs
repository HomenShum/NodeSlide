/**
 * Knockout proof for the PPTX playback canary.
 *
 * A check that has never been red is not a check. Every assertion the canary makes is proved here
 * by DELIBERATELY CORRUPTING a real shipped deck in exactly the way the assertion claims to catch,
 * confirming the canary goes red naming the slide and the defect, and confirming the unmutated
 * deck is still green — so the red is caused by the knockout and not by the harness.
 *
 * The subject is `outputs/atlas-v3-native/nodeslide-artifact-atlas-v3-native.pptx`, which is
 * tracked in git. The knockouts are applied to slide XML in memory; no file on disk is modified,
 * so there is nothing to restore and no way for a failed run to leave a corrupted artefact behind.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeSlide, decidePlayback } from '../lib/pptx-playback-structure.mjs';
import { readDeckSlides } from '../nodeslide-pptx-playback-canary.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DECK = path.join(
  repoRoot,
  'outputs',
  'atlas-v3-native',
  'nodeslide-artifact-atlas-v3-native.pptx',
);
const ROUNDTRIP = path.join(repoRoot, 'outputs', 'atlas-v3-native', 'roundtrip-ppt.pptx');
const MOTION_SLIDE = 21; // the slide the v3 native builder compiles a step build onto

/** Raw slide XML by slide number, straight out of the archive. */
async function loadSlideXml(deckPath) {
  const zip = await JSZip.loadAsync(await readFile(deckPath));
  const paths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const out = new Map();
  for (const p of paths) out.set(Number(p.match(/\d+/)[0]), await zip.file(p).async('string'));
  return out;
}

/** Decide over a map of slideNumber -> xml, optionally rewriting one slide first. */
function decide(xmlBySlide, mutate = null) {
  const slides = [];
  for (const [n, xml] of xmlBySlide) {
    slides.push(analyzeSlide(mutate ? mutate(xml, n) : xml, n));
  }
  return decidePlayback(slides, { deck: 'knockout-subject' });
}

function assertionOf(result, id) {
  const a = result.assertions.find((x) => x.id === id);
  expect(a, `assertion ${id} missing from the report`).toBeDefined();
  return a;
}

/** Every failure of a given defect kind, across all assertions. */
function defects(result, defect) {
  return result.assertions.flatMap((a) => a.failures.filter((f) => f.defect === defect));
}

describe('pptx playback canary — baseline is green and the sensor is armed', () => {
  let xmlBySlide;
  beforeAll(async () => {
    xmlBySlide = await loadSlideXml(DECK);
  });

  it('reads a real deck and reports a pass', () => {
    const result = decide(xmlBySlide);
    expect(result.verdict).toBe('pass');
  });

  // ARM THE SENSOR. If these subject counts were zero, every "no defect found" below would be
  // "nothing was looked at" — the two are indistinguishable to a reader who only sees green.
  it('has real subjects to grade, so a green result is not an empty one', () => {
    const result = decide(xmlBySlide);
    expect(result.slideCount).toBeGreaterThan(0);
    expect(result.shapeCount).toBeGreaterThan(0);
    expect(assertionOf(result, 'A1').subjects).toBeGreaterThan(0);
    expect(assertionOf(result, 'A2').subjects).toBeGreaterThan(0);
    expect(assertionOf(result, 'A3').subjects).toBeGreaterThan(0);
    expect(result.timedSlides).toContain(MOTION_SLIDE);
    expect(result.motionSlides).toContain(MOTION_SLIDE);
  });

  // An assertion with nothing to grade must say so rather than report green.
  it('marks assertions with no subject as no-subject, never as pass', () => {
    const result = decide(xmlBySlide);
    const a4 = assertionOf(result, 'A4');
    expect(a4.subjects).toBe(0);
    expect(a4.status).toBe('no-subject');
    expect(a4.notes.join(' ')).toMatch(/no subject/i);
  });
});

describe('pptx playback canary — knockouts, one per assertion', () => {
  let xmlBySlide;
  beforeAll(async () => {
    xmlBySlide = await loadSlideXml(DECK);
  });

  // ---- A1 : the vacuous pass ------------------------------------------------------------------
  // Empty the <p:tnLst>. The element is still present and still well-formed. Any check that greps
  // for "<p:timing>" stays green here. This one must not.
  it('A1 knockout: an emptied <p:tnLst> is caught, not passed', () => {
    const result = decide(xmlBySlide, (xml, n) =>
      n === MOTION_SLIDE ? xml.replace(/<p:tnLst>[\s\S]*<\/p:tnLst>/, '<p:tnLst/>') : xml,
    );
    expect(result.verdict).toBe('fail');
    const found = defects(result, 'timing-empty');
    expect(found).toHaveLength(1);
    expect(found[0].slide).toBe(MOTION_SLIDE);
    expect(found[0].detail).toMatch(/animating nothing/);
  });

  it('A1 knockout: a self-closed <p:timing/> scaffold is caught', () => {
    const result = decide(xmlBySlide, (xml, n) =>
      n === MOTION_SLIDE ? xml.replace(/<p:timing[\s\S]*?<\/p:timing>/, '<p:timing/>') : xml,
    );
    expect(result.verdict).toBe('fail');
    expect(defects(result, 'timing-empty').map((f) => f.slide)).toEqual([MOTION_SLIDE]);
  });

  // ---- A2 : the animation that targets nothing --------------------------------------------------
  // Corpus fixture #2 in OOXML form: structurally valid, visually nothing.
  it('A2 knockout: an animation repointed at a nonexistent spid is caught and named', () => {
    const result = decide(xmlBySlide, (xml, n) =>
      n === MOTION_SLIDE ? xml.replace(/<p:spTgt spid="8"\/>/, '<p:spTgt spid="99999"/>') : xml,
    );
    expect(result.verdict).toBe('fail');
    const found = defects(result, 'spid-unresolved');
    expect(found).toHaveLength(1);
    expect(found[0].slide).toBe(MOTION_SLIDE);
    expect(found[0].detail).toContain('99999');
  });

  it('A2 knockout: deleting the targeted shape is caught, not just repointing the target', () => {
    // The other direction of the same defect — the animation is untouched, the shape it names is
    // removed. A canary that only watched the timing tree would miss this entirely.
    const result = decide(xmlBySlide, (xml, n) =>
      n === MOTION_SLIDE
        ? xml.replace(
            /<p:cNvPr id="8" name="ns:motion:evidence-scrollytelling:state-2:capture"/,
            '<p:cNvPr id="777" name="ns:motion:evidence-scrollytelling:state-2:capture"',
          )
        : xml,
    );
    expect(result.verdict).toBe('fail');
    const found = defects(result, 'spid-unresolved');
    expect(found.map((f) => f.slide)).toContain(MOTION_SLIDE);
  });

  // ---- A3 : declared motion with no timing -------------------------------------------------------
  // The exported-deck form of "the preview animated and the file did not".
  it('A3 knockout: stripping <p:timing> from a slide that declares motion is caught', () => {
    const result = decide(xmlBySlide, (xml, n) =>
      n === MOTION_SLIDE ? xml.replace(/<p:timing[\s\S]*?<\/p:timing>/, '') : xml,
    );
    expect(result.verdict).toBe('fail');
    const found = defects(result, 'motion-declared-no-timing');
    expect(found).toHaveLength(1);
    expect(found[0].slide).toBe(MOTION_SLIDE);
    expect(found[0].detail).toMatch(/never advances|it never advances/);
  });

  // The shipped ruling is "step-build, not scrub": N states compile to N-1 click advances.
  // Demote one click step and the last state becomes unreachable by advancing.
  it('A3 knockout: a build one click short of its declared states is caught', () => {
    let done = false;
    const result = decide(xmlBySlide, (xml, n) => {
      if (n !== MOTION_SLIDE || done) return xml;
      done = true;
      return xml.replace('nodeType="clickEffect"', 'nodeType="withEffect"');
    });
    expect(result.verdict).toBe('fail');
    const found = defects(result, 'build-steps-short');
    expect(found).toHaveLength(1);
    expect(found[0].slide).toBe(MOTION_SLIDE);
    expect(found[0].detail).toMatch(/never reached by advancing/);
  });

  // ---- A4 : the transition that transitions nothing ------------------------------------------------
  it('A4 knockout: an effect-less <p:transition> is caught', () => {
    const result = decide(xmlBySlide, (xml, n) =>
      n === 1 ? xml.replace('</p:cSld>', '</p:cSld><p:transition spd="slow"/>') : xml,
    );
    expect(result.verdict).toBe('fail');
    const found = defects(result, 'transition-empty');
    expect(found).toHaveLength(1);
    expect(found[0].slide).toBe(1);
  });

  it('A4 positive control: a transition that names an effect passes', () => {
    const result = decide(xmlBySlide, (xml, n) =>
      n === 1
        ? xml.replace('</p:cSld>', '</p:cSld><p:transition spd="slow"><p:fade/></p:transition>')
        : xml,
    );
    expect(result.verdict).toBe('pass');
    const a4 = assertionOf(result, 'A4');
    expect(a4.subjects).toBe(1);
    expect(a4.status).toBe('pass');
    expect(a4.notes.join(' ')).toContain('fade');
  });

  it('A4 does not double-count an mc:AlternateContent Choice/Fallback pair as two subjects', () => {
    const result = decide(xmlBySlide, (xml, n) =>
      n === 1
        ? xml.replace(
            '</p:cSld>',
            '</p:cSld><mc:AlternateContent><mc:Choice Requires="p14">' +
              '<p:transition spd="slow"><p:fade/></p:transition></mc:Choice><mc:Fallback>' +
              '<p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>',
          )
        : xml,
    );
    expect(assertionOf(result, 'A4').subjects).toBe(1);
  });

  // ---- A5 : build list pointing at a ghost ----------------------------------------------------------
  it('A5 knockout: a <p:bldLst> step naming a nonexistent shape is caught', () => {
    const result = decide(xmlBySlide, (xml, n) =>
      n === MOTION_SLIDE
        ? xml.replace(
            '</p:timing>',
            '</p:timing><p:bldLst><p:bldP spid="424242" grpId="0"/></p:bldLst>',
          )
        : xml,
    );
    expect(result.verdict).toBe('fail');
    const found = defects(result, 'bld-spid-unresolved');
    expect(found).toHaveLength(1);
    expect(found[0].slide).toBe(MOTION_SLIDE);
    expect(found[0].detail).toContain('424242');
  });

  // ---- restore: the red was caused by the knockout, not by the harness ------------------------------
  it('restores: the unmutated deck is green again after every knockout above', () => {
    expect(decide(xmlBySlide).verdict).toBe('pass');
  });
});

describe('pptx playback canary — the sensor refuses to grade what it cannot see', () => {
  it('a deck with no slides is not-run, not pass', () => {
    const result = decidePlayback([], { deck: 'empty' });
    expect(result.verdict).toBe('not-run');
    expect(result.reason).toMatch(/no slides/);
  });

  it('a deck with slides but no shapes is not-run, not pass', () => {
    const result = decidePlayback(
      [analyzeSlide('<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>', 1)],
      { deck: 'shapeless' },
    );
    expect(result.verdict).toBe('not-run');
    expect(result.reason).toMatch(/no shapes/);
  });

  it('a deck with shapes but no playback structure is not-run, and says the claims are unfounded', () => {
    const xml =
      '<p:sld><p:cSld><p:spTree><p:cNvPr id="2" name="Title"/></p:spTree></p:cSld></p:sld>';
    const result = decidePlayback([analyzeSlide(xml, 1)], { deck: 'static' });
    expect(result.verdict).toBe('not-run');
    expect(result.reason).toMatch(/exporter emits no timing structure/);
    expect(result.reason).toMatch(/unfounded/);
  });

  // The headline refusal, in miniature: present, well-formed, animating nothing.
  it('the empty <p:timing> scaffold on an otherwise static slide is a FAIL, never a pass', () => {
    const xml =
      '<p:sld><p:cSld><p:spTree><p:cNvPr id="2" name="Title"/></p:spTree></p:cSld>' +
      '<p:timing><p:tnLst/></p:timing></p:sld>';
    const result = decidePlayback([analyzeSlide(xml, 1)], { deck: 'vacuous' });
    expect(result.verdict).toBe('fail');
    expect(defects(result, 'timing-empty')).toHaveLength(1);
  });

  it('commented-out timing is not counted as structure', () => {
    const xml =
      '<p:sld><p:cSld><p:spTree><p:cNvPr id="2" name="Title"/></p:spTree></p:cSld>' +
      '<!-- <p:timing><p:tnLst><p:set/></p:tnLst></p:timing> --></p:sld>';
    const result = decidePlayback([analyzeSlide(xml, 1)], { deck: 'commented' });
    expect(result.verdict).toBe('not-run');
  });
});

/**
 * The reader itself must be armed.
 *
 * A tool that looks real and returns a pass over nothing is the same defect as an empty
 * <p:tnLst>: well-formed, and inert. If readDeckSlides could return a plausible-looking empty
 * result for any input, every assertion above would be grading a fiction. These tests prove the
 * reader actually opened the archive and actually read those bytes.
 */
describe('pptx playback canary — the OOXML reader is not welded', () => {
  it('reads different decks as genuinely different, not as a constant', async () => {
    const a = await readDeckSlides(await readFile(DECK));
    const b = await readDeckSlides(
      await readFile(
        path.join(repoRoot, 'outputs', 'nodekit-showcase', 'nodekit-showcase-full.pptx'),
      ),
    );
    // If the reader were returning a fixed or fabricated result, these would match.
    expect(a.length).toBe(38);
    expect(b.length).toBe(84);
    expect(a.reduce((n, s) => n + s.shapes.length, 0)).not.toBe(
      b.reduce((n, s) => n + s.shapes.length, 0),
    );
    // And it must have read real shape names out of the XML, not invented placeholders.
    expect(a.flatMap((s) => s.shapes.map((x) => x.name))).toContain(
      'ns:motion:evidence-scrollytelling:pinned:scene',
    );
  });

  it('a valid ZIP that is not a PPTX yields no slides, and the canary says not-run', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'this is a zip, but it is not a presentation');
    const slides = await readDeckSlides(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(slides).toHaveLength(0);
    expect(decidePlayback(slides, { deck: 'not-a-deck' }).verdict).toBe('not-run');
  });

  it('a buffer that is not a ZIP at all throws rather than reporting an empty pass', async () => {
    await expect(readDeckSlides(Buffer.from('not a zip archive'))).rejects.toThrow();
  });
});

describe('pptx playback canary — regression lock on a defect found in a shipped artefact', () => {
  // roundtrip-ppt.pptx is tracked in this repo. Every one of its 38 slides carries a
  // <p:transition spd="slow" p14:dur="2000"/> with no effect child: a transition that advances the
  // slide and animates nothing. This test exists so that finding cannot silently disappear.
  it('roundtrip-ppt.pptx fails A4 on all 38 slides with effect-less transitions', async () => {
    const xmlBySlide = await loadSlideXml(ROUNDTRIP);
    const result = decide(xmlBySlide);
    expect(result.verdict).toBe('fail');
    const a4 = assertionOf(result, 'A4');
    expect(a4.status).toBe('fail');
    expect(a4.subjects).toBe(38);
    expect(a4.failures).toHaveLength(38);
    // Its timing tree is intact, so the failure is isolated to transitions — not a broken read.
    expect(assertionOf(result, 'A1').status).toBe('pass');
    expect(assertionOf(result, 'A2').status).toBe('pass');
    expect(assertionOf(result, 'A3').status).toBe('pass');
  });
});
