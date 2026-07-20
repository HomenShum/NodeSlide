# NodeSlide production operations

This runbook covers the automated production path and its remaining external
setup. The repository is the source of truth; no separate `nodeslide-deploy/`
copy is part of deployment anymore.

## Production bindings

- Web: `https://nodeslide.vercel.app`
- Convex: `https://agile-stoat-411.convex.cloud`
- Convex HTTP actions: `https://agile-stoat-411.convex.site`
- Vercel project: `nodeslide`

The URLs above are deliberately literals in
`.github/workflows/deploy-production.yml`. A production build that does not
contain the production WebSocket URL fails before deployment verification. The
paired HTTP URL is supplied explicitly and checked to describe the same Convex
deployment (it is currently tree-shaken from the bundle because the HTTP helper
has no caller). The live gate then requires both the immutable Vercel deployment
URL and the canonical alias to serve the exact hashed entry built on the GitHub
runner.

## One-time GitHub setup

Create a protected GitHub environment named `production` and configure these
environment or repository secrets:

| Secret | Required permission / source |
|---|---|
| `CONVEX_DEPLOY_KEY` | A deployment key for **prod `agile-stoat-411`** with `deployment:deploy`. The workflow rejects a key whose target prefix is not this production deployment. |
| `VERCEL_TOKEN` | A Vercel token allowed to deploy the `nodeslide` project. |
| `VERCEL_ORG_ID` | The Vercel owner/team id for that project. |
| `VERCEL_PROJECT_ID` | The Vercel project id for `nodeslide`. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Project-level Deployment Protection bypass used only by the live gate for the protected immutable deployment URL. |
| `CONVEX_DIAGNOSTICS_KEY` | Optional, least-privilege prod key with `deployment:logs:view`; used only after a red nightly probe. Do not reuse an admin key. |

After the five required deploy secrets are present, create the repository
variable `NODESLIDE_PRODUCTION_DEPLOY_ENABLED=true`. Trusted successful pushes
to `main` are deliberately skipped until that variable is set, so landing the
workflow cannot turn every main-branch run red during credential setup. A
manual dispatch from `main` remains available before enablement and fails
closed with the exact missing-secret list.

GitHub Issues must be enabled if first-red incident creation is desired. If
issue creation is unavailable, the probe job and workflow still fail red and
retain the sanitized artifact.

Vercel Git auto-deployments are disabled in `vercel.json`. This prevents a
second Vercel build racing the CI-owned release. The CLI is pinned to
`vercel@56.3.2` in the workflow; update it intentionally after reviewing its
release notes and re-running the gates below.

## Main-branch deployment (H3)

With `NODESLIDE_PRODUCTION_DEPLOY_ENABLED=true`,
`.github/workflows/deploy-production.yml` starts only after the `CI` workflow
passes for a trusted push to `main`. A manual dispatch is also accepted only
from `main`, independently of that variable. It performs these gates in order:

1. Validate that every credential exists and that the Convex key targets the
   named production deployment.
2. `npm ci`, production-bound `npm run build`, and `scripts/smoke.mjs` against
   the local `dist/`.
3. `npx convex deploy --typecheck enable` using the production-scoped key.
4. A source deployment through the pinned Vercel CLI with both `VITE_` bindings
   supplied as explicit build variables.
5. `scripts/live-smoke.mjs` against the immutable deployment URL and
   `nodeslide.vercel.app`: exact local entry hash, exact Convex bindings, real
   landing DOM, no deployment guard, and zero browser errors.

Production concurrency never cancels an in-flight release. If Convex succeeds
but Vercel fails, the canonical site remains on its prior frontend. Treat
backend changes as backward-compatible, fix forward, and rerun the workflow.
For a frontend regression, promote the last verified Vercel deployment in the
Vercel dashboard while preparing a reverting commit; do not rewrite `main`.

## Nightly journey and first-red alert (H2)

`.github/workflows/nightly-production-probe.yml` runs daily at `09:37 UTC` and
supports manual dispatch from `main`. `scripts/prod-probe.mjs` uses a fresh
browser context to:

1. require the real production landing DOM and no browser errors;
2. create a deck through the real production Convex action using deterministic
   generation (no model spend or provider dependency);
3. commit a title edit and require the authoritative version to increment;
4. reload and require the edit and version to persist; and
5. download a PPTX and inspect its ZIP structure in memory.

The probe is fail-closed: captions and toast text are never sufficient proof.
It writes only a bounded JSON report containing stages, durations, and a
redacted error category. It never uploads browser storage, capability keys,
deck ids, screenshots, or the exported PPTX.

On the first red run, the alert job opens one issue named
`[ops] Nightly NodeSlide production probe is red`. Repeated reds do not create
new issues. The next green run adds a recovery note and closes the incident.

The journey currently leaves one clearly named synthetic deck in production
per run. NodeSlide has no owner-safe automated deck-retention mutation, so the
probe does not invent one or retain an owner capability in CI. Add an explicit
server-side retention contract before automating cleanup.

Local full-journey invocation (this mutates production in exactly that way):

```bash
npx playwright install chromium
PROD_PROBE_URL=https://nodeslide.vercel.app node scripts/prod-probe.mjs
```

## Convex log capture

Plain `convex logs --prod` begins at the current head and does not print normal
successful executions. That is expected CLI behavior, not evidence that
production logging is broken. Historical diagnosis must include both
`--history <n>` and `--success`.

On probe failure, CI optionally runs the bounded equivalent of:

```bash
npx convex logs --history 50 --success --jsonl --prod
```

through `scripts/capture-convex-logs.mjs`. The wrapper stops after 15 seconds
or 250 events and writes an allowlisted JSONL artifact. Raw Convex JSONL is
never saved because its `success` field can contain function return values.
The CI artifact keeps only function identifiers, timing, status, log-level
counts, and error digests.

Repeat the safe capture locally with a least-privilege production deploy key:

```bash
CONVEX_DEPLOY_KEY='<prod key with deployment:logs:view>' \
  CONVEX_LOG_HISTORY=50 \
  node scripts/capture-convex-logs.mjs
```

For a secured, local-only investigation, set
`CONVEX_LOG_INCLUDE_MESSAGES=1`; the wrapper redacts common credential forms,
but that output can still contain user-authored text and must not be uploaded.
The script refuses message-inclusive mode when `CI` is set.

An empty bounded capture means only that no events were present in the chosen
history/window or that the capture could not authenticate; inspect the capture
footer. It does not prove a Convex backend defect. For durable history and
alerting beyond the CLI's recent window, configure a Convex log stream to an
approved sink.

## Read-only repository hygiene (H4 support)

Run the inventory after fetching the refs you want to compare:

```bash
git fetch --prune
node scripts/repo-hygiene-report.mjs --base=origin/main
```

The script reports a dirty tree, local branches already merged into the base,
registered/prunable worktrees, and whether the legacy sibling
`nodeslide-deploy/` directory exists. It never deletes, prunes, switches, or
modifies anything. Review each candidate and remove it manually only from the
owning session after confirming no uncommitted work.

The fate of parity-studio's demo remains a product decision, not a cleanup
script decision: choose archive, maintain, or remove in that repository with
its owner before changing files or worktrees.
