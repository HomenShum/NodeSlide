# Gap closure ledger - 2026-07-22

This is the compact source of truth for the "close them all" pass. It separates
implemented behavior, automated evidence, exact-main production evidence, and
human/external decisions. A checked implementation is not automatically a
checked deployment or taste result.

## Status vocabulary

- **implemented**: the integrated source tree contains the behavior and focused
  regression coverage.
- **automated verified**: a named receipt or completed gate proves the stated
  automated claim.
- **production verified**: the exact merged commit passed CI/deployment and the
  named post-deploy receipt.
- **human/external**: requires a real person's judgment, protected input,
  explicit budget, provider authorization, or separate routing approval.
- **optional depth**: useful native/semantic expansion beyond the current
  explicitly declared fallback contract; not silently counted as shipped.

## Exact release identity

The closure tree began from NodeSlide `origin/main`
`5ece3d2054b53f1597366acbd4a365c64e7e8cab`. The following fields must be filled
only from the final merged state:

| Gate | Status | Exact evidence |
|---|---|---|
| NodeSlide integrated local lint/typecheck/tests/package suites | passed locally | `npm run check`, the built-browser smoke gate, the isolated 11-package consumer, the external-agent/MCP tarball consumer, and the NodeGym portability proof passed on the release candidate. Exact-main CI remains a separate row. |
| NodeSlide final `main` SHA | pending | Not recorded yet. |
| NodeSlide exact-main CI | pending | Not recorded yet. |
| Convex/Vercel production deployment | pending | Not recorded yet. |
| Canonical live-DOM gate | pending | Not recorded yet. |
| Extended create/edit/reload/PPTX + ArtifactSpec/Gym shadow + retention probe | pending | Post-deploy zero-retention receipt not recorded yet. |
| Final offered-fleet probe | pending | The current source catalog has eight production-enabled routes. The historical 11/11 receipt below predates the admission/attribution hardening and is not final-commit proof. |
| Final free-router attribution/structured probe | pending | The five zero-priced routes are qualification candidates, not production offerings. Post-deploy text and structured-output receipts are not recorded yet. |
| Six-viewport light/dark UI QA | pending | The current acceptance receipt is pre-deploy red on both mobile themes. |
| NodeRoom Gym adoption `main` SHA and CI | passed | Adoption [PR #242](https://github.com/HomenShum/NodeRoom/pull/242) merged at `c9b699f416a68dfe29298d62b6559690c7ccaa6a`; exact-main [CI 29916176474](https://github.com/HomenShum/NodeRoom/actions/runs/29916176474), [conformance 29916177044](https://github.com/HomenShum/NodeRoom/actions/runs/29916177044), and [ProofLoop 29916176323](https://github.com/HomenShum/NodeRoom/actions/runs/29916176323) passed. Current NodeRoom main is `83f9b7442065652208f3a641e65bfed2752d5d13` after runtime-hardening [PR #243](https://github.com/HomenShum/NodeRoom/pull/243), with green exact-main [CI 29919737217](https://github.com/HomenShum/NodeRoom/actions/runs/29919737217), [conformance 29919737570](https://github.com/HomenShum/NodeRoom/actions/runs/29919737570), and [ProofLoop 29919737301](https://github.com/HomenShum/NodeRoom/actions/runs/29919737301). |
| NodeRoom/Node Platform Node 24 workflow closure | passed | [node-platform PR #8](https://github.com/HomenShum/node-platform/pull/8) merged at `5c9aa6443ca8e61dc8886fbf0a0b4a7b72858e63`; exact-main [quality 29918399950](https://github.com/HomenShum/node-platform/actions/runs/29918399950) passed with zero annotations. NodeRoom PR #243 pins checkout, setup-node, setup-python, upload-artifact, and github-script to verified immutable Node 24 releases; the final exact-main audit reports zero warnings and zero Node 20 annotations. |

The final NodeSlide SHA and the workflow/deployment/probe URLs are intentionally
post-merge evidence. Committing a purported "final main" SHA into this branch
would create a different commit and invalidate the claim. Append those immutable
coordinates to the merged closure PR and retain them in workflow artifacts; keep
the repository rows pending until that external evidence exists.

## Previously shipped product and operations gaps

These capabilities predate the current closure tree. Their evidence remains
valid for the narrow claim stated; the current release still needs the exact-main
reruns above where runtime code changed.

| Capability | Automated status | Evidence and limits |
|---|---|---|
| Production generation geometry/export | passed for the historical N=20 geometry contract | `artifacts/prod-proof-20260720/a5-generations.json`; proves geometry/publishability/archetype coverage, not visual richness. |
| Multi-model creation repair camera | passed in an explicitly development-only induced-fault run | `artifacts/camera-proof-20260720/b6-dev-repair/`; do not relabel the synthetic fault as a natural production repair. |
| Narrow formula browser geometry | passed | `docs/demo/nodeslide-b6-formula-css-proof.receipt.json`. |
| Historical mixed model catalog | 11/11 shallow routes returned text before this change | `artifacts/close-all-gaps-20260722/baseline/model-fleet-probe.json`; this pre-hardening receipt mixed paid/offered and free-candidate routes and did not require the current provider-returned `actualProvider`/`actualModel` fields. It is availability history, not current offered-fleet, deck-quality, or release evidence. |
| Stale-action reload UX | implementation and deterministic regression passed | `artifacts/camera-proof-20260720/stale-redeploy/` retains two non-reproduced production attempts; no live stale-banner camera claim exists. |
| Production Convex log observability | passed | `artifacts/convex-logs/production.jsonl`; 50 sanitized completion records, with no messages or credentials. |
| Assistant streaming and nested handoffs | passed on deployed product | `docs/CAPABILITY_PLAN.md` G2-G3 records exact deployed SHA, incremental DOM state, nested Kimi/Gemini spans, review card, and zero errors. |
| Isolated Convex component | passed | `docs/CAPABILITY_PLAN.md` I2 records isolated schema/functions/generated API, migrations, one-time authorization grants, and `convex-test` journey coverage. |
| Mounted NodeRoom authorization/full journey | passed for NodeSlide engine v0.2.2 | NodeRoom PRs #234-#236 and `docs/CAPABILITY_PLAN.md` I4/I7/I8; browser receipt, screenshot, video, PPTX, authorization, CAS, reload, and bilateral CI are recorded there. No NodeRoom production Convex deployment is claimed. |
| Immutable install/upgrade | passed for v0.2.2 | `docs/CAPABILITY_PLAN.md` I6; byte-identical Ubuntu producers, manifest SHA-256 `3930276da868ab25853a7857cb5c2ddab724d9931eabb3e5fb499394a806856a`, clean v0.1.0 -> v0.2.2 upgrade, integrity pins, tamper/mixed rejection. |
| GitHub production deployment configuration | passed for the existing repository environment | `artifacts/github-production-environment.json`; names/policy only, no secret values. The current closure commit still needs its own exact-main workflow. |

## Current automated implementation ledger

| Area | Implementation | Integrated/final evidence | Honest boundary |
|---|---|---|---|
| Shared canonical ArtifactSpec | implemented | focused registry/authored/seed/export tests and the full local integrated gate passed; exact-main CI pending | `nodeslide.artifact-spec/v1` has 16 kinds before geometry. The old four-shape version is legacy-read compatibility; the eight-kind projection remains downstream output, not intent. |
| Evidence-class and provenance security | implemented | focused authored-artifact adversarial tests passed | Brief/criteria cannot claim observed status; unfetched links are not evidence; observed claims require immutable upload/runtime receipts. Safe HTTPS/source URLs, exact authorized receipt digests, and SHA-256 authored/geometry/materialization/projection/render lineage fail closed. Public/client copies strip or reject model-authored receipts. Exact-main production proof remains pending. |
| Remote media privacy and source admission | implemented | focused browser/package/HTML/Openverse regressions passed | Embedded raster images are bounded PNG/JPEG/WebP/GIF data URLs. Remote images remain withheld from browser, package viewer, HTML, and PPTX paths; remote video/poster/caption URLs do not enter the DOM until explicit user activation. Openverse metadata is queried only after consent, thumbnail URLs are derived from bounded ids, commercial-license metadata is required, thumbnail downloads omit credentials/referrers and fail on redirects/oversize bodies, and private/credential hosts are rejected. Exact-main browser proof remains pending. |
| Canonical source/provenance persistence | implemented | focused authored/seed/export tests and the full local integrated gate passed; exact-main CI pending | Primary elements preserve authored ID, narrative job, claim IDs, resolved sources, truth, rationale, digest, fidelity, typed legacy recovery, native geometry digest, and render lineage. Legacy keyword inference is used only when no authored binding exists. |
| Canonical compilers and native geometry | implemented | 17/17 focused geometry/authored/HTML-PPTX tests passed; full integrated/live gate pending | All 16 kinds retain an honest mode. Waterfall, Sankey, Gantt, risk-matrix, trace, and spatial-scene now materialize before generic fallback as source-bound grouped editable shapes/connectors/text. Focused waterfall proof finds semantic HTML and editable `<p:sp>` objects with no chart-XML fallback; remaining research-grade depth is not implied. |
| Authenticated ArtifactSpec/Gym shadow receipt | implemented | exact-main production probe pending | Read-only, sanitized, content-free counts/digests; no output, routing, or auto-apply mutation. |
| Offered/free model admission and receipt attribution | implemented | focused catalog, provider-consent, admission, fleet, and adversarial receipt tests passed | Only the eight `productionEnabled` routes are accepted by production generation. The five zero-priced routes remain Gym/qualification candidates. A fleet pass requires the provider-returned actual provider/model and output presence/bytes; dynamic `openrouter/free` cannot pass by echoing its alias. Model/error text is never persisted in the fleet receipt. |
| Assistant stream monotonicity and handoff closure | implemented | focused stream/recovery tests passed | Persisted stream updates may only extend the existing prefix; summaries cannot rewrite it. Entering review/terminal state interrupts every open stream, and stale-run recovery uses the same closure path. This is implementation evidence, not a new live camera claim. |
| Deck Gym configuration | automated verified | `artifacts/node-gym/nodeslide-deck-gym-v2/configuration-validation.json` | 720 planned runs = 8 tasks x 6 cohorts x 5 harnesses x 3 repetitions; this is not 720 completed live runs. |
| Executable harnesses and protected fixtures | implemented | focused runner/semantics tests and the full local integrated gate passed; exact-main CI pending | Five real prompt/context/tool/schema/repair contracts. The persisted matrix must equal the exact ordered regeneration of its raw config bytes. Resume validates every immutable historical receipt and pre-accounts paid failures in cumulative cost/failure budgets before scheduling. Protected descriptors are allowlisted/sealed; unavailable pools are excluded by default; paths, child env, UI projection, and persisted output fail closed on leaks. |
| Evidence evaluator and causal pairing | implemented | r2 refusal and r4 complete control both retained | The evaluator requires normalized specs, all fixture claims/facts, exact route, per-slide/browser/PPTX/PDF/montage/source lineage, observable harness behavior, and matched pairs before a causal claim. |
| Fail-closed deterministic control history | automated verified red | `artifacts/node-gym/nodeslide-deck-gym-v2/campaigns/semantic-contract-v2-control-failclosed-r2/summary.json` | 0/2, $0: missing behavior/lineage was rejected. It remains regression history and was not rewritten green. |
| Current deterministic semantic control | automated verified for one narrow pair | `artifacts/node-gym/nodeslide-deck-gym-v2/campaigns/semantic-contract-v2-control-complete-r4/summary.json` | 2/2, $0, one complete paired harness-control report and `pairedCausalClaimReady: true`; browser/PPTX/PDF/montage/spec/fact/source/harness evidence is bound. `promotionEligible: false`, human preference `not_run`; this is not a live-model, 720-run, route-promotion, or public-release result. |
| Free-model historical attempts | automated verified red | campaign summaries under `artifacts/node-gym/nodeslide-deck-gym-v2/campaigns/` | Gemma/GPT-OSS failures are retained; missing route/spec/cross-format evidence is not rewritten green. |
| Curriculum/diagnosis/capability cards | implemented | focused package/runner tests reported passing | Contracts are keyed by model x harness x role x task x repetition. No held-out boundary-moving experiment has run. |
| Champion/challenger policy | implemented | focused package tests reported passing | Multi-harness/model identity, hard gates, stable repeats, economics, and human review are required; `autoApply` remains `false`. No challenger is eligible. |
| UI/PPTX/PDF evidence envelope | implemented | 31 focused tests plus PDF extraction smoke passed; live run pending | `nodekit.gym-ui-evidence-envelope/v1` requires real relative files, bytes and SHA-256 for editor, every browser/PPTX/PDF slide, montage, exact normalized specs, claim/fact/source lineage, route/harness trace effects, and retention cleanup. Missing evidence fails the executor. No post-deploy UI campaign is claimed. |
| Protected-fixture retention | implemented | focused retention and receipt-validation tests passed; live receipt pending | Gym UI runs use the owner-authenticated `nodeslide.workspace-retention-receipt/v1` cascade. The production probe binds a one-use cleanup lease before submission, persists only its digest with a two-hour expiry, deletes by exact digest + client session even if the create response is lost, and has a bounded cron sweeper as crash backstop. A missing/malformed receipt or any retained deck/source/project row fails closed. |
| Safe training envelope and typed pairs | implemented | focused package tests passed | Only accepted public-development observable episodes can qualify; consent/license/provenance/deletion lineage, redaction, deduplication, and holdout checks fail closed. `nodekit.gym-training-pair/v1` requires an observable correction/repair and immutable accepted/rejected lineage. No real training corpus or fine-tuning is claimed. |
| Provider-neutral checkpoint replay | implemented | focused fake-adapter/holdout tests passed | `nodekit.gym-checkpoint-replay/v1` verifies checkpoint identity, disjoint holdouts, immutable lineage, `autoApply: false`, and no routing mutation. External checkpoint training throws without separate authorization; no provider training was run. |
| Governed routing and escalation | implemented as portable policy | focused routing tests passed; no production adoption | Shadow is user-invisible; production selection requires exact current approval, budget and closed circuit. Typed ambiguity, evidence gaps, repeated failures, and out-of-distribution input escalate. No approved challenger or user-visible route mutation exists. |
| Portable `@nodekit/gym-core` | automated verified | `artifacts/node-gym/node-gym-core-portability-proof.json` | Exact `0.0.1 -> 0.1.0` packed install/upgrade, SHA/integrity/lock/declarations/runtime proof in isolated NodeSlide and NodeRoom-domain consumers. It is not direct NodeRoom repository adoption. |
| Direct NodeRoom Gym consumer | merged and exact-main green | exact candidate stage, `npm ci`, direct `nodegym:consumer:proof`, consumer tests, both required NodeAgent smokes, NodeRoom TypeScript, production gate, ladder, and packed mounted-consumer journey passed in PR and exact-main CI | Exact `@nodekit/gym-core@0.1.0` SHA-256 `b8c14013a54fc7419ebfda806553573c4b6e3d1dde2a17f11a61f5ddd88fc0c2`, npm integrity `sha512-jzQ7eapfnmwnBJZyh0SfOJkXhGFHDRQo30uU3rpRAWwp7T8QcP6OwloLTciTsvr4ICEHDMmNM+JoouELSHMa1Q==`; release lock, stage receipt, package lock, and consumer receipt match. Adoption is [PR #242](https://github.com/HomenShum/NodeRoom/pull/242); current warning-free main/evidence is the PR #243 chain recorded above. The six-run/three-pair journey remains HOLD with `autoApply: false`, no user-visible fallback, and unchanged human state. |
| Artifact Atlas V2 repairs/inspection | automated plus attributed presentation inspection passed | `artifacts/deck-gym/artifact-atlas-v2/receipts.json`, `docs/demo/nodeslide-artifact-semantics-v3/visual-inspection.json`, and `docs/demo/nodeslide-artifact-semantics-v3/v2-issue-ledger.json` | 38 hard-gate receipts, digest-bound Codex inspection, and a tested 23-entry issue-to-slide/artifact/validator/repair ledger. Independent blind audience preference remains open. |
| Artifact Atlas V3 | reproducible release candidate built and inspected | `outputs/artifact-atlas-v3/` contains the 43-slide PowerPoint, build recipe, lineage/evidence/campaign/gate receipts, 43 rendered frames, contact sheet, visual-inspection receipt, and blind-review manifest; artifact-specific receipt/round-trip/static tests pass | It binds the planned-matrix configuration and retained campaign history but does not claim 720 live runs. Production journey/fleet and blind preference remain pending; `publicReleaseApproved: false`, `promotionEligible: false`, and human preference `not_run`. |
| Mobile theme reachability | implemented in CSS + focused regression | exact-main six-viewport production rerun pending | Red-before receipt: `artifacts/close-all-gaps-20260722/acceptance/ui-qa/receipt.json`. |

## Human/external gates - intentionally open

- [ ] Supply authorized hidden/rotating/live-shadow runtime fixtures and an
  explicit total cost cap.
- [ ] Run a coverage-balanced live matrix with at least three matched
  repetitions where promotion evidence is sought.
- [ ] Obtain independently identified, blind comprehension and preference
  judgments for eligible pairs.
- [ ] Produce a stable held-out challenger result, or record the honest measured
  ceiling if none qualifies.
- [ ] Approve any production routing change separately. Shadow evidence cannot
  mutate the user-visible route.
- [ ] Approve public Atlas release/promotion only after exact-main production
  proof, the authorized live matrix, and blind human review. Until then
  `publicReleaseApproved` and `promotionEligible` remain `false`.
- [ ] If fine-tuning is desired, separately authorize licensed/consented data,
  privacy/deletion controls, holdouts, contamination review, current provider
  APIs, and budget. Fine-tuning is optional and is not a NodeSlide release gate.

## Remaining optional technical depth

The first formerly optional audit is now closed; the unchecked entries remain
genuine technical extensions not represented as complete:

- [x] Historical V2 issue audit ledger. The 23-entry machine-readable map at
  `docs/demo/nodeslide-artifact-semantics-v3/v2-issue-ledger.json` binds every
  issue to its slide/artifact, validator owner, repair status/evidence, exact V2
  PowerPoint digest, and visual-inspection digest; the dedicated adversarial
  test validates those bindings.

- [ ] Extend render handles and immutable candidate-render lineage from the
  canonical authored compiler and UI evidence envelope to every remaining
  artifact tool surface; wire the implemented typed escalation policy into the
  exact-main production router only after separate approval.
- [ ] Add dimensional unit algebra; graph reachability/crossing checks; native
  Sankey optimization/width assertions; first-class chart uncertainty/missingness; evidence
  freshness/DOM/OCR/product-version validation; raw statistic reproduction;
  comprehensive non-color encoding; and automated deck rhythm issue codes.
- [ ] Deepen the six new native families beyond their declared v1 geometry:
  proportional Sankey routing/crossing minimization, Gantt calendar/critical-path
  semantics, trace aggregation, risk thresholds, and spatial viewport fidelity.
- [ ] Run the evidence-complete production/UI executor after exact deployment;
  implementation and focused tests are not a live receipt.
- [ ] Populate a lawful accepted/rejected corpus and authorize any external
  checkpoint provider separately. The pair builder and fake replay boundary are
  implemented; real training remains intentionally absent.

## Close-out rule

The NodeRoom and Node Platform rows above are closed with immutable SHAs and
exact-main workflow URLs. Move the remaining NodeSlide rows to passed only after
its final SHA, workflow URLs, deployed frontend/backend identity, and post-deploy
receipt paths are appended to the merged closure PR or retained workflow
artifacts. Do not create a self-invalidating follow-up commit merely to embed its
own SHA. Only a human reviewer may close blind preference. Only an explicitly
authorized experiment may close live-matrix or fine-tuning gates.
