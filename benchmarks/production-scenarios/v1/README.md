# NodeSlide production scenarios v1

This pack is the end-to-end release contract for five recurring deck jobs:
research, finance, startup, operating, and governance. It complements Deck Gym's
artifact experiments and UXBench's agent-operation corpus by asking whether a
real user can finish the complete presentation job.

## Release rule

A scenario passes only when all of these are true together:

1. The generated deck follows the brief, including the requested slide count.
2. Claims, values, units, assumptions, and uncertainty obey the scenario's truth rules.
3. The narrative advances through the declared beats and resolves the opening tension.
4. The visual metaphor visibly changes state instead of repeating decorative chrome.
5. At least four silhouettes are materially distinct and adjacent similarity is at most `0.82`.
6. PPTX, HTML, canonical snapshot, and receipt all complete.
7. The selected distribution path completes and the receipt binds the final artifact.

Missing sources, invented numbers, unresolved placeholders, slide-count drift,
failed diversity, and incomplete export fail closed. A green UI badge is not a
substitute for these observations.

## Validate the pack

```bash
npm run production-scenarios:validate
npx vitest run scripts/tests/production-scenarios.test.mjs
```

The second test is a knockout check: it removes the diversity failure and the
governance release gate, then requires validation to turn red.

## Run a live case

Build the CLI, pass the selected scenario's `brief` as the prompt, and retain the
four delivery files plus the published URL as evidence:

```bash
npm run build --workspace @nodeslide/cli
npm run nodeslide:generate -- \
  --title "<scenario title>" \
  --prompt "<scenario brief>" \
  --output "<evidence directory>"
```

Do not pass `--allow-fallback` for a production-quality run. A hosted provider
failure is a failed scenario, not permission to substitute generic content.

## Evaluation matrix

| Domain | User job | Truth boundary | Required visual argument |
| --- | --- | --- | --- |
| Research | Evidence to bounded pilot decision | Preserve source lineage, hypotheses, and contradiction | Evidence map → calibrated signal → decision boundary |
| Finance | Earnings to board decisions | Preserve units, reconciliations, and forward-looking labels | Reported result → bridge → scenarios and sensitivities |
| Startup | Opportunity to retellable seed story | Label synthetic values; no fake proof | Pain → product workflow → proof → wedge → ask |
| Operating | Metrics to owned intervention | Missing is not zero; definitions and owners survive | Flow → bottleneck → intervention → cadence |
| Governance | Framework to release state | Failed controls and stale evidence fail closed | Cross-cutting governance → evidence → guarded threshold |

Every case also defines burst/degraded adversarial examples and a sustained repeat
count so a deck that works once but drifts under repeated agent use does not pass.
