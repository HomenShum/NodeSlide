# Recovered work audit

Date: 2026-07-30  
Purpose: classify the pre-cleanup working trees before removing branches and
worktrees for the Devin handoff.

## What moves forward

### Already on `main`

Seventy-three untracked source/test files in the old primary checkout were
byte-identical to files now on `main`. They arrived through the July 28-30 PR
sequence and must not be reapplied.

This includes the agent authoring proofs, benchmark gates, visual-logic tools,
trust-surface checks, RecipeLang implementation, CLI generation path, and most
of the NodeSlide agent corpus.

### Recovered in this change

`scripts/emit-atlas-receipts.mjs` contained one coherent change not present on
`main`: human blind-review preference can be merged into Atlas receipts only
when a complete, internally consistent tournament record supports it.

The recovery adds:

- evidence-derived preferred/rejected sets;
- receipt eligibility and completeness checks;
- render bindings and schedule/seed binding;
- fail-closed declared-file handling;
- a 1 MiB read bound and 10,000-entry collection bounds;
- scenario coverage for a valid review, a forged winner, degraded fallback
  misuse, 5,000 abstentions, and an oversized file.

### Distilled into the Devin handoff

The temporary hosted-MCP audit at revision `12153fb` found that the interface
was reachable but creation degraded to the deterministic seven-beat fallback
after provider JSON repair failed. It also identified the missing publish/PPTX
delivery surface, process-local owner continuity, repeated silhouettes, and the
absence of demonstrated cinematic storytelling.

Those findings and their current architectural root cause are preserved in
`docs/DEVIN_VISUAL_COMPOSITION_HANDOFF_2026-07-30.md`. Raw create responses are
not committed because they contain disposable workspace identifiers and are
stale production snapshots.

## What does not move forward

### Invalid mass deletion

The old primary checkout showed 100+ deletions across `mcp/` and nearly every
workspace under `packages/`. This was not a coherent package-removal change:

- root `package.json` still declared `packages/*` and `mcp` workspaces;
- build scripts still invoked CLI, MCP, agent, React, Convex, and testing
  packages;
- `package-lock.json` still linked those workspaces;
- no migration, replacement package, or consumer update accompanied the
  deletion.

Applying it would break CLI/MCP generation and package CI. It is treated as
filesystem loss, not product intent.

### Superseded or failed generated output

The remaining stashes contain:

- `.serena/` project metadata;
- `.tmp/` lint, typecheck, benchmark, and probe logs;
- multiple iterative governance decks superseded by the retained final deck;
- two proof logs that end in explicit failures;
- generated API declarations superseded by current Convex generation;
- an older agent UI linter that would restore deleted consent assumptions and
  remove current trust-surface coverage;
- binary showcase/dogfood outputs without a passing release receipt.

These files are not suitable repository inputs. They remain recoverable from
the pre-cleanup stash/bundle until cleanup is accepted, but are intentionally
excluded from `main`.

## Recovery invariant

No unique source change is silently discarded:

1. byte-identical work is already on `main`;
2. the one coherent unsuperseded source change is recovered with tests;
3. useful diagnostic conclusions are promoted into the Devin handoff;
4. invalid deletions and reproducible/tool-local residue are documented rather
   than committed.

