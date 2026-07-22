# Next session: maintenance and new goals

Last updated 2026-07-21.

NodeSlide's code-completable release, deployment, packaging, production camera,
bilateral-CI work, and the stronger mounted NodeRoom browser proof are merged.
Start with `docs/CAPABILITY_PLAN.md`, which remains the checklist of record. Do
not reopen completed items without contradictory deterministic evidence.

## Exact shipped state

- NodeSlide shipped-app main `955fbdbc5d7d635ba67ecc830515d78a94d0f2c0`
  includes the B6 DEV-only repair-camera receipt, the bounded Openverse repair,
  E4's production video/screenshot/editable PPTX, production logging, the
  credential-backed Linkup proof, and element-bound snapshot navigation.
- Exact-main CI
  [29810144284](https://github.com/HomenShum/NodeSlide/actions/runs/29810144284)
  and production deployment
  [29810501034](https://github.com/HomenShum/NodeSlide/actions/runs/29810501034)
  passed through Convex, Vercel, immutable-URL, and canonical live-DOM gates.
- The GitHub `production` environment's custom branch roster contains only
  `main` (administrators can bypass); exactly four deployment secret names are
  configured, the obsolete bypass secret is absent, and deployment automation
  is enabled. The sanitized receipt is
  `artifacts/github-production-environment.json`; it contains no secret values.
- Approved package release: immutable, attested
  [`v0.2.2`](https://github.com/HomenShum/NodeSlide/releases/tag/v0.2.2), built
  from exact SHA `a88fb57f111db82e9334d68fa7611a51ed54c3c1`.
- Twin Ubuntu build receipts:
  [29786786189](https://github.com/HomenShum/NodeSlide/actions/runs/29786786189)
  and [29786787854](https://github.com/HomenShum/NodeSlide/actions/runs/29786787854);
  their complete artifact directories were byte-for-byte identical.
- Public immutable install/upgrade proof:
  [29787121559](https://github.com/HomenShum/NodeSlide/actions/runs/29787121559),
  covering exact rebuild, clean install, v0.1.0 to v0.2.2 upgrade, lock pins,
  tamper rejection, and mixed-release rejection.
- NodeRoom mounted consumer main:
  `0d13dffe88190e7911986bfe5027761cae6294c5` via
  [PR #235](https://github.com/HomenShum/NodeRoom/pull/235). It preserves the
  exact v0.2.2 producer/manifest/public-proof/package-byte/lock-integrity pins
  and adds a clean literal browser/a11y receipt for edit → Make live → reopen,
  mounted package-boundary attributes, and fail-closed unverified writes. Exact
  PR CI
  [29798115351](https://github.com/HomenShum/NodeRoom/actions/runs/29798115351)
  passed the production gate plus authenticated authorization, isolated
  component, Memory/Convex/React, and both existing NodeAgent journeys.
  Post-merge main CI
  [29798490823](https://github.com/HomenShum/NodeRoom/actions/runs/29798490823),
  [conformance 29798491024](https://github.com/HomenShum/NodeRoom/actions/runs/29798491024),
  and [ProofLoop 29798490834](https://github.com/HomenShum/NodeRoom/actions/runs/29798490834)
  are green. The literal camera used a local memory sample; no NodeRoom
  production Convex deployment is claimed.
- NodeSlide exact release-candidate CI:
  [29786776403](https://github.com/HomenShum/NodeSlide/actions/runs/29786776403),
  including NodeRoom's canonical NodeAgent packed-consumer journey.

`v0.2.0` and `v0.2.1` remain immutable audit history, not acceptance targets.
`v0.2.1` was superseded because its public Ubuntu rebuild did not match its
Windows-built manifest. Never rewrite that failure as a pass.

## Closed acceptance and retained observations

Do not convert any of these into a green claim without the named evidence:

1. F1/F2/F4 is closed. With explicit user authorization, the configured
   production Linkup credential was transferred from NodeBench AI to the pinned
   NodeSlide production Convex environment without exposing its value. The
   committed production proof records consent, eight retained web sources, a
   reviewable proposal, explicit acceptance, and an element-bound highlighted
   snapshot region with zero browser errors. See
   `docs/demo/nodeslide-web-research-proof/receipt.json` and its PNG/video
   siblings.
2. The stale-action reload component is implemented and regression-covered.
   The first production timing attempt signalled before Convex activation; a
   second submitted 2.880 seconds after activation. Both old clients succeeded
   with reviewable, unapplied proposals and zero console errors, so the stale
   failure/banner was not reproduced. Preserve both raw receipts and do not
   relabel the deterministic banner tests as a live camera pass. Reopen only if
   a natural stale-action rejection supplies the missing production condition.
3. Model-fleet health is closed with a fresh bounded production pass. The historical
   1-token audit is retained at
   `artifacts/prod-proof-20260720/model-fleet-probe.json`. Commit `7edc66f`
   removed the uncredentialed Nebius route from the offered fleet, raised the
   bounded probe to 64 tokens, and pinned affected OpenRouter metadata. Commit
   `8bc12a7` fixed the pi-ai provider-option boundary but the second pass still
   returned 4/8; preserve that red receipt at
   `artifacts/prod-proof-20260721/model-fleet-probe.json` as historical evidence.
   Commit `76a6623` then removed the invalid reasoning-disable overrides for
   mandatory-reasoning Fable/Gemini routes, aligned the UI effort allowlists with
   current provider metadata, and assigned route-specific probe budgets. The
   first fresh production audit passed all 8/8 routes at
   2026-07-21T22:53:19Z. Its sanitized receipt is
   `artifacts/prod-proof-20260721-final/model-fleet/model-fleet-probe.json`; the
   companion production create → edit → reload → seven-slide PPTX export receipt
   is in the sibling `prod-probe/report.json`. Reopen only on a new red receipt.
4. H5 is closed by the user's confirmation that the Mike draft was already
   sent. Do not draft or send another copy.
5. Visual-generation acceptance is reopened by contradictory rendered-deck
   evidence. The prior A5 N=20 receipt proved geometry, publishability, and
   archetype IDs, not visual storytelling. Track K in `docs/CAPABILITY_PLAN.md`
   is the new ordered work: K1 structured diagrams/rhythm preflight and K2's
   server-owned StorySpec/material inventory are implemented. K2's receipt
   proves that an uncaptured screenshot stays a blocked placeholder even when
   provider output tries to promote it. K3-K5 are now also implemented and
   accepted through real candidate pixels, complete-deck rhythm review, and
   seven individually inspected exported-PPTX renders. The first PPTX pass
   exposed a diagram-body/bullet collision; the repaired second pass and the
   overflow gate are green. See
   `docs/demo/nodeslide-visual-authoring-v2/receipt.json`. Never replace this
   acceptance with layout IDs or compilation alone.

I7 is closed by [NodeRoom PR #236](https://github.com/HomenShum/NodeRoom/pull/236)
at NodeRoom main `616c902f09743613ae1cbddc97b5819fb29c831e`. Its committed
browser/accessibility receipt, screenshot, video, and PPTX are linked from the
capability plan.

The B6 narrow-formula P1 is also closed. Product CSS no longer overrides nested
KaTeX spans, and `docs/demo/nodeslide-b6-formula-css-proof.receipt.json` records
a green 160 × 96 px Chromium geometry/accessibility proof with its screenshot.

Screenshots, component tests, captions, and CI summaries are not substitutes
for the checklist's explicit camera/browser/human wording.

## Artifact Atlas / Arena V2 milestone

The expansion plan is implemented as Artifact Atlas V2. The source is
`benchmarks/artifact-atlas/v2/atlas.json`; the newest deliverable is
`outputs/artifact-atlas-v2/nodeslide-artifact-atlas-v2.pptx`. It contains 38
canonical recipes, a 14-slide public showcase, seven design languages, twelve
controlled theme variants, six domain packs, four motion/fallback contracts,
real product/media proof, advanced data/system artifacts, accessibility
contracts, free-router/model ledgers, and a same-control harness comparison.
Both PowerPoint files were independently rendered and passed `slides_test.py`.
The V2 finalizer records the observed visual gate in all receipts; human
preference remains pending. See `docs/ARTIFACT_ATLAS_ARENA.md` for exact outputs
and commands.

## Artifact Atlas / Arena V1 history

All six implementation phases in `docs/ARTIFACT_ATLAS_ARENA.md` are present in the
local worktree:

- twelve fixtures cover all eight Atlas categories, with 72 equal-input live-model
  candidates plus twelve deterministic controls;
- all 84 plans completed, and the browser/native-PPTX critic pass retained 82 as
  eligible;
- the two red receipts are intentional evidence, not missing work: Gemma duplicated a
  screenshot callout operation while omitting the missing-evidence label, and Kimi used
  the explicitly forbidden `real screenshot` claim;
- capability cards and recommendations are advisory (`autoApply: false`), and the free
  Gemma route completed 23/24 candidates at zero provider cost;
- Artifact Gallery and Model Compare now use real pixels, operations, eligibility, and
  economics; Harness Compare honestly reports that no comparable prior harness receipt
  exists;
- twelve coverage-balanced provisional winners are in the local gallery, and twelve
  model-blind brackets await human preference. `publicReleaseApproved` remains `false`;
- `outputs/ultra-showcase-rc1/nodeslide-ultra-showcase-rc1.pptx` is a 12-slide,
  coverage-balanced release candidate. It passed independent rendering and
  `slides_test.py`; human tournament approval is still required before calling it a
  public winner deck.

The renderer supports resumable `--only-failed` repair passes and rebuilds aggregates
from per-candidate receipts, because a killed full run can leave `receipts.json` stale.
Do not replace the two honest red model receipts with synthetic green results. The only
remaining Atlas decision is human blind preference/public approval, not implementation.

## Useful gates

```bash
npm run check
npm run packages:build
node scripts/smoke.mjs
node scripts/live-smoke.mjs
```

For NodeRoom, follow its `AGENTS.md` and `CLAUDE.md`. The pinned mounted-release
gate is `npm run nodeslide:mounted:release:proof`; the fast repository gate is
`npm run floor`. Before changing NodeAgent, run both required NodeAgent smokes.

## Traps already paid for

- Do not weaken fail-closed verification to make a receipt green.
- Do not apply one global reasoning shape to every OpenRouter route. Kimi needs
  an explicit disable; GLM consumed the 64-token probe budget; Fable and both
  Gemini routes require route-specific handling. Preserve sanitized error
  classification without logging provider bodies or credentials.
- Creation needs the 240-second provider budget.
- The default bar chart is DIV-based; SVG-only probes are invalid.
- Vite `manualChunks` substring matches can break React initialization order.
- Preserve the v0.2.1 reproducibility failure and the exact v0.2.2 acceptance
  chain.
- Keep unrelated dirty worktrees and ProofLoop memory/output uncommitted.

The product doctrine remains: no caption, trace, checkmark, or handoff may claim
what the system did not prove.
