# NodeSlide production visual-logic campaign

Run mode: **AUTHORIZED PRODUCTION** with disposable test decks.

## Decision

The production baseline is not agent-ready for unattended institutional distribution. Three
independent successful CLI generations reproduced the same failure class: unsupported hero
placeholders and prose labels were allowed to satisfy visual obligations. The deterministic
creation gate now rejects or repairs those primitives before materialization.

## Scenario corpus

The tracked corpus is in `scenarios.json`; `run-corpus.mjs` runs the same prompts through the built
CLI and records bounded, retry-aware results.

| Case | Real reference | User and distribution job | Expected visual proof |
| --- | --- | --- | --- |
| Earnings | SEC-filed Remitly FY2025 earnings deck | CFO/board pre-read and editable PPTX | sourced metrics/charts; no invented guidance |
| AI governance | NIST AI RMF 1.0 | bank risk committee operating brief | Govern/Map/Measure/Manage system, not a checklist |
| Health data | WHO RHIS analysis toolkit | district-manager training and monthly leave-behind | denominator logic, chart choice, uncertainty, action loop |
| Seed pitch | YC seed fundraising guidance | fictional startup investor meeting and forwardable leave-behind | pain → product → evidence → wedge → ask; synthetic values labeled |

## Before: production evidence

- Earnings: succeeded on attempt 2. The deck contained `0 cohorts`, an empty zero-value guidance
  chart, a screenshot placeholder caused by the negated phrase “no fake screenshots,” and a
  non-quantitative `Typed artifact` hero that overlapped its caption in the rendered PPTX.
- AI governance: both bounded attempts failed with an upstream server error. This remains a
  production-reliability signal; the harness did not relabel it as success.
- Health data: succeeded on attempt 1. It contained two `0 cohorts` heroes and a WHO screenshot
  placeholder, despite already having honest diagrams and an explicitly illustrative chart.
- Seed pitch: succeeded on attempt 1. It contained two `0 cots` proxy heroes and an opening image
  placeholder. The sequence had one useful workflow diagram and one illustrative traction chart,
  but repeated the same prose-heavy composition across unrelated narrative jobs.
- PowerPoint overflow automation passed all three successful decks, but full-size inspection found
  a metric/caption collision. The generic overflow test therefore remains necessary but
  insufficient.

## Root-cause chain

1. Keyword extraction treated any occurrence of `screenshot`, `image`, or `code` as a request and
   ignored nearby negation.
2. Design planning and visual-rhythm critique treated the presence of an image object as evidence,
   even when it had no renderable asset.
3. Any metric string—including `0 cohorts` and `Typed artifact`—reset the text-dominance counter.
4. Missing-truth chart bindings could occupy a dominant area with zero values.
5. The bounded critique loop could retain a known-bad first pass when the provider was degraded.
6. Metric height and caption position used fixed geometry, so long decision metrics could render
   beyond their nominal box without a safe gutter.
7. Story continuity was represented by a single growing line. It indicated progress, but did not
   visibly transform.

## Deterministic repair contract

- Negated material requests do not create proof obligations.
- Only embedded raster assets or valid videos count as renderable media.
- Dominant unresolved images are errors. When a slide has at least two real brief bullets and no
  competing visual, repair converts them into an editable evidence → claim map; otherwise the
  image is removed.
- Metrics must contain a numeric/currency/percentage/inequality or explicit decision-state signal.
- Missing-truth charts are removed rather than rendered as zero-value evidence.
- Visual primitives without authored truth state are errors when they dominate the slide.
- Story continuity has both a progress line and a transforming marker tied to reveal intensity.
- Long stat-panel metrics use measured height, a reduced font when needed, and a larger caption
  gutter.
- The report and repair stay bounded for a recurring 100-deck portfolio review.

## Verification

Before deployment:

- 51 focused visual-logic/layout scenarios passed.
- 2,716 repository/workspace tests passed; 7 unrelated tests were skipped by their suites.
- Typecheck, Biome, and the production build passed.
- The first combined `npm run check` wrapper was killed by the command timeout during package
  build, producing an EPIPE. Running its four gates independently proved each gate.

Production after-proof must use the same corpus and include:

1. CLI exit status and retry count.
2. Hosted reading view plus editable PPTX.
3. Render of every slide and deck montage.
4. Automated overflow check.
5. Human page-level and sequence-level inspection.
6. Raw production DOM signal after deployment.

## External taste and content references

- YC seed guide:
  <https://www.ycombinator.com/blog/this-brief-guide-is-a-summary-of-what-startup-founders-need-to-know-about-raising-the-seed-funds-critical-to-getting-their-company-off-the-ground>
- SEC Remitly filing:
  <https://www.sec.gov/Archives/edgar/data/1782170/000162828026009031/final4q25earningsdeck.htm>
- NIST AI RMF:
  <https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10>
- WHO RHIS toolkit:
  <https://www.who.int/publications/i/item/9789240063938>
- Mobbin Canva presentation-creation flow:
  <https://mobbin.com/flows/16ed12d5-4a57-435d-8fe0-d3b18c085885>
- Mobbin Pitch editor:
  <https://mobbin.com/screens/cc270921-5a03-41ac-9959-3642bcda9aca>

## Known boundary

A URL in a CLI prompt is still context text, not retrieved source material. The new gate prevents
that absence from being laundered into fake charts or screenshots; it does not implement a web
retrieval subsystem. Institutional source ingestion remains a separate agent-readiness capability
because it requires bounded reads, SSRF controls, provenance extraction, and attachment lifecycle
rules.
