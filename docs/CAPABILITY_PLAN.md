# Capability Plan — closing the gap between governance and capability

Source: brutal self-assessment (2026-07-19) after the live-prod verification matrix
and final demo. NodeSlide's accountability layer (scope, CAS, gates, receipts,
honest fallbacks) is ahead of agent-product norms; the generation/design/agency
capability underneath it is thin. This is the ordered checklist to fix that.

Every item ships with a fail-closed acceptance check (assert real product state,
never claim by caption). Corpus only grows; tsc/vitest/biome stay green per commit.

Priorities: **P0** = before panel deep-dives · **P1** = strengthens the story ·
**P2** = roadmap, labeled honestly as such.

---

## A · Layout engine — from styled document to designed deck (P0)

The materializer is fixed-coordinate stacking; every slide is one grid family.
This is the root of the visual monotony AND the collision/overflow bug class.

- [ ] A1. Text measurement: estimate rendered height (font metrics × content
      length × width) for headline/body/bullets; clamp or reflow instead of
      fixed heights. Kills the collision class the 0.13 clamp only patched.
- [ ] A2. Slide archetype variety: ≥5 layouts (statement, stat-dominant,
      comparison, chart-dominant, image-dominant) selected from slide role +
      content shape (has chart / metric / quote / image), not position alone.
- [ ] A3. Server-side geometry validation at materialization: run the
      collision/overflow checks before persisting; auto-nudge or reflow on
      failure so no deck is born export-blocked.
- [ ] A4. Unify validation surfaces: move the client-only geometry checks
      (`slidelang/validation.ts` collision/overflow) into the shared validator
      so footer, Trace, server, and the export gate agree. (Today: footer can
      show green while export blocks — dishonest-by-accident.)
- [ ] A5. Acceptance: 20 fresh prod generations → 0 collisions, 0 overflows,
      100% export-clean, ≥3 visually distinct layouts per deck at thumbnail
      scale (assert distinct archetype ids per deck).

## B · Agentic depth — a real loop, not a labeled function call (P0/P1)

Today: one planner call + one JSON repair. Thread steps are status labels.
No decomposition, no sub-agents, no self-verification against the render.

- [ ] B1. Creation loop (P0): generate spec → materialize → validate (incl.
      geometry after A3) → feed issue list back to the model → revise ops →
      converge. Bounded attempts, one receipt per pass, honest terminal states.
      Reuses the render-repair loop bones (exists, unused in creation).
- [ ] B2. Orchestrator/worker routing (P1, specced in AI_TAB_THREAD_REBUILD.md):
      planner model → op skeleton + copy briefs; cheap executor model → copy;
      orchestrator validates before candidate assembly. Spans carry
      `parentSpanId` + per-model attribution; AgentThread shows roles.
