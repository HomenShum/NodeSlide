# production-agent.json — declared gaps

`production-agent.json` is validated against the schema copy at
`contracts/production-agent.v1.schema.json` (source:
`2026-senior-agent-engineering-checklist/schema/production-agent.v1.schema.json`).
Every value in the contract is backed by code or CI in this repo. Where the
mechanism does not exist, the contract refuses to invent it — so the file is
DELIBERATELY nonconforming in exactly three places. The gate refusing here is
the gate working; do not "fix" these by editing the JSON, fix them by building
the mechanism.

## Deliberate schema nonconformances

1. **`runtimeGuards.circuitBreaker` — absent.** No error-rate-threshold
   circuit breaker exists. What does exist: 2 provider attempts max, then a
   deterministic fallback; the budget ledger converts unresolved exposure to
   `unreconciled` and refuses further reservations past the cap. That is a
   fuse, not a breaker — a sustained provider brownout is absorbed per-run,
   not tripped fleet-wide.
2. **`release.canary` — absent.** Deploy is 100% cutover via
   `.github/workflows/deploy-production.yml` (Convex + Vercel + a live DOM
   gate). The workflow now waits for the platform READY state, greps a
   server-rendered content signal on the canonical alias, and on any
   post-deploy gate failure automatically runs `vercel rollback` and verifies
   the alias stopped serving the failed commit — but that is deploy +
   automatic rollback, not a canary, and the schema agrees: `trafficPercent`
   must be ≤ 50, so a 100% cutover cannot be declared as one. A partial-traffic
   canary is deliberately not built: (a) the app is a Vite SPA, not Next.js,
   so there is no framework middleware layer; (b) the Convex backend is a
   single shared deployment mutated earlier in the same job, so both traffic
   cohorts would hit the already-new backend and the risky surface (schema and
   function changes) cannot be split; (c) the deploy gates byte-compare served
   HTML against the built bundle, which a traffic-split middleware would break
   nondeterministically. The rollback is also frontend-only — Convex has no
   one-command revert, so every Convex change must stay backward-compatible
   with the previous frontend.
3. **`release.judgeRegression.trigger` = `"nightly-cron"`** — not in the
   schema enum (`on-commit` / `on-pr` / `pre-deploy`). The taste judge
   (`npm run nodeslide:bench:taste-judge`) runs in the `live_evidence` job of
   `.github/workflows/nodeslide-bench.yml` on `cron: '17 6 * * *'` and
   `workflow_dispatch` only. Declaring `on-pr` would be false: PRs run the
   bench gates, not the live judge.

## Other truthful omissions and notes

- **No golden-metric SLO names.** `task-completion-rate`,
  `tool-call-error-rate`, and `p99-latency-ms` are not measured anywhere in
  this repo; the declared SLOs are the PRD's real, tracked targets
  (`docs/PRD.md`). The gate's golden-metric floor is unmet and not disguised
  with renamed substitutes.
- **No conversation-context compression** — declared as `strategies: ["none"]`
  with rationale (single-shot bounded calls under
  `shared/nodeslideRunBudget.ts` budgets: cost 1 USD, input 1,048,576 tokens,
  iterations 12 default / 128 hard max per run).
- **Champion registry unpopulated.** `npm run deck-gym:matrix` (and
  `deck-gym:model-ledger`) evaluate candidate models, but no populated
  champion registry gates a model swap today. `pinnedModel` is
  `NODESLIDE_DEFAULT_AGENT_MODEL` (`shared/nodeslide.ts`); the offered fleet
  is the pinned `NODESLIDE_AGENT_MODELS` list.
- **`fewShotForComplexParams: false`.** Provider calls are constrained by
  strict JSON schemas and server-side patch validators, but prompts do not
  carry few-shot exemplars for complex parameters.
- **`loopBreaker.maxDepth: 1`** is structural, not configured: the multi-agent
  pass (`convex/lib/nodeslideMultiAgent.ts`) is a fixed role pipeline and no
  role can spawn agents. There is no explicit reasoning-depth guard to point
  at.
- **Retry block** describes the stale-state reservation retry in
  `convex/lib/nodeslideBudgetedProvider.ts`: `MAX_STATE_RETRIES = 2`,
  exponential backoff base 50 ms doubling to a 1,000 ms cap
  (`nodeSlideStateRetryBackoffMs`), no jitter.
