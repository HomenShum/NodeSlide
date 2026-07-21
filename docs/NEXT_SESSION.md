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
3. Model-fleet health remains an open production blocker. The historical
   1-token audit is retained at
   `artifacts/prod-proof-20260720/model-fleet-probe.json`. Commit `7edc66f`
   removed the uncredentialed Nebius route from the offered fleet, raised the
   bounded probe to 64 tokens, and pinned affected OpenRouter metadata. Commit
   `8bc12a7` fixed the pi-ai provider-option boundary and explicitly disabled
   hidden reasoning for pinned routes. Its exact-commit CI, conformance, and
   deploy gates passed, but the second and final authorized production probe
   still returned 4/8: Kimi, Sonnet, GPT Sol, and GPT Terra passed; GLM exhausted
   64 output tokens; Fable, Gemini 3.5, and Gemini 3.1 rejected or failed the
   explicit-disable request. The red receipt is
   `artifacts/prod-proof-20260721/model-fleet-probe.json`. Do not claim a healthy
   fleet. The next pass should inspect sanitized upstream error classifications
   and implement route-specific reasoning controls, then begin a fresh bounded
   production QA pass; this pass exhausted its two-attempt stop limit.
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
