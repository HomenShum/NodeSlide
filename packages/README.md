# NodeSlide injectable boundary

This directory is the first behavior-preserving package seam around the
existing NodeSlide application. The standalone app continues to import the
authoritative implementations from `shared/` and the pure validation modules in
`convex/lib/`; package entrypoints wrap those same implementations so consumers
can migrate without a second DeckSpec, patch engine, or validator.

| Package | Current public surface | Explicitly excluded |
|---|---|---|
| `@nodeslide/contracts` | DeckSpec, patch, proposal, validation, trace, export, and attachment contracts | React, Convex, DOM, host auth |
| `@nodeslide/engine` | Pure `applyDeckPatch`, patch/snapshot validation, scope validation, affected-ID calculation, migrations | Persistence, approval UI, provider calls |
| `@nodeslide/backend` | Repository, asset, and telemetry ports; default-deny permissions; approval and production-governance declarations; runtime-validated principals; host authorization evidence; bound receipts | Any concrete database or auth vendor |
| `@nodeslide/testing` | Deterministic fixtures, memory repository/assets/telemetry, repository conformance smoke | Production persistence |
| `@nodeslide/agent` | Runtime-neutral room tools, host tool contract, governed direct-edit/proposal routing | A second agent loop or model provider |
| `@nodeslide/react-headless` | Controlled deck navigation, repository controller, proposal previews/review state, and permission derivation | Rendering, CSS, DOM queries, persistence SDKs |
| `@nodeslide/react` | Controlled StudioShell, deck renderer, proposal review, agent transcript/composer, opt-in scoped styles | Convex, auth, routing, global CSS, standalone app state |
| `@nodeslide/client-http` | Hosted repository/assets/telemetry client with normalized errors and host credentials | Trusting a serialized client principal |
| `@nodeslide/convex` | Injected generated refs, auth-session and bearer-capability adapters, optional Studio binding, mountable isolated component functions/schema, one-time host grants, migrations, and literal governance | App `_generated/api` imports, host tables, credentials, or auth-vendor policy |
| `@nodeslide/registry` | Versioned source-owned compositions for studio/agent/renderer/presenter/backend proof | Automatic routing, auth, `.env`, or global-style edits |
| `@nodeslide/cli` | Preflighted init/upgrade, verified immutable artifact-set install, integrity-pinned receipt, and diff-only source upgrades | Silent overwrites, mutable package sets, or unpublished-package claims |
| `@nodeslide/external-agent` | Bundled library + `nodeslide` CLI for offline inspect/validate/propose/apply | UI, hosted auth, provider calls, a second patch engine |

The compatibility direction is deliberate:

```text
existing app -> shared/* + pure convex/lib validators
                                  ^
package entrypoints --------------|
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
`docs/ECOSYSTEM.md`. Build a complete release set and its integrity manifest
with:

```bash
npm run artifacts:build -- \
  --out ./artifacts/v0.2.2 \
  --release-id <full-40-character-lowercase-git-commit-sha> \
  --release-version 0.2.2 \
  --registry-version 0.2.2
```

The manifest pins the exact 11-package closure with SHA-256 and npm SHA-512
integrity. Artifact-mode installs consume the whole verified closure so npm
never resolves an unpublished internal `@nodeslide/*` dependency from a mutable
registry.

Public immutable assets must come from the Ubuntu
`immutable-package-build.yml` workflow artifact. `npm pack` encodes a
CLI bin's executable mode differently on Windows, so two same-OS local builds
are useful rehearsal but are not the canonical cross-run producer proof. The
workflow builds twice, requires the exact 12-file roster and byte identity, and
binds its downloadable artifact to a full commit SHA already on `main`.

After building, prove the actual publish-shaped artifacts in a fresh temporary
consumer with scripts disabled:

```bash
npm run packages:consumer:smoke
```

The smoke packs the reusable application-boundary workspaces, installs only
those tarballs plus React and Convex peers into an isolated consumer, verifies
the mountable component config/functions/types, runs the
repository proposal/acceptance conformance journey, exercises the agent proposal
path, HTTP descriptor, migration plan, registry reader, CLI planner, headless
permissions and review model, server-renders the controlled deck viewer,
compiles a strict TypeScript consumer against the packed declarations, verifies
the exported CSS, and removes the temporary directory. Source-workspace imports
cannot satisfy this gate.

The in-memory reference adapter receives authorization from a
constructor-injected host policy and fails closed when none is supplied.
Production adapters must invoke their own server-side host policy before
repository work. The portable package validates the normalized principal and
records only an opaque host audit reference; credentials, JWTs, and host
ActorProofs stay outside NodeSlide. Acceptance receipts bind the reviewer,
deck, action, and exact proposal. Caller-authored audit receipts are limited to
the disjoint `custom-receipt:*` ID namespace and `custom` operation; canonical
mutation receipt IDs and operation claims remain repository-owned.

External coding agents can use the bundled CLI or the adapted MCP server as
documented in `docs/EXTERNAL_AGENT_ACCESS.md`. Both transports consume these
package boundaries instead of copying the deck model or patch engine.

Before public npm publication, initialize from the exact artifacts:

```bash
npx @nodeslide/cli init --profile full-studio --backend convex --ui host-tokens \
  --artifacts ./artifacts
```

The `nodeslide` binary supports interactive prompts. The scoped `npx` package
name remains explicit until ownership of the unscoped `nodeslide` registry name
is confirmed; the CLI does not claim an unpublished alias.

For upgrades, use a separately generated, strictly newer release set and run
`nodeslide upgrade --artifacts <directory>`. The immutable proof workflow
installs v0.1.0 into a clean consumer, upgrades to v0.2.2, checks the lockfile
and receipt pins, and rejects mixed or tampered sets. Public-release acceptance
additionally requires GitHub release immutability, the exact canonical
11-package asset roster, manifest release IDs equal to both tag commit SHAs,
successful `gh release verify` and per-asset `gh release verify-asset` checks,
and a byte-identical rebuild of the checked-out candidate tag.
