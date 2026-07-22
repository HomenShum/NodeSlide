# NodeSlide semantic artifacts and Model Gym goal plan

Status: **foundation implemented; live experiment, production-shadow, portability,
and independent preference evidence remain open**
Goal ID: `NS-SEMANTIC-GYM-V3`
Source: Artifact Atlas V2 visual/semantic audit and the non-frontier model
co-optimization discussion on 2026-07-21.

## Implementation snapshot — 2026-07-22

The repository now closes the audited false-green and foundation gaps:

- all 38 Atlas artifacts carry versioned typed specifications and artifact-family
  semantic validation;
- the audited chart, waterfall, Sankey, causal-loop, timeline, Gantt, evidence,
  equation, runtime, trace, comparison, risk, and spatial defects are repaired;
- the finalizer requires a digest-bound inspection ledger and no longer promotes
  screenshot existence to visual approval;
- the regenerated Atlas and Showcase pass independent PowerPoint rendering,
  overflow checks, and full-size inspection of every slide;
- the PDF evidence region is deterministic and digest-bound to the receipt;
- portable NodeGym contracts now cover paired plans, returned-route attribution,
  differential diagnosis, curriculum boundaries, advisory promotion, safe
  training export, and user-invisible shadow routing;
- Deck Gym V2 validates a 360-run paired matrix across four task pools, six model
  cohorts, five harness profiles, and three repetitions.

The following are deliberately **not** claimed complete by this commit:

1. The 360 live model executions and their browser/PPTX/PDF evaluation artifacts
   have not been run; the committed matrix is an immutable experiment plan.
2. No challenger has been promoted. Promotion still requires repeated paired
   evidence and blind human preference review.
3. The shadow-routing contract is implemented, but it has not been exercised on
   production traffic.
4. The portable NodeGym core has not yet passed a packed install/upgrade test in
   a second consumer.
5. Typed artifact compilation is proven in the deterministic Atlas path, not yet
   wired through every Convex-backed production generation route.
6. Optional fine-tuning remains outside the acceptance path until approved data,
   licensing, privacy, and holdout gates are satisfied.

Accordingly, `publicReleaseApproved` and automatic routing mutation remain
`false`. These are external or downstream evidence gates, not missing green
checkmarks to manufacture.

## Goal

Make NodeSlide able to produce, validate, compare, and continuously improve
non-boring presentation artifacts without confusing successful rendering with
correct visual communication.

The end state is a reproducible loop that discovers the lowest-cost eligible
`model × harness profile × role × task class` combination while preserving the
quality, evidence, editability, and export fidelity established by a stronger
reference system.

Artifact Atlas remains the breadth inventory. Deck Gym becomes the causal
experiment runner. Typed artifact specifications and deterministic compilers
become the shared boundary between models and rendered slides. NodeGym is
extracted only after that boundary has proved portable inside NodeSlide.

## North-star and guardrails

North-star metric:

> Percentage of frontier-quality workflows completed by the lowest-cost
> eligible model-harness pair while passing every hard domain gate.

Guardrails:

- Never promote from a successful build, screenshot existence, caption, model
  self-score, or archetype count.
- Never call illustrative, stale, estimated, pilot, or unrun data observed.
- Never compare models or harnesses on different tasks and call the difference
  causal.
- Keep model identity pinned for capability evidence. Use a random free router
  only for robustness testing and record the route that actually answered.
- Harness assistance is allowed and measured. Hidden task-specific presets or
  benchmark-answer lookup are not.
- Weaker models receive narrower tasks, smaller relevant context, stronger
  schemas, typed tools, examples, and deterministic recovery—not lower gates.
- Human taste remains a separate blind-review gate. It is never inferred from
  Deck CI.
- No promotion auto-applies to production routing.

## Definition of done

The goal is complete only when all of the following are true:

1. Every known Atlas V2 defect below has a red-before/green-after regression.
2. Atlas receipts distinguish syntactic render, geometry, semantic validity,
   evidence validity, browser/PPTX fidelity, accessibility, and human review.
