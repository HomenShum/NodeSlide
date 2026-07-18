# AI Tab → Conversational Thread (Cursor/v0-style) — build map

Decision (2026-07-18): rebuild the AI tab as an agentic chat thread — visible
steps, inline patch cards, multi-turn — against the live Kimi K3 agent.

## Ground truth: the state already exists — build WITH it

| Thread need | Already exists | Where |
|---|---|---|
| Durable runs w/ lifecycle | `nodeslide_agent_runs` — status: queued → researching → planning → validating → awaiting_review → completed/failed/cancelled; provider/model; patchId; error | `convex/schema.ts:486` |
| Turn messages | `nodeslide_agent_messages` — role user/assistant/tool/system, toolName, sourceIds (citations) | `schema.ts:535` |
| Visible steps | `nodeslide_agent_spans` — name, toolName, status, durationMs, model, tokens, costMicroUsd, parentSpanId | `schema.ts:578` |
| Reactive reads | `listAgentRuns`, `listAgentMessages`, `listAgentTelemetryPage` | `convex/nodeslide.ts:368/382/396` |
| Patch accept-in-place | `nodeslide_patches` + existing apply/reject mutations (today's patch card) | `schema.ts:331` |
| Invocation | `proposeEdit` action (writes run+messages+spans via nodeslide.ts mutations) | `convex/nodeslideAgent.ts:94` |
| Composer | `ai-elements/prompt-input.tsx` (already adopted) | AiInspector |

**Nothing server-side changes.** The rebuild is a client projection:
runs+messages+spans → thread turns.

## Target shape (Cursor/v0)

```
[Thread scroll]
  ├─ user bubble          = run.instruction
  ├─ assistant turn
  │    ├─ StepTimeline    = spans for run (toolName · status · ms · model), collapsible
  │    ├─ streamed prose  = assistant/tool messages (sourceIds → citation chips)
  │    └─ PatchCard       = run.patchId → inline Accept / Reject (existing mutations)
  ├─ (next run = next turn — multi-turn IS the run list)
[PromptInput docked at bottom — scope/policy controls fold into a popover]
```

- Run status drives the turn state: queued/researching/planning/validating →
  live shimmer + step ticks; awaiting_review → patch card hot; failed → honest
  error voice with retry.
- `AiInspector.tsx` (2,245 lines) slims to: mount `<AgentThread deckId/>` +
  composer; the propose-form dies. TraceInspector stays as the deep-dive view;
  the thread's StepTimeline links each turn to it.

## Slices

1. `thread/AgentThread.tsx` — runs+messages subscription, turn grouping, status
   shimmer, step timeline from spans (read-only). **← this commit**
2. Inline PatchCard wiring (accept/reject in place) + composer docking.
3. AiInspector slim-down + policy controls → popover; delete dead form code.
4. Live-drive against Kimi agent; latency/citation polish; tests.

## Coordination + integration notes (Claude, 2026-07-18)

Slice 4's prerequisite — **a working live agent — is now met.** The AI edit
agent was fully broken (no model key + validator gap + kimi-k3 missing from
pi-ai's catalog + `reasoning:true` returning empty content). Fixed on this
branch: **Kimi K3 is the default and works end to end** — propose → validate →
accept → applied, verified live (commits `15d2686`, `299253d`). So AgentThread
can be driven against a real agent, not just fixtures.

Gotchas for slices 2–3 (wiring `<AgentThread/>` into AiInspector):

- **Scoped Tailwind reset.** AgentThread styles with Tailwind utilities
  (`bg-primary`, `border-border`, `size-3`, opacity modifiers) that resolve
  against the shadcn tokens mapped in `src/tailwind.css`. Preflight is scoped
  to `.ns-ai-elements` only (see the `@layer base` block), so **mount
  AgentThread inside a `.ns-ai-elements` wrapper** or its `border` utilities
  render with no visible border (Tailwind sets width but preflight sets
  `border-style: solid`, and that reset is scoped).
- **Dead CSS on swap.** `nodeslideV3.css` has an appended "Agentic conversation
  thread" block (commit `4bf2318`) that restyles the CURRENT `ns-ai-v3-chat-turn`
  review-scroll into user-bubbles/agent-cards. It's a **stopgap for the live
  thread** and becomes dead once AgentThread replaces the review-scroll —
  delete that block in slice 3.
- **Props already flow.** AiInspector already receives `agentRuns`,
  `agentMessages`, and `patches` (props on `AiInspectorProps`) plus
  `onAccept`/`onReject` — wire them straight into `<AgentThread/>`; no new
  queries, exactly as slice 1 intends.
- **Branch hygiene:** Claude is NOT editing `AiInspector.tsx` to avoid a
  same-branch collision with slice 3. Codex owns slices 2–4.
