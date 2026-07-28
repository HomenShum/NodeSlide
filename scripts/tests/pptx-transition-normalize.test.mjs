/**
 * Proof for the round-trip transition normalizer.
 *
 * The persona is the person who regenerates `outputs/atlas-v3-native/roundtrip-ppt.pptx` and then
 * has to answer "did that tool delete anything it should not have?". Every test below is built so
 * that a normalizer which simply deleted all transitions, or which deleted nothing, would fail.
 *
 * The load-bearing one is `a transition naming a real effect is preserved`. Without it, "the
 * canary is green" and "the normalizer nuked the evidence" are the same observation.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { normalizePackage, surveyDeck } from '../build-atlas-roundtrip.mjs';
import { stripVacuousTransitions } from '../lib/pptx-transition-normalize.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUNDTRIP = path.join(repoRoot, 'outputs', 'atlas-v3-native', 'roundtrip-ppt.pptx');
const SHIPPED = path.join(
  repoRoot,
  'outputs',
  'atlas-v3-native',
  'nodeslide-artifact-atlas-v3-native.pptx',
);

/** Exactly what LibreOffice Impress's PPTX filter writes onto every slide it exports. */
const LIBREOFFICE_INJECTION =
  '<mc:AlternateContent><mc:Choice Requires="p14">' +
  '<p:transition spd="slow" p14:dur="2000"></p:transition></mc:Choice>' +
  '<mc:Fallback><p:transition spd="slow"></p:transition></mc:Fallback></mc:AlternateContent>';

const SLIDE_HEAD =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld><p:cSld><p:spTree>' +
  '<p:cNvPr id="2" name="ns:motion:demo:state-1"/></p:spTree></p:cSld>';

const SLIDE = (body) => `${SLIDE_HEAD}${body}</p:sld>`;

describe('stripVacuousTransitions — removes the false claim, never the real one', () => {
  it('removes the LibreOffice injection and the wrapper that only held it', () => {
    const before = SLIDE(LIBREOFFICE_INJECTION);
    const { xml, removed, kept } = stripVacuousTransitions(before);
    expect(removed).toBe(2); // the p14 Choice and the legacy Fallback describe one transition
    expect(kept).toBe(0);
    expect(xml).not.toContain('<p:transition');
    expect(xml).not.toContain('<mc:AlternateContent>');
    // Everything that is not the transition survives untouched.
    expect(xml).toBe(SLIDE(''));
  });

  it('PRESERVES a transition that names a real effect — the knockout', () => {
    const real = '<p:transition spd="slow"><p:fade/></p:transition>';
    const { xml, removed, kept } = stripVacuousTransitions(SLIDE(real));
    expect(removed).toBe(0);
    expect(kept).toBe(1);
    expect(xml).toContain('<p:fade/>');
    expect(xml).toBe(SLIDE(real));
  });

  it('keeps the effect half of a mixed AlternateContent and drops only the empty half', () => {
    const mixed =
      '<mc:AlternateContent><mc:Choice Requires="p14">' +
      '<p:transition spd="slow" p14:dur="2000"><p:fade/></p:transition></mc:Choice>' +
      '<mc:Fallback><p:transition spd="slow"></p:transition></mc:Fallback></mc:AlternateContent>';
    const { xml, removed, kept } = stripVacuousTransitions(SLIDE(mixed));
    expect(removed).toBe(1);
    expect(kept).toBe(1);
    expect(xml).toContain('<p:fade/>');
    // The wrapper still holds a real effect, so it must survive.
    expect(xml).toContain('<mc:AlternateContent>');
  });

  it('treats a sound-only transition as effect-less, because sound is not motion', () => {
    const sound = '<p:transition spd="slow"><p:sndAc/></p:transition>';
    const { removed, kept } = stripVacuousTransitions(SLIDE(sound));
    expect(removed).toBe(1);
    expect(kept).toBe(0);
  });

  it('DOCUMENTED LIMITATION: a nested <p:stSnd/> is read as an effect and survives', () => {
    // The shared definition of "names an effect" lives in pptx-playback-structure.mjs and scans
    // every descendant of <p:transition>, exempting only the top-level names sndAc and extLst. A
    // sound action with a child therefore looks like an effect to it, so this sound-only
    // transition is PRESERVED here and would pass the canary's A4.
    //
    // This test is not an endorsement. It pins the current behaviour so the leniency is a recorded
    // fact rather than a surprise, and so that tightening A4 later shows up as a deliberate change
    // to this expectation. The normalizer deliberately does not carry a second, stricter opinion:
    // one definition shared with the gate is worth more than two that can drift apart.
    const nested = '<p:transition spd="slow"><p:sndAc><p:stSnd/></p:sndAc></p:transition>';
    const { removed, kept } = stripVacuousTransitions(SLIDE(nested));
    expect(removed).toBe(0);
    expect(kept).toBe(1);
  });

  it('removes a self-closed <p:transition/>', () => {
    const { xml, removed } = stripVacuousTransitions(SLIDE('<p:transition spd="slow"/>'));
    expect(removed).toBe(1);
    expect(xml).not.toContain('<p:transition');
  });

  it('never rewrites markup inside an XML comment', () => {
    const commented = SLIDE('<!-- <p:transition spd="slow"></p:transition> -->');
    const { xml, removed, kept } = stripVacuousTransitions(commented);
    expect(removed).toBe(0);
    expect(kept).toBe(0);
    expect(xml).toBe(commented);
  });

  it('leaves a slide that never had a transition byte-identical', () => {
    const plain = SLIDE('<p:timing><p:tnLst/></p:timing>');
    const { xml, removed, kept } = stripVacuousTransitions(plain);
    expect(removed).toBe(0);
    expect(kept).toBe(0);
    expect(xml).toBe(plain);
  });

  it('is idempotent — a second pass changes nothing and removes nothing', () => {
    const once = stripVacuousTransitions(SLIDE(LIBREOFFICE_INJECTION));
    const twice = stripVacuousTransitions(once.xml);
    expect(twice.xml).toBe(once.xml);
    expect(twice.removed).toBe(0);
  });

  it('survives degenerate input rather than throwing', () => {
    expect(stripVacuousTransitions('').removed).toBe(0);
    expect(stripVacuousTransitions(undefined).xml).toBe('');
  });
});

