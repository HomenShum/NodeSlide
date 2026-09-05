# Next session: finish evidence, preserve honest boundaries

Last updated 2026-07-22.

`origin/main` was `5ece3d2054b53f1597366acbd4a365c64e7e8cab` when this
closure pass began. The implementation described below was reviewed from the
dirty closure tree; it is not a production claim until its exact commit passes
CI, deployment, and the post-deploy probes. Record the final SHA and run URLs in
the merged closure PR and workflow artifacts instead of copying this baseline
SHA forward. That evidence is necessarily external to the commit it identifies:
committing a purported final SHA would create a new SHA and invalidate itself.

Start with `docs/CAPABILITY_PLAN.md`, which is the checked/open ledger. Read
`docs/PRODUCTION_ARTIFACT_BOUNDARY.md` before changing ArtifactSpec code. The
long-form phase design in `docs/ARTIFACT_SEMANTICS_MODEL_GYM_GOAL.md` remains
useful context, but its original unchecked implementation list is not the
current status ledger.

## What is already shipped and must not be reopened casually

- The production app, Convex/Vercel deployment workflow, canonical live-DOM
  gate, scheduled probes, logging diagnostics, stale-action reload UX, assistant
  streaming/nested handoffs, camera/screenshot capture, editable PPTX export,
  web research, and bounded model probing already have shipped code and retained
  receipts. The current offered catalog and the separately non-offered free
  qualification catalog must be read from `shared/nodeslide.ts`, not inferred
  from an older probe.
- The GitHub `production` environment is configured for `main`; the sanitized
  configuration receipt is `artifacts/github-production-environment.json`. It
  records names and policy, never secret values. The earlier setup note in the
  README was stale and has been removed.
- Package release `v0.2.2` remains the accepted immutable NodeSlide engine
  release. Its exact build/install/upgrade and NodeRoom mounted journey evidence
  remain valid for that package line. Do not rewrite the superseded `v0.2.1`
  reproducibility failure as a pass.
- The stale-socket banner is implemented and regression-covered. Two bounded
  production timing attempts did not naturally reproduce a stale-action
  rejection, so there is no live stale-banner camera claim. Reopen only if a
  natural rejection supplies that exact production condition.
- The mixed catalog was green before this closure pass. The baseline receipt at
  `artifacts/close-all-gaps-20260722/baseline/model-fleet-probe.json` records
  11/11 shallow routes returning text, but it predates the current eight-route
  production admission boundary, five-route free-candidate catalog, and required
  provider-returned `actualProvider`/`actualModel` attribution. It is historical
  availability evidence, not current offered-fleet or release status.
- The Mike draft was already sent by the user. Never create or send another.

## Closure implementation now in the tree

### 1. Typed artifact boundaries

Do not use “ArtifactSpec v1” as if it named one interchangeable schema.

| Boundary | Version | Scope | Honest claim |
|---|---|---:|---|
| Canonical authored ArtifactSpec | `nodeslide.artifact-spec/v1` | 16 kinds | Shared runtime/provider/tool boundary before geometry, with task-scoped schemas and fail-closed source binding. |
| External canonical schema | `nodeslide.artifact-spec/v1` | 16 kinds | Checked-in JSON Schema for tool consumers; runtime validation remains authoritative for semantic invariants. |
| Legacy provider read adapter | `nodeslide.production-authored-artifact/v1` | 4 old shapes | Chart/graph/equation/metric compatibility only; input normalizes immediately to the canonical spec. |
| Authored compiler receipt | `nodeslide.production-authored-artifact-receipt/v2` | digest-exact | Server-recomputed evidence class, source receipt, spec, typed recovery, native geometry, base/materialization/projection, and render-handle lineage. |
| Native artifact geometry | `nodeslide.artifact-geometry/v1` | 6 advanced families | Waterfall, Sankey, Gantt, risk-matrix, trace, and spatial-scene become grouped editable shapes/connectors/text before generic fallback. |
| Persisted authored binding | `nodeslide.authored-artifact-binding/v1` | 16 kinds | Preserves identity, narrative job, claims, sources, truth, rationale, digest, and declared fidelity on primary elements. |
| Production snapshot projection | `nodeslide.production-artifact-spec/v1` | 8 kinds | Deterministically reconstructed from a materialized `DeckSnapshot` for semantic/export gating. |
| Production graph binding | `nodeslide.production-artifact-binding/v1` | graph node/edge roles | Persists identity and direction that geometry cannot reconstruct safely. |
| Production compiler receipt | `nodeslide.production-artifact-compilation-receipt/v1` | digest-bound | Proves the regenerated downstream projection passed or failed. |
| Workspace retention receipt | `nodeslide.workspace-retention-receipt/v1` | sanitized counts/digest | Owner-authenticated Gym/UI cleanup proves zero remaining deck/source/project rows without retaining a deck ID or owner key. |
| Production-probe retention receipt | `nodeslide.production-probe-retention-receipt/v1` | one-use cleanup binding | A pre-submit session lease can delete the exact synthetic workspace even if the create response loses the deck ID/owner key; only the digest is persisted and a bounded expiry sweeper is the crash backstop. |

