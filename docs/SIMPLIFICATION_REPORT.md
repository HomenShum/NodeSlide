# Simplification report — Wave 3 (human readiness)

Gate: <https://raw.githubusercontent.com/HomenShum/NodeKit/main/templates/promotion/HUMAN_READY.md>

Baseline commit `acbaa99`. Every number below was produced by running the
command in its row against this tree, before and after. Where a tool does not
fit this stack, the row says so instead of being left blank.

Host for all runs: Windows 11, Node 22.22.2, npm workspaces, fresh
`npm install`. The machine was running other heavy jobs during part of this
session; where that changed a result it is called out, because a timeout is not
the same finding as an assertion failure.

## Measurements

| Measure | Before | After | Change | Evidence command |
|---|---:|---:|---:|---|
| Production files | 385 | 375 | −10 | `git ls-files 'src/**' 'convex/**' 'packages/**' 'shared/**' 'mcp/**' 'api/**' 'contracts/**' \| grep -E '\.(ts\|tsx\|js\|mjs\|css)$' \| grep -v _generated \| grep -v /dist/ \| grep -vE '\.(test\|spec)\.' \| wc -l` |
| Production source lines | 173,964 | 172,197 | −1,767 | same file list piped to `xargs wc -l` |
| Direct dependency declarations (all 19 `package.json` files) | 104 | 97 | −7 | `node -e` sum of `dependencies` + `devDependencies` + `optionalDependencies` over `git ls-files '*package.json'` |
| Root runtime dependencies | 30 | 29 | −1 | `node -e "console.log(Object.keys(require('./package.json').dependencies).length)"` |
| Unused files | 59 | 53 | −6 | `npx knip` |
| Unused exports | 285 | 227 | −58 | `npx knip` |
| Unused exported types | 233 | 188 | −45 | `npx knip` |
| Unused dependencies (7 prod + 2 dev) | 9 | 3 | −6 | `npx knip` |
| Duplicate blocks | 305 | 308 | +3 | `npx jscpd@4 src convex shared packages mcp api --ignore "**/dist/**,**/_generated/**,**/node_modules/**" --format "typescript,tsx,javascript,jsx"` |
| Duplicate percentage | 2.50% | 2.53% | +0.03 pt | same jscpd command |
| Circular dependencies | 6 | 6 | 0 | `npx dependency-cruiser@16 --config <cfg> "src/**/*.{ts,tsx}" "convex/**/*.ts" "shared/**/*.{ts,js}" "mcp/src/**/*.ts" "api/**/*.ts" "packages/*/src/**/*.{ts,tsx}"` with a one-rule `no-circular` config |
| Modules in the dependency graph | 404 | 391 | −13 | same dependency-cruiser command |
| Canonical workflow tests | 313 files, 2,821 passed, 7 skipped, **exit 0** | 314 files, 2,800 passed, 7 skipped, **exit 0** | −24 tests belonging to the deleted dead module, +3 new (build depth ×2, tour drift ×1) | `npm test` |
| Build | **exit 1** — `'tsup' is not recognized`, twice out of two | **exit 0** | fixed | `npm run build` |
| Lint | exit 0 | exit 0 | unchanged | `npm run lint` (biome, 1,073 files) |
| Typecheck | exit 0 | exit 0 | unchanged | `npm run typecheck` |
| Production bundle — entry chunk | not measurable (build failed) | 445.05 kB (136.20 kB gzip) | — | `npm run build`, vite report |
| Production bundle — vendor chunk | not measurable (build failed) | 5,052.25 kB (1,471.42 kB gzip) | — | `npm run build`, vite report |
| Browser workflow passes | not applicable — the Playwright specs in `tests/e2e/` target a deployed URL and need `VERCEL_AUTOMATION_BYPASS_SECRET`; no deployment was made in this wave | | | `npx playwright test` (not run) |
| Additions/deletions — whole branch | — | — | 33 files, +1,854 / −2,142 | `git diff --shortstat acbaa99 HEAD` |
| Additions/deletions — code only | — | — | 16 files, **+19 / −2,140** | `git diff --shortstat acbaa99 HEAD -- src convex shared packages mcp api` |
| Additions/deletions — docs, tours, scripts | — | — | 16 files, +1,833 / −0 | `git diff --shortstat acbaa99 HEAD -- docs .tours README.md scripts` |

### Two numbers that need their honest caveat

**The bundle did not shrink — deliberately.** The entry and vendor chunks are
byte-for-byte identical before and after the deletions (445.05 kB / 5,052.25 kB).
Everything deleted was already tree-shaken out of the shipped bundle. That is
the point of this wave and worth saying plainly: **the deletions removed code a
reader has to navigate, not bytes a user has to download.** Judging this work by
bundle size would score it as zero.

**Duplication went up by three blocks.** jscpd's denominator shrank (154,325 →
154,053 analysed lines) because the deleted code was not duplicated. Duplication
was not a target this wave, and none of the 308 findings is material — the
largest is 33 lines inside a single dialog component. Left as documented.

