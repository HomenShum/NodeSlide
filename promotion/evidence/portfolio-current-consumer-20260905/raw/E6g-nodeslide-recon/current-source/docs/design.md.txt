# Design: Executable Composition Grammars for NodeSlide

## Problem

`buildSlide()` in `nodeslideSeed.ts` emits the same element scaffold for every
slide: accent-rail → section label → headline → body → bullets → [visual
primitive] → footer → page-number. The archetype only tweaks widths and
positions of these same elements. `fanOutNodeSlideComposition()` then mirrors
or focus-zooms the identical tree. The result: decks where every slide has the
same silhouette.

## Root cause

The design plan (`nodeslideDesignPlan.ts`) already produces useful metadata
(`layoutFamily`, `dominantRegion`, `density`, `compositionIntent`) but that
metadata never reaches an executable builder. The materializer hard-codes one
scaffold and the fan-out transforms it geometrically.

## Solution architecture

### 1. Composition grammar builders (`nodeslideCompositionGrammars.ts`)

Each grammar is a function that receives the planned slide, theme, and context,
and returns a **materially distinct** element tree. Each grammar decides which
elements exist — a slide may omit body copy, bullets, rails, rules, labels, and
footers when the composition does not need them.

Eight grammars:

| Grammar | Elements | Silhouette |
|---------|----------|------------|
| `full-bleed-thesis` | Large headline, minimal accent | Centered mass, vast negative space |
| `asymmetric-editorial` | Headline upper-left, body lower-left | Left-weighted, right void |
| `process-canvas` | Headline strip top, diagram fills canvas | Top band + large visual field |
| `evidence-dossier` | Headline, 2-3 evidence cards in grid | Card grid, no body prose |
| `metric-stage` | Giant metric center, label below | Single central mass |
| `comparison-field` | 2-3 columns, each with sub-headline | Vertical divisions |
| `spatial-map` | Network nodes/connectors, headline overlay | Scattered masses with traces |
| `sparse-transition` | Section number, minimal text | Mostly empty, one corner mass |

### 2. Builder dispatch

`buildSlide()` dispatches to the appropriate grammar based on the design plan's
`layoutFamily` and `semanticArchetype`. The shared scaffold code (accent-rail,
section, headline, body, bullets, footer, page-number) is removed from the
default path; each grammar emits only the elements it needs.

Fallback: when a visual primitive (chart, metric, image, diagram) fails evidence
validation, the dispatcher selects a qualitative fallback grammar instead of
collapsing to the prose scaffold.

### 3. Composition fan-out

`fanOutNodeSlideComposition()` now generates candidates from **different
grammars** (not just mirror/focus of one tree). For a slide whose archetype
supports multiple layout families, the fan-out materializes 2-3 grammar
candidates and scores them.

### 4. Deck-level diversity gate (`nodeslideDeckDiversity.ts`)

After all slides are materialized, a deterministic gate measures:
- Element-type and region occupancy signatures
- Dominant-region changes
- Text-area/visual-area ratios
- Repeated alignment axes
- Repeated decorative primitives
- Adjacent-slide and whole-deck silhouette similarity

Fails or recomposes when adjacent slides are near-duplicates or one composition
family dominates beyond a bounded threshold.

### 5. Transformational continuity

Story continuity elements (motif bar, marker) are emitted by grammars that
support them, not unconditionally. The motif evolves: position, scale, opacity,
and color change carry narrative meaning.

## Flow

```
PlannedSlide + DesignPlan
  → compositionGrammarDispatch(plan.layoutFamily, plan.semanticArchetype)
    → grammarBuilder(planned, theme, context)
      → SlideElement[] (materially distinct tree)
  → fanOutNodeSlideComposition(elements, plan, alternativeGrammars)
    → candidates from 2-3 grammars
    → scored and selected
  → deckLevelDiversityGate(allSlides)
    → fail or recompose if adjacent silhouettes match
```

## Constraints

- Do not weaken truth gates for visual variety.
- Do not synthesize quantities, rankings, or evidence.
- Each grammar must produce a materially different element tree, not parameter
  presets over one tree.
- The diversity gate must operate on rendered geometry, not archetype labels.
- Existing tests for truth-policy, post-coercion, body-fit, topology, and export
  must remain green.
