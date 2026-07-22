# ECOSYSTEM — repo responsibility map (J3) + orchestration and distribution decisions (J2/J4)

One page. Every future extraction cites this map. Sources: J1 NodeAgent runtime audit
(noderoom, read-only, 2026-07-19), J2 eve control-plane audit (NodeVideo repos, read-only,
2026-07-19). Do not re-derive these facts — re-audit only if the cited files move.

## Repo responsibility map

| Repo | Owns | Consumes | Must never contain |
| --- | --- | --- | --- |
| **nodeslide** (`D:\VSCode Projects\nodeslide`) | Governed deck engine: layout/validation/patch/chart math in `shared/`, canvas + PPTX render, AgentThread UI, Deck CI, `@nodeslide/*` packages (I2–I6), cross-model routing for its own agent lane (Track B2 — see decision below) | NodeAgent runtime *types* via the adapter contract below (compile-time only, lands with I2 ports); OpenRouter/Kimi K3 + GLM model lanes | React/Convex/DOM types inside `shared/`; `convex/react` or `_generated` imports outside `NodeSlideStudio.tsx`; any eve/NodeVideo runtime dependency; a second copy of NodeAgent's run loop |
| **noderoom** (`D:\VSCode Projects\noderoom`) | Collab product **and the NodeAgent runtime**: seams `AgentModel`/`AgentTool`/`RoomTools` (`src/nodeagent/core/types.ts`), `runAgent` loop (`core/runtime.ts:270–306`), both production entry points (`convex/agent.ts`, `convex/agentJobRunner.ts`), job lifecycle (`convex/agentJobs.ts`), hash-chained receipts (`agentSteps`), spend gates, step journal, governed `agentArtifacts` | `@nodeslide/*` packages (distribution decision below); its own Convex backend | Deck-engine logic (layout/chart/PPTX math) — that is nodeslide's; per-product forks of `@nodeslide/*` code (consume the package, never copy-paste) |
| **NodeVideo / eve** (`D:\VSCode Projects\NodeVideo`, `NodeVideo-eve-control-plane`) | NodeVideo product: `nodevideo.capability-pack.v1` pack format (`packs/*`), fixed media workers (`scripts/workers/*.mjs`), Convex job/proposal/artifact ledger with lease semantics (`convex/jobs.ts`), `nodekit.yaml` repo-contract convention. eve-agent: one framework-hosted conversational agent with approval-gated typed wrappers over the control API | Vercel `eve@0.24.4`; its own control API env config | Cross-product orchestration or model routing (it has none today — four hardcoded `gpt-5.4-mini` strings; do not grow it speculatively); NodeSlide or NodeRoom runtime code |
| **agentic-ui-qa** | Cross-product QA + dogfooding protocol: personas, Agentic UI Bar scoring, bounded fix-revamp loop, worked profiles for NodeBench/NodeRoom/NodeSlide | Read/drive access to the products under test | Product source code, engine logic, or fixes landed directly — findings route back to the owning repo |

## J2 decision — the orchestration fork (recorded verbatim from the eve audit)

> **Recommendation: build cross-model orchestrator/worker routing inside NodeSlide now. Do not make eve the orchestration layer NodeSlide registers into.**
>
> - **Eve has no routing to inherit.** Four hardcoded `gpt-5.4-mini` strings is the entire "model routing" surface. NodeSlide already has more real multi-model machinery (Kimi K3 via OpenRouter default, model picker, GLM fallback) than eve does. Registering into eve would mean building the router inside eve first — pure speculative platform work.
> - **Eve is single-tenant by construction.** Product-specific env prefixes, a hardcoded capability list for one pack, NodeVideo-specific contracts (`JobReceipt`, `StartJobReceipt`, freeze digests). There is no multi-app abstraction to slot into; "eve as platform" is aspiration, and the decision doc itself scopes eve to conversational control of NodeVideo's fixed workers.
> - **Eve's genuinely reusable asset is a *pattern*, not a runtime:** typed tool → bounded control API → digest-bound receipt → approval-gated dispatch → durable Convex lease ledger. NodeSlide can copy that pattern (it largely already follows it via parity-studio governance) without a shared process.
> - **Repo/IP posture:** AI Fund fresh-repo + IP carve-out rules make a shared orchestration dependency across NodeVideo/NodeSlide actively risky right now.
>
> **Migration note (eve later):** if/when two products need the same router, extract at the seam eve already draws — the control API. Define a product-neutral `control-plane.v1` contract (submit/status/retry/cancel + receipt schema) and a `model-routing.v1` policy object (task class → model tier → fallback chain, with per-product overrides). NodeSlide's B2 router should therefore be written as a **standalone module with a typed policy input and no NodeSlide imports in its core** so it can be lifted into eve unchanged. Trigger for migration: a second product actually consuming the same router, not before.

**One owner, stated in writing:** Track B2 routing lives **in nodeslide**, as a policy-driven
standalone module. eve owns nothing NodeSlide depends on.

