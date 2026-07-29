/**
 * Remove converter-injected <p:transition> elements that name no visual effect.
 *
 * WHY THIS EXISTS
 * ---------------
 * `outputs/atlas-v3-native/roundtrip-ppt.pptx` failed the playback canary's A4 assertion on all
 * 38 of its slides: every slide carried
 *
 *     <mc:AlternateContent>
 *       <mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="2000"/></mc:Choice>
 *       <mc:Fallback><p:transition spd="slow"/></mc:Fallback>
 *     </mc:AlternateContent>
 *
 * A <p:transition> with no effect child is the "None" transition wearing a duration attribute. It
 * is structurally valid OOXML and it plays nothing: PowerPoint cuts instantly while the file
 * claims a two-second transition. It is the transition-shaped twin of an empty <p:tnLst>.
 *
 * WHERE IT CAME FROM — measured, not assumed
 * ------------------------------------------
 * Not from us. `scripts/build-atlas-v3-native.mjs` emits ZERO <p:transition>; the shipped deck
 * `nodeslide-artifact-atlas-v3-native.pptx` contains none. The round-trip artefact is that same
 * deck passed through `soffice --headless --convert-to pptx` (commit 2000458), and LibreOffice
 * Impress's PPTX filter writes this pair onto EVERY slide unconditionally, whether or not the
 * source declared a transition. Re-running that conversion on the current 0-transition deck
 * reproduces all 38 injections exactly — see scripts/tests/pptx-transition-normalize.test.mjs.
 *
 * So the root cause is not a bad emitter. It is that a tracked artefact was produced by an ad-hoc
 * external command with no owned generator, and therefore inherited that tool's defaults with no
 * stage that could inspect them. `scripts/build-atlas-roundtrip.mjs` is that missing generator;
 * this module is its normalization stage.
 *
 * WHY REMOVAL AND NOT A REAL EFFECT
 * ---------------------------------
 * The v3 recipe specifies no slide transitions anywhere. Its motion is compiled to <p:timing>
 * step-builds on the slides whose fixtures declare `kind: "motion"` — that is the shipped ruling,
 * "step-build, not scrub". Inventing a <p:fade/> here would manufacture motion the recipe never
 * asked for purely to turn a canary green, which is the inversion of the point. An absent
 * transition is honest. A declared one that does nothing is a false claim in the artefact.
 *
 * WHAT IS DELIBERATELY NOT TOUCHED
 * --------------------------------
 * A transition that DOES name an effect is preserved untouched — this normalizer must never be
 * able to delete real motion. So is every <p:timing> tree, every shape, and every other part of
 * the package. The definition of "names an effect" is imported from the canary's own decision
 * layer rather than restated, so the normalizer and the gate can never drift apart.
 */

import { transitionEffects } from './pptx-playback-structure.mjs';

/** Byte ranges covered by XML comments, so commented-out markup is never rewritten. */
function commentRanges(xml) {
  const ranges = [];
  for (const m of xml.matchAll(/<!--[\s\S]*?-->/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function inside(ranges, index) {
  return ranges.some(([a, b]) => index >= a && index < b);
}

/**
 * An <mc:AlternateContent> block whose Choice/Fallback shells are now empty carried nothing but
 * the transition we just removed. Left behind it is inert, but it is also a lie in miniature —
 * a container advertising alternate representations of nothing. Remove it too.
 */
function isEmptyAlternateContent(block) {
  const inner = block
    .replace(/^<mc:AlternateContent(?:\s[^>]*)?>/, '')
    .replace(/<\/mc:AlternateContent>$/, '')
    .replace(/<mc:Choice(?:\s[^>]*)?>|<\/mc:Choice>|<mc:Fallback(?:\s[^>]*)?>|<\/mc:Fallback>/g, '')
    .trim();
  return inner === '';
}

/**
 * Strip every effect-less <p:transition> from one slide's XML.
 *
 * Returns `{ xml, removed, kept }` — `removed` is how many transition elements were dropped and
 * `kept` how many were preserved because they name a real effect. Callers report both, so
 * "nothing was removed" can never be confused with "nothing was examined".
 */
export function stripVacuousTransitions(xml) {
  if (typeof xml !== 'string' || xml.length === 0) {
    return { xml: typeof xml === 'string' ? xml : '', removed: 0, kept: 0 };
  }
  const comments = commentRanges(xml);
  const matches = [...xml.matchAll(/<p:transition(?:\s[^>]*?)?(?:\/>|>[\s\S]*?<\/p:transition>)/g)];

  let removed = 0;
  let kept = 0;
  const cuts = [];
  for (const m of matches) {
    if (inside(comments, m.index)) continue;
    if (transitionEffects(m[0]).length > 0) {
      kept += 1;
      continue;
    }
    removed += 1;
    cuts.push([m.index, m.index + m[0].length]);
  }
  if (cuts.length === 0) return { xml, removed, kept };

  // Splice from the end so earlier offsets stay valid.
  let out = xml;
  for (const [start, end] of cuts.reverse()) {
    out = out.slice(0, start) + out.slice(end);
  }

  // Second pass: drop AlternateContent wrappers that existed only to hold those transitions.
  out = out.replace(/<mc:AlternateContent(?:\s[^>]*)?>[\s\S]*?<\/mc:AlternateContent>/g, (block) =>
    isEmptyAlternateContent(block) ? '' : block,
  );

  return { xml: out, removed, kept };
}
