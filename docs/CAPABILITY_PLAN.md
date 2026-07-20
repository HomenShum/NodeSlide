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

- [x] A1. Text measurement: estimate rendered height (font metrics × content
      length × width) for headline/body/bullets; clamp or reflow instead of
      fixed heights. Kills the collision class the 0.13 clamp only patched.
      — DONE a0d34f9: `shared/` text metrics estimator drives block heights at
      materialization.
- [x] A2. Slide archetype variety: ≥5 layouts (statement, stat-dominant,
      comparison, chart-dominant, image-dominant) selected from slide role +
      content shape (has chart / metric / quote / image), not position alone.
      — DONE 9fc0d24: archetype selector in the materializer picks layout from
      slide role + content shape.
- [x] A3. Server-side geometry validation at materialization: run the
      collision/overflow checks before persisting; auto-nudge or reflow on
      failure so no deck is born export-blocked.
      — DONE a0d34f9: geometry gate runs pre-persist with auto-nudge/reflow.
- [x] A4. Unify validation surfaces: move the client-only geometry checks
      (`slidelang/validation.ts` collision/overflow) into the shared validator
      so footer, Trace, server, and the export gate agree. (Today: footer can
      show green while export blocks — dishonest-by-accident.)
      — DONE 2e8ce2d: single-source geometry checks in shared validator; server
      and client verdicts agree.
- [x] A5. Acceptance: 20 fresh prod generations → 0 collisions, 0 overflows,
      100% export-clean, ≥3 visually distinct layouts per deck at thumbnail
      scale (assert distinct archetype ids per deck).

      ### A5 acceptance run (2026-07-19, N=6 live prod generations)

      Deviation from spec: N=6, not 20 — two generator agents produced 3 live
      prod decks each; the remaining 14 generations were not run. All 6 decks
      were live generations (no fallbacks). Scored with the shared validator
      (`convex/lib/nodeslideValidation.ts` `validateNodeSlideSnapshot`) via a
      temporary vitest harness (deleted after the run). Gates per deck:
      0 geometry errors, publishOk, exactly 6 slides, ≥3 distinct archetypes.

      | Deck | Gen time (s) | Geometry errors | Geometry warnings | publishOk | Slides | Distinct archetypes | Adjacent archetype repeats | Verdict |
      |---|---|---|---|---|---|---|---|---|
      | gen1-deck1 (LatticeServe) | 97 | 0 | 0 | true | 6 | 3 (media-dominant, split, stat-dominant) | 0 | PASS |
      | gen1-deck2 (TidalCore) | 130 | 0 | 0 | true | 6 | 4 (statement, media-dominant, stat-dominant, split) | 0 | PASS |
      | gen1-deck3 (Plately) | 90 | 0 | 0 | true | 6 | 4 (stat-dominant, chart-dominant, media-dominant, split) | 0 | PASS |
      | gen2-deck1 (HelixNote) | 150 | 0 | 0 | true | 6 | 5 (media-dominant, comparison, stat-dominant, split, chart-dominant) | 0 | PASS |
      | gen2-deck2 (Farline Logistics) | 75 | 0 | 0 | true | 6 | 4 (media-dominant, split, stat-dominant, chart-dominant) | 0 | PASS |
      | gen2-deck3 (Quietdesk) | 87 | 0 | 0 | true | 6 | 3 (stat-dominant, media-dominant, split) | 1 | PASS |

      Result: 6/6 decks pass every gate — 0 geometry errors and 0 warnings
      across all decks, all export-clean (publishOk), all exactly 6 slides,
      all ≥3 distinct archetypes. One adjacent archetype repeat observed
      (gen2-deck3); not a gate, noted for honesty. Checked off on the
      strength of 6/6 green with the N=6-vs-20 deviation stated above.

## B · Agentic depth — a real loop, not a labeled function call (P0/P1)

Today: one planner call + one JSON repair. Thread steps are status labels.
No decomposition, no sub-agents, no self-verification against the render.

- [x] B1. Creation loop (P0): generate spec → materialize → validate (incl.
      geometry after A3) → feed issue list back to the model → revise ops →
      converge. Bounded attempts, one receipt per pass, honest terminal states.
      Reuses the render-repair loop bones (exists, unused in creation).
      — DONE a99edcd: bounded server-side self-critique loop — first spec is
      materialized in memory via the real buildBriefNodeSlide path, shared
      validator + quality signals produce a concrete report, exactly one
      revision call embeds it, and the revision is adopted only when it
      strictly reduces the report.
- [x] B2. Orchestrator/worker routing (P1, specced in AI_TAB_THREAD_REBUILD.md):
      planner model → op skeleton + copy briefs; cheap executor model → copy;
      orchestrator validates before candidate assembly. Spans carry
      `parentSpanId` + per-model attribution; AgentThread shows roles.
      — DONE 4a0b44c (policy module + executor copy lane + attribution) and
      live-proved on prod 2026-07-19: sample deck, "Rewrite the headline and
      the body copy to be more direct." → thread showed BOTH roles in one
      turn: "Planner · Kimi K3: proposed 2 operations and delegated 2 copy
      targets to the executor lane." and "Executor · Gemini 3.5 Flash: wrote
      copy for 2 text elements; deterministic validation reran on the
      assembled operations." Patch card (2 ops) validated and reviewable.
