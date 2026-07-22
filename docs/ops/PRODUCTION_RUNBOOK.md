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
runner. The frontend also embeds the exact 40-character source SHA in
`nodeslide-build-sha`. Immediately before the Convex deploy, the workflow
rewrites the deliberately invalid checked-in backend identity placeholder with
that same SHA; the public, non-secret `nodeslideBuildIdentity.get` query must
return it before the frontend is promoted.

## One-time GitHub setup

Create a protected GitHub environment named `production` and configure these
environment or repository secrets:

| Secret | Required permission / source |
|---|---|
| `CONVEX_DEPLOY_KEY` | A deployment key for **prod `agile-stoat-411`** with `deployment:deploy`. The workflow rejects a key whose target prefix is not this production deployment. |
| `VERCEL_TOKEN` | A Vercel token allowed to deploy the `nodeslide` project. |
| `VERCEL_ORG_ID` | The Vercel owner/team id for that project. |
| `VERCEL_PROJECT_ID` | The Vercel project id for `nodeslide`. |

Keep all four values on the protected `production` environment when possible.
They are injected only into the steps that need them, never into the job-wide
environment. The workflow rejects a malformed or wrong-deployment Convex key,
and after `vercel pull` it requires `.vercel/project.json` to match both
protected Vercel ids and the literal project name `nodeslide`; no secret value
is written to a receipt or log.

After the four required deploy secrets are present, create the repository
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

All first-party JavaScript actions are immutable full-SHA pins whose checked-in
`action.yml` declares the Node 24 runtime. `scripts/production-workflows.test.mjs`
fails if an unapproved first-party action or movable tag is introduced. The
Node Platform reusable conformance workflow is likewise pinned to verified
commit `5c9aa6443ca8e61dc8886fbf0a0b4a7b72858e63`, whose own workflows pin Node 24
action releases.

## Main-branch deployment (H3)

With `NODESLIDE_PRODUCTION_DEPLOY_ENABLED=true`,
`.github/workflows/deploy-production.yml` starts only after the `CI` workflow
passes for a trusted push to `main`. A manual dispatch is also accepted only
from `main`, independently of that variable, but it cannot bypass CI: the exact
dispatch SHA must already have a successful trusted `CI` push run. The release
run title attests the source SHA explicitly instead of relying on the generic
Actions `head_sha` field. It performs these gates in order:

1. Require the checked-out SHA to equal the current `refs/heads/main` and find
   its successful trusted `CI` push run through the GitHub API.
2. Validate that every credential exists, that the Convex key has the exact
   production prefix and an opaque suffix of at least 16 characters, and that
   Vercel pulled the protected `nodeslide` project ids.
3. `npm ci`, production-bound `npm run build`, and `scripts/smoke.mjs` against
   the local `dist/`; the built HTML must embed the exact source SHA.
4. Build the prebuilt Vercel artifact and require its HTML to carry the same
   source SHA.
5. Recheck current `main` immediately before the first production mutation, so
   an older queued release fails rather than rolling production backward.
6. Stamp the Convex source identity, run `npx convex deploy --typecheck enable`
   using the production-scoped key, and query the activated backend until that
   exact SHA is observed.
7. Deploy the prebuilt artifact through the pinned Vercel CLI.
8. Gate the immutable deployment and `nodeslide.vercel.app`: exact local entry
   hash, exact frontend SHA, exact Convex bindings, real landing DOM, no
   deployment guard, and zero browser errors.

Production concurrency never cancels an in-flight release. If Convex succeeds
but Vercel fails, the canonical site remains on its prior frontend. Treat
backend changes as backward-compatible, fix forward, and rerun the workflow.
For a frontend regression, promote the last verified Vercel deployment in the
Vercel dashboard while preparing a reverting commit; do not rewrite `main`.

### Recording exact-main evidence without changing the SHA

