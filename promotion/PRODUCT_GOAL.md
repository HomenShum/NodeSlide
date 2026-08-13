# Product goal — NodeSlide

## Who opens this, and what they are trying to finish

Someone has to stand up on Thursday and walk a room through a decision — a
diligence memo, an operating review, a board update — and the slides have to
survive being questioned. Today they either build the deck by hand over two
evenings, or they let an AI tool generate pictures of slides and then discover
the numbers cannot be traced, the chart cannot be re-pointed at the corrected
spreadsheet, and every small fix means asking for the whole thing again. They
arrive here with a brief and maybe a CSV, wanting a first draft in minutes that
they can then *edit like a document* rather than regenerate like an image. When
it worked, they leave holding a presentation they can open, change, and defend:
each slide made of real text, real charts bound to the data they attached, and a
visible record of what the AI changed and where each claim came from — plus a
PowerPoint file that still opens as editable shapes on someone else's laptop.
The technical shape of that promise is a canonical structured document
(a typed `DeckSnapshot`) that every change — human or agent — must pass through
as a reviewable, validated proposal.

## The gate

This repo is judged by the twelve-condition PROMOTION gate, which lives in one
place and is not restated here:

**https://github.com/HomenShum/NodeKit/blob/main/templates/promotion/GATE.md**

Gate variant: `full`

Scoring vocabulary is PASS / FAIL / **UNVERIFIED**, and UNVERIFIED is never PASS.

## Canonical journeys

The work queue lives in [PRODUCT_JOURNEYS.md](PRODUCT_JOURNEYS.md). A journey
without browser evidence is unfinished, however green the tests are.

## Loop state

Every iteration is recorded in [PROMOTION_LOG.md](PROMOTION_LOG.md) — journey
exercised, defect fixed, evidence path, conditions newly passing. Loop state
lives in git, never in an agent's memory, so any agent can resume the loop cold.

## Current scorecard

Baseline measured 2026-08-13 against a fresh clone of `main` (`4c6f9ba`) on
Windows 11 / Node, driven with Playwright Chromium 149 at 1280×800 and 390×844.
The app was reachable: `npx convex dev` provisioned an anonymous **local**
deployment with no account, and vite served the landing at `localhost:5180`.
The first real action a stranger takes — create a deck from a brief — failed
server-side, so every condition that depends on the deck editor was never
observed. Raw capture: `promotion/evidence/baseline/report.json`.

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | FAIL | J1 blocked: `createDeckFromBrief` returns `preview_not_configured` on a fresh local deployment — `promotion/evidence/baseline/j1-after-create.png`, `report.json` step `j1-create-deck`. Of six journeys, J0 (quickstart) and J4 (Artifact Atlas) completed; J1 and J5 failed; J2 and J3 were unreachable. |
| 2 | No critical or major usability defect open | FAIL | Two majors open with reproductions in [PROMOTION_LOG.md](PROMOTION_LOG.md): D1 (first-run create is blocked and the error names an internal concept with no next step), D2 (brief textarea and model select take keyboard focus with no visible focus indicator). |
| 3 | Mobile and desktop both intentional | UNVERIFIED | Landing observed and deliberate at both widths (`j1-landing-desktop.png`, `j1-landing-mobile-390.png`), but the deck editor — the surface that carries the product — never rendered, so the product-wide condition was not observed. |
| 4 | No horizontal overflow at supported widths | UNVERIFIED | Measured `scrollWidth == innerWidth` on landing at 390 and 1280 and on Atlas at 1280 (`report.json`). The editor and inspector panels were unreachable, so the widest surfaces were never measured. |
| 5 | Loading/empty/success/error/agent-running designed | UNVERIFIED | Loading is designed and observed ("Reading the brief and evidence…" plus elapsed timer and a 3-step explainer, `j1-creating.png`); the error state is styled and announced (`role="alert"` + toast, `j1-after-create.png`). Success, empty and agent-running were never reached. |
| 6 | Keyboard and basic accessibility pass | FAIL | Tab order is sane over the first 8 stops, but `#nodeslide-landing-prompt` (the main brief textarea) and `[data-testid="landing-model-select"]` report `outline: none` with no box-shadow substitute while focused — `report.json` step `keyboard-tab-order`. No axe/screen-reader pass was run. |
| 7 | Web Interface Guidelines: no major unresolved | UNVERIFIED | Review not run this session. |
| 8 | Web-quality audit: no major unresolved | UNVERIFIED | No Lighthouse / axe / Core Web Vitals run this session. |
| 9 | No unexplained console errors or failed requests | UNVERIFIED | Zero failed network requests and exactly one console error across the driven journeys, and that one is explained — it is D1's `ConvexError` surfacing (`report.json` `console`). Partial: the editor, agent run and export paths were never exercised. |
| 10 | Performance does not obstruct interaction | UNVERIFIED | No interaction beyond the landing was possible; no timings collected. |
| 11 | Tests and build green | FAIL | `npm test` → exit 1 (4 failed / 2757 passed / 7 skipped; all four are timeouts, plus three vitest fork workers that failed to start). `npm run build` → exit 1 twice out of two (`'tsup' is not recognized` inside `packages/convex`), while `npm run build --workspace @nodeslide/convex` alone → exit 0. Reproduction in [PROMOTION_LOG.md](PROMOTION_LOG.md). `npm run lint` → exit 0. |
| 12 | Verified in the rendered app, not inferred from code | UNVERIFIED | Nothing was improved this iteration, so there is nothing to have verified. Baseline only. |

**Status: NOT PROMOTED** — 0/12 PASS (4 FAIL, 8 UNVERIFIED).
