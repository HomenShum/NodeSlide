# Architecture — the invariants, and what enforces each one

`docs/START_HERE.md` walks the code in the order it runs. This page states the
rules that walk obeys, and names the file that would have to be edited to break
each one. If you only remember one thing, remember rule 1.

## 1. The deck is data. Everything you can see is derived from it.

A presentation is a `DeckSnapshot` — a typed record with a deck, slides,
elements, sources and version numbers. Defined once in **`shared/nodeslide.ts`**
and used by both the browser and the backend.

The slides on screen, the exported PowerPoint, the published HTML and the
semantic projection are all *renderings* of that record. None of them is the
source. This is why a chart stays a chart after export, and why an edit does not
require regenerating the deck.

**Enforced by:** the type. `src/domains/nodeslide/components/SlideRenderer.tsx`
and `src/domains/nodeslide/slidelang/pptx.ts` both consume `DeckSnapshot` and
neither can write to it.

## 2. Nothing writes to a deck directly. Every change is a proposal.

A change — from a person dragging a box or from a model answering a prompt — is
a list of `PatchOperation`s plus the version numbers of everything it touched.

**Enforced by:** `evaluateNodeSlideCas` in `convex/lib/nodeslidePatches.ts:659` (`evaluateNodeSlideCas`).
It compares the versions the patch was written against with the versions in the
database inside the same transaction. Equal: commit and bump. Not equal: the
patch is stored with status `stale` and a human-readable list of what moved.

This is compare-and-set. It is the reason two editors, or a person and an agent,
cannot silently overwrite each other, and it is the one thing to be most careful
around when you add an operation type. A new operation that does not report the
ids it touches (`touchedNodeSlideIds`, same file) will pass the check without
being checked.

## 3. There is exactly one write path, and the agents use it too.

The browser calls `applyPatch` / `proposePatch` / `acceptPatch` in
`convex/nodeslide.ts`. A coding agent calls MCP tools in
`mcp/src/lib/nodeslideTools.ts`, which call the *same* Convex functions. The
published `@nodeslide/*` packages call the same functions over HTTP.

**Enforced by:** the absence of an alternative. There is no direct table write
outside `convex/`, and `commitPatch` (`convex/nodeslide.ts:5304` (`commitPatch`)) is the only
function that advances a version.

## 4. The model chooses intent inside a bounded schema. Code produces geometry.

The model is never asked to invent pixel positions. It is asked for a typed
plan — narrative, slide roles, a typed artifact spec — constrained by
`briefJsonSchema` (`convex/nodeslideAgent.ts:1882` (`briefJsonSchema`)). Deterministic code in
`convex/lib/nodeslideSeed.ts` turns that plan into positioned, typed elements.

**Why:** the same brief must be reproducible, validatable and repairable. A
model that returns coordinates cannot be checked; a model that returns intent
can.

## 5. Refusals happen before spending, not after.

Inside `createDeckFromBrief`, every check that can be made from arguments
already in hand — argument shape, output-identity binding, admission, quota —
runs *before* the provider call. The comments in
`convex/nodeslideAgent.ts:1757-1765` (`creationAttemptId`) say so explicitly, and they are worth
reading before you reorder anything there.

The mirror of the same rule: if a paid call ends without a reconcilable billing
receipt, creation **fails closed**. No fallback deck is produced under an
unresolved charge (`nodeSlideCreateSpendUnreconciled`).

## 6. Long work is a durable job, not a long request.

Generating a deck can take minutes. `startCreateDeck`
(`convex/nodeslideJobs.ts:204` (`startCreateDeck`)) writes a job row and returns immediately; the
row's id determines the deck id, so the browser knows what it is waiting for
before the work begins. `convex/nodeslideJobRunner.ts` executes it and calls
`checkpointInternal` as it goes. A reload reattaches to the row.

**Enforced by:** the identity check at the top of `createDeckFromBrief` — a
durable create whose deck id is not `nodeslideStableId('deck_job', jobId)` is
refused for free.

## 7. Progress reaches the screen by subscription, not by polling.

`useQuery` in `NodeSlideStudio.tsx` (lines 688–780) subscribes. Convex pushes.
There is no interval timer and no hand-rolled socket in this repository. If you
find yourself adding one, the state you want probably is not in the database
yet — put it there instead.

## 8. Crashes are cleaned up on a schedule, not hoped away.

Agent runs hold a lease. `recoverStaleAgentRunsInternal`
(`convex/nodeslide.ts:3347` (`Fails abandoned active runs honestly`)), run every two minutes by `convex/crons.ts`, fails
runs whose lease expired. A crashed action therefore stops spinning in the UI
within two minutes rather than forever.

## The shape, in one diagram

```
browser (src/)                    backend (convex/)                external
──────────────                    ─────────────────                ────────
NodeSlideLanding.start
  └─ NodeSlideStudio.createDeck ─► createDeckFromBrief (action)
                                     ├─ validators ................ (no I/O)
                                     ├─ admission + quota
                                     ├─ budgeted dispatch ───────► OpenRouter / Nebius
                                     ├─ critique + revision
                                     └─ createFromBriefInternal (mutation) ─► tables
                                                                              │
NodeSlideStudio.useQuery ◄── live subscription ◄──────────────────────────────┘
  └─ SlideRenderer

editor drag / AI proposal ──────► proposePatch / acceptPatch (mutation)
                                     └─ evaluateNodeSlideCas ──► commit, or store as `stale`

coding agent (MCP) ─────────────► the same Convex functions
```

## Reading the comments

The backend files carry long block comments that explain *why* a check sits
where it does — often naming the bug that put it there ("until this was
declared, Convex rejected the whole call … which made every durable create job
fail at 35% progress"). They are the most valuable documentation in the
repository. Treat them as load-bearing: if you move code past one, move the
comment with it.
