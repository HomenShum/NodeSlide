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
| `@nodeslide/convex` | Injected generated refs, auth-session and bearer-capability adapters, optional Studio binding, isolated component schema and migration chain | App `_generated/api` imports or auth-vendor policy |
| `@nodeslide/registry` | Versioned source-owned compositions for studio/agent/renderer/presenter/backend proof | Automatic routing, auth, `.env`, or global-style edits |
| `@nodeslide/cli` | Preflighted init/upgrade, exact package/tarball plan, hashed receipt, diff-only source upgrades | Silent overwrites or unpublished-package claims |
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
`docs/ECOSYSTEM.md`.

After building, prove the actual publish-shaped artifacts in a fresh temporary
consumer with scripts disabled:

```bash
npm run packages:consumer:smoke
```

The smoke packs the reusable application-boundary workspaces, installs only
those tarballs plus React and Convex peers into an isolated consumer, runs the
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
