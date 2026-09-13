# Production scenario proof — 2026-07-31

## Verdict

The production acceptance pack and the 12-slide reference presentation are
complete. NodeSlide's hosted CLI path is **not production-ready for this case**:
generation completed, but the resulting deck failed composition diversity and
publish validation, so the transactional CLI correctly wrote no public output.

## Reference target

- `reference-deck/NodeSlide-From-Signal-to-Defensible-Decision.pptx`
- `reference-deck/NodeSlide-reference-montage.png`
- `reference-deck/NodeSlide-PPTX-render-montage.png`
- `reference-deck/repro/` — source, generated hero asset, design notes, and replay instructions

The reference deck contains 12 slides and uses a transforming signal-to-decision
metaphor. Every slide was inspected individually. The exported PPTX passed the
overflow test and was re-rendered independently; one clipped final-card line was
found during pixel inspection and repaired before the final export.

## Hosted NodeSlide result

The production action completed after 272 seconds. Production logs then recorded:

- slides 5 and 6 near-duplicate at similarity `0.90`;
- no alternate composition available;
- `publishDeck` refused the current version because publish validation had not passed.

That public attempt is preserved under `live-nodeslide-deck/`. A second,
deliberately private `--no-publish` run preserved the generated artifacts for
inspection under `live-nodeslide-private-export/`.

Pixel inspection of the private export found additional contract failures:

- 8 slides were produced from an exact 12-slide brief;
- the five domain scenarios were collapsed into one generic slide;
- the deck used repeated editorial columns and rounded panels instead of an
  evolving signal-to-decision metaphor;
- slide 5 contained a visible body-copy overlap even though the mechanical
  overflow script passed;
- slide 7 invented a weighted readiness formula not supplied by a source.

The private artifacts prove the diagnosis. They do not count as production
completion because no public share exists and the brief was not satisfied.

## Root cause

The provider result reaches materialization without an enforced structural brief
contract for slide count, domain obligations, or source-bound claims. The
diversity gate can detect a near-duplicate, but this run had no alternate grammar
to repair it. Publish correctly fails closed, but only after the expensive hosted
generation has completed.

## Next implementation slice

1. Parse exact structural constraints from the brief into the authored StorySpec.
2. Reject or repair provider plans that violate slide count, required scenario jobs,
   source truth, and visual-metaphor transitions before materialization.
3. Require a bounded alternate grammar whenever the diversity gate fails.
4. Add pixel/semantic overlap detection because canvas-bound overflow alone missed slide 5.
5. Emit a sanitized failed-generation receipt naming the blocking slides and gates,
   while preserving the current no-publish/no-final-artifacts transaction rule.
6. Re-run all five held-out scenarios; production passes only when every job writes
   PPTX, HTML, canonical snapshot, receipt, and its intended distribution target.
