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

## Top-level `convex/nodeslide*.ts` port verdicts (2026-07-27)

File-level verdicts for the top-level `convex/nodeslide*.ts` cluster only.
`convex/lib/**` is audited separately. Measured with
`scripts/port-audit.mjs --destination <this repo>` at `79ae98f`: **144 items
missing** in this cluster. Every one of them is **MERGE**, not PORT. Each was
tested by copying the parity file into this tree and running
`tsc --noEmit -p convex/tsconfig.json`; the errors below are the compiler's,
not a reading of the code.

No table was added to `convex/schema.ts` to make a port fit. A schema migration
is an owner decision, and every row in the first table needs one.

### Blocked on tables this repo's schema does not define

`ctx.db.query('<table>')` fails `TS2345 / TS2344: not assignable to
TableNamesInDataModel`. Each rejected table also cascades: the query result
degrades to the first table's document type, so a single missing table produces
dozens of `TS2339 Property 'x' does not exist` and `TS18046 'row' is of type
'unknown'` follow-on errors. The table name is the root cause; the rest is noise.

| File | Items | Missing tables |
|---|---|---|
| `convex/nodeslideScopedMemory.ts` | 19 | `nodeslide_scoped_memories`, `nodeslide_access_grants` |
| `convex/nodeslideJobs.ts` | 17 | `nodeslide_agent_jobs`, `nodeslide_durable_sessions`, `nodeslide_durable_session_events`, `nodeslide_durable_job_journal_entries`, `nodeslide_run_budgets`, `nodeslide_billable_calls`, `nodeslide_budget_events` |
| `convex/nodeslideWorkspaceAccess.ts` | 15 | `nodeslide_workspaces`, `nodeslide_workspace_projects`, `nodeslide_access_grants`, `nodeslide_access_grant_events` |
| `convex/nodeslideSourceRefresh.ts` | 12 | `nodeslide_source_refresh_schedules`, `nodeslide_source_refresh_proposals`, `nodeslide_source_revisions`, `nodeslide_claim_evidence_receipts` |
| `convex/nodeslideUploads.ts` | 12 | `nodeslide_uploads` |
| `convex/nodeslidePptxSync.ts` | 10 | `nodeslide_pptx_sync_links` |
| `convex/nodeslideSessions.ts` | 9 | `nodeslide_durable_sessions`, `nodeslide_durable_session_events`, `nodeslide_durable_job_journal_entries`, `nodeslide_durable_model_result_replays` |
| `convex/nodeslideBudgets.ts` | 7 | `nodeslide_run_budgets`, `nodeslide_billable_calls`, `nodeslide_budget_events` |
| `convex/nodeslideSync.ts` | 5 | `nodeslide_sync_connections` |
| `convex/nodeslideDelegation.ts` | 4 | `nodeslide_delegation_grants`, `nodeslide_delegation_uses` |
| `convex/nodeslideJobControl.ts` | 4 | `nodeslide_agent_jobs` |
| `convex/nodeslideRoleStages.ts` | 3 | `nodeslide_agent_jobs`, `nodeslide_role_stages` |

`nodeslideWorkspaceAccess.ts` additionally fails
`TS2339: Property 'workspaceId' does not exist on type '{ _id: Id<"nodeslide_decks">; ... }'`
— this repo's `nodeslide_decks` has no workspace dimension at all, so the
workspace layer is not a table addition but a reshape of an existing table.

`nodeslideSync.ts` is the cheapest unblock in the cluster: one table, zero
missing module dependencies.

### Blocked only on modules outside this cluster

No schema change needed. These become portable the moment the named
`convex/lib/**`, `shared/**`, or `convex/workflows.ts` modules land. Failure is
`TS2307: Cannot find module`.

