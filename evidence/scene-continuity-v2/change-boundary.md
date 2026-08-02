# NodeSlide scene continuity change boundary

Route: `https://nodeslide.vercel.app/?deck=deck_msaxp46j_1392600a6a52b494283f351ea6f9fcd3`
Viewport: `1440x1100`
Theme: current production dark shell with light slide canvases
Session: signed-in Chrome profile, anonymous production deck owner session preserved as `🎞️ NodeSlide scene continuity QA`
Trigger: open the recent risk-committee deck, then select `Overview`
Fixture/input: `Build exactly 12 slides for a risk committee deciding whether an AI release may proceed; include a scene-level story progression and do not invent evidence.`
Captured state: production deck requested 12 slides but rendered 7; all seven use the same restrained editorial family and the threshold continuity device is largely a thin rail/marker.

## CHANGE A · Generated deck overview

Current: Seven populated slide canvases; repeated cream editorial layouts; scene continuity appears as small annotations/rails rather than a changing visual subject.

Expected: The requested slide count is preserved; each populated slide has a typed scene state (subject, transformation, framing, intensity, continuity handoff); the compiler renders that state as a visible, stage-specific transformation; adjacent slides remain recognizably connected without repeating the same composition.

Data source: provider plan → normalized deck spec → deterministic story/scene compiler → slide elements.

| State | Expected visible result |
| --- | --- |
| Empty | No fabricated deck or completion badge; the creation surface remains the primary action outside this box. |
| Loading | No partial deck is presented as complete; durable generation status remains in the existing job/trace surface outside this box. |
| Error | Exact failed stage remains visible in the existing trace/error surface; no silent fallback that changes requested count or claims model-authored composition. |
| Populated | Exact requested count, model/provider identity and receipts remain inspectable in Trace, scene transformations are visible, and validation does not report success when count/overflow/diversity gates fail. |
| Overflow | Text and artwork stay inside each 16:9 slide; overview cards keep a stable grid and readable labels. |
| Responsive | At narrower widths, slide cards reflow/scroll without clipping; scene identity remains readable at thumbnail scale. |

## CHANGE B · Slide navigator output

Current: Seven thumbnail rows mirror the incomplete and visually repetitive deck.

Expected: Navigator count and section totals match the requested count and overview; thumbnails make scene progression distinguishable at a glance; titles and evidence status remain unchanged unless generated content itself changes.

Data source: the same normalized deck spec and rendered slide elements as CHANGE A.

| State | Expected visible result |
| --- | --- |
| Empty | No slide rows; existing Add slide affordance remains honest. |
| Loading | No optimistic slide rows with invented final content. |
| Error | Previously valid deck remains recoverable; failed generation does not replace it with a partial deck. |
| Populated | Section totals, row count, titles, and thumbnails agree with the overview and requested count. |
| Overflow | Long titles truncate without hiding slide number, evidence status, or actions. |
| Responsive | Navigator remains scrollable and selectable; it may collapse only through existing responsive behavior. |

Out of scope: top toolbar; title field; undo/redo; theme/language/reset; Share/Present/Export; editor control chrome; inspector tabs; AI composer; trace presentation; authentication; landing page.

Unchanged assertion: same production route, deck identity, selected Overview tab, theme, inspector state, toolbar actions, evidence labels, and export/share availability. Any required change outside CHANGE A/B is a scope surprise and must be recorded before editing.