## J4 decision — how noderoom consumes `@nodeslide/*` before public npm

Options evaluated for THIS setup (Windows 11, sibling repos under a path with a space —
`D:\VSCode Projects\` — separate git histories, npm both sides):

- **workspace link / `npm link`** — rejected. npm workspaces can't span repos; `npm link`
  on Windows uses junctions that break under paths with spaces in some tooling, produces
  duplicate React trees (hook errors) because the linked package resolves its own
  `node_modules`, and silently tests unbuilt source instead of the publish artifact.
- **git tag install** (`npm i github:HomenShum/nodeslide#vX.Y.Z`) — rejected for now.
  `@nodeslide/*` are subpackages of a monorepo; npm's git installs only fetch repo root,
  so this needs either split repos or committed build output plus `prepare` scripts —
  extra machinery that public npm makes obsolete anyway.
- **versioned tarball** (`npm pack` → `file:` install) — **chosen.**

**Decision: versioned tarball.** In nodeslide: the artifact builder runs `npm pack` for
the complete 11-package `@nodeslide/*` closure and writes
`nodeslide-artifacts.json`; noderoom installs through `@nodeslide/cli --artifacts`
or pins the verified tarballs in a committed `vendor/` directory. The manifest binds one
release ID/version to every filename with independent SHA-256 and npm SHA-512 integrity,
and install receipts preserve those pins. Justification: the tarball **is** the exact
artifact npm would publish, so I6's release bar (install → mount → create → edit → live
agent change → chart render → PPTX → Deck CI green) tests reality, not a symlink; it is
deterministic and version-pinned (semver + migration notes per I6 apply unchanged — a new
artifact set requires a version bump, no mutable "latest"); mixed, unlisted, missing, or
tampered tarballs fail before npm runs; it has zero symlink/junction/spaces problems on
Windows; and switching to public npm later is a one-line specifier change.

## NodeSlideAgentAdapter contract (from J1, against the REAL noderoom types)

**Docs-only for now.** This block is transcribed from the J1 audit's draft against the real
seams in `noderoom/src/nodeagent/core/types.ts` (AgentModel :55–66, AgentTool :69–74,
RoomTools :233–307, EditOutcome :169–174, AgentResult :119–129). The compilable version —
imported types, tests, and the actual `RoomTools` partial implementation — lands with the
I2 package ports and is verified by J5 (compile against real NodeAgent types + noderoom
cross-link). Until then, treat this as the agreed interface, not shipped code.

```ts
// @nodeslide/agent-adapter — contract only (compiles at I2, not before)
// Real seams (noderoom): AgentModel, AgentTool, RoomTools, EditOutcome, AgentResult
import type { ZodTypeAny } from "zod";

/** Deck-scoped backend port. Structurally a subset of noderoom's RoomTools so the
 *  same tool objects run in both hosts. CAS conflicts are DATA, never thrown —
 *  mirrors noderoom EditOutcome (types.ts:169–174). */
export type DeckEditOutcome =
  | { ok: true; version: number }
  | { ok: false; conflict: true; expected: number; actual: number }
  | { ok: false; locked: true; holder: string }
  | { ok: false; pendingApproval: true; proposalId?: string }
  | { ok: false; invalid: true; findings: string[] }; // Deck CI fail-closed

export interface NodeSlideRoomTools {
  // Required (mirrors RoomTools required surface, deck-shaped)
  snapshot(): Promise<{ deckId: string; version: number; slides: unknown[] }>;
  readRange(args: { slideId: string; region?: string }): Promise<unknown>;
  proposeLock(args: { slideId: string }): Promise<{ ok: boolean; holder?: string }>;
  releaseLock(args: { slideId: string }): Promise<void>;
  /** Sole mutation seam: engine patch + expected version (CAS). */
  applyDeckPatch(args: {
    patch: unknown;            // shared/ patch type — no React/Convex/DOM types here
    expectedVersion: number;
  }): Promise<DeckEditOutcome>;
  say(text: string): Promise<void>;
  // Optional capabilities (noroom-style `?` capability probing, RoomTools :233–307)
  renderSlidePreview?(args: { slideId: string }): Promise<{ pngDigest: string }>;
  runDeckCI?(): Promise<{ ok: boolean; findings: string[] }>;
  exportPptx?(): Promise<{ artifactId: string; sha256: string }>;
}

/** Tool shape is noroom's AgentTool verbatim (types.ts:69–74): plain object,
 *  zod schema, execute(args, rt). "Registration" = membership in this array,
 *  passed into runAgent({ tools }) exactly like PRODUCTION_ROOM_TOOLS. */
export interface NodeSlideAgentTool<RT extends NodeSlideRoomTools = NodeSlideRoomTools> {
  name: string;
  description: string;
  schema: ZodTypeAny;
  execute(args: unknown, rt: RT): Promise<unknown>;
}

/** Adapter: what nodeslide hands to noderoom's runAgent (runtime.ts:270–306).
 *  Model stays host-provided (AgentModel) — routing policy is nodeslide's B2
 *  standalone module; budgets/receipts/journal remain the host runtime's job. */
export interface NodeSlideAgentAdapter {
  rt: NodeSlideRoomTools;
  tools: readonly NodeSlideAgentTool[];       // deck.outline, slide.compose, chart.render, deck.validate, ...
  systemPrompt: string;
  /** Advisory classification for the host's op ledger (QUERY_TOOLS/MUTATION_TOOLS
   *  sets are hardcoded in agent.ts:125–126 — impedance mismatch #1 from J1;
   *  host must merge these or new tools log as generic tool_call). */
  toolClasses: Record<string, "query" | "mutation">;
}
```

