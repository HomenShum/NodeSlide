---
name: claude-sonnet-deck-adapter
description: Apply evidence-backed Claude Sonnet safeguards to NodeSlide story direction, critique, and deck generation. Use when Sonnet proposes a narrative, critiques candidates, or directly composes presentation slides.
---

# Claude Sonnet Deck Adapter

Treat story-direction and critic roles as hypotheses until separately ablated; Deck Gym measured finished artifacts, not planning quality.

## Contract

1. Verify the route is live; otherwise invoke `no-generic-fallback` and stop.
2. Produce a concise StorySpec before slide copy: thesis, audience decision, slide jobs, evidence, and climax.
3. Allocate a strict word and line budget to every region. Prefer annotations, labels, and visual comparisons over explanatory paragraphs.
4. Require a typed artifact plan before composition; Sonnet's live baseline passed no complete required-artifact gate.
5. Separate critic and executor roles. A Sonnet critique must cite a rendered region and a measurable change.
6. Render and measure before completion; apply `repair-internal-overlap` to every dense region.
7. Revalidate source support after compression; do not introduce a stronger claim to improve rhetoric.

## Completion checks

- StorySpec exists and is evidence-bound.
- Copy remains inside allocated regions.
- Required artifacts are editable and visible.
- Every critique names evidence, defect, and executable repair.
- An independent validator or human makes the final acceptance decision.

Do not declare a story advantage from brand reputation or an unblinded comparison.