describe('the shipped deck was never the source of the defect', () => {
  it('nodeslide-artifact-atlas-v3-native.pptx carries zero <p:transition> to begin with', async () => {
    const survey = await surveyDeck(await readFile(SHIPPED));
    // Arm the sensor first: a zero transition count means nothing if the deck did not parse.
    expect(survey.slides).toBe(38);
    expect(survey.shapes).toBeGreaterThan(300);
    expect(survey.transitionSlides).toHaveLength(0);
    // And its real motion is present, so "no transitions" is a design choice, not an empty deck.
    expect(survey.timingSlides).toEqual([21, 22]);
    expect(survey.clickEffects).toBe(8);
  });
});

describe('the committed round-trip artefact, after the generator was fixed', () => {
  let survey;
  beforeAll(async () => {
    survey = await surveyDeck(await readFile(ROUNDTRIP));
  });

  it('parsed as a deck before any claim is made about its transitions', () => {
    expect(survey.slides).toBe(38);
    expect(survey.shapes).toBeGreaterThan(300);
  });

  it('carries no effect-less <p:transition> on any slide', () => {
    expect(survey.vacuousTransitionSlides).toEqual([]);
  });

  it('still carries the step-build timing that the round trip was measuring', () => {
    // This is the regression that matters: the fix removed a converter default, not our motion.
    expect(survey.timingSlides).toEqual([21, 22]);
    expect(survey.motionSlides).toEqual([21, 22]);
    expect(survey.clickEffects).toBe(8);
  });

  it('normalizing it again is a no-op, proving the committed bytes are the generator output', async () => {
    const { removed } = await normalizePackage(await readFile(ROUNDTRIP));
    expect(removed).toBe(0);
  });
});

describe('normalizePackage over a whole package', () => {
  it('removes injections from every slide and leaves shapes and timing alone', async () => {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types/>',
    );
    for (let n = 1; n <= 3; n += 1) {
      zip.file(`ppt/slides/slide${n}.xml`, SLIDE(LIBREOFFICE_INJECTION));
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const before = await surveyDeck(buffer);
    expect(before.slides).toBe(3);
    expect(before.vacuousTransitionSlides).toEqual([1, 2, 3]);

    const result = await normalizePackage(buffer);
    expect(result.removed).toBe(6);
    expect(result.touched).toEqual([1, 2, 3]);

    const after = await surveyDeck(result.buffer);
    expect(after.vacuousTransitionSlides).toEqual([]);
    expect(after.shapes).toBe(before.shapes);
    expect(after.slides).toBe(before.slides);
  });
});
