---
name: no-generic-fallback
description: Detect and fail closed when a presentation generation route substitutes generic or unrelated content for the requested brief. Use before ranking, exporting, accepting, or promoting any model-generated deck.
---

# No Generic Fallback

1. Compare requested model, attempted model, provider, trace classification, and completion state.
2. Measure frozen-claim coverage and check brief-specific entities, evidence IDs, and required artifacts.
3. Compare the deck digest against known fallback and cross-run duplicate groups.
4. Classify the result `GENERIC_FALLBACK` when provenance is degraded or the deck is unrelated despite structural validity.
5. Return a typed degraded result with retry, route-change, or explicit human-acceptance choices.

Never count degraded output as requested-model success. Never grant it a qualified score or promotion eligibility. Preserve the artifact for diagnosis without exposing provider secrets.

Completion requires a live route, sufficient claim coverage, and no known fallback fingerprint.
