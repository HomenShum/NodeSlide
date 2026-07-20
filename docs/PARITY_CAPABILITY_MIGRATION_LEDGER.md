# Parity Studio -> injectable NodeSlide capability ledger

This ledger prevents the package extraction from silently treating standalone
NodeSlide as the complete historical implementation. The merge is
**bidirectional**: Parity Studio still owns proven capabilities that are absent
from this repository, while standalone NodeSlide contains newer layout,
rendering, and agent-quality work that must not be overwritten by older copies.

## Audited baselines

- NodeSlide: `699561423fb83e47cc3cf89e9401c60c28fd7ef7`
- Parity Studio: `3e491814366939f8ee4aaa23098b6784dd22b1bd`
- Audit date: 2026-07-19
- Source checkout: `D:\VSCode Projects\parity-studio` (read-only; its untracked
  `NUL` file is unrelated and must not be copied)

Statuses:

- **current**: already present in NodeSlide; package it without behavior change.
- **parity-only**: preserve and migrate from Parity after tests are identified.
- **diverged**: reconcile semantics and tests; never overwrite either side.
- **blocked**: owner or dependency decision required before migration.

Nothing marked `parity-only`, `diverged`, or `blocked` may be deleted or called
obsolete until its named gate passes in both standalone NodeSlide and the first
consumer.

## Core contracts and mutation protocol

| ID | Capability | Source evidence | State | Target | Migration gate |
|---|---|---|---|---|---|
| P01 | DeckSpec, patches, snapshots, validation receipts | both `shared/nodeslide.ts` | diverged | `@nodeslide/contracts` | Structural diff, schema migration note, all contract tests green |
| P02 | Pure scoped patch application | both `shared/nodeslidePatch.ts` | diverged | `@nodeslide/engine` | Run both patch suites; reconcile every operation and CAS assumption |
| P03 | Attachment bounds and normalization | both `shared/nodeslideAttachments.ts` | diverged | contracts + engine | Malformed/oversize/idempotency cases from both suites pass |
| P04 | Access policy | Parity `shared/nodeslideAccessPolicy.ts` | parity-only | backend policy adapter | Cross-user, cross-workspace, and revoked-access tests pass |
| P05 | Session capability grants | Parity `shared/nodeslideSessionGrant.ts` | parity-only | contracts + backend | Expiry, scope, revocation, and replay tests pass |
| P06 | Delegated approver authority and digest binding | Parity `shared/nodeslideDelegation.ts`, `convex/nodeslideDelegation.ts` | parity-only | contracts + agent/backend adapters | Wrong digest, wrong delegate, expired grant, and double-use fail closed |
| P07 | Publish approval policy | both publish-approval modules | diverged | engine policy + backend | Existing sign-off and revoked-approver tests from both repos pass |
| P08 | Versioned signatures and profile application | both signature modules | diverged | contracts + engine | Current NodeSlide signature tests plus Parity compatibility fixtures pass |

## Durable agent execution and governance

| ID | Capability | Source evidence | State | Target | Migration gate |
|---|---|---|---|---|---|
| P09 | Durable agent sessions | Parity `shared/nodeslideDurableSession.ts`, `convex/nodeslideSessions.ts` | parity-only | `@nodeslide/agent` + backend | Resume after interruption with one terminal result |
| P10 | Jobs, leases, claims, attempts, cancellation | Parity `convex/nodeslideJobs.ts`, `nodeslideJobControl.ts`, `nodeslideJobRunner.ts` | parity-only | NodeAgent adapter + Convex adapter | Lease fencing, cancellation, retry ceiling, idempotent resume tests |
| P11 | Job journal and replay | Parity `convex/lib/nodeslideJobJournal.ts` | parity-only | NodeAgent adapter + proof | Duplicate step replay cannot duplicate a mutation or cost |
| P12 | Per-run budgets and spend ledger | Parity `shared/nodeslideRunBudget.ts`, `convex/nodeslideBudgets.ts`, budget-ledger tests | parity-only | agent policy + backend | Hard limit, settlement, retry accounting, and zero-cost fallback tests |
| P13 | Multi-agent roles/stages | Parity `convex/nodeslideRoleStages.ts`, `convex/lib/nodeslideMultiAgent.ts` | parity-only | `@nodeslide/agent` | Bounded delegation, allowlists, typed stage outputs, independent verification |
| P14 | Managed kernel and execution trace validation | Parity `convex/lib/nodeslideManagedKernel.ts`, `nodeslideExecutionTrace*.ts` | parity-only | NodeAgent adapter + telemetry | Required stages cannot be skipped; malformed traces fail closed |
| P15 | Durable memory and scoped memory | both memory modules; Parity has scoped policy/retention ETL | diverged | NodeAgent memory adapter | Owner scope, retention, invalidation, and context-disclosure tests |
| P16 | Provider routing and routing receipts | both provider modules; Parity routing policy/receipt suite | diverged | NodeSlide routing policy + NodeAgent provider port | Same route decision and receipt under fixed fixtures |