| File | Items | Missing modules |
|---|---|---|
| `convex/nodeslideDeckCi.ts` | 4 | `convex/lib/nodeslideDeckCi.ts` |
| `convex/nodeslideJobRunner.ts` | 2 | `convex/lib/nodeslideCreationTelemetry.ts`, `convex/lib/nodeslideJobValidators.ts`, `convex/lib/nodeslideLiveRenderRepair.ts` |
| `convex/nodeslideJobWorkflow.ts` | 2 | `convex/workflows.ts`, `convex/lib/nodeslideJobValidators.ts`, npm `@convex-dev/workflow` |
| `convex/nodeslideAuthoringQuality.ts` | 1 | `shared/nodeslideAuthoringQuality.ts`, `shared/nodeslideJourneyProof.ts` |
| `convex/nodeslidePptxCreate.ts` | 1 | `convex/lib/nodeslideLiveRenderRepair.ts` |
| `convex/nodeslideUploadExtraction.ts` | 1 | `convex/lib/nodeslidePdfExtraction.ts`; also calls `internal.nodeslideUploads` and `internal.nodeslide.attachStoredDataSourceInternal`, both still missing |

### Symbol-level merges into files that already exist here

`convex/nodeslide.ts` and `convex/nodeslideAgent.ts` are present but shorter
than parity's. The missing exports:

| Symbol | File | Blocker |
|---|---|---|
| `recordEvidenceCaptureInternal`, `pruneExpiredEvidenceCapturesInternal`, `listEvidenceCaptureSummaries`, `getEvidenceCaptureDetail` | `nodeslide.ts` | `nodeslide_evidence_captures`, `nodeslide_evidence_steps`, `nodeslide_source_revisions` |
| `attachStoredDataSourceInternal` | `nodeslide.ts` | its own body is clean, but it calls the private `ensureNodeSlideSourceRevision`, which writes `nodeslide_source_revisions` and imports `convex/lib/nodeslideSourceRevision.ts` |
| `createImportedDeckInternal` | `nodeslide.ts` | `nodeslide_agent_jobs`, `convex/lib/nodeslideJobState.ts` |
| `deleteDeck` | `nodeslide.ts` | `convex/lib/nodeslideDeckDeletion.ts` |
| `duplicateDeck` | `nodeslide.ts` | `convex/lib/nodeslideDeckFork.ts` |
| `NodeSlideDelegatedCommitAuthority`, `commitDelegatedNodeSlideProposal` | `nodeslide.ts` | `shared/nodeslideDelegation.ts` |
| `captureWebSourcesBestEffort` | `nodeslideAgent.ts` | `TS2304: Cannot find name 'captureNodeSlideWebEvidence'` / `'createNodeSlideSourceSnapshotPdf'` from `convex/lib/nodeslideEvidenceCapture.ts` |
| `mergeAgentJobMemories` | `nodeslideAgent.ts` | `TS2304: Cannot find name 'NodeSlideScopedMemoryItem'` from `convex/nodeslideScopedMemory.ts` |
| `NodeSlideStoredWebSource`, `pairNodeSlideStoredWebSources`, `nodeSlideEvidenceAttachmentDigest`, `finalizeNodeSlideEvidenceRecord` | `nodeslideAgent.ts` | compile clean on their own — held back by their **test**. Their only coverage is `convex/lib/nodeslideAgentEvidenceCapture.test.ts`, and 3 of its 4 cases import `captureWebSourcesBestEffort`. Landing the four helpers alone would put untested exports in this repo. Port the whole evidence block with the test once `convex/lib/nodeslideEvidenceCapture.ts` arrives. |

### Notes for whoever picks this up

- **Deferred npm dependencies.** `convex/nodeslideJobs.ts` needs
  `@convex-dev/persistent-text-streaming` and `convex/nodeslideJobs.ts`,
  `nodeslideJobControl.ts`, `workflows.ts` need `@convex-dev/workflow`. Parity
  pins `^0.3.3` and `^0.3.0`. Not added here: no file that landed needs them,
  and unused runtime dependencies do not belong in a product repo.
- **No dangling runtime references.** Convex entry points are resolved by name
  at runtime (`internal.nodeslideScopedMemory`, `(internal as any).X`), so
  absence is invisible to a symbol grep. Grepping the bare module names for all
  eighteen un-ported modules across `convex/**` in this repo returns zero hits.
  Nothing here is currently calling a function that does not exist.
- **Correction to the intake brief.** It states that this repo's
  `NodeSlideStudio.tsx` already binds
  `nodeslideDelegation.issueGrant/revokeGrant/listGrants` and
  `nodeslideJobs.startEditProposal`, making a workspace port ambiguous. At
  `79ae98f` that is not true: `src/domains/nodeslide/NodeSlideStudio.tsx` has
  zero references to `nodeslideDelegation` or `nodeslideJobs`, and
  `issueGrant`/`revokeGrant` appear nowhere under `src/`. Those bindings exist
  in **parity's** copy of the file. The workspace layer is still MERGE, but on
  the schema evidence above, not on a name collision.
