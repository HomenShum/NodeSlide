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
