# Next session: remaining literal visual and human acceptance

Last updated 2026-07-20.

All code-completable release, deployment, packaging, mounted-consumer, and
bilateral-CI work is merged. Start with `docs/CAPABILITY_PLAN.md`, which remains
the checklist of record. Do not reopen completed items without contradictory
deterministic evidence.

## Exact shipped state

- NodeSlide main includes the merged B6 camera receipt plus E4 implementation
  SHA `67154cf03bca1419175f577070b15f7ab80c0549` and its proof artifacts.
- Exact-main CI
  [29795473157](https://github.com/HomenShum/NodeSlide/actions/runs/29795473157)
  and production deployment
  [29795711517](https://github.com/HomenShum/NodeSlide/actions/runs/29795711517)
  passed. E4's production camera, screenshot, editable PPTX, and receipt are in
  `docs/demo/nodeslide-e4-openverse.*`.
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
- Automated production deployment proof:
  [29786276438](https://github.com/HomenShum/NodeSlide/actions/runs/29786276438)
  for exact tested main SHA `71fb8726b15da70408692e6e6aeafac6a438ef1a`.
- NodeRoom mounted consumer main:
  `d2c77bcb8fcbdd11b0e87d3fd597f2ec1103eb04` via
  [PR #234](https://github.com/HomenShum/NodeRoom/pull/234). It pins the exact
  v0.2.2 producer, manifest, public proof, all package bytes, and lock
  integrities. Both CI triggers passed the full production gate and bilateral
  Memory/Convex/React/NodeAgent consumer journey.
- NodeSlide exact release-candidate CI:
  [29786776403](https://github.com/HomenShum/NodeSlide/actions/runs/29786776403),
  including NodeRoom's canonical NodeAgent packed-consumer journey.

`v0.2.0` and `v0.2.1` remain immutable audit history, not acceptance targets.
`v0.2.1` was superseded because its public Ubuntu rebuild did not match its
Windows-built manifest. Never rewrite that failure as a pass.

## Remaining literal acceptance

Only work that requires a real recorded UI or a human action remains:

1. F1/F2/F4: record live web snapshot capture, the claim-bound region, and the
   element-to-region opening behavior.
2. I7: record the mounted NodeRoom journey in a real browser with accessibility
   observation. The deterministic product path, reload, export, Memory/Convex
   parity, v0.2.2 pin, and bilateral CI are already complete.
3. H5: a human sends the Mike draft.

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