## What was deleted

| Path | Lines | Why it was safe |
|---|---:|---|
| `shared/nodeslideDelegation.ts` | 679 | An entire delegation-grant policy module — grant tokens, policy digests, TTLs, use counters — with **zero importers anywhere in the repo**. The delegation concept that actually ships is `AgentSessionDelegationGrant` in `src/domains/nodeslide/session/types.ts`, defined independently. This was a second implementation nothing constructed. |
| `shared/nodeslideDelegation.test.ts` | 347 | Tested only the module above. Deleted with it. **No assertion covering shipped behaviour was removed** — grep for `nodeslideDelegation` outside those two files returns nothing. |
| `src/components/ui/command.tsx` | 161 | A shadcn command-palette component with no consumers. The command palette the product actually uses is `src/domains/nodeslide/components/CommandPalette.tsx`, imported at `NodeSlideStudio.tsx:54` and wired to the toolbar. |
| `src/components/ui/dialog.tsx` | 142 | Its only importer was `ui/command.tsx`. Dialogs in the product use `useModalDialog` in `src/domains/nodeslide/components/useModalDialog.ts`. |
| `src/components/ui/hover-card.tsx` | 36 | No consumers after the prompt-input trim below. |
| 46 declarations in `src/components/ai-elements/prompt-input.tsx` | 313 | This vendored component kit exported 81 symbols. Exactly **11** were imported, all by one file (`inspector/AiInspector.tsx`). The `PromptInputCommand*`, `PromptInputTab*`, `PromptInputHoverCard*`, `PromptInputActionMenu*`, `PromptInputBody` and `PromptInputHeader` families were never referenced — not even inside the file itself. Removing them also removed the last uses of three UI wrappers and one npm dependency. |
| `shared/nodeslideArtifactAtlas.ts` | 82 | Zero references. |
| `shared/nodeslideLongformBench.ts` | 201 | Zero references. |
| `shared/nodeslideSourceMonitoring.ts` | 46 | Zero references. |
| `src/domains/nodeslide/nodeslidePackageConvex.ts` | 63 | Zero references. |
| `src/domains/nodeslide/integrations/index.ts` | 2 | A re-export barrel with **no importers**. Its consumers already import the real files directly. |
| `src/domains/nodeslide/integrations/googleSlides/index.ts` | 28 | Same: a 30-symbol barrel nothing imported. |
| 29 re-exports in `src/domains/nodeslide/session/index.ts` | 41 → 26 | The barrel published 19 functions and 16 types; **3 functions and 3 types** are used outside the folder. The rest are session bookkeeping. Trimming it is not cosmetic: a barrel that lists internals reads like a supported API, and the next person calls `writeAgentSessionState` from a component. |
| 7 dependency declarations | — | `cmdk` (root; only importer was the deleted `ui/command.tsx`); `convex`, `katex`, `pptxgenjs`, `@types/katex` (`mcp/`, none imported by `mcp/src`); `pptxgenjs` (`packages/cli`, not imported); `@types/katex` (root — `katex@0.18` ships `types/katex.d.ts` itself). |

## Custom code replaced by a capability that already existed

1. **Delegation grants** — 679 lines of bespoke grant/policy machinery deleted in
   favour of the grant type the session already ships
   (`src/domains/nodeslide/session/types.ts`). Rung (b) of the reuse ladder: the
   repository already contained it.
2. **Command palette** — a vendored `cmdk`-based palette plus its dialog
   dependency deleted in favour of the product's own `CommandPalette`. That
   removed one npm dependency, not just one file.
3. **Nested build scripts** — `packages/convex` ran `npm run build:client && npm
   run build:component`. Replaced by the two commands themselves joined with
   `&&`, which npm already runs through a shell. Two script names removed, and it
   fixed a build failure (below).

## The one behaviour change: defect D4 is fixed, with its root cause

`npm run build` failed deterministically at the eleventh workspace with
`'tsup' is not recognized as an internal or external command`, although
`node_modules/.bin/tsup` existed and `npm run build --workspace @nodeslide/convex`
alone exited 0. The Wave 1 baseline guessed "Windows PATH growth"; it was not
measured. It is now.

**Measured.** A probe printed `process.env.PATH.length` at each nesting level:

| Where | PATH length | Result |
|---|---:|---|
| shell | 3,800 | — |
| workspace build, run standalone (level 3) | 5,237 | ok |
| its nested `build:client` (level 4) | 6,674 | ok — `tsup` resolves |
| workspace build inside `npm run build` (level 3) | 7,409 | ok |
| its nested `build:client` (level 4) | ≈8,850 | **`node` itself is not recognized** |

Every `npm run` prepends roughly 1,437 characters of `node_modules/.bin`
directories to PATH. `@nodeslide/convex` was the **only** workspace whose build
started another `npm run`, so it was the only one to reach a fourth level — and
a fourth level crosses the ~8,191-character ceiling `cmd.exe` will expand. Past
that ceiling cmd.exe hands the child an empty PATH, so nothing resolves. The
error named `tsup` only because `tsup` happened to be the first word.

