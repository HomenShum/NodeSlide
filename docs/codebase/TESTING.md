# Testing

## The commands

```bash
npm test          # vitest: 314 files, 2,800 tests, 7 skipped. ~2 min on a quiet machine.
npm run typecheck # tsc -b, then every workspace's own typecheck
npm run lint      # biome over 1,073 files
npm run build     # workspaces, then the recipelang reference, then tsc -b, then vite build
npm run check     # all four, in that order
```

`npm test` is the gate. It runs the root vitest project and then each
workspace's own `test` script. Everything below is inside that one command
unless it says otherwise.

## Five kinds of test, and when to write which

**1. Pure logic — the majority.** Anything in `shared/` or `convex/lib/` is a
plain function tested with plain assertions. `shared/nodeslidePatch.test.ts` is
the model to copy: 20-odd cases, each named for the situation it protects
("rejects stale patches before mutation", "clamps drag and resize geometry
inside the slide"). No mocks, no fixtures beyond a deck literal.

**2. Backend functions, in-process.** `convex-test` runs real Convex functions
against an in-memory database, so `convex/nodeslideJobSeam.test.ts` can enqueue
a job, run the action and assert on the rows without a server. Use this for
anything that touches a table.

**3. Component tests.** `@testing-library/react` + jsdom, e.g.
`src/domains/nodeslide/components/SlideRenderer.charts.test.tsx`. Query by role
and testid, never by class name.

**4. Script and gate tests.** `scripts/tests/*.test.mjs` covers the 235 scripts
in `scripts/`. They are `.mjs` because the scripts are.

**5. Browser end-to-end.** `tests/e2e/*.spec.ts` under Playwright. **These are
excluded from `npm test`** (see `vite.config.ts` → `test.exclude`) because they
target a deployed URL and need `VERCEL_AUTOMATION_BYPASS_SECRET`. They are not
part of the local gate.

## The house rule for a test name

Name the person and the situation, not the function:

```ts
describe('NodeSlide abandoned agent-run recovery', () => {
  it('interrupts every open assistant stream when its worker lease expires', …);
```

A failure message should tell you what a user lost. `it('works')` tells you
nothing at 3am.

## Where the important protection lives

| What could break | The test that catches it |
|---|---|
| A patch commits over a deck that moved | `shared/nodeslidePatch.test.ts` → `rejects stale patches before mutation` |
| An agent edits outside its granted scope | `shared/nodeslidePatch.test.ts` → `rejects out-of-scope and wrong-mode operations` |
| The job runner sends an argument the action does not declare | `convex/nodeslideJobSeam.test.ts` |
| A deck id that does not derive from its job id | `convex/nodeslideCreateRunIdentity.test.ts` |
| A provider call that escapes the budget ledger | `convex/nodeslideBudgetEnforcement.test.ts`, `nodeslideBudgetWiring.test.ts` |
| A crashed worker leaving a stream open forever | `convex/nodeslideAgentRecovery.test.ts` |
| Deleted user data that is not actually gone | `convex/nodeslideDerivedErasure.test.ts`, `nodeslideDataRights.scenario.test.ts` |
| A workspace build script that breaks `npm run build` on Windows | `scripts/tests/workspace-build-depth.test.mjs` |

## Flakiness, honestly

Under heavy parallel load on a developer machine, roughly two files out of 314
fail — a *different* two each run, always with `Test timed out` or
`Failed to start forks worker`, and every one of them passes when run alone.
Observed during Wave 3 on: `nodeslideUploadExtraction`, `NodeBookWorkspacePanel`,
`packages/cli/src/installer`, `AiInspector.openUiWiring`.

**Before you file that as a bug, re-run the one file:**

```bash
npx vitest run <path/to/the.test.ts>
```

If it passes alone, you found host contention, not a defect. The durable fix is
a worker cap in the vitest config; it has not been made because it changes test
infrastructure for everyone and no one has measured the right number yet.

## Adding a test

Put it next to the code (`X.test.ts` beside `X.ts`). No `__tests__` directory,
no separate config. If the thing under test is pure, do not reach for
`convex-test`; if it touches a table, do not try to fake the table.