The production projection covers generic, metric, comparison, statement, chart,
graph, equation, and evidence-media. It preserves explicit `observed`,
`derived`, `estimated`, `illustrative`, `missing`, and `not-run` provenance;
unknown versions, kinds, shapes, or promoted truth states fail closed.

Provider schemas ask only for the six core kinds plus advanced kinds selected
from the brief. Canonical specs validate and resolve server-owned source refs
before geometry. Brief/criteria cannot become observations, unfetched links are
not evidence, and observed claims require immutable upload/runtime receipts with
safe HTTPS/source and exact receipt-digest binding. The server recomputes SHA-256
spec/geometry/materialization/projection/render lineage and strips or rejects
model-authored receipts at public/client boundaries. The normalized spec and
compiler receipt persist in creation state; materialized primary elements retain
a digest-bound authored binding. Creation, candidate validation,
edit/repair/propagation, variation persistence, rendering, JSON download, HTML,
and PPTX also use the separate downstream compiler gate. The authenticated
ArtifactSpec shadow endpoint and Gym shadow route are read-only, sanitized,
user-invisible, and cannot auto-apply or mutate routing.

The architecture boundary is now version/fidelity, not missing 16-kind access:
the old four-shape contract is read compatibility only; the eight-kind
projection describes materialized output and must not be relabeled as authored
intent. Six advanced families now have declared grouped-editable native geometry;
remaining semantic/static fallbacks must not be advertised as native.
See `docs/PRODUCTION_ARTIFACT_BOUNDARY.md` for the exact per-kind contract.

### 2. Executable NodeGym and safe evidence

The Gym is now more than a model list or prompt label:

- `npm run node-gym:validate` currently reports a 720-plan matrix:
  8 tasks × 6 model/router cohorts × 5 harnesses × 3 repetitions. This is a
  validated experiment plan, not 720 completed model runs;
- five harness profiles compile into immutable prompt, context, tool,
  response-schema, and repair contracts;
- model comparison keys and stricter model-inclusive harness comparison keys are
  distinct, and bounded selection does not orphan one side of a pair;
- curriculum levels 1–8 are represented; public fixtures are committed while
  hidden-validation, rotating-challenge, and live-shadow fixtures must arrive
  through authorized runtime input and contribute only sealed digests. Protected
  fixture descriptors are allowlisted, raw payload environment variables are
  removed from child processes, paths are contained, and persisted output is
  recursively rejected if protected strings leak;
- the runner binds the persisted matrix to the exact raw configuration bytes and
  exact regenerated run order, is resumable and immutable per attempt, validates
  every historical receipt before reuse, pre-accounts historical paid failures
  in cumulative cost/failure budgets, remains pair-safe/circuit-broken, and
  validates the actual returned route;
- evaluation binds normalized specs, numeric facts/claims, sources,
  per-slide/browser/PPTX/PDF/montage evidence, and cross-format lineage;
