# NodeSlide developer handoff — 2026-09-05

An author needs an editable deck whose data, revisions and review status can be checked before sharing. This recovery slice preserves multiline briefs, exposes the reason a broader deck check failed, and makes the repository checks work from a Windows path containing spaces. The complete product is still under review.

**Re your request:** make each repository usable for developer/user handoff, including visual, responsive and interaction grading. The verified slices and remaining gaps below are deliberately separate. No full-product grade or production deployment is claimed.

## Start with the reproducible code checks

Use Node.js 22 and npm 10. The recorded Windows run used Node 22.22.2 and npm 10.9.7. From a fresh checkout:

```powershell
npm ci
npx playwright install chromium
npm run check
npm run packages:consumer:smoke
npm run proof:external-agent
```

The full check runs lint, application/workspace typechecks, tests and package/application builds. Package smoke checks exercise normally packed and installed consumers. Linux browser hosts may need the system dependencies described by Playwright's installer. No model key is needed for these checks.

For an interactive session, read [the application walkthrough](docs/START_HERE.md) and [the backend bootstrap findings](promotion/evidence/portfolio-current-consumer-20260905/raw/E6g_NODESLIDE_LOCAL_BACKEND_PREREQUISITES.md.txt) first. Use a dedicated development deployment. Creation needs its local `NODESLIDE_PUBLIC_CREATION` setting; select the `deterministic` model explicitly. The landing page's default model can require a provider.

The recorded Convex CLI printed a localhost URL while its native process listened on all interfaces. The proof stopped that process, used the same installed native binary with explicit `--interface 127.0.0.1`, and verified both listeners before pushing only to the owned local deployment. [The execution record](promotion/evidence/portfolio-current-consumer-20260905/raw/E6g_NODESLIDE_LOOPBACK_BACKEND_PLAN.md.txt) explains the exact version and boundary. Do not treat a printed URL as proof of the actual bind address, or run local-admission commands against an existing shared deployment. Historical proof scripts contain machine-specific paths and must not be run blindly.

The proof backend and frontend have stopped; their recorded processes exited and ports were released. Private generated configuration, access storage and database state are intentionally absent from this handoff. Set up your own session. No existing OpenAI key was read and no model-provider request was made.

## What changed and why

| Author/developer action | Observed failure | Repair and evidence boundary |
| --- | --- | --- |
| Run checks from a Windows checkout whose path contains spaces | URL pathname handling retained `%20`; a Unix `find` subprocess masked absent trace coverage; tours changed with checkout line endings | Native file-URL conversion, deterministic filesystem traversal and `.tour` LF policy. Existing generated citations were refreshed without changing their prose. |
| Paste a multiline CSV brief and export the generated chart | A shared single-line validator removed all five line breaks, so saved input and exported deck had no chart | Preserve internal prompt whitespace while retaining raw size/blank checks. Real UI creation, title/notes edits and reload produced exact JSON and one native PPTX chart with values 100, 120 and 140. |
| Open a failed Deck CI result before sharing | The Trace panel showed a narrower passed validation as “publish ready” without the actual composition blocker | Forward only the current deck/version result to both inspector surfaces; show the actual blocker and version; label older validation as recorded core validation. Pending/unavailable checks do not borrow a result. |
| Enlarge inspector text while reading check counts | The one-line status control clipped blocker/warning counts | Allow the existing count row to wrap. The actual 390/1440 captures and text bounds show the complete counts. Other enlarged controls still have defects. |

The runtime changes preserve existing export policy, validation booleans, diversity thresholds and provider boundaries. Generated API metadata reflects the existing local Convex modules. No dependencies or backend schema were changed by these slices.

## Evidence and replay

The [portable packet](promotion/evidence/portfolio-current-consumer-20260905/README.md) contains raw before/after captures, actual exported files, failed probes, passing logs, source hashes and independent judgments. Its manifest maps each original evidence path to its byte-preserved copy. Source/script snapshots use a `.txt` suffix so the application test collector does not execute historical tests. Archived Markdown uses `.md.txt` to keep historical citations out of the current documentation checks without changing their original bytes.

The source-validation full check on 2026-09-05 passed in 145.859 seconds before publication. After correcting the archived Markdown filenames, the unchanged five-test documentation owner passed, but the next ordinary full check failed in 184.375 seconds: the existing six-kind NodeBook scenario exceeded its 60-second deadline. The other 315 files and 2,822 tests passed, with seven skips; that run did not reach workspace tests or builds. Full local readiness remains held. Earlier OpenUI and NodeBook failures remain historical evidence, and the timing cause is not yet established. No timeout, retry, skip or concurrency setting was altered.

The actual browser proof used two retained synthetic decks at version 3, with passing and failing Deck CI outcomes. At 390×844 and 1440×960, three native keyboard entry/reload rounds per deck exercised twelve journeys. The primary source scenarios separately cover pending, unavailable, stale-version, wrong-deck and warning states. Component scenarios are not pixel or production proof.

To repeat the author journey in your own local session:

1. Choose the deterministic model and paste a brief containing a CSV header and separate rows for Month 1/100, Month 2/120 and Month 3/140.
2. Create the deck, change its title and add multiline Unicode presenter notes. Reload and verify both current values persist.
3. Download JSON and PPTX. Inspect the exact submitted prompt, chart values and notes in those actual files. Opening the PPTX in native Office is a separate check.
4. Open Deck CI using the keyboard on phone and desktop widths. Check that its detail identifies the current version and actual reason; an older core receipt must not imply overall readiness.
5. Test pending/unavailable and stale-result cases through the existing component scenarios. Keep fixture results distinct from the real backend journey.

## Remaining work before a complete product handoff

- Presenter notes overlap the slide pager/zoom controls. Enlarged inspector navigation, density controls and the fixed-height footer can clip text. The doubled-text proof only certifies the repaired check counts.
- Six normal viewport sizes have captured evidence, but complete accessibility, keyboard, touch, human-device, performance and long-session coverage is unfinished. Full visual, responsive and interaction dimension grades remain unassigned.
- The deterministic CSV chart uses the generic unit `value`. Source-column fidelity, prose-only numeric extraction and bare-CR CSV parsing are not certified. The native Office application was not opened.
- The real model-provider path and production deployment are unverified in this slice. Export success is not proof that a deck meets every quality check.
- Shared CI and consumer integration must be judged at the actual review commit. Historical package-consumer proofs remain bound to their original source; the latest full check does not relabel them as new consumer runs.
- Original dirty clones, branches and worktrees remain preserved. Do not wholesale merge them into this candidate or retire them based on this scoped repair.

The next implementation should address the observed notes/control overlap in its existing layout owner, with an actual before boundary and separate proof. Keep this handoff current when a slice is independently accepted.
