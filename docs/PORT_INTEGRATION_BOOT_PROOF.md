# Port integration — boot proof, and its exact ceiling

Captured 2026-07-27 against `port/integration` @ `546d2b8`, before the `port/tables` and
`port/libtail` branches landed. Written because PR #74 shipped with five green checks and returned
HTTP 500 in production, and because no item on this port had ever been verified past the compiler.

## What was actually run

| step | command | result |
|---|---|---|
| root types | `npx tsc -p tsconfig.json --noEmit` | exit 0 |
| convex types | `npx tsc -p convex/tsconfig.json --noEmit` | exit 0 |
| tests | `vitest run` | 132 files, 1044 passed, 1 skipped |
| production build | `npm run build` (`packages:build && tsc -b && vite build`) | exit 0, built in 26.97s |
| serve | `vite preview --strictPort --port 4319` | index HTTP 200, 1310 bytes |
| asset | `GET /assets/index-D7cwfM_B.js` | HTTP 200, 609,669 bytes |
| render | real browser, DOM read | `#root` has 1 child — React mounted |
| console | all levels | zero messages |

The build is a materially stronger oracle than `tsc` and was worth running on its own: `vite build`
resolves the entire import graph at bundle time, so an unresolvable module fails there even where a
type-only reference satisfied the compiler. It passed.

## What the render actually showed

    NODESLIDE DEPLOYMENT GUARD
    This preview is not connected to a backend.
    VITE_CONVEX_URL is required in every environment. NodeSlide is intentionally
    disconnected rather than falling back to production data.

**This is the correct result, not a failure.** The guard is fail-closed behaviour working exactly as
designed — the app refuses to reach for production data when its backend URL is absent, which is the
same doctrine the ledger and the evidence gates run on. It rendering *at all* is the finding: the
bundle mounts, React runs, and the first thing the ported tree does is decline to invent a
connection.

## The ceiling — stated plainly, because the number above is easy to over-read

`.nodeslide-studio` was **not** found and **zero** `data-ns-*` attributes were observed. Those are
the attributes `scripts/nodeslide-agent-ui-linter.mjs` gates on and the ones
`capture-gap-closure-ui-qa.mjs` fails a run over. They are unreachable without a live Convex
deployment, and supplying one would mean pointing this build at real data — precisely what the guard
above exists to prevent.

So the honest reading:

    PROVEN      the ported tree compiles, bundles, serves, mounts, and fails closed cleanly
    NOT PROVEN  that any ported convex function, query, mutation or studio surface behaves correctly

Every convex function on this branch remains verified by the compiler and its unit tests only. Vite
does not bundle them, so the strongest oracle available here never touched them. **"It builds and
boots" is not "the port works,"** and no claim in PR #84 should be read as the latter.

## What would close the gap

A deployment with real credentials, then the repo's own gates against it:
`nodeslide-agent-ui-linter.mjs` for the three required `data-ns-*` attributes, and
`capture-gap-closure-ui-qa.mjs` for the `data-ns-theme` agreement check. Until then the LAUNCH gate
in the NodeKit plan — fetch the live URL, find the promised DOM signal — is **unsatisfied for this
port**, and that is the single largest piece of unverified surface in it.

## Reproduce

```
cd <worktree> && npm run build
npx vite preview --strictPort --port 4319
# then, in a real browser, not curl:
#   document.getElementById('root').children.length     -> 1
#   document.querySelector('.nodeslide-studio')          -> null without a backend
```

Note the last line. `curl` on this URL returns a 1,310-byte shell with no application content, and
that shell is identical whether the app works or is catastrophically broken. A raw-HTML grep would
have called this verified while proving nothing at all.
