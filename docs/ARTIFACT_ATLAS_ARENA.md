# NodeSlide Artifact Atlas, Model Arena, and Ultra Showcase

NodeSlide separates visual-vocabulary proof from full-deck generation:

1. **Artifact Atlas** defines the artifact, narrative job, evidence, references, editability, and fallback contract for one slide.
2. **Model Arena** gives the same artifact contract, evidence, references, and budget to representative models and a deterministic baseline.
3. **Ultra Showcase** may later curate only winning, human-reviewed, export-safe Atlas artifacts. It is not a one-shot model output.

## Artifact Atlas V2 — expanded capability museum

V2 turns the baseline into a reusable visual system and benchmark surface:

- **38 canonical artifacts** across narrative foundations, advanced data, systems, progression, product/media, evidence/technical proof, and decision/evaluation.
- **14-slide public showcase** selected from the same recipes, not redrawn in a separate pipeline.
- **7 design languages**, plus a controlled 12-render theme matrix covering four artifact types in three themes.
- **6 evidence-backed domain packs**: founder roadshow, research talk, board/operating review, technical architecture review, investment/finance, and product launch.
- **4 motion-aware artifact contracts** with explicit web, PowerPoint, PDF, and reduced-motion behavior.
- **38 reusable recipes** with required inputs, supported tools, references, rules, exports, source lineage, accessibility, and per-artifact receipts.
- Real NodeSlide screenshots, a real before/after repair journey, a bounded interaction sequence, and a commissioned rights-clearable editorial image.

The comparison layer stays honest. Claude, Kimi, and Gemma use the frozen Arena receipts; Nemotron and GPT-OSS are identified as bounded free-router pilots with their semantic caveats; the deterministic builder remains a control; and the best-routed ensemble remains **not run**. Human preference is still pending and is never inferred from Deck CI.

Artifact Lab now loads the V2 catalog and exposes four workflow actions per artifact: use the slide, use the recipe, generate with user data, and generate three variants. Its expandable receipt shows the recipe, harness, builder, Deck CI state, PowerPoint fallback, known fidelity difference, and human-preference state.

### V2 outputs

- `outputs/artifact-atlas-v2/nodeslide-artifact-atlas-v2.pptx` — 38-slide internal museum.
- `outputs/artifact-atlas-v2/nodeslide-ultra-showcase-v2.pptx` — 14-slide public narrative.
- `public/artifact-atlas-v2/catalog.json` — product-facing catalog and verified receipts.
- `artifacts/deck-gym/artifact-atlas-v2/` — recipes, theme matrix, domain packs, route comparison, harness comparison, and receipt ledger.
- `benchmarks/artifact-atlas/v2/atlas.json` — frozen V2 benchmark definition.

### V2 commands

```powershell
npm run artifact-atlas:v2
npm run artifact-atlas:v2:test

# After rendering both PPTX files and completing visual inspection:
npm run artifact-atlas:v2:finalize
```

The finalizer fails closed unless both PowerPoint files and all 38 rendered Atlas screenshots exist. It then records the observed browser render, PowerPoint render, overflow gate, visual inspection, and known fidelity differences while leaving human preference pending.

## Artifact Atlas v1

The first milestone freezes twelve slide-level fixtures across all eight Atlas categories:

| Category | Fixtures |
|---|---|
| Narrative | Hero thesis |
| Data | KPI strip, multi-series chart, uncertainty range |
| Systems | Architecture diagram, sequence diagram |
| Time | Research timeline |
| Product proof | Screenshot with callouts |
| Evidence | Claim-to-source lineage |
| Technical | KaTeX equation, code plus runtime proof |
| Decisions | Risk matrix |

The source of truth is `benchmarks/artifact-atlas/v1/atlas.json`. The final evidence ledger is `artifacts/deck-gym/artifact-atlas-v1/receipts.json`.

## Bounded Arena v1

The first matrix is intentionally small:

```text
12 fixtures × 3 representative models × 2 directions = 72 model candidates
12 fixtures × 1 deterministic baseline                = 12 control candidates
                                                         --
                                                         84 total
```

The representative cohort is Kimi K3, Claude Sonnet 5, and zero-cost Gemma 4 26B. Model roles are explicitly provisional until repeated receipts earn a specialization. The deterministic builder is a control, not an ensemble model.

Every candidate for a fixture shares the same:

- evidence and source digest;
- references and reference digest;
- artifact contract and requirement digest;
- per-candidate budget and budget digest.

Only the model and design direction vary. Promotion remains blind-review, human-review, and `autoApply: false` gated.

## Arena v1 result

- All **84/84 candidate plans** passed the bounded structured-output gate: 72 live plans and 12 deterministic controls.
- The final browser/PPTX critic ledger contains **82/84 eligible artifacts**. Every fixture has at least five eligible candidates and therefore a usable Gallery exemplar.
- Both remaining failures are retained rather than repaired around: one Gemma screenshot plan duplicated the numbered-callout operation and omitted the required missing-evidence label; one Kimi screenshot plan emitted the fixture's forbidden `real screenshot` phrase.
- Every eligible receipt has a browser PNG, a rendered PowerPoint PNG, a native or grouped-editable PPTX, visible claim evidence, source binding, and export validation.
- The browser equation uses real KaTeX MathML. Its PowerPoint fallback is editable Cambria Math text and is explicitly recorded as a web/PPTX difference.

The first full critic run exposed three harness defects that are now regression knowledge: a forbidden-phrase matcher confused target comparisons with `on target`, invisible planning operations had been allowed to count as visible evidence, and code/runtime slides needed a distinct divider primitive to pass the visual gate. The repaired harness requires the full forbidden phrase, recognizes explicitly rejected unsupported claims, and counts only rendered text toward claim coverage.

## Artifact receipt

`shared/nodeslideArtifactAtlas.ts` defines `ArtifactShowcaseReceipt`. A generated artifact fails closed unless it has:

- the required artifact type, not a substitute such as a bar chart for a risk matrix;
- allowed-claim and forbidden-claim checks;
- browser and PowerPoint renders plus the PowerPoint file;
- declared web and PowerPoint editability;
- source and reference digests;
- model, role, tools, time, tokens, cost, and repair count;
- a recorded web-versus-PowerPoint difference when a fallback is used.

An eligible receipt can feed three future UI projections without changing the underlying truth:

- **Artifact Gallery** groups passing receipts by artifact and exposes “Use this pattern.”
- **Model Compare** shows the same fixture across model candidates and the deterministic control.
- **Harness Compare** pairs the same model, artifact, and direction across harness versions so system improvements are not credited to the model.

## Commands

```powershell
npm run artifact-atlas:validate
npm run artifact-atlas:matrix
npm run artifact-arena:plan
npm run artifact-arena:render
npm run artifact-arena:capabilities
npm run artifact-arena:curate
npm run artifact-arena:tournament
npm run artifact-atlas:gallery -- --receipts artifacts/deck-gym/artifact-atlas-v1/receipts.json

node scripts/artifact-atlas.mjs model-compare --fixture risk-matrix --receipts <receipts.jsonl>
node scripts/artifact-atlas.mjs harness-compare --previous <v1.jsonl> --current <v2.jsonl>
```

## Product and Showcase state

NodeSlide now exposes **Artifact Gallery**, **Model Compare**, and **Harness Compare** from the landing screen. Model Compare can switch among browser output, rendered PowerPoint, source-bound operations, and measured economics. Harness Compare truthfully reports that v1 has no paired predecessor.

`outputs/ultra-showcase-rc1/nodeslide-ultra-showcase-rc1.pptx` is the first twelve-slide showcase release candidate, composed only from eligible provisional exemplars. It is not labeled public-approved: `tournament.json` contains model-blind brackets with human preference still pending. The curation receipt therefore keeps `publicReleaseApproved: false`; no machine ranking is misrepresented as human taste.