3. Models generate versioned typed artifact specs; deterministic compilers own
   geometry and export construction.
4. Every supported spec family has schema validation, semantic invariants,
   browser rendering, editable PowerPoint output or an honest fallback, and
   fixture tests.
5. Deck Gym runs paired repeated trials across the same task, evidence, model,
   harness profile, tool/context configuration, and budget.
6. The gym includes frontier, mid-tier, small/legacy, pinned free, deterministic
   control, and random-router robustness cohorts without mixing their claims.
7. A curriculum identifies the first unreliable level for each model-harness
   pair and produces a typed failure diagnosis.
8. At least one cheaper/non-frontier challenger matches or beats the frozen
   frontier baseline on a bounded task class at materially lower cost, on a
   held-out set, without a hard-gate regression. If no challenger does, the
   honest result and diagnosed ceiling still close the experiment milestone.
9. Champion/challenger promotion requires repeated stability, held-out gain,
   economics, and completed blind human review; `autoApply` remains false.
10. The portable experiment contracts are consumed by NodeSlide and one small
    second consumer before any NodeKit extraction is called reusable.

## Phase 0 — restore receipt truth (P0)

- [ ] Replace Atlas V2's catalog-wide `visualInspection: passed` status with
      explicit per-gate states: `not_run`, `passed`, `failed`, `provisional`,
      and `not_applicable`.
- [ ] Remove the finalizer behavior that converts screenshot-file existence
      into visual approval or `eligible-builder-verified`.
- [ ] Add a signed/attributed inspection record containing inspector type,
      inspected artifact digest, method, timestamp, findings, and disposition.
- [ ] Preserve existing renders as historical evidence; do not rewrite them
      into green receipts.
- [ ] Publish a machine-readable V2 audit ledger mapping every issue below to a
      slide, artifact recipe, severity, validator owner, and repair status.
- [ ] Make Gallery, Model Compare, Harness Compare, and public catalog reject
      receipts with an unknown, provisional, failed, or stale hard gate.

Exit gate: rerunning the current finalizer on the uncorrected V2 output must
remain non-eligible and expose the known failures instead of producing a green
catalog.

## Phase 1 — repair the audited Atlas V2 artifacts (P0)

### Hard correctness and evidence repairs

- [ ] Slide 2: reconcile the displayed seven chapters with the footer count.
- [ ] Slide 8: add units, scale ticks, period labels, and an uncertainty
      encoding that does not imply unsupported discrete regime changes.
- [ ] Slide 9: bind every waterfall label to its bar; separate baseline/plan;
      add a unit/scale; assert that deltas reconcile baseline to final.
- [ ] Slide 15: add directed edges; use `+`/`-` for causal polarity and `R`/`B`
      for loop classification; make every cycle traceable without crossings.
- [ ] Slide 16: replace the arrow illustration with a quantitative Sankey whose
      widths, labels, totals, and conservation can be checked—or rename it
      honestly as a non-quantitative flow diagram.
- [ ] Slide 20: add dependency connectors and confidence encoding, or remove
      those claims from the title and recipe.
- [ ] Slide 22: constrain every series to its panel, give the panels a shared
      scale, and reconcile the displayed harness version.
- [ ] Slide 24: use a digest-bound V2 product capture for the V2 claim.
- [ ] Slide 25: either show five inspectable captured product states or state
      honestly that three captures represent five workflow steps.
- [ ] Slide 27: demonstrate actual zoom, selection, source binding, and spatial
      navigation states, or label the scene as an illustrative concept.
- [ ] Slide 29: replace the web-inspector screenshot with a real PDF page/region
      receipt, or change the artifact type and claim.
- [ ] Slide 30: bind runtime statistics to raw repeated measurements, sample
      size, units, environment, and digest; otherwise label them illustrative.
- [ ] Slide 31: bind the trace to real trace/span IDs and a sanitized raw
      receipt, or label it illustrative.
- [ ] Slide 32: evaluate the displayed quality-cost equation from its actual AST
      and show all substituted terms; add a regression for the exact formula.
