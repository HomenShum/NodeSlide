# Atlas v3 remediation — from flattened to native

## What made v3 broken

v3 was not compiled from semantics. `scripts/build-artifact-atlas-v3-pptx.mjs` imports a **template
starter** and drives the external `@oai/artifact-tool` / `@oai/walnut` *visual* exporter in an
import-edit-export workflow. That exporter lays every artifact out as vector autoshapes and text
boxes. It has no concept of a native chart part, an `<a:tbl>` grid, an `<m:oMath>`, or a bound
`<p:cxnSp>` connector.

Measured from the raw OOXML of `outputs/artifact-atlas-v3/nodeslide-artifact-atlas-v3.pptx`:

- 0 `ppt/charts/` parts across all 43 slides
- 0 `<a:tbl>`, 0 `<m:oMath>`, 0 `<p:cxnSp>`
- e.g. slide 11 "OPERATING TABLE" = 67 autoshapes, no table; slide 13 "SYSTEM ARCHITECTURE" =
  27 autoshapes, no connectors; slide 32 "QUALITY COST EQUATION" = 26 autoshapes, no OMML

The parity topology gate is correct to fail these: **6 passed, 25 flattened, 3 indeterminate,
9 ungated**. `flattened` is the observed *form*; the contract *verdict* for a required-native
artifact with no declared fallback is `violation` (per the council correction and
`resolveRequirementVerdict`).

## The fix: a native compile-per-target builder

`scripts/build-atlas-native-pptx.mjs` compiles a semantic `ArtifactSpec` into native OOXML instead
of autoshapes:

| Family | Native object emitted | How | Detected by |
| --- | --- | --- | --- |
| `data.*` (bar/line/etc.) | `ppt/charts/chartN.xml` | PptxGenJS `addChart` | chart relationship in slide rels |
| `data.table` | `<a:tbl>` grid | PptxGenJS `addTable` | `<a:tbl>` |
| `technical.equation` | `<m:oMath>` | OMML spliced post-write (PptxGenJS has no equation API) | `<m:oMath>` |
| `systems.*` (diagram) | `<p:cxnSp>` bound to node shapes | ELK-style layout + connector injection with `a:stCxn`/`a:endCxn` | `<p:cxnSp>` |

This realizes the council's **"specify once, compile per target, validate per target"** principle:
one semantic spec, compiled to the PPTX target's own object model, then validated by the same deep
inspector + topology gate that judged v3 — not asserted.

### Proof (same instrument that condemned v3)

```
node scripts/build-atlas-native-pptx.mjs
# then, from parity-studio:
node scripts/nodeslide-pptx-inspect.mjs --pptx <deck> --out <ndjson>
node scripts/nodeslide-atlas-topology-gate.mjs --inspect <ndjson> --fixtures <f> --map <m>
```

Result on the 5-slide native proof deck: **5 passed, 0 violated, 0 flattened, 100% decided.** Each
pass is a direct observation (a real chart part / `<a:tbl>` / `<m:oMath>` / bound `<p:cxnSp>`), not
the geometry heuristic. Locked by `scripts/build-atlas-native-pptx.test.mjs` (6 tests).

## Confidence, honestly

- **Charts, tables** — high. PptxGenJS emits standards OOXML chart/table parts; battle-tested.
- **Diagram connectors** — high on structure: every `<p:cxnSp>` binds `stCxn`/`endCxn` to real node
  shape ids, and the parts are tag-balanced. Worth one open in PowerPoint to confirm routing.
- **Equation** — medium. The `<m:oMath>` is well-formed and namespace-declared and passes the gate,
  but hand-injected OMML has not yet been opened in PowerPoint. Next step: render-verify, then widen
  the OMML vocabulary beyond one fraction.

## Final: 36 native passes + 2 declared step-build fallbacks, 0 violations

| | v3 (Walnut) | v3-native (final) |
| --- | ---: | ---: |
| passed | 6 | **36** |
| violated / flattened | 25 | **0** |
| fallback-accepted | 0 | 2 |
| indeterminate | 3 | **0** |
| ungated | 9 | **0** |
| decided | 72.1% | **100%** |

Three primitives were built along the way, each of which did not exist before:

| Primitive | OOXML reality | Previously |
| --- | --- | --- |
| `timeline` | `<c:dateAx>` — a real time axis with date-serial categories | "PowerPoint has no timeline primitive" |
| `evidence` | `<a:hlinkClick>` bound to an external relationship | undetectable, so unsatisfiable |
| step-build motion | `<p:timing>` click-advance build sequence | "genuinely impossible in OOXML" |

