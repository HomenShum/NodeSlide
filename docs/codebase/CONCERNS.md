# Concerns — what is known to be wrong or awkward

Every entry has a reproduction or a measurement. A hunch is not a concern. This
is the page to read before you conclude you have found something new.

Open product defects with full reproductions live in
`promotion/PROMOTION_LOG.md`. This page covers the *codebase* concerns and the
one product defect Wave 3 fixed.

---

## 1. A stranger cannot create a deck on a fresh clone (blocking, D1)

**Reproduce:** clone, `npm install`, `npx convex dev`, `npm run dev:web`, open
`localhost:5180`, type a brief, choose `deterministic`, press Create. You get
`ConvexError {"kind":"nodeslide_create","code":"preview_not_configured"}`.

**Why:** `createDeckFromBrief` admits a create only if
`NODESLIDE_PUBLIC_CREATION=true`, or a durable job row exists, or both
`NODESLIDE_PREVIEW_ACCESS_CODE` and `NODESLIDE_PREVIEW_ADMISSION_SUBJECT` are
set in the Convex environment (`convex/lib/nodeslideValidators.ts:256` (`validateNodeSlidePreviewAdmission`)).
`npx convex dev` sets none of the three, and there is no `.env.example` — though
the README links one.

**Workaround, measured on a fresh anonymous deployment:**

```bash
npx convex env set NODESLIDE_PUBLIC_CREATION true
```

Before it, `npx convex run nodeslideAgent:createDeckFromBrief …` throws
`{"code":"preview_not_configured"}`. After it, the same call returns a deck at
version 1 with 6 slides and 82 elements — deterministic mode, no API key, no
network call to a provider. This is now the third line of the setup block in
`docs/START_HERE.md`.

**Status:** open as a product defect. The workaround is documented and verified,
but a stranger who follows only the README still hits the wall, and the error
text names an internal concept with no next action (defect D3). Wave 3 did not
change the admission code: whether a local deployment should default to open
creation is a product and security decision, not a refactor, and Wave 3's rules
forbid mixing feature work with structural work.

---

## 2. Six compile-time dependency cycles — real, and harmless at runtime

**Measured:** `dependency-cruiser` reports 6 `no-circular` violations:

```
shared/nodeslide.ts ↔ shared/nodeslideArtifactSpec.ts
convex/lib/nodeslideSeed.ts ↔ nodeslideDesignPlan.ts
convex/lib/nodeslideSeed.ts ↔ nodeslideCompositionGrammars.ts
convex/lib/nodeslideSeed.ts ↔ nodeslideAuthoredArtifact.ts
convex/lib/nodeslideCompositionFanout.ts → nodeslideDesignPlan.ts → nodeslideSeed.ts → back
convex/lib/nodeslideArtifactPresence.ts ↔ nodeslideDeckCi.ts
```

**Every back-edge is `import type`, and TypeScript erases it.** Proved by
compiling each file and grepping the emitted JavaScript for its cycle partner:

```bash
npx esbuild convex/lib/nodeslideDesignPlan.ts --format=esm --platform=node | grep -c nodeslideSeed
# 0 — the import is gone after compilation
```

All six return 0. There is no runtime cycle, and `dependency-cruiser` does not
distinguish the two even with `tsPreCompilationDeps: false` (both settings
report 6).

**Left as-is.** Breaking the compile-time cycles means lifting shared types out
of the 3,753-line `convex/lib/nodeslideSeed.ts` into a new module — adding a
file a reader must open, to satisfy a tool that is not measuring a hazard. If
`nodeslideSeed.ts` is ever split for its own sake, the cycles go away for free.

---

## 3. Four files hold most of the system

| File | Lines |
|---|---:|
| `convex/nodeslide.ts` | 6,124 |
| `src/domains/nodeslide/NodeSlideStudio.tsx` | 4,528 |
| `convex/lib/nodeslideSeed.ts` | 3,753 |
| `convex/nodeslideAgent.ts` | 2,295 |

This is a real navigation cost. It was **not** addressed in Wave 3, on purpose:
splitting a 6,000-line Convex module changes the deployed function names, which
is a behaviour change for every published `@nodeslide/*` package consumer, and
Wave 3's first rule is to preserve externally observable behaviour.

The mitigation available today is `docs/START_HERE.md` and `.tours/`, which give
line numbers instead of asking anyone to read the files end to end.