- **Suggested order.** `shared/**` and `convex/lib/**` first — they gate 11
  items with no schema cost. The 117 table-blocked items need an owner decision
  on the schema before any of them can move.

## The unassigned areas: `shared/**` non-nodeslide, and `convex/workflows.ts` (2026-07-27)

Two areas were in nobody's cluster. Both are now closed, one of them by
measurement rather than by porting.

### `shared/**` files not named `shared/nodeslide*` — the set is empty

There are none. `find shared -type f` in parity returns 46 `shared/nodeslide*`
modules plus `shared/generated/nodeslide-arena-contracts.json` and
`shared/generated/nodeslide-atlas-receipts.json`, and nothing else. The area
was unassigned because it does not exist, not because it was overlooked.

This also means no `shared/**` work by this agent could have unblocked the six
modules below. Every `shared/` import in them resolves to a `shared/nodeslide*`
file, which is the other cluster's scope. `scripts/port-audit.mjs` never
emitted these paths either — its source roots are `shared/nodeslide*`,
`convex/nodeslide*`, `mcp/src/nodeslide*`, `src/domains/nodeslide/**` and
`scripts/nodeslide-*`, so a non-nodeslide `shared/` file would have been
invisible to it regardless.

### `convex/workflows.ts` — PORT the manager, MERGE parity-studio's pipeline

Landed at `f55f79b`. `convex/workflows.ts` is also outside the audit's source
roots, so the audit's before/after counts are identical (843 missing, verdict
FAIL, 0 closed, 0 newly missing). That number is not a measurement of this
work; the compiler below is.

Parity's file holds two unrelated things. The `WorkflowManager` singleton is
repo-agnostic durable orchestration and is what NodeSlide imports. The other
three exports — `iterateWithCommentsWorkflow`, `verifyImportedKit`,
`parityStudioWorkflow` — are parity-studio's screenshot-to-UI-kit pipeline.

Copying the file verbatim and running `tsc --noEmit -p convex/tsconfig.json`
produced **35 errors, all in that one file**:

| Code | Count | Cause |
|---|---|---|
| `TS2339` | 30 | `Property '<x>' does not exist` for `runs`, `artifacts`, `uiKits`, `comments`, `parityReports`, `generation` on `internal` |
| `TS2307` | 1 | `Cannot find module '@convex-dev/workflow'` |
| `TS7006` / `TS7031` | 4 | `step` / `args` implicitly `any`, cascading off the untyped `workflow.define` |

None of those six modules or their tables exist here, so the three definitions
are MERGE and stay in parity. No table was added to `convex/schema.ts`.

That refusal also **removes two blockers the table above listed**:
`convex/lib/qualityGate.ts` and its `convex/lib/parityChecker.ts` were reachable
from `nodeslideJobWorkflow` only through the parity-studio definitions. Both
compile clean in this tree, and both were still backed out — they model a
`ParityReport` that has no consumer here, and dead product code from another
repo is not a port.

Two pieces of infrastructure came with it:

- `convex/convex.config.ts` is new; this repo had no component registration at
  all, and `components.workflow` is what the manager wraps. It registers
  `@convex-dev/workflow` only. Parity also registers
  `@convex-dev/persistent-text-streaming`; nothing here imports it, so it is
  still deferred. `convex/nodeslideJobs.ts` is the file that will need it.
- The `components` declaration in `convex/_generated/api.d.ts` is normally
  codegen output, but `npx convex codegen` requires a live `CONVEX_DEPLOYMENT`
  and fails offline (`InvalidDeploymentName`). The three lines were written by
  hand. They are a mechanical reflection of `app.use(workflow)` with no
  deployment-specific content, and `convex/_generated/api.js` is already
  byte-identical to parity's because `componentsGeneric()` resolves components
  at runtime. **Anyone with deployment credentials should run `npm run codegen`
  once to confirm it regenerates the same text.** That is the one claim here
  that was reasoned rather than executed.

Parity ships no test for `workflows.ts`. `convex/workflows.test.ts` is new.