## Authoring quality, evaluation, and repair

| ID | Capability | Source evidence | State | Target | Migration gate |
|---|---|---|---|---|---|
| P17 | Authoring policy and workflow state | Parity `shared/nodeslideAuthoringPolicy.ts`, `nodeslideAuthoringWorkflow.ts` | parity-only | contracts + agent | State transitions exhaustive; invalid progression rejected |
| P18 | Authoring-quality evaluator | Parity `shared/nodeslideAuthoringQuality.ts`, `convex/nodeslideAuthoringQuality.ts` | parity-only | engine/evals | Immutable fixture scores match Parity baseline |
| P19 | Deck CI | Parity `convex/nodeslideDeckCi.ts`, `convex/lib/nodeslideDeckCi.ts` | parity-only | engine/evals + backend | CI findings bind to exact deck version and block release correctly |
| P20 | Semantic evaluation and StoryBench | both evaluation modules; Parity has broader suites | diverged | `@nodeslide/agent` evals | Locked fixtures, scorer immutability, no evaluator context leakage |
| P21 | Render-inspect-repair loop | both repair paths; Parity live render repair modules | diverged | engine + agent | Fixed deck improves or reverts; no hidden direct canonical write |
| P22 | Journey proof | Parity `shared/nodeslideJourneyProof.ts` | parity-only | `@nodeslide/testing` + proof | Fresh-user create/edit/review/export/reopen receipt verifies |

## Evidence, data, and source lifecycle

| ID | Capability | Source evidence | State | Target | Migration gate |
|---|---|---|---|---|---|
| P23 | User data export | Parity `shared/nodeslideDataExport.ts`, `convex/nodeslideDataExport.ts` | parity-only | contracts + export adapter | Export is owner-scoped, complete, bounded, and reopenable |
| P24 | Source revision, refresh, monitoring, lineage | Parity source refresh/revision/monitoring/lineage modules | parity-only | backend jobs + proof | Immutable prior revision retained; changed claims invalidated |
| P25 | Upload and deterministic extraction | both upload paths; Parity PDF/data extraction suite | diverged | asset store + workers | Exact bytes, limits, hashes, and extraction disclosure preserved |
| P26 | Claim/evidence receipts and region binding | both evidence modules; Parity broader claim receipt tests | diverged | contracts + proof | Every material claim points to immutable evidence or explicit assumption |
| P27 | Private data deletion and retention | both data controls; Parity retention policy is broader | diverged | backend policy | Linked evidence fails closed; authorized deletion leaves audit receipt |

## Presentation interoperability

| ID | Capability | Source evidence | State | Target | Migration gate |
|---|---|---|---|---|---|
| P28 | Native PPTX generation and reopen | both PPTX compilers; Parity create/round-trip tests | diverged | compiler package (future) | Golden deck exports, opens, preserves editability and sources |
| P29 | PPTX import | both `src/.../slidelang/pptxImport*` | diverged | compiler package | Same fixture normalization and bounded parser behavior |
| P30 | PPTX link and sync planning | Parity `shared/nodeslidePptxLink*.ts`, `convex/nodeslidePptxSync.ts` | parity-only | integration adapter | External changes become typed proposals; stale sync cannot overwrite |
| P31 | Google Slides OAuth and runtime | Parity `convex/nodeslideGoogleAuth.ts`, `nodeslideGoogleSlidesRuntime.ts` | parity-only | Google Slides adapter | Host auth isolated, tokens never enter receipts, live smoke gated |
| P32 | Google Slides import/export/sync UI contracts | Parity `src/.../integrations/googleSlides/*` | parity-only | integration + React registry | Round trip, capability disclosure, and conflict handling pass |
| P33 | External change-set normalization | Parity `src/.../integrations/externalChangeSet.ts` | parity-only | contracts + integration | Remote edits normalize to governed proposals, never direct writes |

