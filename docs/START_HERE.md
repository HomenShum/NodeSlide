# START HERE — one user action, followed through the code

You have just cloned NodeSlide. Nobody who built it is available. This page
follows **one real thing a person does** — typing a description of a
presentation and pressing a button — from the browser tab all the way to the
row in the database, in the order the machine actually executes it. Not in
architecture order. Read it top to bottom once and you will be able to find
anything else.

**The person:** someone who has to present a decision and defend it — a
diligence memo, an operating review, a board update. They do not want a picture
of a slide. They want slides they can still edit, whose numbers they can point
at, and whose every AI-made change they saw before it happened.

**The one rule that explains the whole design:** nothing — not the person, not
the AI — writes to a deck directly. Every change is proposed, checked against
the version of the deck it was written for, and only then committed. If the
deck moved underneath the proposal, the proposal is marked stale instead of
overwriting someone's work.

## Run it first

```
npm install                                     # ~7 min the first time
npx convex dev --once                           # provisions a local backend, writes VITE_CONVEX_URL
npx convex env set NODESLIDE_PUBLIC_CREATION true   # <- do not skip this one
npx convex dev                                  # leave running
npm run dev:web                                 # open the printed http://localhost:5180
```

**Why the third line.** Creating a deck is gated by an admission check
([Step 3](#step-3--the-request-is-checked-before-any-money-is-spent)). `npx
convex dev` configures none of the three ways past it, so without that command
your first Create fails with
`ConvexError {"code":"preview_not_configured"}` — defect D1 in
`promotion/PROMOTION_LOG.md`. The flag is a local-deployment setting; it does
not change the code.

Verified on a fresh anonymous deployment, so this is measured rather than
suggested:

```
$ npx convex run nodeslideAgent:createDeckFromBrief "$(cat args.json)"
ConvexError: {"code":"preview_not_configured", …}        # before
$ npx convex env set NODESLIDE_PUBLIC_CREATION true
$ npx convex run nodeslideAgent:createDeckFromBrief "$(cat args.json)"
deck version 1 · 6 slides · 82 elements                  # after
```

Two more things that will otherwise cost you an hour:

- Use `localhost:5180`, not `127.0.0.1:5180`. Vite binds the IPv6 loopback only
  (defect D6).
- On the landing page choose the **`deterministic`** model. It runs the entire
  path below with no API key and no network call to any model provider.

---

## Step 1 — The page loads and connects to the backend

**File:** `src/main.tsx`
**Symbol:** module top level
**Called by:** `index.html` (`<script type="module" src="/src/main.tsx">`)
**Calls next:** `App` in `src/App.tsx`

**Why this exists**
NodeSlide keeps no application state in the browser bundle. Decks, versions,
proposals and receipts all live in Convex, a hosted database that pushes changes
to every open tab. So the very first thing that must succeed is the connection.
If it cannot be made, the app deliberately renders a plain explanation instead
of an empty screen, because a blank page is the failure mode nobody can debug.

**Core code**
```tsx
try {
  const convex = new ConvexReactClient(convexWsUrl());
  createRoot(rootEl).render(
    <StrictMode><ConvexProvider client={convex}><App /></ConvexProvider></StrictMode>,
  );
} catch (error) {
  // renders <main data-testid="deployment-configuration-error"> …
}
```

**Input** — the `VITE_CONVEX_URL` environment variable, read by `convexWsUrl()`
in `src/lib/convexEndpoints.ts`.
**Output** — a live websocket to the backend, and a React tree under it.
**Failure behavior** — a missing or malformed URL renders the guard panel marked
`data-testid="deployment-configuration-error"`. Nothing else is attempted.
**Next** — `App` chooses what to render, in Step 2.

---

## Step 2 — The person types a brief and presses Create

**File:** `src/domains/nodeslide/components/NodeSlideLanding.tsx`
**Symbol:** `start` (line 103)
**Called by:** the Create button and the Enter key handler in the same file
**Calls next:** `createDeck` in `src/domains/nodeslide/NodeSlideStudio.tsx` (line 1890),
passed in as the `onCreate` prop

There is no router. `src/App.tsx` renders `NodeSlideStudio` for every URL except
`?domain=atlas`, which lazily loads a read-only gallery that shares no state with
the editor. The landing page is the studio's own empty state, not a separate page.

**Why this exists**
This is where free-form human intent becomes a structured request. The person
typed one paragraph; the deck generator needs an audience, a purpose and success
criteria. Rather than interrogate the user with a form, `start` fills those in
with defaults and sends the paragraph as the brief. Everything downstream can
therefore assume a complete request shape.

**Core code**
```tsx
const start = () => {
  const nextPrompt = prompt.trim();
  if (!nextPrompt) return;
  onCreate({
    clientSessionId,
    title: starterTitle ?? titleFromPrompt(nextPrompt),
    brief: { prompt: nextPrompt, audience: '…', purpose: '…', successCriteria: [/* … */] },
    themeId: 'editorial-signal',
    route: 'free',
    providerMode,
    attachments,
    /* provider model + explicit consent string, unless deterministic */
  });
};
```

**Input** — the textarea `#nodeslide-landing-prompt`, the model dropdown
`[data-testid="landing-model-select"]`, and any files dropped on the page.
**Output** — one `CreateDeckAdmissionRequest` object.
**Failure behavior** — an empty prompt returns silently; the button stays enabled
so the user can keep typing.
**Next** — `NodeSlideStudio.createDeck` adds the one-click identity and calls the
server.

---

## Step 3 — The request is checked before any money is spent

**File:** `convex/nodeslideAgent.ts`
**Symbol:** `createDeckFromBrief` (declared line 1704; handler body from line
1739, admission resolved at lines 1800–1810)
**Called by:** `NodeSlideStudio.createDeck` (line 1890) via
`useAction(nodeslideApi.nodeslideAgent.createDeckFromBrief)` (line 712)
**Calls next:** the provider dispatch in Step 4

**Why this exists**
This is the trust boundary. Above it, values came from a browser and are
suspect. Below it, everything is typed and checked. The order of the checks is
deliberate and is the single most important thing to understand about this file:
**every check that can be made from arguments already in hand runs before the
first paid model call.** A refusal that arrives after the bill is a refusal that
cost money.

Three gates run here, in order:

1. **Shape.** Convex validates every argument against the declared `args`
   object before the handler body runs. An undeclared field is rejected outright.
2. **Identity.** For a durable background job, the deck id must be derivable
   from the job id (`nodeslideStableId('deck_job', jobId)`). A caller that cannot
   name the job whose deck it claims to produce is refused for free.
3. **Admission and quota.** Either `NODESLIDE_PUBLIC_CREATION=true`, or an
   existing job row, or a preview access code — see
   `validateNodeSlidePreviewAdmission` in `convex/lib/nodeslideValidators.ts:255`.
   Then a per-session and global rate limit.

Content validation lives next door in `convex/lib/nodeslideValidators.ts`:
`validateNodeSlideCreateDeckFields` (line 73) bounds the title and brief,
`validateNodeSlideBriefAttachments` (line 203) bounds uploaded evidence.

**Core code**
```ts
const admissionQuotaSubject =
  durableAdmission?.admissionQuotaSubject ??
  (publicCreationEnabled
    ? 'public-launch-v1'
    : await validateNodeSlidePreviewAdmission({
        providedAccessCode: args.accessCode,
        expectedAccessCode: process.env[NODESLIDE_PREVIEW_ACCESS_CODE_ENV],
        admissionSubject: process.env[NODESLIDE_PREVIEW_ADMISSION_SUBJECT_ENV],
      }));
```

**Input** — the request object from Step 2.
**Output** — a validated title, brief, theme, attachment list and provider choice.
**Failure behavior** — every refusal throws `nodeslideCreatePublicError(code,
message)`, which reaches the browser as a `ConvexError` with a machine-readable
`code`. No database row and no provider call has happened yet.
**Known defect** — on a fresh clone none of the three admission paths is
configured, so this step refuses with `preview_not_configured`. That is defect D1
in `promotion/PROMOTION_LOG.md`; it is a product-loop item, not a Wave 3 one.
**Next** — the bounded model call.

---

## Step 4 — The model plans the deck, inside a budget

**File:** `convex/nodeslideAgent.ts`
**Symbol:** `createNodeSlideBudgetedCreateDispatch` (built at line 2013),
invoked at line 2055
**Called by:** the `createDeckFromBrief` handler
**Calls next:** `runNodeSlideCreationCritique`, then the persistence mutation in
Step 6

**Why this exists**
A model that can spend money needs a ceiling that is enforced by code rather
than by prompt. The dispatch wrapper reserves budget against a ledger row keyed
by the run id, calls the provider with a hard timeout, and reconciles the spend
afterwards. The model is asked for JSON that matches an explicit schema
(`briefJsonSchema`, line 1882) — slide count, allowed element kinds and
required provenance fields are enforced by the schema, not hoped for in prose.

A deterministic generator (`deterministicBriefSpec`) produces the same shape
with no network call. That is why `deterministic` in the model dropdown
exercises this whole path offline.

**Core code**
```ts
const provider = await invokeNodeSlideBriefProvider(providerChoice, async () => callBriefProvider());
if (nodeSlideCreateSpendUnreconciled(provider)) {
  throw nodeslideCreatePublicError('invalid_request',
    'The live provider call ended without a reconcilable billing receipt. …');
}
const providerSpec = provider?.ok === true ? provider.value : fallbackSpec;
```

**Input** — the validated brief plus a server-computed `StorySpec` and material
inventory (`buildNodeSlideStoryContext`).
**Output** — a raw deck specification, then at most one self-critique revision
pass (`runNodeSlideCreationCritique`) that keeps pass one if the revision does
not improve it.
**Failure behavior** — a provider failure falls back to the deterministic spec.
An *ambiguous* provider result (paid but unreconciled) fails closed instead:
no deck is created under an unresolved charge.
**Next** — persistence.

---

## Step 5 — Tools, for callers that are not the browser

**File:** `mcp/src/lib/nodeslideTools.ts`
**Symbol:** `registerNodeSlideTools` (line 414)
**Called by:** `mcp/src/index.ts` when the MCP server starts
**Calls next:** the same Convex functions the browser calls

**Why this exists**
A coding agent (Claude Code, Codex, an editor plugin) is a first-class NodeSlide
user. Rather than a second backend for agents, the MCP server is a thin adapter:
each tool validates its arguments with Zod and then calls the *same* Convex
function the UI calls. There is one write path, so an agent cannot bypass the
version check in Step 6.

Read tools (`nodeslide.get_deck`, line 430) are marked `readOnlyHint: true`;
the write tool (`nodeslide.propose_edit`, line 540) proposes and never commits.

**Core code**
```ts
registerTool(server, 'nodeslide.get_deck', {
  title: 'Read a NodeSlide deck',
  description: 'Owner-gated read … it never returns the owner key.',
  inputSchema: ownerArgs,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async (args) => textResult(readReceipt('nodeslide.get_deck', await convexCall(/* … */))));
```

**Input** — MCP tool calls over stdio, each carrying a deck id and an owner key.
**Output** — bounded JSON plus a receipt naming the tool that produced it.
**Failure behavior** — a Zod failure is returned to the calling agent as a tool
error; the Convex function is never reached.
**Next** — writes land in the same place as browser writes.

---

## Step 6 — The deck is written, or the write is refused

**File:** `convex/nodeslide.ts` (persistence) and `convex/lib/nodeslidePatches.ts` (the check)
**Symbols:** `createFromBriefInternal` (line 3670), `applyPatch` (line 1175),
`acceptPatch` (line 1224), `commitPatch` (line 5304),
`evaluateNodeSlideCas` (`convex/lib/nodeslidePatches.ts:659`)
**Called by:** Step 4 for creation; the editor and the agent for every later edit
**Calls next:** nothing — this is the bottom of the stack

**Why this exists**
This is the promise in the README made mechanical. Every slide, element and the
deck itself carries a version number. A proposal records the versions it was
written against. Before committing, `evaluateNodeSlideCas` compares those
recorded versions with the versions in the database *right now*. Same numbers:
commit. Different numbers: the patch is stored with status `stale` and a
human-readable list of what moved. This is compare-and-set, the same idea as an
optimistic lock — it is why two people (or a person and an agent) editing at once
cannot silently clobber each other.

**Core code**
```ts
for (const slideId of touched.slideIds) {
  const slide = snapshot.slides.find((c) => c.id === slideId);
  const expected = patch.baseSlideVersions[slideId];
  if (!slide) reasons.push(`Touched slide ${slideId} no longer exists.`);
  else if (expected === undefined) reasons.push(`No base slide clock was supplied for ${slideId}.`);
  else if (expected !== slide.version) reasons.push(`Slide ${slideId} changed from v${expected} to v${slide.version}.`);
}
return { canCommit: reasons.length === 0, /* … */ reasons };
```

**Input** — a `DeckSnapshot` read inside the transaction, and the proposed patch.
**Output** — `canCommit` plus the exact reasons if not.
**Failure behavior** — a refused patch is *persisted* as `stale` with its
reasons, not discarded. The author sees why, and the receipt survives.
**Next** — the commit bumps versions, which the browser is already watching.

---

## Step 7 — Progress and results reach the screen

**File:** `src/domains/nodeslide/NodeSlideStudio.tsx` (subscriptions),
`src/domains/nodeslide/components/SlideRenderer.tsx` (drawing)
**Symbols:** `useQuery(...)` at lines 688–780; `SlideRenderer` (line 28);
`convex/nodeslideJobs.ts` → `checkpointInternal` (line 794), `getStream` (line 680)
**Called by:** React render
**Calls next:** nothing — this is the user-visible end

**Why this exists**
There is no polling loop and no hand-written websocket code in this repo.
`useQuery` subscribes to a Convex query; when a mutation changes a row the query
touched, Convex pushes the new result and React re-renders. Long creations run as
durable jobs that write progress with `checkpointInternal`, so a reload
mid-generation reattaches to the same job instead of starting over.

`SlideRenderer` draws from the canonical `DeckSnapshot`. Charts, formulas and
diagrams are real DOM and SVG elements, which is what makes them clickable and
editable rather than a picture.

**Core code**
```tsx
const queriedWorkspace = useQuery(/* nodeslide.getWorkspace, { deckId, ownerAccessKey } */);
```

**Input** — a deck id and owner key held in the studio's state.
**Output** — re-rendered slides whenever any version clock advances.
**Failure behavior** — while a query is loading it is `undefined`, and the studio
renders its loading shell. A backend error surfaces through the toast in Step 8.
**Next** — what happens when any of this goes wrong.

---

## Step 8 — Failure and recovery

**Files:** `src/domains/nodeslide/nodeslideUserError.ts`,
`convex/nodeslide.ts` (`recoverStaleAgentRunsInternal`, line 3348),
`convex/crons.ts`, `convex/nodeslideJobs.ts` (`cancel` line 712, `retry` line 738)
**Called by:** the studio's `catch` blocks; a Convex cron every 2 minutes
**Calls next:** nothing

**Why this exists**
Three different things can fail, and each has its own recovery:

1. **The request is refused.** `createDeck` catches, calls the studio's local
   `errorMessage` helper (`NodeSlideStudio.tsx:4527`), which delegates to
   `nodeSlideUserErrorMessage` in `src/domains/nodeslide/nodeslideUserError.ts`,
   and shows a toast plus an inline `role="alert"`. The typed input is preserved
   so nothing is retyped.
2. **The worker dies mid-run.** A run holds a lease. A cron job every two
   minutes finds runs whose `leaseExpiresAt` has passed and fails them honestly,
   so a crashed action never spins forever in the UI.
3. **The user changes their mind, or the job is wedged.** `cancel` and `retry`
   on `convex/nodeslideJobs.ts` operate on the durable job row.

**Core code**
```ts
/** Fails abandoned active runs honestly so a crashed action never spins forever in the UI. */
export const recoverStaleAgentRunsInternal = internalMutation({ /* … */ });
```
registered in `convex/crons.ts`:
```ts
crons.interval('recover stale NodeSlide agent runs', { minutes: 2 },
  internal.nodeslide.recoverStaleAgentRunsInternal, {});
```

**Input** — the clock, and rows in `nodeslide_agent_runs`.
**Output** — runs moved out of active states with a stated reason.
**Failure behavior** — the recovery itself is a plain mutation; if it fails the
next tick retries it two minutes later.
**Next** — the tests that hold all of this in place.

---

## Step 9 — The tests that prove this flow

Run everything with `npm test` (313 files, 2799 tests, ~2 min).

| The step above | The test that proves it | What it would catch |
|---|---|---|
| 3 — arguments and admission | `convex/nodeslideJobSeam.test.ts` | the runner sending an argument the action does not declare — this exact bug once made every durable create fail at 35% |
| 3 — identity binding | `convex/nodeslideCreateRunIdentity.test.ts` | a deck id that does not derive from its job id |
| 4 — budget ceiling | `convex/nodeslideBudgetEnforcement.test.ts`, `convex/nodeslideBudgetWiring.test.ts` | a provider call that escapes the ledger |
| 6 — the version check | `shared/nodeslidePatch.test.ts` → `rejects stale patches before mutation` | a patch committing over a deck that moved |
| 6 — scope and shape | `shared/nodeslidePatch.test.ts` → `rejects out-of-scope and wrong-mode operations` | an agent editing outside the scope it was granted |
| 7 — durable progress | `convex/nodeslideJobRuntime.test.ts`, `convex/nodeslideJobWorkflow.test.ts` | progress that goes backwards, or a reload losing its job |
| 8 — lease recovery | `convex/nodeslideAgentRecovery.test.ts` | a crashed worker leaving a stream open forever |
| build | `scripts/tests/workspace-build-depth.test.mjs` | a workspace build script that nests another `npm run` and breaks `npm run build` on Windows |

---

## Where you would add one adjacent capability

Say you want a new slide element kind — a table.

1. Add the type to the canonical snapshot in `shared/nodeslide.ts`, alongside
   the existing element kinds. Everything else keys off that union.
2. Add its patch operations and their validation to `shared/nodeslidePatch.ts`,
   and a case to `touchedNodeSlideIds` in `convex/lib/nodeslidePatches.ts` so the
   version check in Step 6 knows which ids the operation touches. **This is the
   step that is easy to forget and the one that breaks safety if you do.**
3. Teach the generator: extend `briefJsonSchema` in `convex/nodeslideAgent.ts`
   so the model may emit it, and the materializer in `convex/lib/nodeslideSeed.ts`
   so a plan becomes typed elements.
4. Draw it in `src/domains/nodeslide/components/SlideRenderer.tsx`.
5. Export it: `src/domains/nodeslide/slidelang/pptx.ts` for PowerPoint,
   and the HTML projection beside it.
6. Add a case to `shared/nodeslidePatch.test.ts` in the shape of the existing
   `updates a typed chart while preserving editable structure`.

## Where to read next

- `docs/codebase/ARCHITECTURE.md` — the same system in dependency order rather than runtime order
- `docs/codebase/CONCERNS.md` — what is known to be wrong, with reproductions
- `docs/SIMPLIFICATION_REPORT.md` — what Wave 3 removed and what it measured
- `.tours/` — the same three walks as clickable CodeTours (VS Code extension `vsls-contrib.codetour`)