- [ ] B3. Unblock cheap executors (P1): pin `reasoning:false` for Gemini 3.5
      Flash in the pi-ai catalog override (same disease as Kimi's original bug);
      audit the rest of the fleet with a 1-token probe script.
- [ ] B4. Edit-path tool loop (P1): read → propose → verify-against-render →
      finalize, with real steps in the thread replacing status labels.
- [ ] B5. Variations become a judged fan-out (P2): 3 executor generations + a
      judge pass with tradeoff labels (pairs with A2 for layout-distinct
      directions).
- [ ] B6. Acceptance: one routed run on camera — two models in one thread turn
      with parent-child spans, tokens, cost; creation self-corrects an induced
      layout issue without human input.

## C · Math — typeset it or stop saying LaTeX (P1)

The formula element stores a `latex`-tagged string; nothing typesets it.

- [ ] C1. KaTeX render for math elements in the browser canvas (SSR-safe).
- [ ] C2. PPTX export: KaTeX → SVG → raster embed, replacing "math as text";
      capability report updated truthfully (`pptx_static_fallback`).
- [ ] C3. Expression validation + honest plain-text fallback when parse fails.
- [ ] C4. Acceptance: golden formula typesets in browser; PPTX shows the
      rendered equation; capability claims match the adapter.

## D · Charts — from primitive to charting (P1)

Single-series flat bars only.

- [ ] D1. Types: line, horizontal bar, pie/donut, stacked bar; axis labels,
      ticks, units; multi-series schema (`labels` + `series[]`).
- [ ] D2. `update_chart` gains `chartType` + series ops so the agent can switch
      forms ("make this a trend line").
- [ ] D3. Native PPTX charts via PptxGenJS chart API (it supports them) instead
      of static shapes — keeps decks editable in PowerPoint.
- [ ] D4. Source binding preserved across type switches; validator understands
      series.
- [ ] D5. Acceptance: each type renders + exports natively + agent switches a
      chart's type live on prod.

## E · Images — fill the grey boxes (P1/P2)

Placeholder governance is excellent; capability is thin. Generated decks arrive
with empty slots unless a human uploads art.

- [ ] E1. (P1) License-aware image search (Openverse first: no key, CC-licensed,
      credit metadata) behind explicit consent; insert fills alt/credit
      automatically and stays export-truthful.
- [ ] E2. (P2) Optional generation via user-keyed provider (BYOK), labeled
      illustrative.
- [ ] E3. (P1) Crop/focal-point + aspect handling in the Design tab.
- [ ] E4. Acceptance: placeholder → search → insert with license credit on
      camera; export stays clean (capability sync already shipped).

## F · Evidence & screenshots — prove the lineage (P1)

Web-research snapshot capture and region-highlighted evidence are schema-real
but never live-verified.

- [ ] F1. Verify (or finish) snapshot capture on the web-research path; honest
      no-badge state when capture fails.
- [ ] F2. Region highlight on the snapshot bound to the claim.
- [ ] F3. Evidence tab: claim → source → element binding made visible/clickable.
- [ ] F4. Acceptance: live run showing a web claim whose snapshot region opens
      from the element that cites it.

## G · Thread/UX debt (P2)

- [ ] G1. Policy controls → popover; delete the stopgap agentic-CSS block in
      `nodeslideV3.css` (slice-3 leftovers).
- [ ] G2. Streaming assistant text in AgentThread (reads as alive, not batch).
- [ ] G3. Nested handoff rendering (pairs with B2).
- [ ] G4. Creation wait UX: informative staged progress on the landing (what
      the 2–4 min is doing), since Kimi's tail is slow.

## H · Ops, CI, hygiene (P0-quick)

- [ ] H1. CI runtime smoke: build → `vite preview` → headless assert landing
      renders + zero page errors (the blank-page chunking class can never ship
      again on green CI).
- [ ] H2. Nightly prod probe: the fail-closed create→edit→export script on a
      schedule; alert on first red.
- [ ] H3. Vercel deploys from CI on main push (replace manual prebuilt deploys);
      keep VITE_CONVEX_URL pinned to prod.
- [ ] H4. Repo hygiene: retire stale parity worktrees/branches; remove
      `nodeslide-deploy` staging folder; decide parity-studio's demo fate.
- [ ] H5. Human: send the Mike draft (video URL now public via the README).

## I · Injectable component — NodeSlide in anyone's repo (P1)

Everything above should land as capabilities of an *installable* deck-agent,
not features locked inside this app. Target shape: drop NodeSlide into any
React + Convex repo the way AI Elements drops into a Next app. Pilot bed:
our own `noderoom` repo.

- [ ] I1. Extraction boundary audit: `shared/` (types + patch engine) must have
      zero app imports; editor/inspector/AgentThread components take all state
      via props/hooks (no app-global reach-ins); enumerate every leak.
- [ ] I2. Backend as a **Convex component**: package the `nodeslide_*` schema +
      functions with Convex's component system so a host app mounts it with
      isolated tables (`app.use(nodeslide)`); host passes provider keys/env.
      Fallback mode: hosted-API adapter pointing at our prod deployment.
- [ ] I3. Frontend as `@nodeslide/react`: `<NodeSlideStudio/>` (full editor) and
      `<DeckAgentThread/>` (chat + patch review only) with a typed backend
      adapter interface; scoped Tailwind stays preflight-off so it cannot
      restyle the host app (the `.ns-ai-elements` discipline, generalized).
- [ ] I4. Install path: `npx nodeslide init` (shadcn-style registry for the
      ownable UI pieces) + npm for the engine; writes the Convex mount, env
      names, and a seed route. One command to a working sample deck.
- [ ] I5. Governance travels with the component: consent tokens, scope
      validators, CAS, gates, and Trace receipts are part of the package —
      not optional extras the host can silently drop.
- [ ] I6. Docs: a 10-minute "add a deck agent to your app" guide with the same
      honest capability labels the product uses.
- [ ] I7. Acceptance (fail-closed, in `noderoom`): fresh clone → install via I4
      → mount → create a deck → live agent edit accepted → PPTX export, all
      driven headlessly in noderoom's own CI, zero copy-paste from this repo.
- [ ] I8. Dogfood loop: noderoom's integration becomes a second CI surface for
      every track above (a layout or thread regression must fail in the
      consumer repo too, not just here).

---

## Suggested sequence

1. **H1 + A1–A4** (one arc: layout correctness + unified validation + CI that
   would have caught everything this week)
2. **I1** extraction-boundary audit (cheap now, brutal later — every subsequent
   track builds against the injectable boundary instead of re-entangling)
3. **B1** creation self-correction loop (the DeepAgent story, reusing repair bones)
4. **C1–C2** KaTeX (small, high-credibility for the researcher persona)
5. **I2–I4** package + install path → **I7** noderoom pilot
6. **D1–D3** charts · **B2–B3** routing · **E1/E3** images · **F** evidence
7. **G/E2/B5/I8** polish + roadmap + consumer-repo CI

Definition of done for the plan itself: every checked item has a fail-closed
verification run linked in the commit message, and no caption anywhere claims
what a screen hasn't shown.
