# NodeSlide Technical Design Document

**Schema:** `nodeslide.slidelang/v1` (`shared/nodeslide.ts`, `NODESLIDE_SCHEMA_VERSION`)
**Toolchain:** `local-slidelang-adapter/1.1.0` (`NODESLIDE_TOOLCHAIN_VERSION`)
**Runtime:** React + TypeScript + Vite front end, Convex backend, PptxGenJS export, `@earendil-works/pi-ai` provider layer, governed MCP server (`mcp/`).

NodeSlide is a domain inside Parity Studio. Convex owns authoritative state. The React editor is an optimistic projection that always reconciles with a server receipt. One canonical snapshot feeds the renderer, the validators, present mode, the publisher, and both compilers.

```text
prompt / brief ─▶ AI planner (pi-ai route or deterministic) ─▶ scoped proposal
                                                                     │
DeckSnapshot (Convex canonical + version clocks) ◀── acceptPatch ◀── validate + CAS gate
        │                                                                     ▲
        └─▶ browser editor ─ EditOp[] ─▶ applyDeckPatch ─ candidate ─────────┘
        │
        └─▶ present · publish · HTML · PPTX · JSON
```

## 1. Deck spec schema and compiler

`DeckSnapshot { deck, slides, elements, sources }` is the canonical shape (`shared/nodeslide.ts`). It is mirrored by Convex validators in `convex/lib/nodeslideValidators.ts` and normalized tables in `convex/schema.ts`, so the same object crosses the wire, the database, and both compilers unchanged.

`SlideElement` carries `id`, `slideId`, `name`, `kind`, `bbox`, `rotation`, `content`, `style`, and kind payloads `chart` / `math` / `video` / `image` plus `imageUrl` / `altText`, `sourceIds`, `locked`, `visible`, `groupId`, `exportCapabilities`, and a per-element `version`. `ElementKind` is `text | shape | image | chart | math | video | connector`. `BoundingBox` is normalized `0..1`, so one spec maps to the browser and to 16:9 PowerPoint coordinates (`SLIDE_WIDTH_IN = 13.333`, `SLIDE_HEIGHT_IN = 7.5`). "Compile" is deterministic projection, not a rebuild. `src/domains/nodeslide/slidelang/` holds `buildPptx`, the HTML compiler (`html.ts`), and `capabilities.ts`.

## 2. AI planning: prompt to deck spec

Two entry points. `nodeslideAgent:createDeckFromBrief` turns a `DeckBrief` into a full deck. `nodeslideAgent:proposeEdit` turns an instruction plus scope into one proposal. Both route through `callNodeSlideFreeJson` in `convex/lib/nodeslideProvider.ts`, built on `@earendil-works/pi-ai`. The default route is managed Nebius (`zai-org/GLM-5.2`, `baseUrl https://api.tokenfactory.nebius.com/v1`). `NODESLIDE_AGENT_MODELS` also exposes an OpenRouter fleet (GLM 5.2, Claude Sonnet 5, Claude Fable 5, Gemini 3.5 Flash, Gemini 3.1 Pro, GPT-5.6 Sol and Terra). The deterministic fallback needs no egress.

`planNodeSlideEdit` (`nodeslideEditPlanner.ts`) assembles read context with `resolveNodeSlideReadContext` (`nodeslideReadContext.ts`), builds a bounded provider input via `buildNodeSlideEditProviderInput`, and requests JSON against a per-request `scopedEditResponseSchema`. Model output is untrusted. `operationsUseOnlyAuthorizedSources` rejects any operation that binds copy to a source outside read scope. Origin is recorded as `free_route` or `deterministic_fallback`. Every failure mode (invalid JSON, timeout, network, exception) converges on the same labeled deterministic proposal. It is caught at the provider boundary, so a raw Convex error never surfaces.

## 3. Browser editor state and mutation protocol

Human edits and agent edits share one write path: `EditOp[] → applyDeckPatch` (`shared/nodeslidePatch.ts`). The `PatchOperation` union is `move`, `resize`, `replace_text`, `update_style`, `update_chart`, `update_image`, `add_element`, `remove_element`, `set_visibility_v1`, `group_elements_v1`, `ungroup_elements_v1`, `reorder_element_v1`, `add_slide`, `remove_slide`, `reorder_slide`, `update_slide`, `update_deck`.

CAS is enforced twice. `applyDeckPatch` throws when `baseDeckVersion !== snapshot.deck.version`. `validatePatchScope` enforces the scope kind and `OperationMode` (`copy`, `style`, `layout`, `unrestricted`) before any mutation runs. `DeckPatch` also carries fine-grained `baseSlideVersions` and `baseElementVersions` clocks so non-overlapping work rebases safely. Geometry is clamped by `normalizeBox`. The client previews a candidate locally, but acceptance is the server mutation `nodeslide:acceptPatch`, which rebuilds the candidate, revalidates, recomputes `candidateDigest`, and compares clocks. Inspector tabs (AI, JSON deck-as-code, Design, Data, Comments, Versions, Trace) all emit the same operations.

## 4. Validation and repair

`validateNodeSlideSnapshot` (`nodeslideValidation.ts`) returns three independent gates on one `ValidationResult`:

- **`ok`**. No `error` issues. Schema, referential integrity, bounds, chart or math data present, safe media URLs.
- **`publishOk`**. `ok` and no warning of code `source`, `missing_asset`, `export`, `contrast`, `font_size`, or `on_brand_*`. This is the publish gate.
- **`cleanOk`**. No issue above `info`. The strictest bar.