- [ ] Slide 35: derive point position and size from observed normalized metrics;
      represent missing quality/latency as missing; never plot pilots as a
      measured frontier.
- [ ] Slide 36: separate observed, pilot, control, and unrun cohorts; normalize
      cost/latency units and preserve `not-run` rather than converting it to
      `blocked`.
- [ ] Slide 37: relabel the current breadth result as a coverage comparison and
      add a true paired harness A/B before claiming performance improvement.

### Readability and visual-grammar repairs

- [ ] Slide 4: attach the customer voice to a real source/speaker or style it as
      an explicit hypothetical prompt rather than an unattributed quotation.
- [ ] Slide 12: bind funnel and winner values to receipts and reduce dashboard
      density so the causal takeaway is readable at presentation distance.
- [ ] Slide 17: label decision edges yes/no and remove branch semantics that
      must currently be inferred from node text.
- [ ] Slide 18: add geographic labels/legend and a meaningful encoding, or
      remove the decorative map inset.
- [ ] Slide 34: add likelihood/impact direction, ticks, or category anchors.
- [ ] Run complete-deck rhythm review after individual repairs so correctness
      does not regress the showcase into repetitive cards or dense diagnostics.

Exit gate: all repaired slides pass semantic validators, browser and PowerPoint
pixel inspection, editable-output checks, accessibility checks, and a fresh
blind comprehension review. `slides_test.py` remains necessary but insufficient.

## Phase 2 — typed artifact intermediate representations (P0)

Create a versioned discriminated union, tentatively
`nodeslide.artifact-spec/v1`, with a common envelope:

- `id`, `kind`, `schemaVersion`, `narrativeJob`, `claimIds`, `sourceIds`;
- `dataDigest`, `sourceDigest`, `units`, `locale`, `readingOrder`;
- `editability`, `browserContract`, `pptxContract`, `pdfContract`;
- `accessibility`, `missingness`, `assumptions`, `knownFidelityDifferences`;
- `provenance` for observed, derived, estimated, illustrative, and missing data.

Implement these initial spec families:

- [ ] `ChartSpec`: axes, scale type/domain, series, values, labels, units,
      annotations, uncertainty, and missing values.
- [ ] `WaterfallSpec`: baseline, ordered deltas, final, reconciliation tolerance,
      and label policy.
- [ ] `SankeySpec`: nodes, source/target flows, values, units, layer/order hints,
      and conservation tolerance.
- [ ] `GraphSpec`: typed nodes, directed edges, labels, group/boundary regions,
      and reading direction.
- [ ] `CausalLoopSpec`: edge polarity, loop membership, loop type, delays, and
      an explicit cycle list.
- [ ] `TimelineSpec` and `GanttSpec`: temporal scale, tasks/events, milestones,
      dependencies, status, and confidence.
- [ ] `EvidenceMediaSpec`: MIME/type, immutable source digest, page/region or DOM
      selector, capture version, highlight geometry, and claim binding.
- [ ] `MotionSpec`: named states, transitions, controls, reduced-motion behavior,
      and static PowerPoint/PDF keyframe selection.
- [ ] `ComparisonSpec`: cohorts, metric definitions, denominator, units,
      aggregation, status/missingness, and comparability constraints.
- [ ] `EquationSpec`: expression AST, symbols, values/units, evaluation steps,
      rounding policy, and rendered expression.
- [ ] `RuntimeProofSpec` and `TraceSpec`: environment, sample size, raw receipt
      digest, clock/units, trace/span identity, sanitization, and aggregation.
- [ ] `RiskMatrixSpec`: axes, direction, categories, thresholds, risks, and
      mitigation/source binding.
- [ ] `SpatialSceneSpec`: nodes/regions, viewport states, selection, navigation,
      source binding, and static fallback views.

For every family:

- [ ] TypeScript type and runtime schema agree.
- [ ] Convex validator and API boundary reject unknown or promoted provenance.
- [ ] JSON Schema is checked in for external/tool consumers.
- [ ] Version migration and unknown-version failure behavior are tested.
- [ ] Positive, negative, adversarial, and missing-evidence fixtures exist.
- [ ] The model receives only the relevant spec schema and examples for its
      assigned task—not the entire artifact universe.

