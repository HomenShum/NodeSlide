# Devin handoff: raise NodeSlide's visual composition ceiling

Date: 2026-07-30  
Baseline: `7cb93684c71d8b648bad9428350708d9b23b88ed` (`origin/main` before this handoff)

## Decision

Treat the repeated/generic slide problem as a compiler architecture defect, not
as a prompt-tuning or spacing defect.

The current production path selects archetypes and fanout variants, but then
materializes nearly every slide through the same composition scaffold. Truth
gates correctly remove invented charts, metrics, images, and incomplete
matrices. When they do, the system has no strong qualitative visual fallback,
so it collapses to the same prose/diagram layout.

Do not weaken the truth gates to recover visual variety.

## Root-cause trace

Symptom:

- decks repeat the same top label, horizontal rule, headline zone, body/bullet
  regions, footer, page number, and decorative rail;
- `canonical`, `mirrored`, and `visual-focus` variants read as rearrangements of
  one template, not different compositions;
- a deck can pass slide-local geometry checks while remaining monotonous as a
  sequence.

Upstream cause:

1. `shared/nodeslideArchetypes.ts` classifies content eligibility and adjusts
   dimensions/positions.
2. `convex/lib/nodeslideDesignPlan.ts` assigns useful metadata such as
   `layoutFamily`, `dominantRegion`, and reference IDs.
3. `convex/lib/nodeslideSeed.ts` still emits the same structural skeleton for
   almost every slide, including decoration, headline, prose, bullets, and
   footer.
4. `convex/lib/nodeslideCompositionFanout.ts` transforms that skeleton instead
   of compiling genuinely different composition trees.
5. Candidate scoring catches overlap, bounds, and dominant-area failures, but
   has no deck-level silhouette/perceptual-similarity gate.
6. Recent truth fixes correctly quarantine false visual proof. That removed
   dishonest sources of variety and exposed the shared-scaffold fallback.

The earlier archetype work was real, but it changed labels and geometry inside a
shared grammar. It did not make the grammar executable.

Relevant history:

- `9fc0d24` — slide archetype variety in the materializer
- `76a6623` — visual authoring and repair probes
- `0db6571` — agent-driven cinematic deck creation
- `784086a` — reject false visual proof
- `c3c9814` — quarantine invented visual quantities
- `17a820d` — quarantine incomplete risk matrices
- `c7dcadd` — enforce visual claims after coercion
- `7cb9368` — current production baseline

## Required implementation

### 1. Compile executable composition grammars

Replace the shared scaffold with composition builders whose element trees and
silhouettes are materially distinct. At minimum support:

- full-bleed visual with anchored thesis;
- asymmetric editorial split;
- process/sequence canvas;
- evidence dossier or annotated document;
- metric/decision stage;
- comparison field;
- spatial map/network;
- sparse statement or chapter transition.

Each grammar must decide which elements exist. A slide must be allowed to omit
body copy, bullets, rails, rules, labels, and footers when the composition does
not need them. Do not implement this as eight parameter presets over one
element tree.

Wire the useful metadata already produced by
`convex/lib/nodeslideDesignPlan.ts` into actual builder dispatch. Make the
RecipeLang/process reference an executable process grammar, not a standalone
demo.

### 2. Add truthful qualitative fallbacks

When a requested chart, metric, image, or matrix fails evidence validation,
preserve the narrative job with a non-quantitative composition:

- relationship map;
- tension/contrast field;
- annotated process;
- before/after state without invented values;
- evidence cards with explicit missing/not-run states;
- symbolic visual metaphor grounded in supplied text.

Never synthesize quantities, rankings, timings, evidence, or source-backed
claims to make a slide look richer.

### 3. Score the deck, not only each slide

Add a deterministic deck-level diversity gate after candidate materialization.
It should measure at least:

- element-type and region occupancy signatures;
- dominant-region changes;
- text-area/visual-area ratios;
- repeated alignment axes;
- repeated decorative primitives;
- adjacent-slide and whole-deck silhouette similarity.

