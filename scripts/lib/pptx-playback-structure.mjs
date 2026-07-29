/**
 * PPTX playback structure — the pure decision layer behind the playback canary.
 *
 * WHY THIS EXISTS
 * ---------------
 * The council's ruling on the video judge was blunt: "The video judge reviews the playback. It
 * does not prove that the PPTX timing structure is active." A browser preview and a rendered MP4
 * are both downstream of the same assumption — that what the app draws is what PowerPoint will
 * play. Motion Deception Corpus fixture #7 is exactly that gap: a video showing motion the
 * artefact does not contain.
 *
 * NodeSlide's whole output is a .pptx. A .pptx is a ZIP of OOXML. So the timing structure is
 * readable, and can be asserted directly, with no renderer in the loop at all. This module holds
 * the assertions; the runner holds the I/O.
 *
 * THE VACUOUS PASS THIS IS BUILT TO REFUSE
 * ----------------------------------------
 * `<p:timing><p:tnLst/></p:timing>` is well-formed, present, schema-valid, and animates nothing.
 * PowerPoint writes that empty scaffold onto ordinary slides. Any check that greps for
 * `<p:timing>` therefore passes on a deck with zero animation. Every assertion below is
 * separately reported with its SUBJECT COUNT, so "0 failures" can never be confused with
 * "0 things looked at" — that welded-sensor failure is the one this file is shaped around.
 *
 * WHAT IT PROVES / WHAT IT DOES NOT
 * ---------------------------------
 * Proves: the file's declared timing tree exists, contains real animation behaviours, targets
 * shapes that exist, and — where the deck declares a step-build — carries enough click steps.
 * Does NOT prove: that PowerPoint renders any of it as intended. That needs a real PowerPoint
 * runtime, which is what scripts/nodeslide-motion-canary.mjs does separately. Structure present
 * is not motion observed. The runner prints both halves of that sentence.
 */

/** Animation BEHAVIOUR elements. A timing tree containing none of these animates nothing. */
const BEHAVIOUR_NODES = [
  'set',
  'anim',
  'animClr',
  'animEffect',
  'animMotion',
  'animRot',
  'animScale',
  'cmd',
];

/**
 * Elements that may appear inside <p:transition> without being a visual effect.
 * A transition carrying only these is the "None" transition wearing a duration.
 */
const NON_EFFECT_TRANSITION_CHILDREN = new Set(['sndAc', 'extLst']);

/** Shapes named by the v3 native builder to mark a declared motion scene. */
const MOTION_STATE_NAME = /^ns:motion:(.+):state-(\d+)(?::|$)/;
const MOTION_PINNED_NAME = /^ns:motion:(.+):pinned(?::|$)/;

/** Strip every comment so commented-out XML cannot be counted as structure. */
function stripComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/** Extract the first <p:timing>...</p:timing> block, or null. Handles a self-closed element. */
export function extractTiming(xml) {
  const selfClosed = /<p:timing\s*\/>/.exec(xml);
  const paired = /<p:timing(?:\s[^>]*)?>[\s\S]*?<\/p:timing>/.exec(xml);
  if (paired) return paired[0];
  if (selfClosed) return selfClosed[0];
  return null;
}

/** Extract <p:transition .../> or <p:transition>...</p:transition> blocks. */
export function extractTransitions(xml) {
  return [...xml.matchAll(/<p:transition(\s[^>]*?)?(\/>|>[\s\S]*?<\/p:transition>)/g)].map(
    (m) => m[0],
  );
}

/**
 * Every shape id declared on the slide. An animation target must land in this set, otherwise it
 * points at nothing — the OOXML form of corpus fixture #2, an animation aimed at a decoy.
 */
export function slideShapes(xml) {
  return [...xml.matchAll(/<p:cNvPr\s+id="(\d+)"\s+name="([^"]*)"/g)].map((m) => ({
    id: m[1],
    name: m[2],
  }));
}

/** Count of real animation behaviour nodes inside a timing block. */
export function behaviourNodes(timingXml) {
  if (!timingXml) return [];
  const found = [];
  for (const node of BEHAVIOUR_NODES) {
    const re = new RegExp(`<p:${node}(?=[\\s/>])`, 'g');
    const hits = timingXml.match(re);
    if (hits) found.push({ node, count: hits.length });
  }
  return found;
}