- matched deltas, confidence intervals, capability cards, and anonymized
  blind-review packets are derived from receipts rather than prose;
- promotion remains advisory with `autoApply: false`;
- training export accepts only eligible public-development episodes and fails on
  missing license/consent/provenance/deletion lineage, secrets/PII, duplicate or
  deleted episodes, or holdout contamination;
- `nodekit.gym-training-pair/v1` requires an observable correction/repair and
  immutable accepted/rejected/source lineage; provider-neutral
  `nodekit.gym-checkpoint-replay/v1` is tested with a local fake adapter and
  disjoint holdouts, while external training requires separate authorization;
- governed route selection checks task-class eligibility, evidence digest,
  metadata freshness, cost cap, circuit state, and exact current
  `nodekit.gym-routing-approval/v1`; typed ambiguity, evidence, semantic, and
  repeated-failure conditions escalate without mutating routing;
- `nodekit.gym-ui-evidence-envelope/v1` requires real bytes/SHA-256 for the
  editor, each browser/PPTX/PDF slide, montage, specs, claims/facts, sources,
  route/harness effects, and cleanup. Protected Gym creation fails unless its
  owner-authenticated retention receipt proves zero remaining deck/source rows;
  the production journey uses the separate pre-submit cleanup lease below.

Portable `@nodekit/gym-core@0.1.0` is dependency-free. The receipt
`artifacts/node-gym/node-gym-core-portability-proof.json` proves exact packed
clean install and `0.0.1 → 0.1.0` upgrade, SHA/integrity/lock pins, declarations,
runtime exports, and isolated NodeSlide plus NodeRoom-domain consumers. That
receipt is deliberately an isolated portability proof, not direct repository
adoption. A clean NodeRoom integration branch produced a real
room-change-review consumer and a six-run, three-pair deterministic journey.
Exact candidate staging, `npm ci`, direct `nodegym:consumer:proof`, consumer
tests, both required NodeAgent smokes, and TypeScript are green; release lock,
stage receipt, package lock, and consumer receipt agree on the same bytes.
NodeSlide/NodeRoom CI definitions now exercise the pack/stage/direct-proof path.
Direct adoption landed in [NodeRoom PR #242](https://github.com/HomenShum/NodeRoom/pull/242)
at `c9b699f416a68dfe29298d62b6559690c7ccaa6a`; exact-main
[CI](https://github.com/HomenShum/NodeRoom/actions/runs/29916176474),
[conformance](https://github.com/HomenShum/NodeRoom/actions/runs/29916177044),
and [ProofLoop](https://github.com/HomenShum/NodeRoom/actions/runs/29916176323)
passed. Node 24 workflow hardening landed in
[NodeRoom PR #243](https://github.com/HomenShum/NodeRoom/pull/243), leaving
current main `83f9b7442065652208f3a641e65bfed2752d5d13` with green exact-main
[CI](https://github.com/HomenShum/NodeRoom/actions/runs/29919737217),
[conformance](https://github.com/HomenShum/NodeRoom/actions/runs/29919737570),
and [ProofLoop](https://github.com/HomenShum/NodeRoom/actions/runs/29919737301),
plus zero warning and zero Node 20 annotations. The reusable producer is
[node-platform PR #8](https://github.com/HomenShum/node-platform/pull/8), merge
`5c9aa6443ca8e61dc8886fbf0a0b4a7b72858e63`, exact-main
[quality](https://github.com/HomenShum/node-platform/actions/runs/29918399950).
The user's unrelated dirty checkout remains untouched. The exact candidate tarball SHA-256 is
`b8c14013a54fc7419ebfda806553573c4b6e3d1dde2a17f11a61f5ddd88fc0c2`;
the committed consumer receipt is `docs/eval/node-gym-consumer-proof.json` in
NodeRoom.

### 3. Atlas V3 candidate and retained red runs

`outputs/artifact-atlas-v3/` contains the reproducible 43-slide candidate, typed
artifact lineage, campaign ledger, PowerPoint, all 43 round-trip rendered
slides, contact sheet, evidence/PPTX/visual-inspection receipts, build recipe,
and blind-review manifest. Artifact-specific receipt, round-trip, and static
inspection tests pass. The source museum remains digest-bound to the
independently audited V2 deck; V3 layers evidence instead of rewriting historical
pixels. Candidate existence is not public release or human approval.

Current campaign truth:

- the retained r2 deterministic light/structured control is an honest 0/2 at
  zero provider cost: both attempts lack observable harness behavior, normalized
  claim/fact bindings, per-slide evidence, montage, and source lineage, so it
  proves fail-closed refusal;
- the corrected r4 deterministic control is 2/2 at zero provider cost with one
  complete paired report, exact normalized equation facts, observable harness
  effects, browser/PPTX/PDF/montage artifacts, and source lineage;
- r4 `pairedCausalClaimReady: true` applies only to that one deterministic
  harness-control pair. `promotionEligible` remains `false` and human preference
  is `not_run`;
- bounded Gemma and GPT-OSS free-route attempts are retained as
  provider/degraded/artifact failures because exact route, typed spec, or
  cross-format evidence was incomplete;
- those red attempts are useful evaluator/failure-diagnosis evidence, not a
  deterministic or free-model quality result, harness winner, or promotion basis;
- no full live matrix or eligible blind pair has completed;
- `publicReleaseApproved` and `promotionEligible` remain `false`.

The V3 candidate binds the 720-plan configuration digest and the current control
receipt at
`artifacts/node-gym/nodeslide-deck-gym-v2/campaigns/semantic-contract-v2-control-complete-r4/summary.json`
while retaining r2 as red regression history. Rebuild the matrix, evidence
candidate, PowerPoint, renders, montage, and blind manifest together after any
digest-affecting change. Never mix a new matrix digest with an old campaign
ledger or call completed red runs “missing work.”

### 4. UI and production probe closure candidate

- `scripts/capture-gap-closure-ui-qa.mjs` records the red-before UI pass. Desktop
  and tablet were clean; mobile light/dark found that the theme toggle was
  unreachable.
- The mobile toolbar CSS now keeps a 30 × 30 theme toggle visible and has focused
  regression coverage. It still needs the same production six-viewport rerun
  after exact deployment before the red finding can be marked green.
- `scripts/prod-probe.mjs` now extends create → reload → edit → PPTX evidence with
  authenticated, sanitized, read-only production ArtifactSpec compilation and
  deterministic Gym shadow receipts. Before submission it plants a random
  one-use cleanup lease in the disposable browser session; the server persists
  only its digest and expiry. The finally path deletes the exact tagged workspace
  by digest + client session even if the create response was lost, while a
  bounded cron sweeper handles runner crashes. A submitted creation without a
  valid `nodeslide.production-probe-retention-receipt/v1` reporting zero
  remaining deck/source rows fails the entire probe; the mutation separately
  verifies that the project row is gone before it can issue that receipt.
- `scripts/node-gym-ui-executor.mjs` now builds
  `nodekit.gym-ui-evidence-envelope/v1` from real editor/per-slide browser/PPTX/
  exact-PDF-page/montage bytes and SHA-256 plus normalized spec, claim/fact,
  source, route/harness, and cleanup lineage. Focused tests and PDF extraction
  smoke pass; no live production UI campaign has used this final envelope yet.
- The pre-change baseline create/edit/reload/PPTX proof is
  `artifacts/close-all-gaps-20260722/baseline/prod-probe.json`.

## Exact remaining gates

These are not interchangeable; close only the gate whose named evidence exists.

### Code/repository release gates

1. Run the complete integrated gate once on the settled tree and record one clean
   receipt. Focused ArtifactSpec/provenance/native-geometry, privacy, retention,
   deployment-identity, model-attribution, stream/recovery, UI-evidence, Gym,
   portability, Atlas, and NodeRoom tests are green, but intermediate suites are
   not a substitute for the final integrated run.
2. Run `npm run check`, `npm run packages:build`, the portability proof, Atlas V3
   build/render/static inspection, and repository smoke gates.
3. Commit intentionally, push, merge to `main`, and require exact-main CI plus
   Convex/Vercel deployment and canonical live-DOM success. Append the merged SHA
   and immutable run URLs to the closure PR/workflow artifacts; do not create a
   self-referential follow-up commit to record its own SHA.
4. After deployment, run the extended production probe (including zero-retention
   cleanup), the current eight-route offered-fleet probe, the separately
   non-offered five-route free-router text and structured qualification probes,
   and desktop/tablet/mobile × light/dark UI QA. Bind every receipt to the final
   commit and deployed frontend/backend identity. A red free-candidate route
   remains non-offered; it is not silently promoted or rewritten green.
5. Treat direct NodeRoom adoption as a closed prerequisite: PRs #242 and #243,
   current main `83f9b7442065652208f3a641e65bfed2752d5d13`, and the exact-main URLs above
   are authoritative. Rerun that chain only if package bytes or the consumer
   contract change; never touch the user's unrelated dirty checkout.

### Optional fidelity-depth backlog (not hidden release claims)

The 16-kind model-spec-first architecture is implemented. These narrower
research/native-depth items remain explicit rather than being smuggled into a
green architecture checkmark:

1. Deepen the six grouped-editable native families beyond their declared v1
   geometry: Sankey proportional routing/crossing minimization, Gantt calendar/
   critical-path semantics, trace aggregation, risk thresholds, and spatial
   viewport fidelity.
2. Versioned fields and validators for unit algebra, graph reachability/crossing,
   chart uncertainty/missingness, capture freshness/DOM bounds, raw-statistic
   reproduction, non-color encoding, and automated whole-deck rhythm.
3. Extend the implemented authored-compiler render handles, immutable lineage,
   and typed escalation policy to every remaining tool surface and, only after
   approval, the production router.

These are real quality-depth extensions. They are not required to claim the
current declared v1 behavior, and deeper claims need their own fixtures and
cross-format proof.

### Human/external gates

1. Supply authorized protected task fixtures and an explicit cost cap, then run
   the coverage-balanced live matrix with repeated matched comparisons.
2. Obtain real blind comprehension/preference judgments for eligible pairs.
   Automated semantic scores cannot fill this field.
3. Approve any production routing change separately after a stable challenger
   exists. Shadow results never auto-promote.
4. Fine-tuning is optional and outside NodeSlide release. It requires separately
   authorized licensed/consented data, privacy/deletion controls, clean holdouts,
   contamination checks, a budget, and an approved experiment. Do not fabricate
   these prerequisites.
5. Public Atlas release/promotion remains closed until exact-main production
   evidence, the authorized live matrix, and blind human review are all recorded.

## Useful gates

```bash
npm run check
npm run packages:build
npm run proof:node-gym-portability
npm run node-gym:validate
npm run node-gym:run -- --help
node scripts/build-artifact-atlas-v3.mjs
node scripts/smoke.mjs
```

Use the production commands only after the exact matching commit is deployed.
Never run a broad paid matrix without the user's explicit budget and protected
fixtures.

## Traps already paid for

- Do not weaken fail-closed validation or delete red attempts to make an
  aggregate green.
- Do not conflate the 16-kind canonical authored spec, its four-shape legacy read
  adapter, and the eight-kind downstream projection.
- Do not claim a model result without the actual returned upstream route.
- Do not treat a screenshot/file's existence as semantic, visual, cross-format,
  or human approval.
- Do not apply one reasoning shape or token budget to every OpenRouter route.
- Creation needs the established 240-second provider budget.
- The default bar chart is DIV-based; SVG-only browser probes are invalid.
- Preserve package reproducibility failures and immutable receipt history.
- Keep unrelated dirty worktrees and external product changes untouched.

The doctrine remains: no caption, checkmark, trace, handoff, LinkedIn post, or
release note may claim what the named evidence did not prove.