**Fix.** `packages/convex/package.json` now runs `tsup … && tsc -p
tsconfig.component.json` directly — one fewer nesting level, two fewer script
names, and the same two outputs.

**Locked.** `scripts/tests/workspace-build-depth.test.mjs` asserts that no
workspace `build` script contains `npm run`, and that the convex build still runs
both halves. Knockout-verified: it fails (2/2) against the pre-fix
`package.json` and passes against the fixed one.

## Findings left unresolved, with the reason

| Finding | Why it was left |
|---|---|
| **6 circular dependencies remain (unchanged).** | All six are **type-only and erased at compile time**. Measured, not argued: `npx esbuild <file> --format=esm \| grep -c <cycle-partner>` returns **0** for all six back-edges (`shared/nodeslideArtifactSpec.ts`, `convex/lib/nodeslideDesignPlan.ts`, `nodeslideCompositionGrammars.ts`, `nodeslideCompositionFanout.ts`, `nodeslideAuthoredArtifact.ts`, `nodeslideArtifactPresence.ts`). There is no runtime cycle. Breaking the remaining compile-time cycles means moving types out of the 3,753-line `convex/lib/nodeslideSeed.ts` into a new module — adding a file a reader must open, to satisfy a tool that is not measuring a real hazard. Documented in `docs/codebase/CONCERNS.md` instead. |
| **53 files still reported unused by Knip.** | Audited, not accepted. The largest group is `packages/registry/sources/*` (7 files), which are **read at runtime by path**: `packages/registry/src/index.ts` lists them in `NODESLIDE_REGISTRY_ENTRIES` and loads them with `readFile`. Knip cannot see a string-keyed load. Likewise `packages/convex/src/componentSchema.ts` and `src/react.tsx` are `tsup` entry points, and `playwright.config.ts` / `packages/vitest.config.ts` are configs. The rest are one-off proof and capture scripts under `scripts/`, kept because `docs/` and `promotion/` cite their receipts. See CONCERNS.md. |
| **3 unused dependencies still reported.** | All three are false positives and all three are explained: `@nodebook/core` is the `file:vendor/…` resolution anchor for a transitive dependency of `@nodebook/react` (removing it breaks `npm install`); `@nodeslide/react` and `@nodeslide/react-headless` are imported by `packages/convex/src/react.tsx`, which Knip cannot see because it is a `tsup` entry point rather than an import target. |
| **227 unused exports / 188 unused exported types remain.** | Concentrated in modules that are deliberately published surfaces (`packages/*/src/index.ts`, `shared/*`) or in per-script helper libraries. Trimming these is the next wave's highest-value reduction; doing it safely needs the package consumers' import lists, which are outside this repo. |
| **Defects D1, D2, D3, D6 in `promotion/PROMOTION_LOG.md`.** | Product-loop defects (first-run admission, focus rings, error copy, IPv6-only bind), not structural ones. Wave 3's rule 3 forbids mixing feature work with structural refactoring. D4 was fixed here because it is a *build* defect and the gate requires the build to pass. **D1's workaround is now documented and measured** — `npx convex env set NODESLIDE_PUBLIC_CREATION true` turns `{"code":"preview_not_configured"}` into a real deck (version 1, 6 slides, 82 elements, deterministic, no key). Whether a local deployment should default to open creation is a product and security decision, so no code changed. |
| **D5 "tests fail" is re-scoped, not fixed.** | Re-measured. On a quiet host the baseline suite is **green** (313 files, 2,821 tests, exit 0) at the same commit that failed twice during the Wave 1 baseline. Under heavy parallel load, 2 files fail — a *different* two each run, always with `Test timed out` or `Failed to start forks worker`, and every one of them passes when run alone. This is host contention, not a code defect. The useful fix is a vitest concurrency cap, which is a change to test infrastructure and is recorded rather than made. |
| **Duplication (308 blocks, 2.53%).** | Not targeted. Largest single finding is 33 lines inside `NodeSlideConnectionsDialog.tsx`. Below the threshold where extraction pays for the indirection. |

## Reproducing this report

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run build
npx knip
npx jscpd@4 src convex shared packages mcp api \
  --ignore "**/dist/**,**/_generated/**,**/node_modules/**" \
  --format "typescript,tsx,javascript,jsx"
```

The dependency-cruiser row needs a config; the whole thing is one rule:

```js
module.exports = {
  forbidden: [{ name: 'no-circular', severity: 'error', from: {}, to: { circular: true } }],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|_generated|/dist/|\\.test\\.|\\.spec\\.)' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
```

It is not committed on purpose: a config file whose only reader is a report is a
knob the repo would have to maintain forever. Paste it into
`.dependency-cruiser.cjs`, run the command in the table, delete it.

On Windows, pass **globs** rather than directory names to dependency-cruiser —
directory arguments resolve to zero modules there and will quietly report a
clean graph.
