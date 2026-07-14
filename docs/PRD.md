# NodeSlide Product Requirements Document

**Build Challenge:** AI Fund SlideLang. **Prototype:** [parity-studio.vercel.app/?domain=nodeslide](https://parity-studio.vercel.app/?domain=nodeslide)

**Thesis:** A presentation should be a trustworthy, editable program, not an opaque image returned by a prompt. NodeSlide compiles a prompt into a typed `DeckSnapshot` where every change, human or agent, flows through one validated mutation path.

This is a show-your-work doc. Every claim below cites the code that backs it.

## 1. The deck creator and workflow

What a user does, end to end:

1. **Intake.** The landing composer asks "What presentation should we build?" and takes a prompt plus an optional structured brief (`DeckBrief`: prompt, audience, purpose, successCriteria) and CSV/JSON/TXT uploads. The user picks a model, a reasoning effort, and whether to allow web research inside the composer. Navigator, canvas, inspector, validation, and trace stay hidden until creation starts.
2. **Compile.** NodeSlide plans and compiles a multi-slide `nodeslide.slidelang/v1` deck. The default route is managed Nebius `GLM-5.2` at `high` effort (`NODESLIDE_DEFAULT_AGENT_MODEL`, `NODESLIDE_DEFAULT_REASONING_EFFORT`). A deterministic path needs no API key and produces a reproducible deck.
3. **Edit and review.** The browser editor renders native structured elements: `text`, `shape`, `image`, `chart`, `math`, `video`, `connector` (`ElementKind`). The user edits copy and style directly, or asks the agent in the AI inspector (`AiInspector.tsx`) for a scoped change.
4. **Propose before mutate.** Agent output arrives as a `DeckPatch` in `awaiting_review` (`nodeslideAgent.proposeEdit`), carrying the exact `PatchOperation[]`, model attribution, token and cost usage, a `candidateDigest`, and a `candidateValidation` receipt. The canonical deck does not change until a human accepts.
5. **Validate, publish, present.** Three gates guard present, publish, and export. A clean deck presents in-app, publishes as an immutable share snapshot, or exports to editable HTML and PPTX.

Every failure mode (provider timeout, unavailability, invalid JSON after one repair attempt, exception) converges on a labeled deterministic fallback that is still a reviewable proposal (`nodeslideEditPlanner.ts`, `origin: 'deterministic_fallback'`). No fabricated AI success. No raw error dumped to the user.

## 2. Why structured authoring beats prompt-to-static-slides

Prompt-to-image tools shorten the first draft and throw away the structure professionals need next. A picture cannot be inspected, its chart cannot be rebound to data, a layout defect is hard to repair, and every revision is another full generation.

The `DeckSnapshot` is a typed system, not a bitmap. `deck`, `slides[]`, `elements[]`, and `sources[]` stay connected. Each `SlideElement` carries a stable `id`, normalized geometry (`BoundingBox` in 0..1), type-specific data (`ChartData`, `MathData`, `VideoData`, `ImageData`), style, `sourceIds`, `exportCapabilities`, and a `version` clock. Render targets (browser, HTML, PPTX) are derived, never the source.

That structure buys what an image cannot: direct edit without regeneration, data-bound charts, math preserved as an editable `expression`, element- and slide-scoped AI ops, reviewable diffs and versions (`DeckVersion` stores a full snapshot per version), and immutable public publishing where private `notes` stay private. Editable beats throwaway because the asset survives the next revision.

## 3. What makes the generated deck trustworthy and editable

Trust is a product surface, not a hidden backend step. Six mechanisms, all live in code:

- **Stable IDs and normalized geometry.** Every id is deterministic (`nodeslideStableId`). Every box is validated 0..1 with no overflow (`isNormalizedBoundingBox`). The 13.333 x 7.5 in canvas is fixed, so geometry ports cleanly to PPTX.
- **One mutation path.** Every edit (drag, resize, a Design control, an agent proposal, a repair) reduces to one of 17 typed `PatchOperation` variants. Client preview is local. Acceptance is a server mutation (`commitPatch` in `convex/nodeslide.ts`).
- **CAS on version clocks.** `commitPatch` reruns `validateNodeSlidePatch`, then `evaluateNodeSlideCas` compares `baseDeckVersion` plus per-slide and per-element clocks. A stale write is rejected and marked `stale`. Non-overlapping fine-grained edits rebase onto a newer version. No client optimism.
- **Digest-bound candidates.** The server rebuilds the exact candidate, recomputes `candidateDigest`, and refuses to commit if the digest no longer matches its preflight validation binding, even when the deck itself validates. A delayed agent result cannot overwrite newer human work.
- **Scoped writes and consent.** `PatchScope` limits write authority to a deck, slides, elements, a box, or a comment, with an `OperationMode` (copy, style, layout, unrestricted). Read authority (`AgentReadReference`) is separate from write authority. External egress requires an exact, per-operation consent string (`NODESLIDE_NEBIUS_REVIEW_CONSENT`, `NODESLIDE_WEB_RESEARCH_CONSENT`, and peers). Consent for review is not interchangeable with consent for web research.
- **Provenance and trace receipts.** Web claims attach `SourceRecord` citations with `{url, retrievedAt, citation}`. Uploaded data lands as typed sources (digest, columns, rowCount, byteSize) bound to charts and formulas. The `AgentTrace` records provider, model, effort, input and output tokens, `costMicroUsd`, and a validation seal labeled honestly by run type: countersigned for a live run, provisional for a deterministic one.

## 4. The wedge and the broader platform

Start narrow. One buyer, one pain. The buyer is the operator or analyst who ships recurring, evidence-heavy decks: diligence memos, operating reviews, board and investor material, technical explainers. The pain is that these decks must be defended, and a generated image cannot be defended. Provenance and safe revision matter more than a one-off visual.

From that wedge the same compiler expands: reusable team templates, scheduled data refresh, a first-class deck-JSON source panel, a governed MCP surface so a coding agent inherits the same consent and gates as the UI, and agent-to-agent deck production. The durable asset is an inspectable presentation program that humans and agents evolve together. This is non-hype because the data model already supports it. The missing work is the connector and source-UI layer, not a schema rewrite.

## 5. Validation plan and success metrics

**Three gates** from `validateNodeSlideSnapshot`, computed on the candidate before commit:

| Gate | Blocks | Rule |
|---|---|---|
| `ok` | present | no `error` issues (schema, geometry, missing asset, mismatched chart data) |
| `publishOk` | publish and export | no errors, and no `warning` on source, contrast, font size, export, or on-brand |
| `cleanOk` | "clean" badge | no non-info issues at all |

**Render-repair loop** (`nodeslideRenderRepairLoop.ts`) is bounded and deterministic. It renders, observes, proposes a repair, revalidates, and reapplies through the same CAS and patch validators. Default budget is 4 attempts and 45s. Hard caps are 8 attempts, 120s, 128 ops, 20MB render, with cycle and no-progress detection. It always terminates with a labeled reason. Provider JSON gets exactly one repair attempt (`nodeslideProvider.ts`, two model calls max) before falling back deterministically.

**Targets for the challenge prototype:**

| Metric | Target |
|---|---|
| Seeded prompt runs producing an `ok` deck first try | ≥ 95% |
| Agent mutations gated until human acceptance | 100% |
| Stale or digest-mismatched candidates rejected | 100% |
| Render-repair runs that terminate (clean or labeled stop) | 100%, never unbounded |
| Speaker `notes` leaked into public snapshots | 0 (enforced by `PublishedSlide = Omit<Slide,'notes'>`) |
| Time to first editable deck, deterministic path | < 30s |

**Targets for an early cohort:** edit-accept rate ≥ 70%, validation issues per slide < 1.0, successful repair convergence ≥ 80%, and share of revisions done as scoped edits instead of full regeneration ≥ 60%. North-star: validated, human-approved decks published per active team.

Verification today: 482 Vitest tests across 61 files (including a jsdom interaction test that opens the Radix model picker and asserts every offered model renders), plus `tsc -b` and `vite build` as release gates. Honest gaps: PPTX export is real and labeled "Editable with fallbacks" (math as text, linked-video placeholder). PPTX import extracts design taste, not slides. A user-facing deck-JSON surface is in progress. The data model round-trips all of it.
