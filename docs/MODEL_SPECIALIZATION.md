# Model specialization from Deck Gym evidence

## Current conclusion

Treat the three requested routes as different, provisional workers—but separate route reliability from model capability. The first Deck Gym baseline captured artifact behavior well and cognitive/tool behavior poorly. Capability cards therefore report artifact evidence with high confidence while marking planning and detailed tool orchestration unmeasured.

| Capability | Kimi K3 | Claude Sonnet 5 | Gemini 3.5 Flash |
|---|---|---|---|
| Live requested route | 11/23 evaluated | 6/23 evaluated | 0/24 evaluated |
| Claim gate when live | 9/11 | 5/6 | Unmeasured |
| Mean live claim coverage | 0.911 | 0.917 | Unmeasured |
| Required artifact gate when live | 4/11 | 0/6 | Unmeasured |
| Internal-overlap gate when live | 0/11 | 0/6 | Unmeasured |
| Current full-deck role | Provisional executor with guardrails | Provisional story/critic candidate; execution needs guardrails | Blocked until a live-route ablation passes |
| Final taste judge | No | No | No |

Do not claim that Sonnet plans better, Kimi uses tools better, or Gemini extracts faster from this baseline. The runner captured creation, trace attribution, export, PPTX structure, and rendered artifacts—not independent plan quality or detailed tool-call behavior.

## Evidence products

- Capability cards: `.qa/models/<model>/capability-card.yaml`
- Run-level findings: `.qa/models/<model>/findings.jsonl`
- Behavioral summaries: `.qa/models/<model>/benchmark-summary.md`
- Routing policy: `.qa/models/routing-matrix.yaml`
- Failure taxonomy: `.qa/models/failure-taxonomy.yaml`

Regenerate them from Deck Gym receipts with:

```powershell
npm run deck-gym:model-ledger
```

## Provisional skills

### Role

- `profile-deck-models`: generate evidence-based cards, findings, confidence, routing, and skill candidacy.

### Model adapters

- `kimi-k3-deck-adapter`: require live provenance, artifact planning, composition alternatives, density control, and render repair.
- `claude-sonnet-deck-adapter`: bind StorySpec to evidence, enforce region budgets, separate critic from executor, and require independent acceptance.
- `gemini-flash-deck-adapter`: block full-deck generation until a verified live route exists and forbid generic substitution.

### Cross-model guardrails and recovery

- `no-generic-fallback`
- `enforce-density-budget`
- `require-visual-artifacts`
- `repair-internal-overlap`

All eight are candidates, not promoted global policy. Each skill states its executable procedure, completion checks, and failure behavior.

## Promotion experiments

Run the following controlled comparisons before promotion:

1. **Route truth:** current behavior versus typed fail-closed degradation, using the same model, brief, and renderer. Success means zero generic fallbacks accepted as live output.
2. **Density:** skill-off versus `enforce-density-budget` on at least Kimi and Sonnet across four briefs. Success means fewer overflows and better blind preference without claim loss.
3. **Artifact planning:** skill-off versus `require-visual-artifacts` across architecture, research, product, and policy briefs. Success means more required artifacts and better preference without decorative filler.
4. **Overlap recovery:** run `repair-internal-overlap` on at least three independent failures across two briefs. Success means the original gate passes after repair with unchanged claim coverage.
5. **Role separation:** compare direct generation against Sonnet StorySpec → Kimi execution → independent critic using identical inputs and budgets. Capture plan and tool traces so cognitive and execution layers become measurable.

A candidate becomes promotable only after repeated repair success, no material factual or export regression, complete model-blind review, and a retained rollback path.

## Next benchmark trace contract

Add these fields to the next harness version:

- plan steps and slide-job assignments;
- tool names, arguments digest, order, latency, and result status;
- whether results were inspected before the next action;
- repair trigger, repair operation, and post-repair assertion;
- delegated worker scope and parent validation;
- token, latency, and cost by phase.

This enables separate cognitive, execution, and artifact cards instead of collapsing different abilities into one model score.
