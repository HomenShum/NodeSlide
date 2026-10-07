# Structure — where things live

The repository is large (3,867 tracked files) but most of it is **evidence**,
not code. Read this before you go exploring, so you do not spend an afternoon
in `artifacts/`.

## Code you will edit

```
src/                       the browser app
  main.tsx                 boots React, connects to Convex, renders the backend guard on failure
  App.tsx                  the whole router: ?domain=atlas → gallery, everything else → studio
  domains/nodeslide/       the product
    NodeSlideStudio.tsx    4,528 lines — the editor shell: state, subscriptions, every action handler
    components/            landing, canvas, renderer, navigator, toolbar, dialogs
    inspector/             the right-hand panel: AI thread, design, trace, evidence
    slidelang/             deck ↔ JSON ↔ PPTX ↔ HTML conversion
    signature/             extracting and applying a visual "signature" from a reference deck
    session/               one person's live agent session; internals stay inside this folder
    integrations/          Google Slides three-way sync
  components/ui/           radix wrappers (select, tooltip, dropdown-menu, collapsible…)
  components/ai-elements/  a vendored composer kit; only prompt-input.tsx survives, trimmed to what is used

convex/                    the backend — every file here is a deployed function module
  schema.ts                57 tables, the real data model
  nodeslide.ts             6,124 lines — deck CRUD, patches, comments, publishing, agent runs
  nodeslideAgent.ts        2,295 lines — createDeckFromBrief and proposeEdit, the two model entry points
  nodeslideJobs.ts         durable job rows: enqueue, checkpoint, cancel, retry
  nodeslideJobRunner.ts    the internal actions those jobs execute
  crons.ts                 recovery and pruning schedules
  lib/                     pure helpers the function modules import (patches, validators, seed, provider…)

shared/                    types and pure functions used by BOTH src/ and convex/
  nodeslide.ts             the canonical DeckSnapshot — start here to understand the data
  nodeslidePatch.ts        patch operations and their validation

packages/                  15 publishable workspaces (contracts, engine, agent, react, cli, convex component…)
mcp/                       the Model Context Protocol server: the same backend, for coding agents
api/                       one Vercel serverless function (`share.ts`) behind the /s/:slug rewrite
```

## Code you will run but rarely edit

```
scripts/     235 files. Proof runs, benchmark gates, capture scripts, atlas builders.
             Most are one npm script each; see package.json. scripts/tests/ holds their vitest specs.
tests/e2e/   Playwright specs. They target a deployed URL, not a local dev server.
harness/, benchmarks/, qa/, .qa/   fixtures and harness definitions for the gyms and gates
```

## Output, not source — do not edit, do not read to learn the system

```
artifacts/   1,814 files — receipts emitted by the gates and gyms
outputs/     289 files — generated decks, PPTX, rendered atlases
public/      408 files — static assets including generated atlas imagery
evidence/    189 files — captured screenshots and proof bundles
docs/demo/   the recorded walkthroughs the README embeds
promotion/   the product-loop scorecard, journeys and defect ledger (Wave 1/2)
```

## Two orientation rules

1. **`shared/` is the contract.** If a type is used by both the browser and the
   backend it belongs there. A type defined twice is a bug waiting to happen —
   the deck snapshot is the thing both sides agree on.
2. **`convex/lib/` is pure, `convex/*.ts` is deployed.** Anything in `lib/` can
   be unit-tested with no database. The top-level modules define `query`,
   `mutation` and `action`, and Convex publishes those names as the API.

## The four files that hold most of the system

| File | Lines | What it decides |
|---|---:|---|
| `convex/nodeslide.ts` | 6,124 | Every write to a deck, and the version check that guards it |
| `src/domains/nodeslide/NodeSlideStudio.tsx` | 4,528 | Every user action in the editor |
| `convex/lib/nodeslideSeed.ts` | 3,753 | Turning a model plan into typed slide elements |
| `convex/nodeslideAgent.ts` | 2,295 | The two places a model is allowed to be called |

They are large. That is a real cost and it is named in CONCERNS.md. It is also
why `docs/START_HERE.md` gives you line numbers rather than telling you to read
them.