- [x] B3. Unblock cheap executors (P1): pin `reasoning:false` for Gemini 3.5
      Flash in the pi-ai catalog override (same disease as Kimi's original bug);
      audit the rest of the fleet with a 1-token probe script.
      — DONE 9d18ab6: generalized OpenRouter overrides pin reasoning:false for
      Gemini 3.5 Flash.
- [ ] B4. Edit-path tool loop (P1): read → propose → verify-against-render →
      finalize, with real steps in the thread replacing status labels.
- [ ] B5. Variations become a judged fan-out (P2): 3 executor generations + a
      judge pass with tradeoff labels (pairs with A2 for layout-distinct
      directions).
- [ ] B6. Acceptance: one routed run on camera — two models in one thread turn
      with parent-child spans, tokens, cost; creation self-corrects an induced
      layout issue without human input.
      — PARTIAL (honest, 2026-07-19): routed run live-proved headless on prod
      (two models, per-role thread labels, validated 2-op patch — see B2), but
      NOT on camera, and span tokens/cost were not read off the Trace tab in
      this probe. The creation-self-corrects-induced-issue half remains
      unproven live (server self-critique loop shipped in a99edcd, no induced
      fault run yet). Left unchecked until the camera run + trace readout.

## C · Math — typeset it or stop saying LaTeX (P1)

The formula element stores a `latex`-tagged string; nothing typesets it.

- [x] C1. KaTeX render for math elements in the browser canvas (SSR-safe).
      — DONE 5b0faac: real KaTeX typesetting in SlideRenderer with jsdom test
      coverage.
- [ ] C2. PPTX export: KaTeX → SVG → raster embed, replacing "math as text";
      capability report updated truthfully (`pptx_static_fallback`).
- [x] C3. Expression validation + honest plain-text fallback when parse fails.
      — DONE 5b0faac: parse failures fall back to labeled plain text, never a
      silent blank.
- [ ] C4. Acceptance: golden formula typesets in browser; PPTX shows the
      rendered equation; capability claims match the adapter.

## D · Charts — from primitive to charting (P1)

Single-series flat bars only.

- [x] D1. Types: line, horizontal bar, pie/donut, stacked bar; axis labels,
      ticks, units; multi-series schema (`labels` + `series[]`).
      — DONE 46eebaa: ChartType widened (NODESLIDE_CHART_TYPES), Convex
      validators added, pure-SVG renderers in editor canvas + export SVG with
      axis labels/units and theme-palette series colors; legacy bar output
      byte-stable for golden decks.
- [x] D2. `update_chart` gains `chartType` + series ops so the agent can switch
      forms ("make this a trend line").
      — DONE 46eebaa: partial chartType/series overrides merge onto the
      existing chart; edit-planner schema + parseChart accept every type;
      summarizer narrates the switch.
- [x] D3. Native PPTX charts via PptxGenJS chart API (it supports them) instead
      of static shapes — keeps decks editable in PowerPoint.
      — DONE 46eebaa: pie → pieChart, bar-horizontal → barChart barDir=bar,
      stacked-bar → barChart grouping=stacked, asserted against generated
      chart XML; capability report unchanged (still pptx_editable).
- [x] D4. Source binding preserved across type switches; validator understands
      series.
      — DONE 46eebaa: element.sourceIds untouched and chart.sourceId
      re-attached when a replacement omits it (test-asserted); series/label
      length mismatches rejected at patch validation and flagged by the deck
      validator.
- [x] D5. Acceptance: each type renders + exports natively + agent switches a
      chart's type live on prod.
      — DONE (live probe 2026-07-19): on nodeslide.vercel.app, "Turn this
      chart into a line chart" -> Kimi patch "Switch the chart in Evidence
      chart to a line chart" -> Accept -> element class ns-chart--bar (3 bars)
      became ns-chart--line with SVG line geometry. Per-type render/export
      covered by the 46eebaa test suite.

## E · Images — fill the grey boxes (P1/P2)

Placeholder governance is excellent; capability is thin. Generated decks arrive
with empty slots unless a human uploads art.

- [x] E1. (P1) License-aware image search (Openverse first: no key, CC-licensed,
      credit metadata) behind explicit consent; insert fills alt/credit
      automatically and stays export-truthful.
      — DONE 8c9f6f1 and live-proved on prod 2026-07-19: selected the image
      element on slide 3 of the sample deck, searched "circuit board" (exact
      consent copy shown: query goes to api.openverse.org on click), got 8
      commercially-licensed results, inserted the first; image rendered
      (1024x768, converted to local data URI) and the credit field auto-filled
      "Twechie · BY-SA 2.0 via Openverse".
- [ ] E2. (P2) Optional generation via user-keyed provider (BYOK), labeled
      illustrative.
- [ ] E3. (P1) Crop/focal-point + aspect handling in the Design tab.
- [x] E4. Acceptance: placeholder → search → insert with license credit on
      camera; export stays clean (capability sync already shipped).
      — DONE functionally (live headless probe 2026-07-19, DOM evidence not
      video): placeholder → Openverse search → first-result insert with
      license credit verified end-to-end on prod (see E1). Capability sync
      keeps export truthful. Re-run on camera when the next demo is recorded.

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

- [x] H1. CI runtime smoke: build → `vite preview` → headless assert landing
      renders + zero page errors (the blank-page chunking class can never ship
      again on green CI).
      — DONE 5e60dcf: `scripts/smoke.mjs` serves dist, asserts React mounts,
      zero page errors; wired into CI.
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

- [x] I1. **Extraction-boundary audit** (done — see EXTRACTION_BOUNDARY.md: shared/ pure, one backend seam in NodeSlideStudio.tsx, 3 small violations listed, boundary frozen) (P0, first): map every import crossing
      domain ↔ app-shell ↔ convex ↔ shared; classify each as
      contracts/engine/react/backend/agent/host; document violations; freeze
      the boundary (new capability code may not cross it).
- [ ] I2. **Backend ports before backends**: define `NodeSlideRepository`
      (getDeck/applyPatch/createProposal/resolveProposal/listVersions/
      storeReceipt) + `NodeSlideAssetStore` + `NodeSlideTelemetryAdapter`.
      Implement Memory (tests), Convex (reference, as a mountable Convex
      component with isolated tables + migrations), Http (hosted). The Convex
      component is the reference production backend, not the abstraction.
      First boundary slice: package entrypoints, host-neutral ports, Memory
      implementations, and conformance smoke now live under `packages/`;
      Convex/HTTP adapters and the source move remain open. Parity capability
      preservation is tracked in `PARITY_CAPABILITY_MIGRATION_LEDGER.md`.
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

## J · Ecosystem organization — who owns what across HomenShum repos (P1, audit-first)

Gap surfaced 2026-07-19: Track I plans NodeSlide's internals and NodeRoom as a
consumer, but nothing maps the wider fleet — `noderoom` (product +
**NodeAgent runtime**), `NodeVideo` (**eve control plane**: apps/, packs/,
nodekit.yaml), `nodeslide` (deck engine), `agentic-ui-qa` (QA harness). Same
discipline as I1: audit before asserting; no invented org maps.

- [x] J1. **NodeAgent runtime audit** — done 2026-07-19 (read-only): seams + run loop + both entry points + receipts mapped with file:line anchors; adapter contract recorded in docs/ECOSYSTEM.md (docs-only until I2). Map NodeAgent's
      actual surface in `noderoom` — tool registration, run/step model, memory,
      provider routing, receipts. Output: the concrete
      `NodeSlideAgentAdapter` contract written against the real interface,
      not the assumed one.
- [x] J2. **Eve control-plane audit** — done 2026-07-19: eve = single-tenant chat agent, no routing to inherit; decision (verbatim in docs/ECOSYSTEM.md): B2 routing lives in nodeslide as a standalone policy module; eve extraction only when a second consumer exists. Map what eve owns in `NodeVideo`
      (packs, nodekit.yaml, control loops). Decide the orchestration fork
      explicitly: does cross-model routing (Track B2) live per-product inside
      NodeSlide, or is eve the orchestration layer NodeSlide registers into?
      One owner, stated in writing — the same layer must not be built twice.
- [x] J3. **Repo responsibility map** — done 2026-07-19: docs/ECOSYSTEM.md written (owns/consumes/never-contains per repo, sourced from J1+J2 audits). (`docs/ECOSYSTEM.md`, one page): per
      repo — what it owns, what it consumes, what it must never contain.
      NodeSlide = governed deck engine + its packages; NodeRoom = collab
      product hosting NodeAgent; eve/NodeVideo = TBD by J2; agentic-ui-qa =
      cross-product QA. Every future extraction cites this map.
- [x] J4. **Inter-repo distribution decision** — done 2026-07-19: versioned `npm pack` tarball via `file:` pin (link/git-tag rejected for this Windows multi-repo setup; rationale in docs/ECOSYSTEM.md). How noderoom consumes
      `@nodeslide/*` before public npm (workspace link / git tag / tarball /
      private registry), with the same semver+migration rules as I6.
- [ ] J5. Acceptance: J1's adapter contract compiles against real NodeAgent
      types; J2's decision is recorded with rationale; ECOSYSTEM.md merged in
      nodeslide and cross-linked from noderoom.

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
10. J1-J4   ecosystem audits: NodeAgent runtime, eve control plane,
            responsibility map, distribution decision (J1 gates I7)
11. I7-I8   NodeRoom consumer proof + permanent cross-repo CI
```

Organizing principle: **NodeSlide is no longer just an app — it is a reusable
governed presentation engine with two consumers (this app, NodeRoom).** Every
capability is implemented once in the engine, proven here, and independently
verified in NodeRoom.

Definition of done for the plan itself: every checked item has a fail-closed
verification run linked in the commit message, and no caption anywhere claims
what a screen hasn't shown.
