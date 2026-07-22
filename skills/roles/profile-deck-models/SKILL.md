---
name: profile-deck-models
description: Build evidence-based model capability cards, failure ledgers, routing policies, and provisional skill candidates from controlled presentation benchmark receipts. Use when comparing model versions, separating model behavior from harness behavior, deciding presentation-agent roles, or converting repeated Deck Gym findings into testable skills.
---

# Profile Deck Models

## Procedure

1. Freeze the brief, evidence, references, tools, budgets, renderer, and validators. Reject comparisons with uncontrolled differences.
2. Record harness-versus-model ablations separately. Never attribute a harness, renderer, retrieval, or fallback failure to the model without evidence.
3. Score three independent layers:
   - cognitive behavior from plan or reasoning traces;
   - execution behavior from tool traces and result inspection;
   - artifact quality from rendered and exported evidence.
4. Mark a layer `unmeasured` when its evidence is absent. Do not infer tool skill from a finished PPTX.
5. Classify failures using [references/evidence-contract.md](references/evidence-contract.md). Attach run ID, model version, harness version, brief, evidence path, severity, probable cause, and repair result.
6. Generate the ledger with `npm run deck-gym:model-ledger` when Deck Gym receipts are available.
7. Write behavioral capability cards. Prefer “passed claim coverage in 9/11 live runs” over personality analogies.
8. Route by required capability, role skill, adapter, guardrails, and tools. Keep the final taste decision independent and model-blind.

## Skill candidacy

Create a provisional skill candidate only when the behavior appears in at least three independent runs across two briefs. Promote it only after a skill-off versus skill-on ablation demonstrates improvement without unacceptable accuracy, latency, cost, editability, or export regressions.

Never promote from a raw aggregate score, one attractive deck, or a model's self-critique.

## Required outputs

- `.qa/models/<model>/capability-card.yaml`
- `.qa/models/<model>/findings.jsonl`
- `.qa/models/<model>/benchmark-summary.md`
- `.qa/models/routing-matrix.yaml`
- explicit evidence limitations and confidence per layer

## Completion checks

- Every numerical claim resolves to a receipt.
- Requested-route failures are separated from model output quality.
- Raw and qualified scores are both reported.
- Human-review eligibility is distinct from promotion eligibility.
- Proposed skills remain provisional until ablated.

If any check fails, report the missing evidence and stop before assigning a stable model role.