Exit gate: each audited V2 artifact can be represented without untyped prose,
and an intentionally malformed fixture fails with a stable issue code.

## Phase 3 — deterministic artifact compiler and bounded tools (P0/P1)

- [ ] Add an artifact compiler registry mapping each `ArtifactSpec.kind` to
      browser SlideLang elements, editable PowerPoint primitives, accessibility
      text, and an honest fallback contract.
- [ ] Move chart/diagram/equation/evidence construction behind typed tools such
      as `build_chart`, `build_sankey`, `build_graph`, `build_timeline`,
      `bind_evidence`, and `evaluate_equation`.
- [ ] Keep models responsible for narrative intent, selection, and spec values;
      keep deterministic code responsible for geometry, arithmetic, routing,
      labels, clipping, and native export construction.
- [ ] Make every tool return the normalized spec, compiler receipt, semantic
      issues, render handles, and recoverable typed repair operations.
- [ ] Provide exact small-model recovery: schema error → field-level correction;
      semantic error → bounded repair operation; renderer error → deterministic
      fallback; unresolved ambiguity → stronger-model escalation.
- [ ] Preserve base specs and candidate renders immutably through repair.

Exit gate: the same normalized spec generates browser and PPTX artifacts whose
declared fidelity difference is machine-verifiable, with no model-authored
absolute geometry required for the core families.

## Phase 4 — semantic Deck CI and evidence-grade receipts (P0)

Add stable issue codes and family validators for:

- [ ] equation AST/evaluation agreement and unit consistency;
- [ ] waterfall reconciliation and label-to-mark binding;
- [ ] Sankey non-negativity, width/value mapping, and conservation;
- [ ] graph direction, reachable nodes, causal polarity, cycle, and crossing
      constraints;
- [ ] chart axis/unit/scale completeness and honest missingness;
- [ ] timeline ordering, Gantt dependency visibility, and confidence encoding;
- [ ] comparison cohort compatibility, denominators, normalized units, and
      unobserved/pilot separation;
- [ ] evidence MIME/type match, digest, capture freshness, page/region bounds,
      OCR/DOM claim binding, and product-version consistency;
- [ ] trace/runtime raw-receipt binding and sample-statistic reproducibility;
- [ ] child geometry containment inside panels, plots, clips, and viewports;
- [ ] accessibility reading order, contrast, labels, alt text, and non-color
      encoding;
- [ ] deck-level rhythm, repetition, density, narrative coverage, evidence
      coverage, and unsupported-claim checks.

Replace the single green receipt with a versioned receipt containing:

`spec → validation → compilation → browser render → PPTX render → semantic
inspection → evidence inspection → accessibility → blind preference → promotion`.

Each stage records its input/output digests, tool/version, status, issue list,
attempt, cost, latency, and lineage. Later stages cannot overwrite earlier red
states.

Exit gate: seeded regressions for every audited defect are caught before human
inspection, while a deliberate human-only taste distinction remains pending
rather than being falsely automated.

## Phase 5 — Deck Gym V2 causal experiment runner (P1)

### Independent variables

- model and exact provider route;
- model adapter and checkpoint;
- harness profile and version;
- role skill and task class;
- tool set and versions;
- context/retrieval strategy and reference pack;
- reasoning/token/time/cost budget;
- repair and escalation policy;
- repetition seed.

### Measured outcomes

- brief, story, claim, and evidence adherence;
- typed-spec validity and tool-call reliability;
- artifact semantic correctness and repair success;
- artifact appropriateness, dominant-visual clarity, visual-grammar legibility,
  composition diversity, pacing/climax, and novelty within the evidence contract;
- browser/PPTX fidelity, editability, accessibility, and Deck CI;
- blind visual preference and comprehension;
- latency, tokens, dollar cost, retries, escalations, and human interventions.

### Required cohorts

