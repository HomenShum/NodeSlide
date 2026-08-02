# UI change boundary

Route: local rendered artifact `outputs/nodevideo-expression-loop-2026-08-02/nodevideo-expression-loop.html`, slide 5
Viewport: 1280x720 capture; rendered slide region is 1080x608 in the browser artifact
Theme: `editorial-signal`, light
Session: local deterministic production build
Trigger: open slide 5 / render page index 5
Fixture/input: `D:\VSCode Projects\NodeVideo\evidence\youtube-expression-loop-2026-08-02\approved-explanation.json`

## CHANGE A - Slide 5 proof block

Current: The recovered build source and current pixels already show the approved proof wording. The earlier rejected benchmark percentages are absent from the visible proof block.

Expected: A clean rebuild preserves exactly these three visible proof lines: `22 TARGETED TESTS PASS`; `STRICT EDITORIAL AUDIT FAILED: 1/5 CUTS WITHIN +/-2 FRAMES`; `MANUAL SYNTHETIC DOGFOOD - NOT THE FULL EXPRESSION LOOP`. No `1,392`, `49.4%`, or `50.6%` text may appear in the source, snapshot, HTML, PPTX text, verification record, or rendered pixels.

Data source: approved proof section and disclosure limitations in the frozen NodeVideo explanation spec.

| State | Expected visible result |
| --- | --- |
| Populated | Three legible proof rows, including the failed audit and manual-synthetic limitation |
| Overflow | No clipping, overlap, or wrapping outside the three proof rows |
| Browser render | All three lines remain legible at the named viewport |
| PPTX render | Editable text renders with the same meaning and no clipping |

Out of scope: slides 1-4, slide 5 title, decorative motif, footer, page number, narration wording, source pointers, and NodeVideo repository content other than the handoff manifest.

Unchanged assertion: five-slide order, theme, slide 5 title, speaker notes, evidence pointers, and all other slide content remain unchanged.
