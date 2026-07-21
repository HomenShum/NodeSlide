# NodeSlide production camera evidence — 2026-07-20

Run mode: **AUTHORIZED PRODUCTION** on the disposable canonical sample deck. No deck was published or shared. Both assistant proposals were rejected after evidence capture.

Exact deployment: `d1119ae664cda26e3b183350c34f91ae4da9ca41`, GitHub Actions deployment run `29791509370` (`success`).

## Verdicts

- **G2/G3 — PASS.** The exact prompt emitted a genuine streaming message (`data-stream-state="streaming"`) with the live cursor present. It then produced a reviewable two-operation patch, a Kimi K3 planner → Gemini 3.5 Flash executor handoff, and an auditable trace with `5,885 → 435` tokens, `$0.0046` nonzero cost, 8 spans, 16 records, zero errors, and a level-3 executor child beneath the level-2 planner.
- **E4 — BLOCKED after two attempts.** Openverse search itself passed: exact consent copy, query `circuit board`, and 8 commercially licensed results. Inserting the first visible Twechie result failed at `nodeslide:applyPatch` twice (request IDs in `receipts.json`), leaving the placeholder and credit unchanged. The export menu still truthfully offers web-native HTML and editable PPTX with fallbacks.
- **F1/F2/F4 — BLOCKED after two attempts.** The consent toggle was on, but production explicitly returned: `Web research is not configured on this deployment. No search request was sent.` No proposal or mutation occurred. The Evidence tab retained only its two preloaded internal/note sources and exposed zero snapshot toggles, regions, or highlights. No fixture source was presented as live-research proof.

`receipts.json` contains the DOM assertions, telemetry, bounded-attempt record, deployment provenance, screenshot map, and hashes.

## Screenshot map

- `g2-genuine-streaming.png` — captured concurrently with the streaming DOM receipt; the in-flight composer is visible while the newly emitted text was below the inspector's scroll position.
- `g2-inflight-composer-before-stream.png` — the same run immediately before the streamed message appeared.
- `g3-reviewable-patch-nested-handoff.png` — side-by-side candidate plus Kimi → Gemini handoff and Accept/Reject controls.
- `g3-trace-tokens-cost.png` — compact receipt with model, tokens, cost, validation, and span counts.
- `g3-parent-child-trace-waterfall.png` — expanded parent/child trace waterfall.
- `e4-openverse-results-before-insert.png` — placeholder, consent copy, exact query, and eight licensed results.
- `e4-insert-attempt1-server-error.png`, `e4-insert-attempt2-blocked.png` — both fail-closed applyPatch errors.
- `e4-export-capability-menu.png` — HTML/PPTX capability truth.
- `f4-attempt1-research-not-configured.png`, `f4-attempt2-blocked-not-configured.png` — both bounded failures.
- `f4-evidence-tab-no-web-snapshot-after-failure.png` — no web snapshot state after the failed runs.
