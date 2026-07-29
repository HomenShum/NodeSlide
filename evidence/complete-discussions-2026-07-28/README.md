# Complete-discussions proof packet

The original before/after captures use
`f3e8e9d2f7024228192734d266b73115e2717fd8`. The release-preparation checks use
the branch rebased onto `origin/main` at
`41ec29812016eb33e93bb398377d51d85d992b91`.

This packet captures the repository state at `f3e8e9d2f7024228192734d266b73115e2717fd8`
before and after the deterministic July 25–28 contract work.

The packet deliberately does not claim live production, human-preference, or
audience-study evidence. Those layers require external runs and independent
people; missing evidence remains `NOT_RUN`/`UNSCORED`. The one narrower live
claim is explicit: authenticated `mobbin/search_flows` access passed and
produced four attributed, analysis-only facts for one Figma Slides flow. No
source pixels or raw source payload are present in this packet. That local
Mobbin canary is non-authoritative; only NodeKit's tracked service-attested
external-run contract can authorize a Mobbin-derived release.

## Repeated checks

- NodeSlide benchmark PR lane
- NodeSlide benchmark evidence lane with no supplied evidence
- focused motion-corpus / benchmark / Atlas receipt tests
- reference-knowledge projection tests added test-first
- browser-safe projection tests for owned, workspace-private, authenticated
  Mobbin, `novelByIntent`, incomplete evidence, and invalid human overrides
- Node/server canonical-authority tests proving an exact NodeKit Git dependency
  can authorize a complete owned-reference candidate and that a local Mobbin
  `PASS` cannot release without NodeKit's tracked service attestation

The benchmark scripts and Vitest write their own machine-readable reports into
the `before/` and `after/` directories.
