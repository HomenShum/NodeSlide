# July 25–29 NodeSlide audit

Original before/after capture baseline:
`f3e8e9d2f7024228192734d266b73115e2717fd8`.

Release-preparation base after the clean rebase:
`origin/main` at `41ec29812016eb33e93bb398377d51d85d992b91`.

## Already on main

- The seven-class Motion Deception Corpus and its honest static coverage
  declaration (`1/7`) are present.
- The runtime trust-surface probe and browser spec are present, with partial
  reach and explicit `NOT_RUN` results.
- The PPTX playback canary and LibreOffice transition normalization from PR
  #111 are present.
- UXBench and TasteBench already reject absent, malformed, stale, or
  producer-judged evidence.

## Added in this branch

- `ReferenceObservation -> DesignRule -> ScoreReceipt` remains a browser-safe,
  digest-bound NodeSlide projection, but is explicitly
  `authoritative: false`.
- Release authority now lives only in the Node/server adapter at
  `scripts/lib/nodeslide-reference-authority.mjs`. It scores and re-verifies the
  exact candidate through `@homenshum/nodekit/reference-loop`. The current
  dependency is pinned to the landed NodeKit `origin/main` commit
  `ab7c9e69e53e2eb1838f0d854dafb490f960537c`.
- The landed NodeKit source hash is
  `c46b37f97b22d4c4c66af2107652d65b252a4f2a4852f1980c2b40f95d8b9bb0`.
  Its independently rechecked `0.2.1` tarball is `696209` bytes with `494`
  entries and SHA-256
  `38b108ae836e87b7d43e24fa2478389ab5e7746ded531cd0c9d25375b84fda56`.
  The installed package has no consumer-time `prepare` lifecycle, which removes
  the Windows/npm failure exposed by the first landed pin.
- Atomic facts require kind, subject, property, value, unit, and a locator.
- Remote observations require source attribution, `firstSeenAt`,
  `lastVerifiedAt`, inspection identity, and freshness checks.
- The Mobbin intake path consumes the existing approved `mobbin` Atlas policy:
  `remote-mcp`, attributed live inspection, no stored source content, and
  explicit denial of download, cache, RAG indexing, and embedding indexing.
- `ExternalReferenceRun` v1 preserves the fail-closed
  `NOT_RUN/AUTHENTICATED_LIVE_INSPECTION_ABSENT` state, while the current
  authenticated `mobbin/search_flows` run is a local projection `PASS` and
  binds the exact digest of one attributed Figma Slides observation. It is not
  a NodeKit service attestation and cannot authorize a release.
- Runtime validation rejects pixel, screenshot, HTML, DOM, OCR, raw payload,
  cached-source, RAG, embedding, and training fields. The committed Mobbin
  record contains only four derived atomic facts and explicit false retention
  booleans.
- Design rules carry a mechanism hypothesis, confidence, applicability and
  non-applicability conditions, plus problem/intent/layout/interaction tags.
  Appearance-only tags such as `clean`, `beautiful`, `modern`, `premium`, and
  `good UX` are rejected.
- Score receipts cite the exact observation and atomic fact ids. The candidate,
  artifact, harness revision, independent render receipt, exact 40-character
  commit, evaluator run, generated evidence, score, and optional attested human
  override are content-bound. A producer or rule proposer cannot approve its
  own candidate.
- The local projection explains complete NodeSlide-owned, workspace-private,
  authenticated-live Mobbin, incomplete, novelty, and override states for the
  UX, but cannot authorize a release. The canonical adapter is the only path
  that emits an authoritative decision.
- The canonical adapter replays the ordered NodeKit profile and exact Git
  commit, candidate receipt, render bytes, rule and observation digests, trust
  policy, and score receipt. A Mobbin-derived rule also requires exactly one
  tracked, valid service-attested external run. A plain local Mobbin `PASS`
  projection therefore cannot bypass NodeKit.
