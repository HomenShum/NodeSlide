# Port integration — boot proof, and its exact ceiling

Captured 2026-07-27. Written because PR #74 shipped with five green checks and returned HTTP 500 in
production, and because no item on this port had ever been verified past the compiler.

Two measurements are recorded below, at two different commits, because the branch moved under the
first one. Both are kept. Reporting only the green one would be the precise error this port has
spent the day cataloguing.

## Measurement 1 — `546d2b8`, all green

| step | command | result |
|---|---|---|
| root types | `npx tsc -p tsconfig.json --noEmit` | exit 0 |
| convex types | `npx tsc -p convex/tsconfig.json --noEmit` | exit 0 |
| tests | `vitest run` | 132 files, 1044 passed, 1 skipped |
| production build | `npm run build` | exit 0, built in 26.97s |
| serve | `vite preview --strictPort --port 4319` | index HTTP 200, 1310 bytes |
| asset | `GET /assets/index-D7cwfM_B.js` | HTTP 200, 609,669 bytes |
| render | real browser, DOM read | `#root` has 1 child — React mounted |
| console | all levels | zero messages |

`npm run build` was worth running on its own: `vite build` resolves the entire import graph at
bundle time, so an unresolvable module fails there even where a type-only reference satisfied the
compiler. It passed.

### What the render showed

    NODESLIDE DEPLOYMENT GUARD
    This preview is not connected to a backend.
    VITE_CONVEX_URL is required in every environment. NodeSlide is intentionally
    disconnected rather than falling back to production data.

**This is the correct result, not a failure.** The guard is fail-closed behaviour working as
designed — the app refuses to reach for production data when its backend URL is absent, the same
doctrine the ledger and evidence gates run on. It rendering *at all* is the finding: the bundle
mounts, React runs, and the first thing the ported tree does is decline to invent a connection.

## Measurement 2 — `911555b`, after merging `origin/port/integration`

The branch advanced by three commits while measurement 1 was being written (PR #83's trace
waterfall, a `main` merge, and a dedupe repair). Re-running rather than shipping a proof pinned to a
SHA that is no longer the head:

    root tsc     exit 2      <- was 0
    convex tsc   exit 0
    build        exit 1      <- was 0

Five errors, all `TS2307 Cannot find module`: `pdfjs-dist`, `@assistant-ui/react-o11y`,
`@assistant-ui/store`, plus two `TS7006` implicit-any that are downstream of the missing types.

**This is not broken code, and the first read of it was wrong.** Every one of those packages *is*
declared in `package.json` at this commit — `pdfjs-dist ^6.1.200`, `@assistant-ui/react-o11y 0.0.25`,
`@assistant-ui/store 0.2.19`. They are simply not present in the `node_modules` this worktree
resolves against, which was installed before that `package.json` existed. The measuring instrument
was stale, not the subject.

    declared is not installed

which is the sibling of the lesson already recorded on this port — *resolvable through the lockfile
is not declared* (`zod@^4.3.6`). A dependency has four independent states — declared, installed,
resolvable, imported — and this port has now been bitten by a mismatch between three different
pairs of them.

**Why it was not simply fixed:** the resolving `node_modules` is shared, by junction, with sibling
agents that are running test suites against it right now. An earlier `npm install` into a shared
tree in this same effort repointed another checkout's workspace links. Installing is the correct
fix and it must happen when the tree has one writer.

## The ceiling — stated plainly, because measurement 1 is easy to over-read

`.nodeslide-studio` was **not** found and **zero** `data-ns-*` attributes were observed. Those are
the attributes `scripts/nodeslide-agent-ui-linter.mjs` gates on and the ones
`capture-gap-closure-ui-qa.mjs` fails a run over. They are unreachable without a live Convex
deployment, and supplying one means pointing this build at real data — precisely what the guard
exists to prevent.

    PROVEN      at 546d2b8: the ported tree compiles, bundles, serves, mounts, fails closed cleanly
    NOT PROVEN  that any ported convex function, query, mutation or studio surface behaves correctly
    UNKNOWN     at 911555b: pending one install into a tree with a single writer

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
cd <worktree> && npm install && npm run build
npx vite preview --strictPort --port 4319
# then, in a real browser, not curl:
#   document.getElementById('root').children.length     -> 1
#   document.querySelector('.nodeslide-studio')          -> null without a backend
```

Note the last line. `curl` on this URL returns a 1,310-byte shell with no application content, and
that shell is identical whether the app works or is catastrophically broken. A raw-HTML grep would
have called this verified while proving nothing at all.