Do not commit a purported final-main SHA or its post-deploy run URLs to the
branch it is meant to identify. That documentation commit would produce a new
SHA and make the evidence self-contradictory. After merge, append the exact main
SHA plus CI, deployment, production-journey, fleet, and UI-QA URLs to the merged
closure PR. The workflows also retain digest-bound artifacts for the same
coordinates. Repository ledgers remain `pending` until those external records
exist; a follow-up source commit is neither necessary nor valid proof.

## Nightly journey and first-red alert (H2)

`.github/workflows/nightly-production-probe.yml` runs daily at `09:37 UTC` and
supports manual dispatch from `main`. `scripts/prod-probe.mjs` uses a fresh
browser context to the most recent successful deployment. The workflow resolves
the source SHA from the deployment run's explicit title attestation and checks
out that exact commit before installing or executing probe code; a newer default
branch checkout can never be mislabeled as evidence for an older deployment.
The journey then:

1. require the real production landing DOM and no browser errors;
2. create a deck through the real production Convex action using deterministic
   generation (no model spend or provider dependency);
3. commit a title edit and require the authoritative version to increment;
4. reload and require the edit and version to persist;
5. require a passing canonical ArtifactSpec receipt and a non-mutating,
   non-visible NodeGym shadow-route receipt;
6. download a PPTX and require slide XML plus editable chart XML; and
7. delete the entire synthetic workspace and require a zero-row retention
   receipt.

The probe is fail-closed: captions and toast text are never sufficient proof.
It writes only a bounded, allowlisted JSON report containing stages, durations,
sanitized artifact/shadow/retention evidence, and a redacted error category. It
never uploads browser storage, capability keys, deck ids, screenshots, or the
exported PPTX.

On the first red run, the alert job opens one issue named
`[ops] Nightly NodeSlide production probe is red`. Repeated reds do not create
new issues. Manual runs use the separate title
`[ops] Manual NodeSlide production evidence matrix is red`, so a lower-cost
scheduled green cannot falsely close an unresolved full-matrix incident. The
next green run of the same mode adds a recovery note and closes its incident.

Before the create click, the journey places a random one-use cleanup token in
its new session. Creation consumes it once, persists only its digest and a
two-hour expiry on the synthetic deck, and never sends it to the model. The
finally path calls `nodeslideRetention.deleteProductionProbeWorkspace` with the
token plus the exact client session, so it can find and transactionally delete
the workspace even when the action response was lost before the browser learned
the deck id or owner capability. It verifies zero deck/source/project rows and
returns only `nodeslide.production-probe-retention-receipt/v1`, whose digest is
recomputed by the probe. A bounded 30-minute cron sweep deletes expired tagged
workspaces if the runner crashes before its finally block.

The protected NodeGym UI executor retains its separate owner-authenticated
`nodeslide.workspace-retention-receipt/v1` path. Both paths fail closed when the
appropriate receipt is absent, malformed, leaks a stable id/capability, or
reports retained rows. Raw cleanup tokens and owner capabilities exist only in
process/session memory and are never written to artifacts.

Local full-journey invocation (this mutates production in exactly that way) must
bind itself to a successful exact deployment run; copy the SHA and run URL from
GitHub rather than inferring them from the local checkout:

```bash
npx playwright install chromium
PROD_PROBE_URL=https://nodeslide.vercel.app \
PROD_PROBE_COMMIT_SHA=<40-character-deployed-main-sha> \
PROD_PROBE_WORKFLOW_RUN_URL=https://github.com/HomenShum/NodeSlide/actions/runs/<id> \
node scripts/prod-probe.mjs
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

Only schema-recognized Convex `Completion` and `Progress` execution records
increment `capturedEvents`. Unknown JSON objects and non-JSON stdout are counted
and retained only as bounded, redacted diagnostics; they cannot make an empty
history appear green. The footer records both diagnostic counts, while the
capture still exits non-zero with `no-production-events` unless at least one
recognized execution record was sanitized.

Convex CLI does not currently expose a log-only deploy-key scope. The preferred
local path is therefore an already-authenticated Convex CLI session, run from
this repository after confirming its `--prod` target is `agile-stoat-411`:

```bash
CONVEX_LOG_HISTORY=50 \
  npm run diagnostics:convex-logs:prod
