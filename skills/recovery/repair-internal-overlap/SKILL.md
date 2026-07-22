---
name: repair-internal-overlap
description: Diagnose and repair text overflow, internal collisions, and crowded regions inside rendered presentation slides. Use after geometry, density, screenshot, or PPTX validation reports overlap or likely line-capacity failure.
---

# Repair Internal Overlap

1. Render the slide at production size and identify every colliding or capacity-failing region.
2. Record the region bounds, current copy, estimated lines, protected claims, and neighboring artifact.
3. Choose the smallest valid repair in order: compress copy, convert prose to labels, enlarge the region, change the composition, split the slide.
4. Preserve narrative job, evidence, reading order, and minimum font size.
5. Rebuild, rerender, and run both exported geometry and visual inspection.
6. Stop after the bounded repair budget and emit `WEAK_REPAIR` if the defect remains.

Do not merely shrink type, hide content, move it outside the canvas, or trust a canvas-bound overflow test.

Completion requires zero likely text overflow, zero internal collisions, and unchanged claim coverage.