If you do split them, the seam that is actually safe is `convex/lib/` — pure
helpers can move freely because nothing outside the repo names them.

---

## 4. Knip reports 53 unused files. Most are false positives — here is why

Do not delete from this list without checking the category:

- **`packages/registry/sources/*` (7 files) — loaded by path at runtime.**
  `packages/registry/src/index.ts` lists them in `NODESLIDE_REGISTRY_ENTRIES`
  (`source: 'studio/NodeSlideExample.tsx'`) and reads them with `readFile`.
  Static analysis cannot see a string-keyed load.
- **`packages/convex/src/componentSchema.ts`, `src/react.tsx` — tsup entry
  points**, named on the `build` command line and in `exports`.
- **`playwright.config.ts`, `packages/vitest.config.ts`,
  `promotion/capture-baseline.mjs`** — configs and entry scripts.
- **The remainder are one-off proof and capture scripts under `scripts/`.**
  They are each wired to an npm script, and `docs/` and `evidence/` cite the
  receipts they produced. Deleting them orphans documented evidence.

Genuinely dead files were deleted in Wave 3 — see `docs/SIMPLIFICATION_REPORT.md`.

Knip's remaining three "unused dependencies" are also false positives, and all
three are accounted for:

- `@nodebook/core` (root) — a transitive dependency of `@nodebook/react`. The
  root `file:vendor/…` declaration is the only way it resolves. Removing it
  breaks `npm install`.
- `@nodeslide/react`, `@nodeslide/react-headless` (`packages/convex`) — imported
  by `packages/convex/src/react.tsx`, which Knip believes is unused because it
  is a `tsup` entry point rather than an import target.

Its one "unlisted binary", `ffmpeg` in `scripts/nodeslide-journey-gif.mjs`, is
correct and intentional: ffmpeg is a system tool, not an npm package, and only
the demo-GIF script needs it.

---

## 5. 227 unused exports and 188 unused exported types remain

Concentrated in `packages/*/src/index.ts` (deliberately published surfaces) and
in `shared/*`. Trimming these is the highest-value remaining reduction, but
doing it safely needs the import lists of the package consumers, which live
outside this repository. Left for a wave that has them.

---

## 6. Test flakiness under load is host contention, not a defect

The Wave 1 baseline recorded `npm test` failing (defect D5). Re-measured at the
same commit on a quiet machine: **313 files, 2,821 tests, exit 0** (and 314 / 2,800 after this wave's changes). Under heavy
parallel load, two files fail per run — a different two each time, always
`Test timed out` or `Failed to start forks worker`, and each passes in isolation.

The durable fix is a vitest worker cap. Not applied: nobody has measured the
right number, and guessing one degrades every developer's run time. See
`docs/codebase/TESTING.md`.

---

## 7. Windows: nested `npm run` inside a workspace build breaks the build

**Fixed in Wave 3, recorded so it does not come back.** Each `npm run` prepends
about 1,437 characters of `node_modules/.bin` paths to PATH. The root build is
level 1, `packages:build` level 2, a workspace build level 3 — measured at 7,409
characters. A fourth level crosses the ~8,191-character ceiling `cmd.exe` will
expand, and cmd.exe then hands the child an **empty** PATH, so nothing resolves
(a probe confirmed even `node` stops being found).

`scripts/tests/workspace-build-depth.test.mjs` fails if any workspace `build`
script contains `npm run`. Full measurement table in
`docs/SIMPLIFICATION_REPORT.md`.

---

## 8. Small things worth knowing

- **`npx dependency-cruiser` on Windows silently reports zero modules when given
  directory arguments.** Pass globs (`"src/**/*.{ts,tsx}"`). A clean result from
  a directory argument is a false clean.
- **Vite binds the IPv6 loopback only.** `curl localhost:5180` works;
  `curl 127.0.0.1:5180` is refused. Defect D6.
- **`@nodebook/core` is declared at the root but imported by nothing.** It is a
  transitive dependency of `@nodebook/react`, and the root `file:vendor/…`
  declaration is the only way it resolves. Knip flags it; do not remove it.
- **Three files in `shared/` are hand-written `.js` with hand-written `.d.ts`**
  (`nodeslideArtifactRegistry`, `nodeslideArtifactGeometry`,
  `nodeslideSemanticIssues`). Live code, not build output.
- **The CSP in `vercel.json` is an allowlist.** A new outbound host in code needs
  a matching `connect-src` entry, or it fails only in a deployed browser — no
  test catches it.
