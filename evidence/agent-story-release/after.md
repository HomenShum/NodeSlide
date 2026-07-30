# After — finished agent creation and cinematic proof

Captured: 2026-07-30
Branch: `codex/agent-story-release`

## Production transaction

The standalone CLI called the production Convex action with explicit hosted
model consent and low structured-generation effort. It completed without a
deterministic fallback, published the immutable snapshot, and wrote all four
delivery artifacts:

```text
execution: hosted
slides: 7
PPTX: written
standalone HTML: written
canonical snapshot: written
receipt: written
public share: HTTP 200
```

The first high-effort Kimi and Claude attempts returned invalid JSON. The CLI
refused both fallbacks. The low-effort Kimi run completed as real hosted
authorship; this is why CLI and MCP now default full-deck structured generation
to low effort while leaving `--effort` available.

## Five-dimensional story proof

| Scene | Beat / intensity | Composition | Continuity / metaphor |
| --- | --- | --- | --- |
| 1 | orient / 24 | statement | threshold line begins at 0.1171 width |
| 2 | tension / 39 | stat-dominant | plausible output reaches the unguarded gate |
| 3 | hint / 54 | split + editable formula | the gate becomes a computable condition |
| 4 | reveal / 70 | diagram-dominant | typed pipeline reveals controlled passage |
| 5 | prove / 85 | chart-dominant | inspectable risk supplies the proof beat |
| 6 | climax / 100 | media-dominant | guarded threshold opens at peak intensity |
| 7 | release / 76 | stat-dominant | one owned decision closes the passage |

The seven scenes use six distinct composition families. The same locked
threshold-line motif appears on every slide and grows monotonically:

```text
0.1171 → 0.2343 → 0.3514 → 0.4686 → 0.5857 → 0.7029 → 0.8200
```

## Visual and live verification

```text
PPTX slides rendered: 7 / 7
PPTX overflow test: pass
Montage inspection: no internal text collisions
Raw public HTML: HTTP 200, 7 <section> nodes, title + first/last scene present
Chrome live DOM: 7 slide regions, formula, editable diagram, chart, decision
```

Evidence files:

- `production-run-final/The-Trust-Threshold-Production-Proof.pptx`
- `production-run-final/The-Trust-Threshold-Production-Proof.html`
- `production-run-final/The-Trust-Threshold-Production-Proof.nodeslide.json`
- `production-run-final/The-Trust-Threshold-Production-Proof.receipt.json`
- `production-run-final/montage.png`
- `production-run-final/rendered/slide-1.png` through `slide-7.png`

## Knockout chain

The release was held each time a real gate failed:

1. Old CLI could not execute its own bundle and had no generation command.
2. Hosted malformed JSON became an explicit nonzero CLI failure, not a false
   success.
3. The first production share returned HTTP 500 because publication removed
   evidence required by chart compilation.
4. Retaining arbitrary private sources would have violated the existing
   projection privacy test; only an exact redacted provenance stub passes.
5. The first PPTX montage exposed internal collisions despite a passing
   overflow check; point-to-pixel measurement and visual-layout typography
   fixed the actual exported geometry.

The final run passed all of those gates without relaxing fallback, privacy,
artifact-compilation, or publication rules.
