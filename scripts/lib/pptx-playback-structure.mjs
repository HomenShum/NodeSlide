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

/**
 * The examined-and-excused marker.
 *
 * A scene the recipe declared as motion, which the compiler consciously degraded to a still, must
 * leave a trace of that decision ON THE SLIDE. Without it, a slide that was looked at and excused
 * is byte-for-byte indistinguishable from one nobody ever considered — the deck form of "exists but
 * never mounts". The suffix is anchored (`$`, not `(?::|$)`) so the name cannot be produced as a
 * prefix of some longer role string: an excuse must be spelled out exactly to count as one.
 */
const MOTION_DECLARED_STATIC_NAME = /^ns:motion:(.+):declared-static$/;

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
  const declaredStaticScenes = new Set();
  for (const shape of shapes) {
    const state = MOTION_STATE_NAME.exec(shape.name);
    if (state) {
      motionScenes.add(state[1]);
      motionStates.push({ id: shape.id, scene: state[1], index: Number(state[2]) });
      continue;
    }
    const pinned = MOTION_PINNED_NAME.exec(shape.name);
    if (pinned) {
      motionScenes.add(pinned[1]);
      continue;
    }
    // Deliberately NOT added to motionScenes. A declared-static scene is a subject A3 must count,
    // but it is not a scene that claims to animate — folding the two together would make the
    // excuse look like the thing it excuses.
    const declaredStatic = MOTION_DECLARED_STATIC_NAME.exec(shape.name);
    if (declaredStatic) declaredStaticScenes.add(declaredStatic[1]);
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
    declaredStaticScenes: [...declaredStaticScenes],
  };
}

// ---------------------------------------------------------------------------------------------
// Declared intent
// ---------------------------------------------------------------------------------------------

/**
 * THE AMBIGUITY THIS CLOSES
 * -------------------------
 * `not-run: exporter emits no timing structure` is a correct verdict and an open question. It
 * cannot tell "motion was never intended here" from "motion was intended and got lost". Both
 * produce a file with no <p:timing>.
 *
 * The fix is not to guess. It is to let the author say which one it is, in a machine-readable
 * record that lives with the recipe, and then to hold that statement to the artefact.
 *
 * OPT-IN, AND ONLY OPT-IN
 * -----------------------
 * A deck with no declaration keeps today's `not-run`. Silence is never read as a declaration —
 * otherwise every unexamined deck in the repo would quietly become a pass, which is the exact
 * inversion of the instrument's purpose. The declaration must be handed to the canary explicitly
 * (`--intent <file>`); there is no directory convention that could pick one up by accident.
 *
 * AND A DECLARATION IS A CLAIM, NOT A PASS
 * ----------------------------------------
 * `intent: "static"` asserts the artefact contains no motion. If the artefact contains motion, the
 * declaration is false and the deck FAILS. A claim contradicted by its own artefact is a defect;
 * accepting it would rebuild the deception this file exists to refuse, one level up.
 */
export const MOTION_INTENT_SCHEMA = 'nodeslide.motion-intent/v1';

const VALID_INTENTS = new Set(['static', 'motion']);

/**
 * Validate a parsed declaration against the deck it is being applied to.
 * Returns { ok, intent, errors }. Never throws — the caller decides what a bad record means.
 *
 * `deck` binds the record to one artefact by basename. A declaration copied onto a different deck
 * is the single most likely way an excuse gets applied where nobody authored it, so the record
 * names its subject and the binding is checked rather than assumed.
 */
