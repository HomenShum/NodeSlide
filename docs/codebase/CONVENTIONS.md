# Conventions

Things this repository does consistently. Follow them and your change will look
like it belongs; ignore them and a reviewer will spend their attention on style
instead of on your logic.

## Naming

- **Everything backend-facing is prefixed `nodeSlide` / `NodeSlide` / `nodeslide_`.**
  Functions `nodeSlideCreateRunBudget`, types `NodeSlidePlannedSlide`, tables
  `nodeslide_decks`. The prefix exists because these modules are also published
  as packages and mounted inside other applications, where an unprefixed
  `createRunBudget` would collide.
- **Validators say what they validate, and throw.** `validateNodeSlideBriefAttachments`,
  `validateNodeSlidePreviewAdmission`. They return the narrowed value or throw a
  public error; they never return `null` for "invalid".
- **`*Internal` means "not callable from a browser".** `createFromBriefInternal`,
  `checkpointInternal`, `recoverStaleAgentRunsInternal`. Convex enforces this;
  the suffix tells the reader before they check.
- **Tests describe the person and the situation**, not the function:
  `describe('NodeSlide abandoned agent-run recovery')`,
  `it('interrupts every open assistant stream when its worker lease expires')`.
  A test name that reads like a sentence is the cheapest documentation there is.

## Comments

The house style is a block comment that says **why**, naming the failure that
forced the code — often with the measurement. From `convex/nodeslideAgent.ts`:

```ts
// THE DURABLE JOB SEAM. `nodeslideJobRunner.executeCreateDeckInternal` has
// always sent this object; until it was declared here, Convex rejected the
// whole call with `ArgumentValidationError: Object contains extra field
// \`durableJob\``, which made every durable create job fail at 35% progress.
```

Do not replace these with a summary of what the code does. If you move the code,
move the comment. If you delete the code, quote the comment in the commit
message so the reason survives.

## TypeScript

`tsconfig.json` is strict and then some — `noUnusedLocals`,
`noUnusedParameters`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noPropertyAccessFromIndexSignature`. Consequences you will meet immediately:

- Reading `env['FOO']`, not `env.FOO`, for index signatures.
- Spreading conditionally instead of assigning `undefined`:
  ```ts
  ...(revision ? { previousSpec: revision.previousSpec } : {})
  ```
  This pattern is everywhere; it is `exactOptionalPropertyTypes` talking.
- An unused import is a compile error, not a lint warning. That is deliberate:
  it makes dead code visible at the moment it dies.

Import aliases: `@/*` → `src/*`, `@nodeslide/*` → `packages/*/src/index.ts`
(see `tsconfig.json` and the matching `resolve.alias` in `vite.config.ts` — both
must be updated together).

`import type` is used wherever the import is types-only. Six compile-time
dependency cycles exist *because* of this and are erased at build time; see
CONCERNS.md before you "fix" them.

## Formatting

Biome, configured in `biome.json`: 2-space indent, 100 columns, single quotes,
semicolons, trailing commas, imports organised. Run `npm run lint:fix`. Do not
hand-format; do not add Prettier or ESLint.

## Errors that reach a user

Two rules:

1. **Backend errors carry a machine-readable code.**
   `nodeslideCreatePublicError('quota_exceeded', 'NodeSlide creation quota
   reached. Try again after the current window.')` — the browser can branch on
   the code and still has a sentence to show.
2. **The browser sanitises before display.** `nodeSlideUserErrorMessage` in
   `src/domains/nodeslide/nodeslideUserError.ts` is the only thing that decides
   what a user sees. Internal detail does not leak through it.

Failure text is announced (`role="alert"`) and the user's typed input is
preserved. A failed action never clears the composer.

## Files

- **One deployed module per concern** in `convex/`. Pure helpers go to
  `convex/lib/` so they can be tested with no database.
- **Tests sit next to the code**, `X.test.ts` beside `X.ts`. There is no
  `__tests__` directory.
- **No barrel files that re-export internals.** `src/domains/nodeslide/session/index.ts`
  lists only what other folders import, and says so in its own header. A barrel
  that lists everything reads like a supported API and invites callers into
  private machinery.
- **`.mjs` in `scripts/`, `.ts` everywhere else.** Scripts run under plain node
  with no build step; that is why they are `.mjs`.

## The one oddity to know about

`shared/nodeslideArtifactRegistry.js` is hand-written JavaScript with a
hand-written `.d.ts` beside it, in a TypeScript repository. It is live code, not
a build artefact. Two other files in `shared/` are the same. Leave them alone
unless you are converting all three.