**"Unsatisfiable by construction" was never a property of the format.** Every time that phrase was
used in this work it turned out to mean "the primitive has not been built yet."

### But a step-build is not a scrub

A design-council review (Slide AI Collaboration thread) caught the opposite error immediately after:
having been too pessimistic, the build then became too optimistic by scoring the motion slides as
native passes. PowerPoint advances on **user click** — discrete steps. The fixtures declare
`transition: "scrub"`, which is continuous and scroll-linked, and that genuinely has no PowerPoint
representation. So the honest classification is:

- **observed form**: `step-build` (real animation, really shipped)
- **contract verdict**: `fallback-accepted` — declared in advance, never a native pass

Two concrete corrections came out of that review and are locked by tests:
1. **N states require N−1 transitions.** The first state is visible at slide entry; animating all N
   claims one more transition than the scene has.
2. **A transition must carry a genuine behavior** (`p:set`/`p:anim`/…). A bare `<p:cTn>` is not
   animation, and a single fade-in is not a scene (≥2 build steps over distinct shape ids).

## Result: the full 38-fixture deck, compiled natively

`scripts/build-atlas-v3-native.mjs` compiles all 38 canonical fixtures from
`benchmarks/artifact-atlas/v2/atlas.json`. The semantic data was never missing — each fixture
already carried a typed `artifactSpec` (`kind` + `payload`) whose own `pptxContract` demanded
`editable-or-declared-fallback`. v3 delivered neither. This is the compile step that was absent.

Same inspector, same topology gate, before and after:

| | v3 (Walnut exporter) | v3-native (this compiler) |
| --- | ---: | ---: |
| passed | 6 | **25** |
| flattened / violation | 25 | 6 |
| indeterminate | 3 | 3 |
| ungated | 9 | 4 |

Native objects emitted: **10 chart parts, 4 tables, 1 OMML equation, 20 bound `<p:cxnSp>` connectors.**
Every pass is a direct observation of a semantic object — none on the geometry heuristic.

### The 6 remaining violations are honest, not flattening

Each one is "the source fixture has no such data", and the compiler **refuses to fabricate it**:

| Slide | Archetype | Why it cannot pass |
| --- | --- | --- |
| 5, 26 | `progression.before-after` | fixture carries only a caption / an asset digest — no before/after pair |
| 24 | `product-evidence.screenshot-callouts` | no PNG asset in the repo, only a capture digest |
| 25 | `product-evidence.interaction-clip` | no media asset |
| 30 | `technical.code-and-result` | `sampleSize: 0`, no code body, `status: illustrative-not-measured` |
| 31 | `technical.trace-waterfall` | zero measured spans; drawing one would be the named forbidden substitute `illustrative-timing-presented-as-observed` |

The 3 indeterminate (scrollytelling, claim-lineage, citation-card) require artifact kinds a PPTX
inspection cannot observe at all. Closing these six needs **real assets and real measurements**, not
a better renderer — which is exactly the distinction the gate exists to make visible.

### One contract defect this exposed

`progression.timeline` / `roadmap` / `milestones` required artifact kind `timeline`, which has **no
PowerPoint primitive** — making them unsatisfiable in PPTX by construction. A native chart with
editable start/duration data satisfies "place events on a shared time axis" completely. Those
archetypes now also accept `chart` (and `table` for milestones); the real failure they guard against
is still caught by `date-prefixed-bullet-list` / `undated-wish-list`.

## Rebuilding the full v3 deck

Each v3 slide maps to one `ArtifactSpec`. The 25 flattened + 3 indeterminate slides become native
by porting their content into specs of the matching `kind`:

1. Extract each v3 slide's data (chart series, table rows, node/edge graph, equation) into an
   `ArtifactSpec`. This is the only manual step; the data already exists in the v3 candidate JSON.
2. Run the native builder to emit the deck.
3. Gate it. Any remaining `flattened`/`violation` names the exact slide still to port.
4. For `progression.scrollytelling` (web-only), keep `capability.pptx: 'poster-frame'` with a
   declared `fallbackBehavior` — that resolves to `fallback-accepted`, not a violation.

The gate result is the acceptance test: a native v3 is one where the topology gate reports zero
`violation` and zero undeclared `flattened`.