## Impedance notes carried from J1 (why the adapter looks like this)

1. Host op-ledger tool classification is hardcoded (`QUERY_TOOLS`/`MUTATION_TOOLS`,
   agent.ts:125–126, agentJobRunner.ts:136–137) — adapter exports `toolClasses` so hosts
   can merge instead of nodeslide patching noderoom.
2. RoomTools is sheet/room-shaped (editCell, searchSheetContext); decks need patch-level
   CAS — hence one `applyDeckPatch` mutation seam returning outcome-as-data rather than
   many cell-level mutators.
3. Approval flows differ: noderoom's `pendingApproval` proposals vs NodeSlide's inline
   Accept/Reject thread turns — mapped 1:1 through `DeckEditOutcome.pendingApproval`.

## Status

- J1 ✅ audited · J2 ✅ decided (above) · J3 ✅ this file · J4 ✅ decided (tarball)
- J5 ⏳ open: adapter must actually compile against noderoom's real types (with I2),
  and noderoom must cross-link this file.

## Portable NodeGym core

`@nodekit/gym-core` is owned in `packages/gym-core` until a separately governed
NodeKit repository adopts the exact package. It is dependency-free and owns only
product-neutral experiment plans, receipts, pairing, diagnosis, curriculum,
advisory promotion, bounded training export, and user-invisible shadow-route
selection. NodeSlide-specific artifact evaluators remain in NodeSlide; NodeRoom's
consumer supplies its own NodeAgent frame-evidence evaluator.

Distribution is an exact versioned `npm pack` tarball with SHA-256 and npm
integrity pins. `scripts/node-gym-portability-proof.mjs` proves clean install,
the `0.0.1 -> 0.1.0` upgrade, declaration consumption, run-plan compatibility,
and byte-identical provenance across the NodeSlide and NodeRoom consumers. The
NodeRoom side is a committed isolated consumer with its own NodeAgent
frame-evidence evaluator, not a copied NodeSlide evaluator. An available
NodeRoom checkout is fingerprinted and preserved, but a dirty checkout is not
silently modified or claimed as integrated. The receipt is
`artifacts/node-gym/node-gym-core-portability-proof.json`; CI reruns the proof
while its NodeRoom sibling is available for identity/fingerprint binding. A
separate clean NodeRoom integration worktree pinned exact
`@nodekit/gym-core@0.1.0` bytes at SHA-256
`b8c14013a54fc7419ebfda806553573c4b6e3d1dde2a17f11a61f5ddd88fc0c2`,
implemented a real room-change-review consumer, and passed the package proof,
both mandatory NodeAgent smokes, and the full repository floor. Direct adoption
landed in [NodeRoom PR #242](https://github.com/HomenShum/NodeRoom/pull/242) at
`c9b699f416a68dfe29298d62b6559690c7ccaa6a`; exact-main
[CI](https://github.com/HomenShum/NodeRoom/actions/runs/29916176474),
[conformance](https://github.com/HomenShum/NodeRoom/actions/runs/29916177044),
and [ProofLoop](https://github.com/HomenShum/NodeRoom/actions/runs/29916176323)
passed. Node 24 action hardening then landed in
[NodeRoom PR #243](https://github.com/HomenShum/NodeRoom/pull/243), leaving
current main at `83f9b7442065652208f3a641e65bfed2752d5d13` with green exact-main
[CI](https://github.com/HomenShum/NodeRoom/actions/runs/29919737217),
[conformance](https://github.com/HomenShum/NodeRoom/actions/runs/29919737570),
and [ProofLoop](https://github.com/HomenShum/NodeRoom/actions/runs/29919737301).
The reusable producer was fixed by
[node-platform PR #8](https://github.com/HomenShum/node-platform/pull/8), merge
`5c9aa6443ca8e61dc8886fbf0a0b4a7b72858e63`, whose exact-main
[quality run](https://github.com/HomenShum/node-platform/actions/runs/29918399950)
passed; the final NodeRoom main audit reports zero warnings and zero Node 20
annotations. The user's unrelated dirty NodeRoom checkout remains untouched. No
automatic routing or promotion mutation is exposed by this package.
