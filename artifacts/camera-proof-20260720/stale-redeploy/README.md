# Production redeploy continuity / stale-action proof

This directory preserves each production attempt without rewriting a red or
non-reproduced result as a pass.

## Attempt 1 — signal before Convex activation

`attempt-1-signalled-before-activation/` used a browser opened against the old
production deployment at `2026-07-21T02:15:09.985Z`. The trigger was created at
`2026-07-21T02:51:22.006Z` while deployment run `29796788784` had entered its
Convex step, but the workflow did not report the new functions deployed until
`2026-07-21T02:51:33.225Z`.

The old client therefore submitted before activation. Its action succeeded and
produced a reviewable, unapplied Kimi K3 → Gemini 3.5 Flash proposal with two
operations. No reload banner appeared, so the harness correctly wrote a failed
receipt after its 180-second banner timeout. The screenshot proves continuity;
it does **not** prove the stale-action recovery banner.
Screenshot SHA-256: `e563e34814e78bbdc45ce94c1c440f03725cb872b45b39b4d849dd0bb310bca0`.

The next attempt must signal only after the exact Convex deploy step completes.
If the proposal succeeds again, the bounded production claim is that the stale
failure was not reproduced across the observed deploys. If the action rejects,
the proof requires the exact fail-closed reload copy, CTA, and screenshot.

## Attempt 2 — submitted after Convex activation

`attempt-2-post-activation/` held a production client open from
`2026-07-21T03:11:27.871Z`. Deployment run `29798347209` reported its Convex
step complete at `03:25:39Z`; the trigger fired at `03:25:41.834Z`, and the
action submitted at `03:25:41.880Z` (2.880 seconds after activation).

The action again succeeded and rendered a reviewable, unapplied two-operation
Kimi K3 → Gemini 3.5 Flash proposal with zero console errors. No reload banner
appeared. The raw harness receipt says `failed` because its first continuity
locator targeted a different proposal-card rendering and the banner wait timed
out; that raw receipt is intentionally unchanged. `analysis.json` records the
timing and visually inspected outcome. Screenshot SHA-256:
`1a4b6972c0cf69339e5517d9a50a0c0cd9054bfcf903685517be1bac9104f570`.

Bounded conclusion: in both observed deployments the pre-deploy client stayed
operational and produced a reviewable, unapplied proposal. The stale-action
failure was not reproduced. The deterministic reload-banner implementation is
not being relabeled as a production camera pass.
