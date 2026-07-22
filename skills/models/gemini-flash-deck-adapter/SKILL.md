---
name: gemini-flash-deck-adapter
description: Bound Gemini Flash presentation work to independently verified capabilities and prevent generic fallback output. Use when a Gemini Flash route is selected for deck generation, extraction, classification, or other presentation tasks.
---

# Gemini Flash Deck Adapter

The current Deck Gym evidence authorizes no full-deck generation role: 0/24 evaluated routes were live.

## Contract

1. Verify live route provenance before evaluating content.
2. If the route is degraded, emit `GENERIC_FALLBACK`, preserve the provider error class, and stop. Never substitute a generic template.
3. Permit bounded extraction or classification only when that capability has its own controlled evidence; do not treat speed or reputation as proof.
4. Require exact structured output, source identifiers, and deterministic validation for bounded tasks.
5. Escalate full-deck generation to a verified route until a fresh Gemini skill-on ablation passes.

## Completion checks

- Requested and attempted route are explicit.
- The output is brief-specific and source-bound.
- No generic fallback reached ranking or export acceptance.
- The assigned role is supported by a matching benchmark, not inferred from another task.

Fail explicitly when any check is unavailable.
