# Extraction Boundary Audit (I1) — 2026-07-19

Method: full import-graph sweep across `shared/`, `src/domains/nodeslide/`,
`convex/`, `mcp/`, and the app shell, classifying every cross-boundary import
against the target package layout in `CAPABILITY_PLAN.md` Track I.

## Findings

| Boundary | State | Evidence |
|---|---|---|
| `shared/` → anywhere | **PURE** — zero imports from src/convex/app | future `@nodeslide/contracts` + engine core, extractable today |
| domain → `shared/*` | 68 imports, all into contracts/engine territory | correct direction; becomes package deps |
| `convex/` → `src/` | **CLEAN** — zero reach-ins | backend package boundary already real |
| app shell → domain | **ONE import**: `./domains/nodeslide/NodeSlideStudio` | a single mount point |
| domain → backend | **ONE file**: `NodeSlideStudio.tsx` holds every `convex/react` hook and `_generated/api` reference (~line 520+) | the entire backend coupling is one seam |
| inspectors/canvas/thread | props-driven (AiInspector, AgentThread, InspectorPanel, JsonInspector, TraceInspector take state + callbacks) | already the controlled-component contract I3 wants |

## The one-seam discovery

All Convex knowledge lives in `NodeSlideStudio.tsx` (the ~3.8k-line
orchestrator). Everything beneath it is backend-neutral. Therefore I3 is not a
rewrite — it is a **split of one file**:

```text
NodeSlideStudio.tsx  →  StudioShell (backend-neutral: state machine, layout,
                        wiring of props/callbacks into the existing surfaces)
                     +  ConvexStudioAdapter (useQuery/useMutation/useAction +
                        _generated/api → NodeSlideRepository calls)
                     =  <ConvexNodeSlideStudio deckId/> stays as the
                        convenience binding; <NodeSlideStudio {...ports}/>
                        becomes the injectable surface
```

## Violations to fix (small)

1. **Host-path aliases in domain code**: 3 imports use the app's `@/` alias
   (`@/components/ui/select`, `@/components/ui/tooltip`,
   `@/components/ai-elements/prompt-input`) from `AiInspector.tsx`. A package
   cannot assume the host's tsconfig alias — these move into the react package
   (or registry) with relative/self-owned paths.
2. **Direct `window.localStorage` reads** in domain components (model/effort
   persistence) — must route through a host-suppliable preference adapter
   (SSR + privacy policies differ per host).
3. **`mcp/` import shape unverified** — the sweep found no direct src/convex
   imports from `mcp/src`; confirm whether it duplicates types (drift risk)
   or consumes `shared/` correctly, and pin it to `@nodeslide/contracts`.

## Boundary freeze (in force now)

New capability work (Tracks A–F) must respect:

- Layout, validation, patch, compile logic → `shared/` (engine), never in
  components or Convex functions.
- Components take state via props/hooks; **no new `convex/react` or
  `_generated` imports anywhere except the (future) adapter layer** — today
  that means: only `NodeSlideStudio.tsx`.
- No new `@/` alias imports inside `src/domains/nodeslide/`.
- No `window.*` globals in domain code without an adapter.
- `shared/` stays free of React, Convex, and DOM types.

Violating a rule in a capability PR = boundary regression, blocked regardless
of feature value.