- Motion evidence now has separate technical, video-advisory, and
  audience-usefulness verdicts. M0 showcase/video evidence cannot become M3
  audience evidence, stale-build and self-reviewed receipts are rejected, and
  deception class 6 only accepts a knockout that prevents timeline
  construction.
- Push runs no longer label absent input as a failed "Supplied evidence" job.
  They run an explicit absence lane which must exit `2` and emit `UNSCORED`.
  The supplied-evidence lane still runs only when evidence is actually supplied
  and keeps its enforcement switch.

## Before/after receipts

| Check | Before | After |
| --- | --- | --- |
| New contract tests | RED: 2 load/assertion failures, 1 pass | GREEN: 31/31 (motion 7/7, reference projection 14/14, workflow/integration 6/6, canonical authority 4/4) |
| Existing focused tests | 70/70 | 70/70 |
| PR benchmark | `PASS`, summary `sha256:7cc2cfb8b2a3bf94e3696b5e7cabdbce046baa0cbd89ca9a6620478de1627550` | same |
| No supplied evidence | `UNSCORED`, exit 2, summary `sha256:9b25137abbb343e2148931a475f7e7a109ad959bda0eb3c241eb8330b7e20d1a` | same |

The unchanged benchmark digests are intentional: this branch changes evidence
contracts and workflow semantics; it does not manufacture UX/Taste results.

Original slice checks before the final main rebase:

- `npm run test:nodeslide-gates`: 402 passed, 5 skipped.
- Focused reference projection and canonical-authority tests: 18 passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed, including all workspaces.
- `npm run build`: passed, including all packages and the Vite application.
- Full root `npm test`: 2,546 passed, 7 skipped, 1 unrelated failure. The
  failing test converts `import.meta.url` with `.pathname` but does not URL
  decode the clean worktree path, so it looks for
  `D:\VSCode%20Projects\...\NodeSlideStudio.tsx`. No product or contract test
  failed.

Post-rebase release-preparation checks on `41ec298`:

- Focused reference, motion, benchmark-workflow, and current-main
  trust-surface scenarios: 93 passed.
- `npm run test:nodeslide-gates`: 464 passed, 5 skipped.
- `npm run typecheck`: passed, including all workspaces.
- `npm run build`: passed, including all packages and the Vite application
  (`2,321` transformed modules).
- Browser bundle leak scan found no `@homenshum/nodekit`,
  `nodekit.reference-loop`, or server-adapter symbols under `dist/`.

## Live/external evidence still open

- Scheduled benchmark run
  [30344078096](https://github.com/HomenShum/NodeSlide/actions/runs/30344078096)
  failed before browser capture because both production URL repository
  variables were empty. Repository inspection also found no repo-scope
  `NODESLIDE_TASTE_JUDGE_OPENROUTER_KEY` secret name. The workflow now names
  each missing configuration key without exposing values.
- Main push run
  [30409046073](https://github.com/HomenShum/NodeSlide/actions/runs/30409046073)
  showed a failed supplied-evidence job with no supplied path and skipped the
  live lane. This branch corrects the no-input job semantics; a pushed run is
  still required to prove the workflow change on GitHub.
- PR #112's consent-transition runtime-probe correction and PR #110's
  walkthrough disclosures are now part of the rebased `origin/main`; this
  branch preserves them without duplicating their changes.
- The authenticated Mobbin canary passed at `2026-07-29T01:04:17.055Z` through
  `mobbin/search_flows`. It produced one analysis-only `ReferenceObservation`
  for the three-screen Figma Slides “Starting a presentation” flow. The
  evidence packet stores no screenshots, pixels, DOM, OCR, raw response
  payload, cache, embedding, RAG document, or training material.
- That local canary record remains non-authoritative until represented by the
  canonical NodeKit service-attested external-run contract.
- No live UXBench, TasteBench, human audience study, deploy, or merge was
  performed. The release branch is pushed for review only.