- [ ] frozen frontier reference with a light harness;
- [ ] current production mid-tier models with role-appropriate harnesses;
- [ ] smaller, cheaper, older/legacy models with structured/heavy harnesses;
- [ ] pinned free models with exact returned route/provider recorded;
- [ ] deterministic compiler control;
- [ ] random free-router robustness cohort, excluded from model capability
      ranking unless its actual route can be attributed;
- [ ] optional fine-tuned checkpoint cohort after Phase 8 prerequisites.

### Harness profiles

- [ ] `light-director`: broad judgment, evidence, tools, and light constraints.
- [ ] `structured-planner`: StorySpec, task graph, material inventory, reference
      retrieval, typed artifact choice, and validation feedback.
- [ ] `bounded-executor`: one slide/artifact, exact schema, one skill, minimal
      evidence window, one or two tools, examples, and recovery procedure.
- [ ] `repair-specialist`: screenshot/issue input and typed repair operations.
- [ ] `router-robustness`: capability negotiation, strict timeouts, unknown-model
      recovery, and returned-route attribution.

### Experimental controls

- [ ] Maintain four distinct task pools: public development, hidden validation,
      rotating challenge, and anonymized live shadow. Never train or tune against
      hidden, rotating, or live-shadow answers.
- [ ] Freeze task/evidence/reference digests across paired comparisons.
- [ ] Use at least three repetitions for stability before promotion evidence.
- [ ] Separate generation, repair, and judge costs.
- [ ] Compare a heavier and lighter harness on both frontier and weaker models;
      do not assume more scaffolding always helps.
- [ ] Store paired deltas and confidence intervals, not only aggregate ranks.
- [ ] Make harness comparison refuse unmatched tasks, models, directions,
      evidence, budgets, or missing denominators.

Exit gate: one command can reproduce a bounded paired matrix, resume failures,
rebuild aggregates from immutable run receipts, and generate no causal claim
when pairing is incomplete.

## Phase 6 — curriculum and differential diagnosis (P1)

Implement progressive task levels:

1. classify the slide job/archetype;
2. select the dominant artifact;
3. construct one valid typed artifact spec;
4. compose one slide;
5. diagnose and repair a rendered slide;
6. plan connected slides;
7. generate a complete deck;
8. orchestrate specialized workers.

- [ ] Require repeated passing performance before advancing a model-harness pair.
- [ ] Record the first unreliable level and issue distribution.
- [ ] Diagnose failures as planning, missing/wrong context, tool selection,
      tool-call/schema, semantic reasoning, visual judgment, repair, provider,
      budget, or genuine model ceiling.
- [ ] Do not answer every loss by adding prompt text. Every proposed change must
      target a diagnosed cause and run against held-out tasks.
- [ ] Produce capability cards by `model × harness × role × task class`, never a
      single universal model ranking or `latest_harness` label.

Exit gate: at least one model has a measured curriculum boundary and a held-out
experiment showing whether a targeted harness change moved that boundary.

## Phase 7 — self-improvement and champion/challenger loop (P1/P2)

- [ ] Use frontier systems as reference-trajectory authors, critics, failure
      diagnosticians, and improvement proposers—not mandatory production workers.
- [ ] Convert failures into typed candidates: skill change, tool change, context
      change, schema change, deterministic worker, routing/escalation change, or
      training example.
- [ ] Evaluate each candidate on a hidden validation pool before a rotating
      challenge pool; retain live anonymized shadow tasks separately.
- [ ] Perturb wording, data, theme, audience, evidence availability, and domain
      to detect fixture/template overfitting.
- [ ] Maintain task-class champions and challengers. Promotion requires hard
      correctness, held-out gain, stable repeats, no protected-dimension
      regression, lower cost or material quality gain, and completed human review.
- [ ] Keep production adoption as a separately approved routing change.

Economic score must expose its weights and raw dimensions; it must never hide a
hard-gate failure. Suggested starting utility:

```text
U = quality + repairability + reliability
    - λcost × cost - λlatency × latency - λhuman × interventions
```

Exit gate: a champion/challenger proposal is reproducible from immutable
receipts and stays advisory with `autoApply: false`.

