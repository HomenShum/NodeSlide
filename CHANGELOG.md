# Changelog

## Unreleased

### Runtime

- Added a complete `nodeslide generate` transaction: hosted creation,
  fallback refusal, validation, publication, and bounded atomic PPTX/HTML/
  snapshot/receipt delivery.
- Made the CLI bundle standalone and added a one-command repository entry point.
- Split the hosted Vercel build from separately distributed MCP sources so the
  production deployment compiles only files present in its deployment bundle.

### Agent surfaces

- Upgraded `nodeslide.create_deck` from draft creation to the same finished-deck
  transaction used by the CLI.
- Added safe output-root containment, artifact size limits, public URL delivery,
  low-effort structured-generation defaults, and explicit fallback override.

### Story and composition

- Added a deterministic StorySpec for scene continuity, visual metaphor,
  reveal pacing, emotional escalation, and semantic composition rhythm.
- Routed the composition plan through the actual materializer instead of
  recomputing and discarding it.
- Added a visible progressive story motif to every exported slide.
- Calibrated text measurement to PowerPoint points and reduced visual-slide
  typography so exported PPTX layouts do not hide internal collisions.

### Reliability and publication

- Added bounded extraction of one JSON object from realistic provider wrappers.
- Quarantined known-invalid optional authored-artifact enrichment while
  preserving valid legacy structured content and rethrowing unknown failures.
- Preserved chart provenance in public snapshots through redacted, content-free
  evidence stubs while retaining the defense-in-depth source filter.
- Preserved slide archetypes through publication so public rendering matches the
  composition the owner validated.

### Proof

- Added scenario tests for provider wrappers, burst parsing, invalid enrichment,
  publication privacy plus chart compilation, 300-brief story stability,
  composition diversity, motif progression, and PPTX-calibrated text fit.
- Captured a real hosted seven-scene production deck, all four delivery files,
  every rendered slide, a montage, raw-HTML proof, and Chrome live-DOM proof.