Present, publish, and export block on the matching receipt. The render-repair loop `runNodeSlideRenderRepairLoop` (`nodeslideRenderRepairLoop.ts`) drives `validate → render → observe → proposeRepair` on cloned snapshots with no persistence. It converges by cycle detection on a version-stripped `semanticSnapshotDigest` and a no-progress counter, and terminates deterministically on any budget: attempts, wall time, operations, render bytes, observation bytes. Every repair proposal passes `evaluateNodeSlideCas` and `validateNodeSlidePatch` before it applies in memory.

## 5. Chart, math, and image primitives

Each kind renders in the browser (`SlideRenderer.tsx`) and exports through `buildPptx` (`slidelang/pptx.ts`). Charts are structured `ChartData` (`bar | line | area | donut`), rendered as native SVG in the DOM and as an editable object via `pptxSlide.addChart`. Math keeps a machine `expression` plus `display`, `syntax` (`plain | latex`), and typed `variables`. It renders from the preserved expression and exports as editable PowerPoint text (`element.math.display ?? expression`). It does not claim to build an Office equation object. Images use `imageUrl` + `altText`, and `ImageData.placeholder` models a missing licensed asset as an honest, editable replace-image object rather than a broken render. Edits are always the typed operations `update_chart` and `update_image`, never freeform mutation.

## 6. Hosted API

Convex is the hosted API. Queries include `getWorkspace`, `listDecks`, `getPresenterSnapshot`, `getEditorCapabilities`, and the telemetry readers. Mutations include `proposePatch`, `acceptPatch`, `rejectPatch`, `attachDataSource`, `publishDeck`, `revokePublication`, and `restoreVersion`. Actions in `nodeslideAgent.ts` (`proposeEdit`, `proposeExternalAgentEdit`, `createDeckFromBrief`) own model egress. Every deck function is owner-gated by a per-deck `ownerAccessKey` capability (`nodeslideAccess.ts`), never returned in a payload. Durable agent runs (`beginAgentRunInternal`, `advanceAgentRunInternal`, `recoverStaleAgentRunsInternal`) give server-persisted progress, idempotency keys, leases, and reload recovery.

## 7. Publishing and present

`publishDeck` writes an immutable versioned `PublishedDeckSnapshot` plus a `shareSlug`. `NodeSlidePublication` moves `active → superseded → revoked`. `getPresenterSnapshot` and the public read return the narrow published types only. `PublishedSlide` omits `notes`, and `PublishedSourceRecord` keeps only `url` citations, so speaker notes, owner key, traces, and internal sources never cross the publish boundary. Export runs client-side: `downloadPptx`, `downloadDeckHtml`, `downloadDeckJson`. `capabilityWarnings` and `ExportCapability` flags (`web_native`, `pptx_editable`, `pptx_static_fallback`, `web_only`) expose target differences instead of failing silently.

## 8. CLI and plugin integration (MCP)

`mcp/src/lib/nodeslideTools.ts` exposes `get_deck`, `list_slides`, `get_trace`, `list_versions`, `propose_edit`, `accept_proposal`, `reject_proposal`, `upload_source`, `search_web`, `create_deck`, and `byok_status`. A coding agent (Claude Code, Codex, Cursor) drives NodeSlide through these tools. Governance parity is the invariant: every MCP write calls the same governed Convex actions, so it inherits the UI's consent, write-scope, proposal-before-mutate, and receipt gates. `unappliedProposalReceipt` throws if `propose_edit` ever returns an applied deck. `execution=byok` plans locally with a user key (`byok.ts`, `requireLocalKeys`). Keys stay in the MCP process, are never uploaded, and consent gates egress independently of key presence.

## Failure modes and agentic-reliability posture

The 8-point checklist is enforced. **BOUND**. `NODESLIDE_PATCH_OPERATION_LIMIT`, scope caps, and render-repair byte and attempt ceilings bound every collection. **HONEST_STATUS**. Provider failure becomes a disclosed fallback, and the MCP receipt refuses to claim a fake apply. **HONEST_SCORES**. Validation gates are real checks with no score floors. **TIMEOUT**. A 30s `AbortController` deadline races every completion. **SSRF and safe media**. URL safety is validated before fetch and before render. **BOUND_READ**. `MAX_RESPONSE_BYTES = 200_000` caps model output, and observation bytes are capped in the loop. **ERROR_BOUNDARY**. Provider and adapter exceptions are caught and converge on labeled outcomes. **DETERMINISTIC**. CAS digests use sorted-key `stableSerialize` and `canonicalValue`, so the same candidate always hashes the same.

Expected failures are visible. Model unavailability disclosed as fallback. Invalid candidates cannot be accepted. Stale work cannot overwrite newer state. Missing or unsafe media blocks readiness. Unsupported export behavior degrades to a labeled fallback. The Trace inspector surfaces provider, model, plan, operations, validation, digests, and token or cost usage for review. Vitest covers schema coercion, planner attribution, the one-repair fallback, acceptance gating, publishing privacy, and MCP consent parity.

## Reuse disclosure

Reused from Parity Studio: the React / Vite / Convex shell, deploy setup, design tokens, and provider plumbing. Orchestration patterns adapted from my NodeRoom / NodeAgent work. Third-party: React, Convex, PptxGenJS, `@earendil-works/pi-ai`, Zod, Vitest. I built the NodeSlide schema, patch protocol, planners, validation and repair pipeline, editor workflow, exports, publishing boundary, trace receipts, and the governed MCP server.
