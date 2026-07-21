# Next session: externally blocked and literal acceptance tail

Last updated 2026-07-20.

NodeSlide's code-completable release, deployment, packaging, production camera,
and bilateral-CI work is merged. The stronger mounted NodeRoom browser proof is
being finalized separately. Start with `docs/CAPABILITY_PLAN.md`, which remains
the checklist of record. Do not reopen completed items without contradictory
deterministic evidence.

## Exact shipped state

- NodeSlide main `04b034d8888202259db561deaa0525a4e552dd8e` includes the B6
  DEV-only repair-camera receipt, the bounded Openverse repair, and E4's
  production video, screenshot, editable PPTX, and receipt in
  `docs/demo/nodeslide-e4-openverse.*`.
- Exact-main CI
  [29796540673](https://github.com/HomenShum/NodeSlide/actions/runs/29796540673)
  and production deployment
  [29796788784](https://github.com/HomenShum/NodeSlide/actions/runs/29796788784)
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

## Remaining literal or externally blocked acceptance

Do not convert any of these into a green claim without the named evidence:

1. F1/F2/F4 is externally blocked: production has no NodeSlide-owned Linkup,
   Brave, Serper, or Tavily credential. Two consented attempts failed before
   egress and mutated nothing. Never copy a credential from an unrelated local
   project; configure one explicitly, then record snapshot → region → citing
   element acceptance.
2. I7 still needs its stronger mounted NodeRoom browser/accessibility receipt
   merged before checking the item. The deterministic reload/export,
   Memory/Convex/isolated-component, authorization, v0.2.2 pin, and bilateral
   CI paths are already green.
3. The stale-action reload component is implemented and regression-covered.
   The first production timing attempt signalled before Convex activation and
   the old client succeeded, so the banner was not reproduced. Preserve that
   receipt and run the next attempt only after exact Convex activation.
4. The production fleet probe is a completed red audit, not a healthy-fleet
   claim: 4/9 catalog routes returned assistant text and 5/9 failed or returned
   none. Its exact receipt is `artifacts/prod-proof-20260720/model-fleet-probe.json`.
5. B6 itself passed, but its generated narrow formula box exposed a separate
   open P1: broad math-span CSS stacks nested KaTeX characters vertically.
6. H5 remains human-only: send the Mike draft.

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