### The six modules blocked only on modules, re-measured at `f55f79b`

Each of the six was copied into this tree and compiled; the errors are the
compiler's. **`nodeslideJobWorkflow` is down from three blockers to one**, and
`./workflows`, `workflow.define` and `@convex-dev/workflow` no longer error in
any of `nodeslideJobWorkflow`, `nodeslideJobs` or `nodeslideJobControl`.

| File | Errors | Remaining direct blockers |
|---|---|---|
| `convex/nodeslideDeckCi.ts` | 1 | `convex/lib/nodeslideDeckCi.ts` |
| `convex/nodeslideJobWorkflow.ts` | 1 | `convex/lib/nodeslideJobValidators.ts` |
| `convex/nodeslidePptxCreate.ts` | 2 | `convex/lib/nodeslideLiveRenderRepair.ts` (+1 `TS7006` cascade) |
| `convex/nodeslideAuthoringQuality.ts` | 3 | `shared/nodeslideAuthoringQuality.ts`, `shared/nodeslideJourneyProof.ts` |
| `convex/nodeslideUploadExtraction.ts` | 3 | `convex/lib/nodeslidePdfExtraction.ts`, `internal.nodeslideUploads`, `internal.nodeslide.attachStoredDataSourceInternal` |
| `convex/nodeslideJobRunner.ts` | 4 | `convex/lib/nodeslideCreationTelemetry.ts`, `convex/lib/nodeslideJobValidators.ts`, `convex/lib/nodeslideLiveRenderRepair.ts` (+1 `TS2322` cascade) |

**The direct blocker list understates the work.** `TS2307` only names the first
hop. Walking the relative-import closure of each of the six against this tree
gives the real absent set — 14 modules, none of them in the areas this agent
owned:

| File | Direct | Transitive absent |
|---|---|---|
| `convex/nodeslideUploadExtraction.ts` | 1 | 1 |
| `convex/nodeslideAuthoringQuality.ts` | 2 | 4 |
| `convex/nodeslideJobWorkflow.ts` | 1 | 3 |
| `convex/nodeslideDeckCi.ts` | 1 | 7 |
| `convex/nodeslidePptxCreate.ts` | 1 | 8 |
| `convex/nodeslideJobRunner.ts` | 3 | 11 |

Union across the six: 5 in `shared/nodeslide*`
(`nodeslideAuthoringPolicy`, `nodeslideAuthoringQuality`, `nodeslideDelegation`,
`nodeslideJourneyProof`, `nodeslideSlideCount`) and 7 in `convex/lib/nodeslide*`
(`nodeslideArtifactPresence`, `nodeslideCreationTelemetry`, `nodeslideDeckCi`,
`nodeslideJobValidators`, `nodeslideLiveRenderRepair`, `nodeslidePdfExtraction`,
`nodeslideSemanticEvaluation`). Zero in `src/domains/nodeslide/**` — that layer
is already complete here for these six.

`convex/nodeslideUploadExtraction.ts` is the cheapest of the six: one absent
module, no transitive tail. `convex/nodeslideJobRunner.ts` is the most
expensive.

### Not established

- Whether the six modules **pass their tests** once they compile. Only
  compilation was measured; their suites were never run, because none of the
  fourteen dependency modules has landed.
- Whether `npm run codegen` against a real deployment reproduces the
  hand-written `components` block byte for byte.
- The runtime behaviour of the workflow component. `convex/workflows.test.ts`
  proves the manager is constructed against a registered component with the
  ported retry and concurrency policy, and that `.define()` returns an internal
  registered mutation. It does not start, replay, or cancel a real durable run
  — that needs a deployment.
- Six vitest files were failing in this worktree before and after this change
  (`scripts/tests/nodeslide-benchmark-*`, `-taste-judge`, `-tastebench`,
  `-uxbench`, `packages/cli/src/installer.test.ts`). Running the same six files
  in the `nodeslide` main checkout at `79ae98f` fails the same tests with the
  same `Test timed out in 5000ms` / `Hook timed out in 10000ms` /
  `ENOTEMPTY: rmdir` errors, and the failing subset differs run to run in both
  trees. They are pre-existing Windows temp-directory flakes, not a regression
  from this work, but they were not fixed and they are not tracked anywhere.