## Phase 8 — training data and optional checkpoint adapters (P2)

- [ ] Export observable training episodes only: task state, bounded context,
      selected skill, tool choice/arguments/result, artifact spec, validation
      feedback, repair, accepted result, and preference.
- [ ] Exclude hidden chain-of-thought, secrets, private raw evidence, unsupported
      synthetic claims, and failed episodes without a labeled correction.
- [ ] Create accepted/rejected pairs, corrected tool calls, successful repairs,
      and frontier-teacher trajectories that pass all hard gates.
- [ ] Add dataset versioning, consent/provenance, deduplication, train/validation/
      challenge separation, contamination checks, and deletion lineage.
- [ ] Define provider-neutral checkpoint interfaces before adding a Tinker/
      Inkling adapter or any other training provider.
- [ ] Run four isolated comparisons when authorization, current API verification,
      data volume, and budget permit: base+old harness, base+new harness,
      tuned+same harness, and tuned+new harness.

Exit gate: the adapter can be tested with a fake provider and the dataset passes
privacy, provenance, contamination, and replay checks. No live fine-tuning is
required to complete the core NodeSlide semantic/gym milestone.

## Phase 9 — production shadow routing (P2)

- [ ] Register the cheapest eligible model-harness champion per bounded task
      class rather than selecting one universal deck model.
- [ ] Shadow candidate decisions against the production path without changing
      user output; record disagreement and would-have-escalated cases.
- [ ] Escalate ambiguity, unsupported evidence, repeated semantic failures, or
      out-of-distribution tasks to the stronger eligible route.
- [ ] Enforce per-route budgets, circuit breakers, stale-model metadata checks,
      sanitized provider errors, and rollback to the last pinned champion.
- [ ] Require a separately approved routing receipt before any challenger serves
      user-visible generation.

Exit gate: a shadow receipt demonstrates correct task-level routing, fallback,
cost accounting, and zero user-visible behavior change.

## Phase 10 — portable NodeGym contracts and NodeKit extraction (P2)

Do not begin with a speculative platform rewrite. First stabilize the contracts
through Phases 2–7 inside NodeSlide, then extract only code already used twice.

Target packages:

- `@nodekit/gym-core`: experiment, registry, run, receipt, pairing, diagnosis,
  promotion, and trajectory contracts;
- `@nodekit/gym-react`: inspectable matrices, brackets, receipts, and capability
  cards without product-specific styling assumptions;
- `@nodekit/gym-convex`: optional immutable run/trajectory persistence adapter;
- `@nodekit/gym-openrouter`: pinned route metadata and robustness attribution;
- `@nodekit/gym-training`: provider-neutral dataset/checkpoint adapter boundary;
- `@nodeslide/gym`: Artifact Atlas, StoryBench, TasteBench, Deck CI, and PPTX
  domain evaluators.

- [ ] Keep NodeSlide schema/compiler/evaluators in the domain pack.
- [ ] Prove a second small consumer with its own task/evaluator rather than a
      copied NodeSlide demo.
- [ ] Add semver, migrations, packed-install proof, upgrade proof, bilateral CI,
      and an immutable consumer receipt before advertising reuse.
- [ ] Record ownership and distribution in `docs/ECOSYSTEM.md` and the consuming
      NodeKit repository; do not silently fork contracts.

Exit gate: both consumers run the same packed `gym-core` experiment contract,
with domain-specific evaluators and byte-identical package provenance.

## Phase 11 — Artifact Atlas V3 and release proof (P1/P2)

- [ ] Regenerate the 38-artifact museum from typed specs and the compiler
      registry; do not patch the final PowerPoint independently.
- [ ] Add genuinely new fixtures only where they exercise a missing semantic
      family or model curriculum level.
- [ ] Produce browser, PPTX, montage, receipt, and source-lineage artifacts from
      the same run digests.
- [ ] Run the paired model/harness arena on a bounded coverage-balanced subset
      before spending on the full matrix.
