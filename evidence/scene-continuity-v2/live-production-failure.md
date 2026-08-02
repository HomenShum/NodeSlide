# Live production failure — 2026-08-01

## Reproduction

- Production SHA: `c4fa486047a2639d05e57dfe26bfe40f5080c0b3`
- Route: `https://nodeslide.vercel.app/?deck=deck_msb4th5v_3fe81979a88223040e36ab00faecd9c9`
- Viewport: `1440 × 1100`
- Model: Kimi K3 through OpenRouter, High effort
- Requested job: exactly 12 editable risk-committee slides, supplied facts only, explicit unknowns, threshold continuity, no invented metrics/equations/scores/financial figures, at least four composition silhouettes.

## Observed outcome

- Exact count succeeded: 12/12.
- Story-scene compiler was live: four editable threshold marks appeared on slide 1.
- Generation took more than six minutes before the editor route appeared.
- Deck CI failed with one blocker and five warnings; presenting/export was blocked.
- Provider self-critique pass 2 returned invalid JSON after one repair attempt. NodeSlide retained pass 1 with 11 known issues; deterministic visual repair corrected six, leaving six geometry issues.
- The overview remained visually repetitive through slides 1–8; dominant scenes appeared primarily on slides 9–10.

## Six surviving geometry issues

1. Comparison focus reduced a three-line bullet to a two-line box on slide 4.
2. Scene-stage takeaway height was fixed at `0.08`, overflowing on slide 9.
3. The same fixed takeaway height overflowed on slide 10.
4. Diagram focus moved nodes to the left rail but left bullet 1 there, causing a 70% collision on slide 11.
5. The same node collided 48% with another important element.
6. A second diagram node collided 92% with another bullet.

## Root-cause closure in the follow-up

- Preserve measured comparison-bullet height during focus transforms.
- Measure scene takeaways with padding and a two-line-safe height.
- Move diagram bullets opposite the focused visual rail.
- When every fan-out candidate is imperfect, minimize bounds/collisions before applying style bonuses.
- Promote at least four story beats into dominant scenes and vary the actual stage geometry by framing state.
- Give the second approach beat a centered upper scene plus lower split copy instead of a mirrored duplicate.