Fail or recompose when adjacent slides are near-duplicates or when one
composition family dominates beyond a bounded threshold. The gate must operate
on rendered/materialized geometry, not on the declared archetype label.

### 4. Make continuity transformational

Scene continuity should evolve through the deck rather than repeat one
decoration. Persist narrative entities and let them transform:

- introduction -> complication -> evidence -> decision;
- object position, scale, color, or grouping changes should carry meaning;
- reveals should reduce or add information in narrative order;
- emotional escalation should be visible in density, contrast, framing, and
  scale, without sacrificing legibility.

### 5. Add montage-level visual judgment

The production acceptance loop must render every slide and the full montage.
Reject decks with:

- meaningless arrows or disconnected topology;
- tiny copy or stranded whitespace;
- decorative elements that imply unsupported structure;
- repeated silhouettes despite different archetype labels;
- broken scene continuity;
- visual metaphors that contradict the slide claim.

Keep deterministic structural checks as the first gate. Use a visual judge only
after those checks, and retain the rendered evidence and reason codes.

## Scenario-based proof

Use realistic multi-slide cases, not isolated template snapshots:

1. Executive AI governance decision: mixed process, evidence, risk, and decision
   slides with no invented metrics.
2. Research synthesis: dense citations, uncertain findings, competing
   hypotheses, and a conclusion.
3. Startup board update: supplied metrics plus qualitative strategy and an
   explicit data-missing slide.
4. Product launch narrative: scene continuity, reveal pacing, and emotional
   escalation.
5. Adversarial sparse brief: insufficient evidence must produce an honest,
   visually composed deck rather than generic prose or fabricated visuals.
6. Sustained generation: multiple decks in one run must not converge on the
   same sequence of silhouettes.

For each case verify editor render, public share route, CLI creation, editable
PPTX export, and montage. Include degraded provider/time-budget paths.

Knockout test: restore the shared scaffold or force all builders to emit the
same element tree. The deck-level diversity test must turn red.

## Definition of done

- CLI and UI create paths finish a production job and return the same governed
  artifact contract.
- At least six genuinely distinct composition trees are observable in code and
  rendered evidence.
- No more than two adjacent slides share a near-identical silhouette.
- A 10-slide mixed-content deck uses at least four composition families unless
  a documented content constraint makes that impossible.
- Truth-policy, post-coercion, body-fit, topology, export, and refusal tests
  remain green.
- The knockout test proves the diversity gate catches scaffold collapse.
- A human-review montage demonstrates scene continuity, visual metaphor, reveal
  pacing, emotional escalation, and composition diversity.
- Exact production SHA is confirmed through deployment state and raw live HTML;
  the live share deck and downloaded PPTX are visually inspected page by page.

## Primary files

- `convex/lib/nodeslideSeed.ts`
- `convex/lib/nodeslideDesignPlan.ts`
- `convex/lib/nodeslideCompositionFanout.ts`
- `shared/nodeslideArchetypes.ts`
- `convex/lib/nodeslideVisualLogic.ts`
- `convex/lib/nodeslideVisualClaims.ts`
- `convex/lib/nodeslideVisualTruthPolicy.ts`
- related scenario tests and production proof scripts

## Evidence and references

- Final live deck from the last campaign:
  `https://nodeslide.vercel.app/s/share-82eeeff37c3dc56b7a467461a42cd02c03dd`
- Final PPTX:
  `evidence/live-governance-after/From-AI-Inventory-to-Release-Decision.pptx`
- Final montage:
  `evidence/live-governance-after/montage-final-7cb9368.png`
- Earlier, more varied story-run montage:
  `evidence/agent-story-release/production-run-final/montage.png`
- Campaign's own honest limitations:
  `evidence/visual-logic-campaign/README.md`
- RecipeLang reference:
  `public/references/recipelang/`
- Visual alignment reference:
  `https://www.cookingforengineers.com/`

## Do not regress

- Do not revive weak/guessable session IDs.
- Do not loosen evidence or quantitative truth gates for aesthetics.
- Do not call an archetype label proof of composition diversity.
- Do not accept a green local build as production proof.
- Do not grade only one slide; the deck sequence is the product.

