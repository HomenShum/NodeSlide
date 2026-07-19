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

## I · Injectable engine — NodeSlide as a reusable governed presentation system (P0 boundary, P1 packaging)

Corrected after architecture review (2026-07-19): the product is NOT
`<NodeSlideStudio/>` as a mega-component. It is a layered, independently
consumable stack — **portable deck model + governed mutation engine + agent
pack + backend ports + controlled React surfaces + optional source-owned
registry + conformance/consumer tests**. The current app and NodeRoom become
the first two consumers. Every other track builds against these interfaces
from now on — capability work that crosses the boundary is a regression.

Package layout (target):

```text
@nodeslide/contracts       schemas + types only (no React, no Convex, no app imports)
@nodeslide/engine          layout, patches, validation, compilation, proposals (no UI)
@nodeslide/agent           tool/skill pack, context assembly, policy hooks, evals
@nodeslide/react-headless  hooks, state machines, a11y/keyboard contracts
@nodeslide/react           styled controlled components over CSS variables
@nodeslide/convex          reference backend adapter (Convex component + migrations)
@nodeslide/client-http     hosted-API adapter
@nodeslide/mcp             external-agent adapter
@nodeslide/testing         fixtures, fake repository, scripted agent, conformance
registry/                  shadcn-style source-owned compositions (studio route,
                           agent panel, proposal review, design tab, presenter)
```

- [ ] I1. **Extraction-boundary audit** (P0, first): map every import crossing
      domain ↔ app-shell ↔ convex ↔ shared; classify each as
      contracts/engine/react/backend/agent/host; document violations; freeze
      the boundary (new capability code may not cross it).
- [ ] I2. **Backend ports before backends**: define `NodeSlideRepository`
      (getDeck/applyPatch/createProposal/resolveProposal/listVersions/
      storeReceipt) + `NodeSlideAssetStore` + `NodeSlideTelemetryAdapter`.
      Implement Memory (tests), Convex (reference, as a mountable Convex
      component with isolated tables + migrations), Http (hosted). The Convex
      component is the reference production backend, not the abstraction.
- [ ] I3. **Controlled React surfaces**: `<NodeSlideStudio/>` /
      `<DeckAgentThread/>` take snapshot/selection/proposal/permissions +
      onPatch/onPropose/onAccept/onReject/onExport — backend-neutral; ship
      `<ConvexNodeSlideStudio deckId/>` as optional convenience binding.
      Split headless (hooks/state) from styled (CSS-variable tokens:
      `--nodeslide-*`); a host can adopt the engine without NodeSlide's
      visual identity. "Scoped Tailwind" alone is not the isolation contract.
- [ ] I4. **Auth is host-supplied**: normalize to `NodeSlidePrincipal`
      {userId, organizationId?, roles, permissions}; host adapters resolve it
      from WorkOS/Clerk/Auth0/Convex/Supabase/custom. No auth vendor inside
      the packages.
- [ ] I5. **Governance = enforced invariants, configurable UX.** Required and
      non-bypassable server-side: mutation authority checks, version clocks
      (CAS), validation, trace lineage, source authorization, rollback.
      Host-configurable: which operations need human approval (typo fix auto
      → structural deletion approval), Turbo auto-commit, host-supplied
      approval UI, publishing/retention policy. A host cannot bypass
      validation and still claim a valid NodeSlide result — but the engine
      never imposes one UX.
- [ ] I6. **Installer + upgrade contract**: `npx nodeslide init` asks what to
      install (full studio / agent thread / renderer / presenter / backend
      only / agent pack only), which backend (Convex / hosted / custom), and
      which UI mode (default theme / host tokens / headless); detects
      framework + shadcn config; installs versioned packages + chosen
      registry sources; generates example route + env examples + conformance
      tests; runs typecheck/build; writes an installation receipt. Never
      silently touches auth, global CSS, routing, or existing schemas.
      Upgrades: engine/schemas semver + migrations; snapshots carry
      schemaVersion + migration chain; registry sources upgrade by diff.
- [ ] I7. **NodeRoom consumer proof** (a required architectural test, not
      optional dogfood): from a clean NodeRoom branch — installer →
      NodeRoom's own principal adapter → mount as a room artifact → create
      → manual edit → invoke NodeRoom's existing NodeAgent runtime (no
      second runtime) → unapplied proposal → compare → accept through
      server validation/CAS → room activity + receipt → reload → presenter
      → PPTX export → re-validate. Hard checks: no copied backend source,
      no duplicate auth, no second Convex client, no global CSS
      contamination, no table collisions, clean uninstall, same snapshot runs
      against Memory and Convex adapters.
- [ ] I8. **Cross-repo CI**: a NodeSlide package regression must fail
      NodeRoom's consumer suite; both CIs run the same smallest journey
      (load → create → render → edit → version++ → export).

---

## Suggested sequence (corrected)

```text
1.  I1      extraction boundary (before ANY new capability work)
2.  H1      real runtime smoke gate (NodeSlide CI now; NodeRoom CI at I7)
3.  A1-A4   measured layout, 5 archetypes, unified validation
4.  B1      generate -> render -> inspect -> critique -> repair loop
            (the agent must SEE renders, geometry reports, Deck CI findings,
            references - otherwise self-critique is theatre)
5.  C       KaTeX (removes the fastest credibility gap)
6.  D       real charts (multi-series line/bar/area, native PPTX)
7.  E       image search/licensing pipeline
8.  F       visual evidence lineage (screenshot + region binding)
9.  I2-I6   ports, packages, installer (package only proven behavior -
            release bar: install -> mount -> create -> edit -> live agent
            change -> chart render -> PPTX -> Deck CI green, no copy-paste)
10. I7-I8   NodeRoom consumer proof + permanent cross-repo CI
```

Organizing principle: **NodeSlide is no longer just an app — it is a reusable
governed presentation engine with two consumers (this app, NodeRoom).** Every
capability is implemented once in the engine, proven here, and independently
verified in NodeRoom.

Definition of done for the plan itself: every checked item has a fail-closed
verification run linked in the commit message, and no caption anywhere claims
what a screen hasn't shown.