export function parseMotionIntent(raw, { deck } = {}) {
  const errors = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, intent: null, errors: ['declaration is not a JSON object'] };
  }
  if (raw.schemaVersion !== MOTION_INTENT_SCHEMA) {
    errors.push(
      `schemaVersion is ${JSON.stringify(raw.schemaVersion ?? null)}, expected "${MOTION_INTENT_SCHEMA}"`,
    );
  }
  if (!VALID_INTENTS.has(raw.intent)) {
    errors.push(
      `intent is ${JSON.stringify(raw.intent ?? null)}, expected one of ${[...VALID_INTENTS].map((v) => `"${v}"`).join(' | ')}`,
    );
  }
  if (typeof raw.deck !== 'string' || raw.deck.length === 0) {
    errors.push('deck is missing — a declaration must name the artefact it describes');
  } else if (deck && raw.deck !== deck) {
    errors.push(
      `deck mismatch: the declaration is authored for "${raw.deck}" but was applied to "${deck}". A declaration is bound to one artefact; applying it to another is how an excuse reaches a deck nobody wrote it for`,
    );
  }
  if (raw.intent === 'static' && typeof raw.rationale !== 'string') {
    errors.push('intent "static" requires a rationale — an unexplained claim is not auditable');
  }
  const declaredStaticScenes = [];
  const rawScenes = raw.declaredStaticScenes ?? [];
  if (!Array.isArray(rawScenes)) {
    errors.push('declaredStaticScenes must be an array when present');
  } else {
    rawScenes.forEach((entry, i) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`declaredStaticScenes[${i}] is not an object`);
        return;
      }
      if (typeof entry.scene !== 'string' || entry.scene.length === 0) {
        errors.push(`declaredStaticScenes[${i}].scene is missing`);
        return;
      }
      // The slide number is required, not optional. It is what stops a scene id being excused on
      // whichever slide happens to carry the marker after an unrelated reorder.
      if (!Number.isInteger(entry.slide) || entry.slide < 1) {
        errors.push(
          `declaredStaticScenes[${i}] ("${entry.scene}").slide must be a positive integer slide number`,
        );
        return;
      }
      if (typeof entry.reason !== 'string' || entry.reason.length === 0) {
        errors.push(
          `declaredStaticScenes[${i}] ("${entry.scene}").reason is missing — the whole point is that the decision is recorded`,
        );
        return;
      }
      declaredStaticScenes.push({ scene: entry.scene, slide: entry.slide, reason: entry.reason });
    });
  }
  if (errors.length > 0) return { ok: false, intent: null, errors };
  return {
    ok: true,
    errors: [],
    intent: {
      schemaVersion: raw.schemaVersion,
      deck: raw.deck,
      recipe: typeof raw.recipe === 'string' ? raw.recipe : null,
      mode: raw.intent,
      rationale: typeof raw.rationale === 'string' ? raw.rationale : null,
      declaredStaticScenes,
      source: raw.__source ?? null,
    },
  };
}

function assertion(id, title, subjects, failures, notes = []) {
  return {
    id,
    title,
    subjects,
    failures,
    notes,
    // Failure beats subject count. A defect found while examining something the count did not
    // model must never be filed as "nothing was looked at" — that is how a red goes quiet.
    status: failures.length > 0 ? 'fail' : subjects === 0 ? 'no-subject' : 'pass',
  };
}

/**
 * Turn per-slide observations into the canary's verdict.
 *
 * Exit contract mirrors the house style used by nodeslide-motion-canary and the knockout canary:
 *   pass           -> 0   at least one assertion had a subject and none failed
 *   fail           -> 1   a named slide carries a named structural defect
 *   not-run        -> 2   nothing to assert on; NOT a pass, and it says which sensor found nothing
 *   not-applicable -> 3   the recipe declared this deck static, and the artefact agrees
 *
 * WHY not-applicable IS ITS OWN CODE AND NOT 0, AND NOT 2
 * ------------------------------------------------------
 * Not 0, because nothing was graded. A future gate that reads 0 as "motion is proven" would be
 * reading a deck that proved nothing — the same conflation between "checked and fine" and "nothing
 * to check" that the subject counts in this file exist to prevent.
 *
 * Not 2, because the entire purpose of the declaration is to let a consumer treat "declared static"
 * as SATISFIED while "not-run" must still BLOCK. If both share code 2, that consumer has to
 * distinguish them by grepping an English reason string. Prose is not an interface: it gets
 * reworded, translated, truncated by a log viewer, and the gate silently starts accepting the wrong
 * half. A shell must be able to tell them apart with `[ $? -eq 3 ]` and nothing else.
 *
 * And 3 rather than some code below 1, so the default remains conservative: any CI step that does
 * not explicitly opt into accepting 3 still stops on it. Declaring static does not silently turn
 * green anywhere — it turns green only where somebody wrote down that it may.
 */
