# NodeSlide injectable boundary

This directory is the first behavior-preserving package seam around the
existing NodeSlide application. The standalone app continues to import the
authoritative implementations from `shared/`; package entrypoints wrap those
same implementations so consumers can migrate without a second DeckSpec or
patch engine.

| Package | Current public surface | Explicitly excluded |
|---|---|---|
| `@nodeslide/contracts` | DeckSpec, patch, proposal, validation, trace, export, and attachment contracts | React, Convex, DOM, host auth |
| `@nodeslide/engine` | Pure `applyDeckPatch`, scope validation, affected-ID calculation | Persistence, approval UI, provider calls |
| `@nodeslide/backend` | `NodeSlideRepository`, `NodeSlideAssetStore`, `NodeSlideTelemetryAdapter`, normalized principal and receipts | Any concrete database or auth vendor |
| `@nodeslide/testing` | Deterministic fixtures, memory repository/assets/telemetry, repository conformance smoke | Production persistence |
| `@nodeslide/external-agent` | Bundled library + `nodeslide` CLI for offline inspect/validate/propose/apply | UI, hosted auth, provider calls, a second patch engine |

The compatibility direction is deliberate:

```text
existing app -> shared/* (unchanged authoritative implementation)
                         ^
package entrypoints -----|
```

The next extraction slice may move the pure source into these packages and
turn `shared/*` into compatibility re-exports. That source move is deferred
until the package API and the NodeRoom consumer are proven, avoiding a large
rename-only diff in this boundary PR.

Build all tarball-ready package artifacts with:

```bash
npm run packages:build
```

Each workspace is private to prevent accidental publication but supports
`npm pack` for the version-pinned tarball workflow documented in
`docs/ECOSYSTEM.md`.

External coding agents can use the bundled CLI or the adapted MCP server as
documented in `docs/EXTERNAL_AGENT_ACCESS.md`. Both transports consume these
package boundaries instead of copying the deck model or patch engine.