- [ ] Complete blind comprehension and preference review for the public subset.
- [ ] Release the showcase only when every included artifact is hard-gate clean,
      source-bound, editable or honestly degraded, and human-approved.

Exit gate: the newest Atlas is an evidence-grade corpus rather than a deterministic
builder museum, and its release receipt can be independently reproduced.

## Proposed code ownership map

Use existing package boundaries and avoid a second parallel artifact system:

- `shared/nodeslideArtifactSpec.ts`: discriminated spec union and provenance;
- `shared/nodeslideArtifactReceipt.ts`: receipt stages, statuses, and lineage;
- `shared/nodeslideSemanticIssues.ts`: stable issue-code catalog;
- `convex/lib/nodeslideArtifactCompiler/`: domain compilers and typed repairs;
- `convex/lib/nodeslideArtifactValidators/`: runtime semantic validation used by
  creation, edit, export, and production routing;
- `scripts/lib/artifact-semantic-validators/`: offline/browser/PPTX inspection
  adapters that consume the same issue catalog;
- `benchmarks/deck-gym/v2/`: corpus manifests, task-pool manifests, harness
  profiles, model registry snapshots, and promotion policy;
- `artifacts/deck-gym/deck-gym-v2/`: immutable run receipts and derived reports;
- `packages/contracts` and `packages/testing`: portable contracts/test helpers
  until second-consumer proof justifies dedicated `@nodekit/gym-*` packages;
- `docs/demo/nodeslide-artifact-semantics-v3/`: red-before/green-after pixels,
  PowerPoints, source receipts, audit ledger, and final acceptance record.

Names may change during implementation, but ownership must remain singular:
product/runtime, offline evaluator, and package consumers all use the same spec,
issue, and receipt contracts.

## Ordered implementation sequence

```text
0 receipt truth
→ 1 audited repairs
→ 2 typed specs
→ 3 deterministic compiler/tools
→ 4 semantic Deck CI
→ 5 paired Deck Gym V2
→ 6 curriculum/diagnosis
→ 7 champion-challenger improvement
→ 8 optional training adapters
→ 9 production shadow routing
→ 10 NodeKit extraction after second-consumer proof
→ 11 Atlas V3 and public release
```

Phases 2–4 may iterate together by vertical artifact family. The preferred
vertical slice is equation → waterfall → causal graph → evidence media because
it exercises arithmetic, data binding, graph semantics, and provenance before
the complete family registry is attempted.

## Required test layers

Every implementation commit must select the smallest relevant set and the
milestone commit must run all applicable layers:

1. schema/type/validator unit tests;
2. semantic invariant and adversarial fixture tests;
3. deterministic compiler goldens;
4. browser DOM and pixel capture;
5. PowerPoint render, editability, and visual inspection;
6. cross-format fidelity comparison;
7. paired gym replay with immutable digests;
8. blind human comprehension/preference where required;
9. repository check, package build, CI, and production shadow proof for runtime
   changes.

## Deliverables

- Versioned ArtifactSpec schemas and TypeScript/Convex contracts.
- Compiler/tool registry and typed repair operations.
- Semantic Deck CI issue catalog and receipt v2.
- Corrected Atlas V2 audit ledger and green-after artifact regressions.
- Deck Gym V2 runner, curricula, task pools, capability cards, and tournament.
- Exact-route free/small/legacy/frontier comparison receipts.
- Champion/challenger and optional training-episode outputs.
- Production shadow-routing receipt.
- Packed NodeGym core proof with a second consumer.
- Artifact Atlas V3 museum, public showcase candidate, and human release record.

## Explicitly not accepted as completion

- a deck that merely compiles or has no canvas overflow;
- a screenshot whose file exists but was not semantically inspected;
- one successful stochastic run;
- a visual judge score without hard invariants and source lineage;
- a harness comparison with unmatched tasks or evidence;
- a free-router result without returned-model attribution;
- a small model given an easier task and then called frontier-equivalent;
- an unrun model/checkpoint plotted as measured;
- a deterministic builder result labeled as multi-model performance;
- a platform package without an immutable second-consumer install/upgrade proof.
