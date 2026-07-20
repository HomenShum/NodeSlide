# Next coding-agent session — start here

Last updated 2026-07-20. Read this first, then
`docs/CAPABILITY_PLAN.md` (literal checklist of record),
`docs/EXTRACTION_BOUNDARY.md` (package boundary), and
`docs/ops/PRODUCTION_RUNBOOK.md` (intended deployment path).

Code checkpoints before this docs-only deployment-proof update:

- NodeSlide: `12a8527cb99adf5e80af2302a53332509ce7c283`
- parity-studio: `de4a67585f9040db95b2af7caeae69c92894e4e5`
- NodeRoom packed-consumer proof baseline:
  `4a4a3c259ddfa96e51b8194685a7c3b9ff56c384`; v3 proof-contract checkpoint:
  `332149ef4ac945546479d08d328d3f43378b3831` (PR #231)

## Verified production state

- Public app: https://nodeslide.vercel.app
- Immutable Vercel deployment:
  https://nodeslide-3h78aruec-hshum2018-gmailcoms-projects.vercel.app
  (`dpl_FdrshFwD6ZpUmkaBmHgaURtXBofg`; the immutable hostname is protected by
  Vercel login, while the canonical alias is public).
- Exact frontend entry: `/assets/index-B-8KKdg_.js`.
- Convex production: `agile-stoat-411` at
  https://agile-stoat-411.convex.cloud.
- The authorization spine and replay hardening from PRs #17, #19, #21, and #23
  were manually deployed from exact code baseline `12a8527` to production
  Convex. PR #23 is server/test/docs-only, so the canonical alias correctly
  retains the unchanged frontend entry. The production-bound local build and
  runtime smoke pass; the canonical entry still embeds production Convex and
  passes live DOM, CSP, and zero-browser-error checks. There is still no
  automated exact-SHA deployment receipt; retain that distinction until H3 is
  configured and run.
- Final CI corpus at the code baseline: **765 tests across 99 files**
  (core 745/96 + external-agent 11/1 + MCP 9/2), plus typecheck, Biome,
  production build, MCP, node-platform, and packed NodeRoom/NodeAgent consumer
  gates.

## What this session actually closed

- B5 judged variations; E2 BYOK image generation; E3 crop/focal controls;
  stale-redeploy reload UX; H2 scheduled production probe; I3 controlled
  React surfaces; and J5 ecosystem acceptance.
- C4 live math acceptance. The persisted golden exported a 201,283-byte PPTX
  with SHA256
  `B1FCFB1A480E30B5D364A3D800694A9C568C46D1E135238A336D5EB90E4C50B6`.
  Slide 4 contained exactly one math picture backed by a 998×346 PNG, no
  equation text run, and the equation rendered visibly in desktop PowerPoint.
  Slide-4 XML used Georgia three times and Fraunces zero times at the portable
  export boundary, without changing the canonical deck snapshot.
- Production log diagnosis and the bounded capture wrapper. Use
  `npx convex logs --history 50 --success --jsonl --prod`; the repository
  wrapper is `scripts/capture-convex-logs.mjs`.
- The repository authorization spine now requires host-supplied authorization
  for all governed repository mutations and binds receipts to frozen request
  evidence. NodeRoom's packed-consumer proof is operation-v1-only for current
  NodeSlide main; PR #226 removed the rollout bridge, so the old three-argument
  legacy ABI now fails closed. This remains package-level proof, not a mounted
  production host adapter.
- PR #19 closes the post-review replay gaps: immutable proposal decisions and
  stale results, lazy legacy upgrades, canonical receipt/submission IDs,
  dual-index envelope collision checks, contradictory-history rejection, and
  organization-bound custom receipt replay. A subsequent review found one
  origin deck-version binding gap; PR #21 closes it before any write for direct
  and unresolved submissions. A follow-up review found that rejected proposals
  preserve the same submission-version coordinate; PR #23 closes that path
  before any authorization write and extends the regression matrix. The focused
  security suite is 34/34, and the combined security/memory suite is 49/49.
- NodeRoom has bilateral package-level CI and real NodeAgent type compatibility.
  The jobs currently pair moving `main` branches rather than an atomic
  immutable-SHA pair. This is not yet a mounted second product consumer; I7
  remains open.
- NodeRoom PR #231 makes the executable consumer-proof vocabulary explicit. Its
  v3 receipt proves an in-memory receipt ledger, a same-instance in-memory
  repository reread, and a portable JSON snapshot round-trip; it requires
  `durableReceiptPersistence: false` and `packageReload: false`. Those bounded
  checks do not satisfy I7's future mounted reload and durable-persistence goals.
- Portable PPTX font fallback behavior was mirrored into parity-studio and its
  full suite passed: **1,494 tests across 198 files**.
- I2 and I5 are closed in the package boundary: `@nodeslide/convex` now ships a
  mountable component with isolated tables/functions, a generated
  `ComponentApi`, one-time host mutation grants, two contiguous migrations,
  and no application Convex imports. Its tests exercise a real component
  schema through `convex-test`. The six server invariants are exported
  literally and cannot be weakened by host UX configuration.
- I6's local immutable-artifact slice is complete. Eleven v0.1.0 tarballs were
  generated from exact baseline `df5567917425901252252e3adb2efb788ec345e4`;
  a clean consumer then installed that release and upgraded to the v0.2.0
  candidate with exact receipt and `package-lock.json` integrity pins. Tampered
  bytes and a mixed manifest failed closed. I6 remains unchecked only because
  publishing and verifying two public immutable GitHub releases is external
  release work.

## Remaining work — literal acceptance only

1. **A5:** run the remaining 14 production generations. Six of the required
   20 passed; do not convert 6/20 into a checkmark.
2. **B3:** add and run the fleet-wide 1-token model probe. The Gemini 3.5 Flash
   `reasoning:false` override shipped, but the fleet audit did not.
3. **B6 and E4:** record the camera acceptances. The dev-only
   `NODESLIDE_DEV_CREATION_FAULT=drop_requested_chart` repair path and the
   headless image-search journey are tested, but the checklist explicitly asks
   for recorded proof.
4. **F1/F2/F4:** finish live screenshot capture, claim-bound region highlight,
   and the element-to-region acceptance. F3 alone is complete.
5. **G2/G3:** stream assistant text and render nested handoffs.
6. **H3:** configure the production GitHub environment and retain a successful
   exact-SHA automated deploy receipt. No repository environment, secrets, or
   variables exist yet. Required secrets: `CONVEX_DEPLOY_KEY`, `VERCEL_TOKEN`,
   `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
   `VERCEL_AUTOMATION_BYPASS_SECRET`; optional diagnostics secret:
   `CONVEX_DIAGNOSTICS_KEY`; required variable:
   `NODESLIDE_PRODUCTION_DEPLOY_ENABLED=true`.
7. **I4:** mount NodeRoom ActorProof/membership policy as the production host
   authorizer. Package-level authorization/evidence is real; the product host
   adapter is not mounted.
8. **I6:** enable GitHub release immutability, publish two complete artifact
   sets, and run `.github/workflows/immutable-package-proof.yml`. Preserve its
   successful report only after `gh release verify` and every
   `gh release verify-asset` check pass; the local proof is not public-release
   evidence.
9. **I7/I8:** mount the full NodeRoom room-artifact journey, including its own
   principal, canvas, presenter/PPTX/reopen, browser/a11y, and Memory/Convex
   parity; then make that smallest full journey bilateral CI.
10. **H5:** the human still sends Mike's draft.

## Mirror rule

Mirror shared product behavior in `shared/`, `src/domains/nodeslide/`, and
relevant application Convex code. Do not mechanically mirror NodeSlide-owned
`packages/`, `mcp/`, production workflows/probes, registry/installer assets,
isolated component-install material, or product-specific deployment adapters.

For each mirrored behavior change: implement and gate NodeSlide first, port the
smallest behavior-equivalent patch to parity-studio, run the parity release/UI
gates, and record both commits. Exact file identity is not the contract;
observable product behavior is.

## Cross-repo truth and preserved work

- NodeSlide and parity-studio should have zero open PRs after this handoff.
  NodeRoom intentionally retains unrelated draft PRs #182, #190, and #219.
- Preserve the active NodeSlide React-headless work and the unmerged external
  agent / React-headless remote branches; they were not part of this closeout.
- Preserve parity-studio's primary-worktree `NUL` entry while fast-forwarding
  main. Its five unmerged remote branches need deliberate triage, not deletion.
- Preserve unrelated dirty NodeRoom clones/worktrees and the worktrees backing
  open PRs. Only clean, tree-equal authorization-rollout artifacts were cleanup
  candidates.

## How to work

- Start with root-cause evidence before changing code. Keep one git-index owner
  per worktree; parallelize read-only audits and independent repos.
- Every implementation arc is implement → focused gate → full relevant gate →
  commit. Never delete a failing test just to reduce the corpus.
- Verification is fail-closed: assert real product state, not captions. A green
  build is not runtime proof; run `scripts/smoke.mjs` locally and
  `scripts/live-smoke.mjs` against production after deploys.
- Never force-push or reset another session's work. On a push race, fetch,
  rebase/merge deliberately, rerun gates, then push.
- Check the exact checklist wording before marking an item complete. “Partial,”
  “headless,” and “package-level” are meaningful boundaries here.

## Commands that matter

```bash
# full local gate
npm run check

# production-bound build and local runtime smoke
VITE_CONVEX_URL=https://agile-stoat-411.convex.cloud \
VITE_CONVEX_SITE_URL=https://agile-stoat-411.convex.site npm run build
node scripts/smoke.mjs

# production logs
npx convex logs --history 50 --success --jsonl --prod
node scripts/capture-convex-logs.mjs
```

The capture wrapper requires a production-scoped `CONVEX_DEPLOY_KEY`; it writes
only the bounded, sanitized artifact described in the script header.

The intended production path is `.github/workflows/deploy-production.yml`:
exact CI-tested main → production-bound build → local smoke → Convex deploy →
Vercel deploy → exact-bundle live-DOM gate. It remains disabled until H3's
external configuration exists. Manual prebuilt staging is emergency-only; no
`nodeslide-deploy/` directory should remain after a run.

## Traps already paid for

- Vite `manualChunks` substring matches can break React initialization order;
  use exact folder matching.
- OpenRouter `reasoning:true` can consume the response budget before JSON.
  Keep explicit provider overrides and test them; B3's fleet probe is still due.
- Creation needs the 240-second provider budget; slide count is enforced by the
  response schema, not prompt prose.
- The default bar chart is DIV-based; SVG-only probes are wrong for that case.
- Keep shared/server/client validation verdicts aligned. Export uses the same
  fail-closed geometry truth.
- Native `<dialog>` uses `position:absolute`. Center it with `inset:0;
  margin:auto` and give the grid a definite height to avoid the collapsed
  `minmax(0,1fr)` body row.
- Windows Git/PowerShell: autocrlf can create noise; Git Bash `/tmp` is not a
  Windows Python path; a stray `NUL` entry breaks broad `git add -A`.
- `npx convex run <fn> '<json>' --prod` exposes an unsanitized server error when
  the browser only reports “Server Error.”
- An open Convex action socket can go stale across a redeploy. The shipped UI
  now asks the user to reload; do not misdiagnose that class as backend failure.

## Submission context

This is the AI Fund SlideLang Build Challenge submission for Mike Rubino. The
demo is embedded in the README. The final email send is deliberately human.
The product doctrine remains: no caption, trace, checkmark, or handoff may claim
what the system did not prove.
