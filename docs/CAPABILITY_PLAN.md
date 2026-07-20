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
- [ ] A5. Acceptance: 20 fresh prod generations → 0 collisions, 0 overflows,
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

      Result: 6/20 required live generations passed every gate — 0 geometry
      errors and 0 warnings across those decks, all export-clean (publishOk),
      all exactly 6 slides, and all ≥3 distinct archetypes. One adjacent
      archetype repeat was observed (gen2-deck3); it is not a gate. Fourteen
      generations remain, so the item stays unchecked until the literal N=20
      acceptance is complete.

## B · Agentic depth — a real loop, not a labeled function call (P0/P1)

Original gap: one planner call + one JSON repair, status-label thread steps,
and no decomposition or render-aware self-verification. B1/B2/B4/B5 now close
most of that gap; the literal B3 fleet probe and B6 camera acceptance remain.

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
- [ ] B3. Unblock cheap executors (P1): pin `reasoning:false` for Gemini 3.5
      Flash in the pi-ai catalog override (same disease as Kimi's original bug);
      audit the rest of the fleet with a 1-token probe script.
      — PARTIAL 9d18ab6: generalized OpenRouter overrides pin
      `reasoning:false` for Gemini 3.5 Flash. The required fleet-wide 1-token
      probe is not implemented or run.
- [x] B4. Edit-path tool loop (P1): read → propose → verify-against-render →
      finalize, with real steps in the thread replacing status labels.
      — DONE f041168; LIVE-PROVED on prod 2026-07-19: sample deck, prompt
      "Tighten the headline and body copy." → thread showed Planner (Kimi K3,
      1 op), Verify ("applied candidate to a shadow snapshot — clean"), and
      Validation steps before the Accept/Reject patch. Repair step correctly
      absent (verify was clean — honest, not decorative).
- [x] B5. Variations become a judged fan-out (P2): 3 executor generations + a
      judge pass with tradeoff labels (pairs with A2 for layout-distinct
      directions).
      — DONE in PR #13: the variation harness runs bounded candidates through
      deterministic quality signals plus a separate judge contract, records
      the selected tradeoffs, and keeps dev-only repair outside official
      scoring. Unit and UI tests cover the judged result path.
- [ ] B6. Acceptance: one routed run on camera — two models in one thread turn
      with parent-child spans, tokens, cost; creation self-corrects an induced
      layout issue without human input.
      — PARTIAL (2026-07-20): the routed two-model thread and the tokens/cost
      trace were each live-proved in separate headless probes. The dev-only
      `NODESLIDE_DEV_CREATION_FAULT=drop_requested_chart` path and second-provider
      repair are regression-tested. The required on-camera routed run showing
      spans/tokens/cost plus a real induced repair remains.

## C · Math — typeset it or stop saying LaTeX (P1)

Original gap: the formula element stored a `latex`-tagged string but nothing
typeset it. Browser and PPTX rendering now ship; C4 records the live proof.

- [x] C1. KaTeX render for math elements in the browser canvas (SSR-safe).
      — DONE 5b0faac: real KaTeX typesetting in SlideRenderer with jsdom test
      coverage.
- [x] C2. PPTX export: KaTeX → SVG → raster embed, replacing "math as text";
      capability report updated truthfully (`pptx_static_fallback`).
      — DONE 9141672: rendered-equation raster via injectable raster seam,
      unit-tested; deployed to prod 2026-07-19.
- [x] C3. Expression validation + honest plain-text fallback when parse fails.
      — DONE 5b0faac: parse failures fall back to labeled plain text, never a
      silent blank.
- [x] C4. Acceptance: golden formula typesets in browser; PPTX shows the
      rendered equation; capability claims match the adapter.
      — DONE 2026-07-20: the live golden typeset in-browser and exported as
      `pptx_static_fallback`. The 201,283-byte PPTX (SHA256
      `B1FCFB1A480E30B5D364A3D800694A9C568C46D1E135238A336D5EB90E4C50B6`)
      contained one slide-4 math picture backed by a 998×346 PNG and no
      equation text run; the equation was visibly rendered when opened in
      desktop PowerPoint. Slide-4 XML portable-font proof: Georgia ×3,
      Fraunces ×0.

## D · Charts — from primitive to charting (P1)

Original gap: single-series flat bars only. D1–D5 now cover the expanded chart
model, renderer, governed edit path, native PPTX export, and live acceptance.

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

Original gap: generated decks arrived with empty slots unless a human uploaded
art. Search, BYOK generation, and crop/focal controls now ship; E4's camera
acceptance remains.

- [x] E1. (P1) License-aware image search (Openverse first: no key, CC-licensed,
      credit metadata) behind explicit consent; insert fills alt/credit
      automatically and stays export-truthful.
      — DONE 8c9f6f1 and live-proved on prod 2026-07-19: selected the image
      element on slide 3 of the sample deck, searched "circuit board" (exact
      consent copy shown: query goes to api.openverse.org on click), got 8
      commercially-licensed results, inserted the first; image rendered
      (1024x768, converted to local data URI) and the credit field auto-filled
      "Twechie · BY-SA 2.0 via Openverse".
- [x] E2. (P2) Optional generation via user-keyed provider (BYOK), labeled
      illustrative.
      — DONE in PR #13: session-only BYOK image generation is explicit,
      consented, never persisted, and labels generated assets illustrative.
- [x] E3. (P1) Crop/focal-point + aspect handling in the Design tab.
      — DONE in PR #13: the image inspector exposes crop fit, focal point, and
      aspect controls with renderer and regression coverage.
- [ ] E4. Acceptance: placeholder → search → insert with license credit on
      camera; export stays clean (capability sync already shipped).
      — PARTIAL: a headless live search → insert → credit journey passed on
      production and capability sync keeps export truthful. The literal camera
      acceptance remains.

## F · Evidence & screenshots — prove the lineage (P1)

Original gap: web-research snapshot capture and region-highlighted evidence
were schema-real but never live-verified. F3 is complete; F1/F2/F4 remain.

- [ ] F1. Verify (or finish) snapshot capture on the web-research path; honest
      no-badge state when capture fails.
- [ ] F2. Region highlight on the snapshot bound to the claim.
- [x] F3. Evidence tab: claim → source → element binding made visible/clickable.
      — DONE bbf4aaf; LIVE-PROVED on prod 2026-07-19: Evidence tab lists
      per-source citing elements ("Cited by 8/35 elements"); clicking
      `evidence-citing-element` "Headline · Stories with structure" flipped
      the inspector badge to "Selection · 1".
- [ ] F4. Acceptance: live run showing a web claim whose snapshot region opens
      from the element that cites it.

## G · Thread/UX debt (P2)

- [x] G1. Policy controls → popover; delete the stopgap agentic-CSS block in
      `nodeslideV3.css` (slice-3 leftovers).
      — DONE c69b164: advanced-controls popover (live composer shows the
      "Advanced provider, privacy, scope, and editing controls" trigger on
      prod); stopgap CSS block gone (repo grep clean).
- [ ] G2. Streaming assistant text in AgentThread (reads as alive, not batch).
- [ ] G3. Nested handoff rendering (pairs with B2).
- [x] G4. Creation wait UX: informative staged progress on the landing (what
      the 2–4 min is doing), since Kimi's tail is slow.
      — DONE c69b164; LIVE-PROVED on prod 2026-07-19: real creation from the
      landing showed "The model is drafting the slide plan…" plus a counting
      elapsed timer (0:40 → 0:58 across two DOM reads) while the job ran.

## H · Ops, CI, hygiene (P0-quick)

- [x] H1. CI runtime smoke: build → `vite preview` → headless assert landing
      renders + zero page errors (the blank-page chunking class can never ship
      again on green CI).
      — DONE 5e60dcf: `scripts/smoke.mjs` serves dist, asserts React mounts,
      zero page errors; wired into CI.
- [x] H2. Nightly prod probe: the fail-closed create→edit→export script on a
      schedule; alert on first red.
      — DONE in PR #13: the scheduled workflow runs the bounded production
      probe and uploads its evidence; the same exact-SHA journey also passed
      manually during the PR #13 handoff.
- [ ] H3. Vercel deploys from CI on main push (replace manual prebuilt deploys);
      keep VITE_CONVEX_URL pinned to prod.
      — WORKFLOW DONE in PR #13 and hardened in PR #14. External repository
      configuration remains open: no repository environment, secrets, or
      variables are configured. Required secrets: `CONVEX_DEPLOY_KEY`,
      `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and
      `VERCEL_AUTOMATION_BYPASS_SECRET`; optional diagnostics secret:
      `CONVEX_DIAGNOSTICS_KEY`; required variable:
      `NODESLIDE_PRODUCTION_DEPLOY_ENABLED=true`. Retain a successful exact-SHA
      deploy receipt before checking this item.
- [x] H4. Repo hygiene: retire stale parity worktrees/branches; remove
      `nodeslide-deploy` staging folder; decide parity-studio's demo fate.
      — DONE 2026-07-20: removed emergency deploy staging and temporary
      consumer/proof worktrees, pruned only verified merged or tree-equivalent
      branches, and preserved unrelated dirty/unmerged work for explicit
      triage. The standalone NodeSlide deployment is the canonical live demo;
      parity-studio remains the bounded dev-monorepo behavior mirror.
- [ ] H5. Human: send the Mike draft (video URL now public via the README).

## I · Injectable engine — NodeSlide as a reusable governed presentation system (P0 boundary, P1 packaging)

Corrected after architecture review (2026-07-19): the product is NOT
`<NodeSlideStudio/>` as a mega-component. It is a layered, independently
consumable stack — **portable deck model + governed mutation engine + agent
pack + backend ports + controlled React surfaces + optional source-owned
registry + conformance/consumer tests**. The NodeSlide app is the product
consumer; NodeRoom currently provides package-level packed-consumer and
NodeAgent compatibility proof. A mounted end-to-end NodeRoom product journey
remains I7. Every other track builds against these interfaces from now on —
capability work that crosses the boundary is a regression.

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
- [x] I2. **Backend ports before backends**: define `NodeSlideRepository`
      (getDeck/applyPatch/createProposal/resolveProposal/listVersions/
      storeReceipt) + `NodeSlideAssetStore` + `NodeSlideTelemetryAdapter`.
      Implement Memory (tests), Convex (reference, as a mountable Convex
      component with isolated tables + migrations), Http (hosted). The Convex
      component is the reference production backend, not the abstraction.
      Memory, HTTP, auth-session Convex, and owner-capability Convex adapters,
      governance descriptors, migrations, conformance tests, and packed
      consumer proof now live under `packages/`. Closed 2026-07-20: the
      packaged Convex backend now mounts as a real isolated component with its
      own schema, functions, generated `ComponentApi`, contiguous migrations,
      and one-time host authorization-grant ledger. Its mutations import only
      portable package boundaries, never the application schema, mutation
      functions, or `_generated/api`; `convex-test` proves initialize ->
      propose -> accept -> durable reread plus CAS, validation, grant replay,
      resource binding, and migration failure paths.
- [x] I3. **Controlled React surfaces**: `<NodeSlideStudio/>` /
      `<DeckAgentThread/>` take snapshot/selection/proposal/permissions +
      onPatch/onPropose/onAccept/onReject/onExport — backend-neutral; ship
      `<ConvexNodeSlideStudio deckId/>` as optional convenience binding.
      Split headless (hooks/state) from styled (CSS-variable tokens:
      `--nodeslide-*`); a host can adopt the engine without NodeSlide's
      visual identity. "Scoped Tailwind" alone is not the isolation contract.
      — DONE in PR #13: `@nodeslide/react-headless` owns navigation,
      selection, permissions, repository control, and fail-closed review
      state; `@nodeslide/react` ships the controlled StudioShell, viewer,
      proposal review, and agent thread over opt-in scoped CSS; the Convex
      package and source registry provide the optional binding and presenter.
- [ ] I4. **Auth is host-supplied**: normalize to `NodeSlidePrincipal`
      {userId, organizationId?, roles, permissions}; host adapters resolve it
      from WorkOS/Clerk/Auth0/Convex/Supabase/custom. No auth vendor inside
      the packages. First authorization-spine slice: the backend package now
      runtime-validates an exact bounded principal shape; the reference
      repository requires a constructor-injected host authorizer and binds
      every mutation receipt to opaque policy evidence for the exact action
      and resource. Package-level acceptance is therefore bound to the
      reviewer, deck, and proposal without persisting a bearer credential.
      PR #13 also supplied
      default-deny asset policy plus HTTP, auth-session Convex, and
      owner-capability host adapters. The authorization-spine follow-up binds
      their server-produced receipts to the exact principal, action, resource,
      deck, and opaque policy evidence without serializing credentials. PR #19
      additionally binds production replay to immutable submission, decision,
      receipt, and version coordinates and fails closed on contradictory,
      duplicate, noncanonical, or cross-envelope legacy state. PR #21 also
      rejects an origin replay receipt before any write when its deck version
      differs from the persisted direct or unresolved submission. PR #23
      applies the same fail-closed binding to rejected submissions, which
      preserve the proposal's original submission version.
      The production gap remains: NodeRoom ActorProof/membership authorization
      is not yet the mounted host authorizer.
- [x] I5. **Governance = enforced invariants, configurable UX.** Required and
      non-bypassable server-side: mutation authority checks, version clocks
      (CAS), validation, trace lineage, source authorization, rollback.
      Host-configurable: which operations need human approval (typo fix auto
      → structural deletion approval), Turbo auto-commit, host-supplied
      approval UI, publishing/retention policy. A host cannot bypass
      validation and still claim a valid NodeSlide result — but the engine
      never imposes one UX. Closed 2026-07-20: the Convex package exports a
      literal six-invariant declaration and a fail-closed configuration
      validator. Approval mode, per-operation policy, Turbo, publishing, and
      retention remain host-configurable; tests prove none can disable the
      server invariants.
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
      — IMPLEMENTED SLICE in PR #13: framework/shadcn detection, explicit
      profile/backend/UI selection, exact install plans, versioned registry
      sources, env/conformance output, hashed receipts, validation hooks, and
      diff-only upgrades with migrations. The 2026-07-20 artifact slice adds a
      complete 11-tarball manifest with exact release/version, SHA-256, and npm
      SHA-512 pins; pre-install tamper/mixed/unlisted checks; receipt and
      lockfile proof; strictly advancing upgrades; and a clean local
      v0.1.0 -> v0.2.0 install/upgrade proof with tampered and mixed sets
      rejected. Keep unchecked until the same workflow downloads two public
      GitHub releases after release immutability is enabled and verifies each
      release and asset.
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
      — PARTIAL: NodeRoom v3 proof-contract checkpoint `332149ef` (PR #231)
      consumes packed artifacts, compiles the real NodeAgent adapter, and
      exercises proposal/CAS behavior. Receipt schema v3 names the bounded
      evidence precisely: an in-memory receipt ledger, a same-instance
      in-memory repository reread, and a portable JSON snapshot round-trip. It
      explicitly sets
      `durableReceiptPersistence` and `packageReload` to false and retains false
      flags for every other unproved surface. The real room artifact adapter,
      ActorProof/membership policy, mounted canvas and reload backed by durable
      persistence, presenter/PPTX/reopen, browser/a11y, and Memory/Convex parity
      remain.
- [ ] I8. **Cross-repo CI**: a NodeSlide package regression must fail
      NodeRoom's consumer suite; both CIs run the same smallest journey
      (load → create → render → edit → version++ → export).
      — PARTIAL: bilateral cross-repo CI wiring is merged and green. The
      jobs currently test each repository against the other repository's
      moving `main`; they do not create an atomic immutable-SHA pair. The
      shared proof also does not yet mount/render/export, so the full journey
      in this item remains open.

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
- [x] J5. Acceptance: J1's adapter contract compiles against real NodeAgent
      types; J2's decision is recorded with rationale; ECOSYSTEM.md merged in
      nodeslide and cross-linked from noderoom.
      — DONE across the NodeRoom packed-consumer proof and bilateral CI wiring.

---

## Suggested sequence — remaining literal acceptance

```text
1.  A5          run the remaining 14 production generations
2.  B3          add and run the fleet-wide 1-token probe
3.  B6 / E4     record the literal camera acceptances
4.  F1/F2/F4    finish visual evidence lineage
5.  G2/G3       stream assistant text and render nested handoffs
6.  H3          configure external deployment credentials + exact-SHA receipt
7.  I4/I6       mount production host auth and run the immutable artifact
                proof against two public GitHub releases
8.  I7/I8       mount and prove the full NodeRoom journey and bilateral CI
9.  H5          human sends the Mike draft
```

Organizing principle: **NodeSlide is an app plus a reusable governed
presentation engine.** The app is the product consumer today; NodeRoom proves
package compatibility today and becomes the second product consumer only when
the mounted I7 journey passes. Shared capability belongs in the engine and is
independently verified by the smallest honest consumer proof available.

Definition of done for the plan itself: every checked item has a fail-closed
verification run linked in the commit message, and no caption anywhere claims
what a screen hasn't shown.
