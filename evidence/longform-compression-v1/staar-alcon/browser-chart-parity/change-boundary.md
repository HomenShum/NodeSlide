# UI change boundary

Route: generated benchmark artifact `long/browser/slide-027.png`
Viewport: 1280×720
Theme: STAAR/Alcon benchmark light theme
Session: deterministic local benchmark render
Trigger: `npx vite-node scripts/render-longform-compression-benchmark.ts`
Fixture/input: `outputs/longform-compression-v1/staar-alcon/long.nodeslide.json`, slide 27

## CHANGE A · Canonical browser chart rendering

Current: Browser evidence uses a benchmark-only HTML chart implementation with hardcoded orange gradient bars and a reduced axis treatment. The PPTX path uses the canonical chart series color and native editable axes.

Expected: Browser evidence is rendered through NodeSlide's canonical `renderSlideHtml` exporter, preserving the same chart data, labels, series color, bounds, and overall composition used by the snapshot. Browser and PPTX may retain renderer-specific typography and native-chart details, but they must not contradict the authored visual encoding.

Data source: frozen `DeckSnapshot` chart element and its source-bound `ChartData`.

| State | Expected visible result |
| --- | --- |
| Empty | Not applicable; a frozen benchmark slide always has authored content. |
| Loading | Not applicable; local deterministic rendering produces a complete static frame. |
| Error | Renderer exits non-zero and does not issue a successful dual-render receipt. |
| Populated | Teal series bars, source labels, and chart bounds match the canonical snapshot; no orange hardcoded fallback. |
| Overflow | Long category labels remain inside the authored chart bounds without covering adjacent copy. |
| Responsive | Not applicable to this fixed 1280×720 benchmark proof; the production viewer is tested separately. |

Out of scope: slide title, body copy, facts, chart values, chart bbox, story-scene ornament, footer, page number, PPTX renderer, and all non-chart composition grammars.

Unchanged assertion: same snapshot digests, slide order, 72/12/4 counts, factual values, evidence IDs, and PPTX artifact semantics.
