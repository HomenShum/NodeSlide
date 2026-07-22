# Deck Gym production baseline — 2026-07-21

## Outcome

The first controlled Deck Gym matrix is complete. It generated 72 production cells across 12 deck families, three requested models, and two design directions. Seventy cells exported and rendered as seven-slide PPTX files; two cells failed during export. None is promotion-ready under the frozen fail-closed gates.

This is a useful baseline, not a model beauty contest. It shows that route truthfulness, evidence preservation, and density control must precede aesthetic optimization.

## Matrix receipts

- Planned: 72
- Exported: 70
- Export failures: 2
- PPTX render/integrity passes: 70/70 exported decks
- Requested-model routes classified live: 17
- Routes classified degraded: 53
- Blind review matches available: 69
- Promotion-eligible matches: 0
- Automatic promotion: disabled

The two export failures were both `technical-architecture__evidence-editorial`, one Kimi and one Sonnet. Both timed out waiting for a PPTX download after generation reached the editor.

## Model results

| Requested model | Runs evaluated | Live | Degraded | Mean claim coverage | Raw aesthetic/integrity score | Qualified score | Estimated text overflows |
|---|---:|---:|---:|---:|---:|---:|---:|
| Kimi K3 | 23 | 11 | 12 | 0.486 | 0.709 | **0.386** | 59 |
| Claude Sonnet 5 | 23 | 6 | 17 | 0.290 | 0.717 | **0.295** | 34 |
| Gemini 3.5 Flash | 24 | 0 | 24 | 0.076 | 0.721 | **0.180** | 0 |

The difference between raw and qualified score is intentional. Before the correction, generic degraded decks ranked above live decks because they were sparse and collision-free. Deck Gym now requires a live trace and sufficient brief-specific claim coverage before granting the full score.

## Dominant failures

| Gate | Failed decks | Interpretation |
|---|---:|---|
| text-area ratio | 70 | The house template and generated copy are too text-forward for the current anti-boring threshold. |
| meaningful visuals | 66 | Most decks do not contain five real charts, images, diagrams, formulas, or code artifacts. |
| claim coverage | 56 | Degraded fallbacks largely ignore frozen evidence; three live decks also missed the 0.75 threshold. |
| live-model trace | 53 | The requested route often returned the generic degraded path. |
| required artifacts | 52 | Requested artifact types are not being planned or realized reliably. |
| internal text overflow | 17 | All were live-model decks; 93 likely overflowing text boxes were found. |
| forbidden claims | 7 | Some live generations introduced unsupported language. |
| layout repetition | 1 | Within-deck layout variety is generally adequate, but this does not prevent cross-deck sameness. |

Twelve duplicate-deck groups show that degraded outputs recur across models and directions. The two natural-language design directions did not materially alter those fallbacks.

## What the harness should learn next

### P0 — make requested-route truth fail closed

Do not let a generic fallback look like a successful requested-model generation. Return a typed degraded result with the requested route, attempted route, provider error class, and a user choice to retry or accept a clearly labeled fallback. A degraded result must never be eligible for automatic export, ranking, or prompt promotion.

### P0 — add a density-aware revise pass

Move copy compression into the generation contract, not a late visual cleanup. Give every slide a word and line budget derived from its layout, then run an exported-geometry preflight. When a box exceeds capacity, revise only that slide with a concrete target such as “reduce body copy from 126 to 55 words while preserving claims 0.75 and 1040.” Re-render and stop after the bounded repair budget.

### P1 — plan artifacts before prose

Require a slide-level artifact plan before full copy generation: artifact type, evidence source, claim served, editability requirement, and fallback representation. Reject a plan with fewer than five meaningful visual slides for these seven-slide briefs. Placeholder image panels do not count.

### P1 — make visual direction structural

Replace the prose-only direction suffix with a typed visual contract: density band, focal scale, layout grammar, chart-to-text ratio, allowed motif count, transition rhythm, and climax slide. Feed those fields to layout selection and rendering. Add a corpus-level novelty gate that detects duplicate deck digests, repeated palette/type/layout fingerprints, and direction pairs with no measurable delta.

### P1 — separate review eligibility from promotion eligibility

All 69 structurally comparable matches are available for blind human review, including failed decks; this helps identify useful local traits. Promotion remains stricter: both candidates must pass every objective gate, the human preference set must be complete, and automatic application stays disabled.

### P2 — diagnose the architecture export timeout

Reproduce the two failed technical-architecture exports locally from their preserved editor screenshots and run receipts. Instrument export phases separately—schema normalization, SVG/chart conversion, PPTX assembly, validation, and browser download—to identify the shared shape or serialization boundary.

## Evidence map

- Machine summary: `artifacts/deck-gym/deck-gym-v1/evaluation-summary.json`
- Generation summary: `artifacts/deck-gym/deck-gym-v1/generation-summary.json`
- Blind tournament: `artifacts/deck-gym/deck-gym-v1/tournament.json`
- Blocked promotion proposal: `artifacts/deck-gym/deck-gym-v1/promotion-proposal.json`
- Per-run PPTX, trace receipt, screenshots, rendered slides, and evaluation: `artifacts/deck-gym/deck-gym-v1/runs/<run-id>/`
- Twenty-four side-by-side contact sheets: `artifacts/deck-gym/deck-gym-v1/contact-sheets/`

Contact-sheet rows are ordered Claude Sonnet, Gemini, then Kimi. Requested model names are excluded from tournament candidate payloads; this row note is only for operator diagnosis.