```

Non-interactive CI cannot use that session and uses the existing production
deploy key. That credential can deploy as well as read logs, so the nightly job
is attached to the protected GitHub `production` environment and never exposes
the key to artifacts. Do not mint a falsely described "log-only" key. The
receipt records only `production-deploy-key` or `local-convex-session`, never
the credential.

For a secured, local-only investigation, set
`CONVEX_LOG_INCLUDE_MESSAGES=1`; the wrapper redacts common credential forms,
but that output can still contain user-authored text and must not be uploaded.
The script refuses message-inclusive mode when `CI` is set.

An empty bounded capture is not treated as green evidence. The wrapper exits
non-zero and records `failureCode: "no-production-events"` plus
`stopReason: "empty-history"` in the sanitized footer. That can mean the
chosen history/window was genuinely empty; it does not by itself prove a
Convex backend defect. Authentication and CLI failures use the separate
`convex-cli-error` code. For durable history and alerting beyond the CLI's
recent window, configure a Convex log stream to an approved sink.

## Model fleet bounded audit

For an auditable run without copying the protected deployment key locally,
manually dispatch `nightly-production-probe.yml` from `main`. Its protected,
60-minute manual path runs this fail-closed matrix against one attested
frontend/Convex deployment:

1. deterministic create -> edit -> reload -> ArtifactSpec/NodeGym shadow ->
   editable PPTX export -> delete;
2. every offered model route;
3. the bounded free-router text catalog;
4. the bounded free-router structured-output catalog; and
5. the production viewport/theme UI QA capture.

The four optional-cost/capture stages use `continue-on-error` only so every
sanitized receipt can be uploaded; a final aggregator turns the job red unless
all four succeeded. Scheduled nightly runs retain the lower-cost deterministic
journey. Both modes upload only bounded receipts/diagnostics for 14 days. The
manual UI stage intentionally includes six public-sample screenshots (three
real viewport sizes by two themes); it creates no deck and its receipt binds
each screenshot's bytes and SHA-256 digest. The deterministic journey itself
still uploads no screenshot, browser storage, capability, deck id, or PPTX.

If a secured local audit is necessary after deploying the candidate Convex
code, use the capture command (not the raw probe command) and supply the exact
deployment identity:

```bash
CONVEX_DEPLOY_KEY=<protected-production-key> \
MODEL_FLEET_PROBE_COMMIT_SHA=<40-character-deployed-main-sha> \
MODEL_FLEET_PROBE_WORKFLOW_RUN_URL=https://github.com/HomenShum/NodeSlide/actions/runs/<id> \
npm run capture:model-fleet:prod
```

The offered action invokes every `NODESLIDE_OFFERED_AGENT_MODELS` entry
sequentially with a route-specific reasoning effort and bounded output cap. The
current source boundary is eight production-enabled routes. The separate five
`NODESLIDE_FREE_ROUTER_CANDIDATES` are Gym/qualification routes and are not
accepted by production generation merely because a probe returns text.
Mandatory-reasoning
routes receive enough budget to emit visible text after deliberation. Its
`nodeslide.model-fleet-probe/v1` JSON receipt records
catalog/probed/failed counts, route identity, timing, token/cost telemetry, and
only the presence and byte length of assistant output. It never returns model
text or upstream error bodies. Every passing route requires the provider-returned
actual provider/model; a pinned route must match exactly and `openrouter/free`
must resolve to an actual model rather than echo its alias. Treat an audit as
passed only when the top-level `passed` field is `true`, probed count equals the
exact catalog count, and the receipt validator accepts every route attribution.

The manual workflow deliberately runs free text and structured-output probes
even though those routes are not offered. Any failed attribution/output gate
keeps the manual evidence matrix red and the candidate non-offered; it is
retained as diagnostic/Gym evidence, not rewritten green or promoted.

The capture refuses a wrong deployment-key prefix, a noncanonical production
URL, an unverified deployment run, a frontend SHA mismatch, or a Convex SHA
mismatch before it invokes any paid/provider route.

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