## External agent and MCP surface

| ID | Capability | Source evidence | State | Target | Migration gate |
|---|---|---|---|---|---|
| P34 | Existing 11-tool standalone MCP surface | NodeSlide `mcp/src/lib/nodeslideTools.ts` | current | `@nodeslide/mcp` | Current MCP tests compile against package contracts |
| P35 | Snapshot, element, quality, spec, exact-patch tools | Parity source MCP v0.5 (`get_snapshot`, `list_elements`, `evaluate_quality`, `export_spec`, `propose_patch`) | parity-only | `@nodeslide/mcp` | Tool schemas, auth scope, and exact candidate receipts tested |
| P36 | Delegated digest-bound acceptance over MCP | Parity MCP source | parity-only | MCP + delegation policy | Wrong/expired token and mismatched digest fail closed |
| P37 | Published MCP compatibility | Published package is behind Parity source | blocked | MCP release workflow | Reconcile source version, generate changelog, consumer smoke before publish |

## UI and host surfaces to preserve (not package in this slice)

| ID | Capability | Source evidence | State | Target | Migration gate |
|---|---|---|---|---|---|
| P38 | Durable session provider and session UI | Parity `src/.../session/*` | parity-only | react-headless + React | Backend-neutral controlled state, reload/resume browser test |
| P39 | Delegation client and approver review | Parity delegation client + `ApproverReviewView` | parity-only | react-headless + registry | No direct Convex dependency in controlled surface |
| P40 | Deck CI, data, versions, trace inspectors | both inspector trees; Parity has additional Deck CI/data surfaces | diverged | React + registry | Feature inventory screenshot/state fixtures retained |
| P41 | Project/delete/recovery dialogs | Parity component suite | parity-only | registry/host composition | Auth and destructive actions remain host-governed |
| P42 | Monolithic `NodeSlideStudio` orchestration seam | both `NodeSlideStudio.tsx` | diverged | later I3 split | No move in this slice; first extract controlled state and adapter contract |

## Standalone NodeSlide advances that Parity must not overwrite

| ID | Capability | NodeSlide evidence | State | Preservation gate |
|---|---|---|---|---|
| N01 | New chart type contracts/rendering | `shared/nodeslide.ts`, SlideLang renderers/tests | current | Parity reconciliation must pass current chart fixtures and PPTX output |
| N02 | Layout archetypes and deck-level archetype choice | `shared/nodeslideArchetypes.ts` | current | Keep deterministic layout tests and zero-collision scenarios |
| N03 | Geometry and text-fit checks | `shared/nodeslideGeometryChecks.ts`, `nodeslideLayoutMetrics.ts` | current | No older validator may reduce current findings or thresholds silently |
| N04 | KaTeX/math rendering | current SlideLang HTML/PPTX paths | current | HTML and PPTX math fixtures remain green |
| N05 | Current creation critique/repair behavior | current NodeSlide agent/lib tests | current | Compare locked outputs before importing older Parity agent code |
| N06 | Current package boundary and host-neutral ports | `packages/*` from this slice | current | Parity code enters through ports; no Convex or UI imports into contracts/engine |

## Migration order

1. Freeze P01-P03 behind `@nodeslide/contracts` and `@nodeslide/engine`.
2. Run the memory repository conformance suite against the future Convex
   adapter before changing `NodeSlideStudio`.
3. Reconcile governance first (P04-P08), then durable runtime through the
   existing NodeAgent adapter (P09-P16); do not embed a second agent loop.
4. Migrate authoring/eval/evidence capabilities as test-backed modules
   (P17-P27).
5. Add integration adapters (P28-P37) only after backend ports are stable.
6. Move UI surfaces (P38-P42) last, one controlled surface at a time.
7. Run NodeRoom consumer proof and update each row with commit, test, and
   package version. A row is complete only when both hosts pass.