/** Every shape id an animation targets, via <p:spTgt spid="N"/>. */
export function timingTargets(timingXml) {
  if (!timingXml) return [];
  return [...timingXml.matchAll(/<p:spTgt\s+spid="(\d+)"/g)].map((m) => m[1]);
}

/** Click-advanced effects — the step-build steps. */
export function clickEffectCount(timingXml) {
  if (!timingXml) return 0;
  return (timingXml.match(/nodeType="clickEffect"/g) ?? []).length;
}

/** Build-list targets, if the deck declares a step build via <p:bldLst>. */
export function buildTargets(xml) {
  const block = /<p:bldLst>[\s\S]*?<\/p:bldLst>/.exec(xml);
  if (!block) return null;
  return [...block[0].matchAll(/<p:bld(?:P|Graphic|DgM|OleChart)\s[^>]*spid="(\d+)"/g)].map(
    (m) => m[1],
  );
}

/** Does a transition block actually name a visual effect, or is it an empty shell? */
export function transitionEffects(transitionXml) {
  const inner = /<p:transition(?:\s[^>]*)?>([\s\S]*)<\/p:transition>/.exec(transitionXml);
  if (!inner) return []; // self-closing <p:transition/> — no children at all
  const effects = [];
  for (const m of inner[1].matchAll(/<(?:p|p14|p15)?:?([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g)) {
    const name = m[1];
    if (NON_EFFECT_TRANSITION_CHILDREN.has(name)) continue;
    effects.push(name);
  }
  return effects;
}

/**
 * Parse one slide into the facts the assertions consume.
 * Everything here is an observation; no judgement is made until decidePlayback.
 */
export function analyzeSlide(rawXml, slideNumber) {
  const xml = stripComments(rawXml);
  const timing = extractTiming(xml);
  const shapes = slideShapes(xml);
  const motionStates = [];
  const motionScenes = new Set();
  for (const shape of shapes) {
    const state = MOTION_STATE_NAME.exec(shape.name);
    if (state) {
      motionScenes.add(state[1]);
      motionStates.push({ id: shape.id, scene: state[1], index: Number(state[2]) });
      continue;
    }
    const pinned = MOTION_PINNED_NAME.exec(shape.name);
    if (pinned) motionScenes.add(pinned[1]);
  }
  const transitions = extractTransitions(xml).map((t) => ({
    xml: t,
    effects: transitionEffects(t),
  }));
  return {
    slide: slideNumber,
    shapes,
    shapeIds: new Set(shapes.map((s) => s.id)),
    hasTiming: timing !== null,
    timingIsSelfClosed: timing !== null && /^<p:timing\s*\/>$/.test(timing),
    behaviours: behaviourNodes(timing),
    behaviourCount: behaviourNodes(timing).reduce((a, b) => a + b.count, 0),
    targets: timingTargets(timing),
    clickEffects: clickEffectCount(timing),
    buildTargets: buildTargets(xml),
    transitions,
    motionScenes: [...motionScenes],
    motionStates,
  };
}

function assertion(id, title, subjects, failures, notes = []) {
  return {
    id,
    title,
    subjects,
    failures,
    notes,
    status: subjects === 0 ? 'no-subject' : failures.length > 0 ? 'fail' : 'pass',
  };
}

/**
 * Turn per-slide observations into the canary's verdict.
 *
 * Exit contract mirrors the house style used by nodeslide-motion-canary and the knockout canary:
 *   pass    -> 0   at least one assertion had a subject and none failed
 *   fail    -> 1   a named slide carries a named structural defect
 *   not-run -> 2   nothing to assert on; NOT a pass, and it says which sensor found nothing
 */
export function decidePlayback(slides, { deck = '(unnamed deck)' } = {}) {
  // ---- A0: arm the sensor before reporting absence. -------------------------------------------
  // "no broken animation found" and "no animation found" are the same sentence to a reader who
  // cannot see the subject count. Refuse to grade a deck we cannot even see the shapes of.
  const totalShapes = slides.reduce((a, s) => a + s.shapes.length, 0);
  if (slides.length === 0) {
    return {
      deck,
      verdict: 'not-run',
      reason: 'no slides: ppt/slides/slideN.xml is absent — this is not a readable deck',
      slideCount: 0,
      shapeCount: 0,
      assertions: [],
    };
  }
  if (totalShapes === 0) {
    return {
      deck,
      verdict: 'not-run',
      reason: `no shapes: ${slides.length} slide(s) present but zero <p:cNvPr> shapes — nothing an animation could target, so an absence of defects would prove nothing`,
      slideCount: slides.length,
      shapeCount: 0,
      assertions: [],
    };
  }

  const timed = slides.filter((s) => s.hasTiming);
  const declaringMotion = slides.filter((s) => s.motionScenes.length > 0);
  const transitionSlides = slides.filter((s) => s.transitions.length > 0);
  const buildSlides = slides.filter((s) => Array.isArray(s.buildTargets));

  // ---- not-run: the exporter emitted no playback structure at all. ---------------------------
  // This is the honest first verdict for a deck that was never animated. Reporting it green would
  // convert "we never tried" into "we checked and it is fine".
  if (
    timed.length === 0 &&
    declaringMotion.length === 0 &&
    transitionSlides.length === 0 &&
    buildSlides.length === 0
  ) {
    return {
      deck,
      verdict: 'not-run',
      reason: `exporter emits no timing structure: ${slides.length} slide(s), ${totalShapes} shape(s), 0 <p:timing>, 0 <p:transition>, 0 <p:bldLst>, 0 declared motion scenes. Nothing in this file claims to animate, so every claim about its exported motion is currently unfounded`,
      slideCount: slides.length,
      shapeCount: totalShapes,
      assertions: [],
    };
  }

  const assertions = [];

  // ---- A1: a <p:timing> tree must contain animation behaviours. ------------------------------
  // The vacuous pass. Present, well-formed, animating nothing.
  {
    const failures = [];
    for (const s of timed) {
      if (s.behaviourCount === 0) {
        failures.push({
          slide: s.slide,
          defect: 'timing-empty',
          detail: s.timingIsSelfClosed
            ? '<p:timing/> is self-closed — the empty scaffold, not an animation'
            : '<p:timing> present but its <p:tnLst> contains no animation behaviour (no p:set/p:anim/p:animEffect/p:animMotion/p:animRot/p:animScale/p:animClr/p:cmd) — present, well-formed, and animating nothing',
        });
      }
    }
    assertions.push(
      assertion(
        'A1',
        'every <p:timing> tree contains at least one animation behaviour node',
        timed.length,
        failures,
        timed.length === 0
          ? ['no slide carries <p:timing>; this assertion had no subject and proves nothing']
          : [],
      ),
    );
  }

  // ---- A2: every animation target must resolve to a shape on that slide. ---------------------
  // An animation aimed at a deleted shape is structurally valid and visually nothing.
  {
    const failures = [];
    let subjects = 0;
    for (const s of timed) {
      for (const spid of s.targets) {
        subjects += 1;
        if (!s.shapeIds.has(spid)) {
          failures.push({
            slide: s.slide,
            defect: 'spid-unresolved',
            detail: `<p:spTgt spid="${spid}"> targets a shape that does not exist on slide ${s.slide} (slide declares ids: ${[...s.shapeIds].join(', ') || 'none'}) — the animation runs against nothing`,
          });
        }
      }
    }
    assertions.push(
      assertion(
        'A2',
        'every <p:spTgt spid> resolves to a <p:cNvPr id> on the same slide',
        subjects,
        failures,
        subjects === 0
          ? ['no animation declares a shape target; this assertion had no subject']
          : [],
      ),
    );
  }

  // ---- A3: a slide that DECLARES motion must carry timing that delivers it. ------------------
  // This repo's shipped ruling is "step-build, not scrub": N declared states compile to N-1 click
  // advances over a pinned visual. A motion scene with no timing is the exported-deck form of a
  // preview that animated and a file that did not.
  {
    const failures = [];
    for (const s of declaringMotion) {
      const states = s.motionStates.length;
      if (!s.hasTiming || s.behaviourCount === 0) {
        failures.push({
          slide: s.slide,
          defect: 'motion-declared-no-timing',
          detail: `slide declares motion scene(s) ${s.motionScenes.join(', ')} with ${states} state shape(s) but carries ${s.hasTiming ? 'an empty <p:timing>' : 'no <p:timing>'} — the deck shows the states stacked, it never advances between them`,
        });
        continue;
      }
      const required = Math.max(0, states - 1);
      if (s.clickEffects < required) {
        failures.push({
          slide: s.slide,
          defect: 'build-steps-short',
          detail: `scene(s) ${s.motionScenes.join(', ')} declare ${states} state(s), which is a ${required}-click step build, but the timing tree carries only ${s.clickEffects} clickEffect node(s) — ${required - s.clickEffects} state(s) are never reached by advancing`,
        });
      }
    }
    assertions.push(
      assertion(
        'A3',
        'every slide declaring a motion scene carries a step-build timing tree with >= states-1 click advances',
        declaringMotion.length,
        failures,
        declaringMotion.length === 0
          ? ['no slide declares an ns:motion scene; this assertion had no subject']
          : [],
      ),
    );
  }

  // ---- A4: a <p:transition> must name an effect. ----------------------------------------------
  // <p:transition spd="slow"/> with no child is the "None" transition carrying a duration: the
  // transition-shaped twin of the empty <p:tnLst>.
  //
  // Graded PER SLIDE, not per element. PowerPoint wraps a transition in <mc:AlternateContent> as a
  // p14 <mc:Choice> plus a legacy <mc:Fallback> — two elements describing ONE transition. Counting
  // elements would double every subject and report the same slide twice, which inflates the
  // subject count the rest of this file exists to keep honest.
  {
    const failures = [];
    const seen = [];
    for (const s of transitionSlides) {
      const effects = [...new Set(s.transitions.flatMap((t) => t.effects))];
      if (effects.length === 0) {
        failures.push({
          slide: s.slide,
          defect: 'transition-empty',
          detail: `${s.transitions.length} <p:transition> element(s) present but none names an effect child — this is the "None" transition wearing a duration attribute; it advances the slide without animating it`,
        });
      } else {
        seen.push(`slide ${s.slide}: ${effects.join('/')}`);
      }
    }
    assertions.push(
      assertion(
        'A4',
        'every slide carrying <p:transition> names a visual effect child',
        transitionSlides.length,
        failures,
        transitionSlides.length === 0
          ? ['no slide carries <p:transition>; this assertion had no subject']
          : seen.length > 0
            ? [
                `effects observed: ${seen.slice(0, 8).join('; ')}${seen.length > 8 ? ` (+${seen.length - 8} more)` : ''}`,
              ]
            : [],
      ),
    );
  }

  // ---- A5: build-list targets must resolve too. ------------------------------------------------
  {
    const failures = [];
    let subjects = 0;
    for (const s of buildSlides) {
      for (const spid of s.buildTargets ?? []) {
        subjects += 1;
        if (!s.shapeIds.has(spid)) {
          failures.push({
            slide: s.slide,
            defect: 'bld-spid-unresolved',
            detail: `<p:bldLst> declares a build step for spid="${spid}", which is not a shape on slide ${s.slide}`,
          });
        }
      }
    }
    assertions.push(
      assertion(
        'A5',
        'every <p:bldLst> build step resolves to a shape on the same slide',
        subjects,
        failures,
        subjects === 0 ? ['no slide carries <p:bldLst>; this assertion had no subject'] : [],
      ),
    );
  }

  const failed = assertions.filter((a) => a.status === 'fail');
  const withSubjects = assertions.filter((a) => a.subjects > 0);

  // Every assertion having no subject means the sensor is armed but nothing was graded. That is
  // not-run, not pass — otherwise a deck stripped of all animation would report green.
  if (withSubjects.length === 0) {
    return {
      deck,
      verdict: 'not-run',
      reason:
        'no assertion had a subject: the deck has slides and shapes, but nothing in it declares timing, a transition, a build list, or a motion scene',
      slideCount: slides.length,
      shapeCount: totalShapes,
      assertions,
    };
  }

  return {
    deck,
    verdict: failed.length > 0 ? 'fail' : 'pass',
    reason:
      failed.length > 0
        ? `${failed.reduce((a, f) => a + f.failures.length, 0)} structural defect(s) across ${failed.length} assertion(s)`
        : `${withSubjects.length} assertion(s) had subjects and passed`,
    slideCount: slides.length,
    shapeCount: totalShapes,
    timedSlides: timed.map((s) => s.slide),
    motionSlides: declaringMotion.map((s) => s.slide),
    assertions,
  };
}

export const EXIT = { pass: 0, fail: 1, notRun: 2 };

export function exitCodeFor(verdict) {
  if (verdict === 'pass') return EXIT.pass;
  if (verdict === 'fail') return EXIT.fail;
  return EXIT.notRun;
}
