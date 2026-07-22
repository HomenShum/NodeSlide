# Production artifact boundary

Status: the canonical 16-kind pre-geometry boundary and compiler registry are
implemented. The downstream production projection remains deliberately
separate because it describes materialized SlideLang output, not model intent.

## Contract inventory

| Contract | Version | Kinds | Owner | Role |
| --- | --- | ---: | --- | --- |
| Canonical authored ArtifactSpec | `nodeslide.artifact-spec/v1` | 16 | `shared/nodeslideArtifactRegistry.js` + `.d.ts` | Shared runtime discriminated union, issue catalog, JSON-schema slices, and compiler/fallback registry used by Atlas, NodeGym, Convex, and the provider path. |
| Checked-in external schema | `nodeslide.artifact-spec/v1` | 16 | `shared/nodeslideArtifactSpec.schema.json` | Tool-facing JSON Schema. Runtime validation remains authoritative for arithmetic and reference constraints. |
| Legacy provider adapter | `nodeslide.production-authored-artifact/v1` | 4 legacy shapes | `convex/lib/nodeslideAuthoredArtifact.ts` | Read compatibility for chart, graph, equation, and metric JSON produced before the canonical contract. It normalizes immediately to the canonical version. |
| Persisted authored binding | `nodeslide.authored-artifact-binding/v1` | 16 | `shared/nodeslideArtifactSpec.ts` | Digest-bound identity, narrative job, claims, resolved source IDs, truth state, rationale, and declared fidelity attached to materialized primary elements. |
| Downstream snapshot projection | `nodeslide.production-artifact-spec/v1` | 8 projection kinds | `shared/nodeslideArtifactSpec.ts` | Regenerated description of already-materialized elements for validation and export gating. It is not presented as authored intent. |
| Persisted graph binding | `nodeslide.production-artifact-binding/v1` | 2 roles | `shared/nodeslideArtifactSpec.ts` | Retains graph node/edge identity and endpoints. Canonical graphs reuse the authored artifact ID. |
| Projection receipt | `nodeslide.production-artifact-compilation-receipt/v1` | n/a | `shared/nodeslideArtifactSpec.ts` | Digest-bound proof that the materialized snapshot passed or failed. |
| Read-only shadow receipt | `nodeslide.artifact-shadow-receipt/v1` | n/a | `shared/nodeslideArtifactSpec.ts` | Authenticated, anonymized proof of projection status plus canonical binding counts, kind counts, and a content-free preserved-intent digest. |

The 16 canonical kinds are `generic`, `chart`, `waterfall`, `sankey`, `graph`,
`causal-loop`, `timeline`, `gantt`, `evidence-media`, `motion`, `comparison`,
`equation`, `runtime-proof`, `trace`, `risk-matrix`, and `spatial-scene`.

## Production flow

```text
task brief
  -> choose only the relevant ArtifactSpec kind slice
  -> provider authors nodeslide.artifact-spec/v1 before geometry
  -> shared fail-closed validation + exact sourceRef inventory binding
  -> deterministic native primitive, semantic adapter, or declared fallback
  -> persist normalized spec + v2 adapter receipt in the creation record
  -> bind authored identity/provenance/claims/sources/digest to primary elements
  -> materialize deterministic SlideLang geometry
  -> regenerate the distinct eight-kind production projection
  -> browser / HTML / editable-or-declared-fallback PPTX
```

The provider receives six core kinds by default and only the advanced kinds
named by the task. This keeps small-model schemas bounded while making all 16
families reachable. Models author semantic values, not absolute geometry.

Every canonical spec requires `id`, `kind`, `narrativeJob`, `claimIds`,
`sourceIds`, `provenance`, and `payload`. `sourceIds` and
`provenance.sourceRefs` must match exactly. Production additionally resolves
every reference against the server-owned brief, success-criteria, attachment,
and linked-URL inventory. Unknown versions, kinds, truth states, refs, or
payload shapes fail closed with a stable issue code, JSONPath, and bounded
repair operation.

The authored binding prevents post-materialization reconstruction from erasing
intent. In particular, downstream graph identity is no longer regenerated and
authored truth/rationale take precedence over the legacy source-keyword
classifier. Keyword inference remains only for decks that genuinely predate
canonical authored bindings.

## Compiler fidelity policy

The registry does not claim native geometry where NodeSlide has no native
primitive. `chart`, `graph`, and `equation` use their existing primitives.
Waterfall, Sankey, causal loop, timeline, Gantt, comparison, trace, motion, and
spatial scene use deterministic semantic adapters or declared static
keyframes. Evidence without a renderable URL becomes an explicit placeholder.
Runtime proof and risk matrix use explicit summaries rather than invented
samples or 2-D coordinates. Each receipt carries `mode`, `editability`, browser
and PowerPoint contracts, and `knownFidelityDifferences`.

This distinction is intentional: an editable fallback is not the same as a
native visual grammar, and a static fallback is never labeled editable.

## Version and migration policy

- New provider schemas emit only `nodeslide.artifact-spec/v1`.
- The legacy four-shape version is accepted only by the explicit read adapter,
  immediately normalized, and recorded in `acceptedSpecVersion`.
- Legacy arithmetic is parsed by a bounded expression parser; provider text is
  never evaluated as code. An unparseable expression fails semantic validation.
- Unknown spec or binding versions fail closed. No implicit cross-version
  coercion exists.
- Public element validators accept only current graph and authored bindings.
  The short-lived development graph binding remains storage-read compatible
  and migrates to the production namespace.
- The downstream `nodeslide.production-artifact-spec/v1` is not accepted as
  authored input and must never be relabeled `nodeslide.artifact-spec/v1`.

## Verified coverage and explicit residuals

Focused tests cover all 16 positive canonical fixtures, stable negative and
adversarial issue paths, legacy chart/graph/equation/metric compatibility,
unknown version/kind/truth/ref rejection, authored-binding tamper detection,
graph identity and provenance preservation, Atlas reuse of the shared runtime,
and canonical browser/PPTX export.

The architecture gate is closed. The following are quality-depth follow-ups,
not hidden claims of native support:

- Native proportional Waterfall, Sankey, Gantt, risk-matrix, trace-timing, and
  spatial layout primitives do not yet exist; their declared fallbacks are the
  shipped behavior.
- The v1 family payloads do not yet encode every optional research-grade field
  listed in the long-range goal (for example uncertainty bands, crossing
  minimization, or risk thresholds). Adding one requires a versioned schema
  extension and validator fixture.
- Full visual pixel inspection and human blind preference remain external
  evidence gates; unit tests and file existence do not satisfy them.
