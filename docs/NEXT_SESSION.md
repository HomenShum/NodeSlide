# Next session: externally blocked and human acceptance tail

Last updated 2026-07-20.

NodeSlide's code-completable release, deployment, packaging, production camera,
bilateral-CI work, and the stronger mounted NodeRoom browser proof are merged.
Start with `docs/CAPABILITY_PLAN.md`, which remains the checklist of record. Do
not reopen completed items without contradictory deterministic evidence.

## Exact shipped state

- NodeSlide shipped-app main `6ee3aab402d3c599cccd322c140004663ae8a6da`
  includes the B6 DEV-only repair-camera receipt, the bounded Openverse repair,
  E4's production video/screenshot/editable PPTX, fresh production logging, and
  GitHub-environment receipts. The evidence-only handoff commit after that SHA
  preserves both stale-redeploy observations.
- Exact-main CI
  [29798111891](https://github.com/HomenShum/NodeSlide/actions/runs/29798111891)
  and production deployment
  [29798347209](https://github.com/HomenShum/NodeSlide/actions/runs/29798347209)
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

## Remaining literal or externally blocked acceptance

Do not convert any of these into a green claim without the named evidence:

1. F1/F2/F4 is externally blocked: production has no NodeSlide-owned Linkup,
   Brave, Serper, or Tavily credential. Two consented attempts failed before
   egress and mutated nothing. Never copy a credential from an unrelated local
   project; configure one explicitly, then record snapshot → region → citing
   element acceptance.
2. The stale-action reload component is implemented and regression-covered.
   The first production timing attempt signalled before Convex activation; a
   second submitted 2.880 seconds after activation. Both old clients succeeded
   with reviewable, unapplied proposals and zero console errors, so the stale
   failure/banner was not reproduced. Preserve both raw receipts and do not
   relabel the deterministic banner tests as a live camera pass. Reopen only if
   a natural stale-action rejection supplies the missing production condition.
3. The production fleet probe is a completed red audit, not a healthy-fleet
   claim: 4/9 catalog routes returned assistant text and 5/9 failed or returned
   none. Its exact receipt is `artifacts/prod-proof-20260720/model-fleet-probe.json`.
4. H5 remains human-only: send the Mike draft.

I7 is closed by [NodeRoom PR #236](https://github.com/HomenShum/NodeRoom/pull/236)
at NodeRoom main `616c902f09743613ae1cbddc97b5819fb29c831e`. Its committed
browser/accessibility receipt, screenshot, video, and PPTX are linked from the
capability plan.

The B6 narrow-formula P1 is also closed. Product CSS no longer overrides nested
KaTeX spans, and `docs/demo/nodeslide-b6-formula-css-proof.receipt.json` records
a green 160 × 96 px Chromium geometry/accessibility proof with its screenshot.

Screenshots, component tests, captions, and CI summaries are not substitutes
for the checklist's explicit camera/browser/human wording.

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
- Do not use `reasoning:true` on the affected OpenRouter routes; it can consume
  the response budget before structured JSON.
- Creation needs the 240-second provider budget.
- The default bar chart is DIV-based; SVG-only probes are invalid.
- Vite `manualChunks` substring matches can break React initialization order.
- Preserve the v0.2.1 reproducibility failure and the exact v0.2.2 acceptance
  chain.
- Keep unrelated dirty worktrees and ProofLoop memory/output uncommitted.

The product doctrine remains: no caption, trace, checkmark, or handoff may claim
what the system did not prove.