export function decidePlayback(slides, { deck = '(unnamed deck)', intent = null } = {}) {
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
  const sceneSlides = slides.filter((s) => s.motionScenes.length > 0);
  const excusedSlides = slides.filter((s) => (s.declaredStaticScenes ?? []).length > 0);
  // A3's subjects: every slide that declares a motion scene, PLUS every slide that records having
  // been examined and excused. The second group is the point of the marker — a slide considered and
  // consciously left still must be counted as looked at, never as absent.
  const declaringMotion = slides.filter(
    (s) => s.motionScenes.length > 0 || (s.declaredStaticScenes ?? []).length > 0,
  );
  const transitionSlides = slides.filter((s) => s.transitions.length > 0);
  const buildSlides = slides.filter((s) => Array.isArray(s.buildTargets));
  const intentSummary = intent
    ? {
        mode: intent.mode,
        deck: intent.deck,
        recipe: intent.recipe ?? null,
        source: intent.source ?? null,
        declaredStaticScenes: intent.declaredStaticScenes,
      }
    : null;

  // ---- declared static: an affirmative verdict, and a claim that is held to the artefact. -----
  if (intent?.mode === 'static') {
    const contradictions = [];
    const contradiction = (slide, detail) =>
      contradictions.push({ slide, defect: 'declared-static-contradicted', detail });
    for (const s of timed) {
      contradiction(
        s.slide,
        `slide ${s.slide} carries <p:timing> with ${s.behaviourCount} animation behaviour node(s)`,
      );
    }
    for (const s of sceneSlides) {
      contradiction(
        s.slide,
        `slide ${s.slide} declares motion scene(s) ${s.motionScenes.join(', ')}`,
      );
    }
    for (const s of transitionSlides) {
      contradiction(s.slide, `slide ${s.slide} carries ${s.transitions.length} <p:transition>`);
    }
    for (const s of buildSlides) {
      contradiction(s.slide, `slide ${s.slide} carries <p:bldLst>`);
    }
    if (contradictions.length > 0) {
      // The declaration said this deck contains no motion. It does. The claim is false, and a false
      // claim about an artefact is a defect — not a reason to relax into "nothing to grade".
      return {
        deck,
        verdict: 'fail',
        reason: `declared static, but the artefact animates: ${contradictions.length} contradiction(s) across ${new Set(contradictions.map((c) => c.slide)).size} slide(s). The declaration is a claim about this file; the file disagrees with it`,
        slideCount: slides.length,
        shapeCount: totalShapes,
        timedSlides: timed.map((s) => s.slide),
        motionSlides: sceneSlides.map((s) => s.slide),
        intent: intentSummary,
        assertions: [
          assertion(
            'A0',
            'a deck declared static carries no timing, transition, build list or motion scene',
            slides.length,
            contradictions,
          ),
        ],
      };
    }
    return {
      deck,
      verdict: 'not-applicable',
      reason: `declared static by ${intent.source ?? intent.recipe ?? 'the recipe'}: ${intent.rationale ?? 'no rationale recorded'}. Sensor armed on ${slides.length} slide(s) and ${totalShapes} shape(s); 0 <p:timing>, 0 <p:transition>, 0 <p:bldLst>, 0 motion scenes — the artefact agrees with the declaration. No motion was intended here, so none is missing`,
      slideCount: slides.length,
      shapeCount: totalShapes,
      timedSlides: [],
      motionSlides: [],
      intent: intentSummary,
      assertions: [],
    };
  }

  // ---- not-run: the exporter emitted no playback structure at all. ---------------------------
  // This is the honest first verdict for a deck that was never animated. Reporting it green would
  // convert "we never tried" into "we checked and it is fine".
  //
  // It stays not-run for an UNDECLARED deck even now that declaring is possible. Silence is not a
  // declaration: if absence of a declaration resolved to not-applicable, every deck in the repo
  // would be retroactively excused by having said nothing, and the open question this verdict
  // exists to hold open would be closed by default.
  if (
    timed.length === 0 &&
    declaringMotion.length === 0 &&
    transitionSlides.length === 0 &&
    buildSlides.length === 0
  ) {
    return {
      deck,
      verdict: 'not-run',
      reason: `exporter emits no timing structure: ${slides.length} slide(s), ${totalShapes} shape(s), 0 <p:timing>, 0 <p:transition>, 0 <p:bldLst>, 0 declared motion scenes, and no motion-intent declaration was supplied. Nothing in this file claims to animate and nothing states that it should not, so every claim about its exported motion is currently unfounded. Pass --intent <file> to declare the intent; declaring is opt-in and silence is not a declaration`,
      slideCount: slides.length,
      shapeCount: totalShapes,
      intent: null,
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
    const excusedNotes = [];
    const declaredByScene = new Map((intent?.declaredStaticScenes ?? []).map((e) => [e.scene, e]));
    const markersSeen = new Set();
    for (const s of declaringMotion) {
      // ---- examined-and-excused: a scene consciously compiled to a still. --------------------
      for (const scene of s.declaredStaticScenes ?? []) {
        markersSeen.add(scene);
        // The marker and real motion cannot both be true of the same slide. One of them is stale.
        if (s.hasTiming || s.motionStates.length > 0) {
          failures.push({
            slide: s.slide,
            defect: 'declared-static-contradicted',
            detail: `slide ${s.slide} carries the excuse marker ns:motion:${scene}:declared-static AND ${s.hasTiming ? 'a <p:timing> tree' : `${s.motionStates.length} motion state shape(s)`} — a scene cannot be both consciously left still and animated; one of the two is a leftover`,
          });
          continue;
        }
        const declared = declaredByScene.get(scene);
        if (!declared) {
          // The marker names a scene no declaration knows about. An excuse nobody authored is a
          // sticker that silences the gate, which is worse than the absence it replaced.
          failures.push({
            slide: s.slide,
            defect: 'declared-static-undeclared',
            detail: `slide ${s.slide} claims scene "${scene}" was examined and left static, but ${
              intent
                ? `the supplied declaration for ${intent.deck} names no such scene (it declares: ${declaredByScene.size > 0 ? [...declaredByScene.keys()].join(', ') : 'none'})`
                : 'no motion-intent declaration was supplied, so nothing authorises that excuse'
            } — the marker is a claim in the artefact and must be countersigned by the recipe`,
          });
          continue;
        }
        if (declared.slide !== s.slide) {
          failures.push({
            slide: s.slide,
            defect: 'declared-static-slide-mismatch',
            detail: `scene "${scene}" is declared static for slide ${declared.slide}, but the marker sits on slide ${s.slide} — the declaration and the artefact disagree about which slide was examined`,
          });
          continue;
        }
        excusedNotes.push(
          `slide ${s.slide}: scene "${scene}" examined and excused — ${declared.reason}`,
        );
      }
      if ((s.declaredStaticScenes ?? []).length > 0 && s.motionScenes.length === 0) continue;

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
    // The other direction. A declaration that says "scene X was examined and left static" is only
    // worth anything if slide X actually carries that record. Otherwise the excuse lives in a file
    // beside the deck and the deck itself still shows nothing — which is the defect, not the fix.
    for (const entry of intent?.declaredStaticScenes ?? []) {
      if (markersSeen.has(entry.scene)) continue;
      failures.push({
        slide: entry.slide,
        defect: 'declared-static-marker-absent',
        detail: `the declaration excuses scene "${entry.scene}" on slide ${entry.slide}, but no shape on any slide is named ns:motion:${entry.scene}:declared-static — the decision was recorded next to the artefact and not inside it, so the exported deck still carries no trace of it`,
      });
    }
    assertions.push(
      assertion(
        'A3',
        'every slide declaring a motion scene carries a step-build timing tree with >= states-1 click advances, or a countersigned declared-static marker',
        // Declared excuses whose marker is missing were examined too — counting only the slides
        // that happened to carry a marker would let a whole declaration vanish from the subject
        // count at the exact moment its marker went missing.
        declaringMotion.length +
          (intent?.declaredStaticScenes ?? []).filter((e) => !markersSeen.has(e.scene)).length,
        failures,
        declaringMotion.length === 0
          ? ['no slide declares an ns:motion scene; this assertion had no subject']
          : excusedNotes,
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
      intent: intentSummary,
      assertions,
    };
  }

  // Every subject was an examined-and-excused scene: real structure count is zero. Calling that a
  // `pass` would hand exit 0 — "motion verified" — to a deck that contains no motion at all. The
  // affirmative verdict is the honest one, and it is still not 0.
  const onlyExcused =
    failed.length === 0 &&
    timed.length === 0 &&
    sceneSlides.length === 0 &&
    transitionSlides.length === 0 &&
    buildSlides.length === 0 &&
    excusedSlides.length > 0;
  if (onlyExcused) {
    return {
      deck,
      verdict: 'not-applicable',
      reason: `every graded subject was declared static: ${excusedSlides.length} slide(s) carry a countersigned ns:motion:<scene>:declared-static marker and the deck carries no <p:timing>, <p:transition> or <p:bldLst>. Each scene was examined and consciously left still — nothing here is missing motion`,
      slideCount: slides.length,
      shapeCount: totalShapes,
      timedSlides: [],
      motionSlides: [],
      intent: intentSummary,
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
    motionSlides: sceneSlides.map((s) => s.slide),
    excusedSlides: excusedSlides.map((s) => s.slide),
    intent: intentSummary,
    assertions,
  };
}

export const EXIT = { pass: 0, fail: 1, notRun: 2, notApplicable: 3 };

export function exitCodeFor(verdict) {
  if (verdict === 'pass') return EXIT.pass;
  if (verdict === 'fail') return EXIT.fail;
  if (verdict === 'not-applicable') return EXIT.notApplicable;
  return EXIT.notRun;
}
