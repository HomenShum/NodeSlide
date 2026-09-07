# NodeSlide developer handoff — 2026-09-05

An author needs an editable deck whose data, revisions and review status can be checked before sharing. The accepted recovery slices preserve multiline briefs, expose the reason a broader deck check failed, make repository checks work from a Windows path containing spaces, and separate notes from slide navigation and zoom controls. The complete product is still under review.

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
| Edit presenter notes, navigate and adjust zoom | Bottom-positioned pager and zoom controls covered the note editor and obstructed phone targets | Put the unchanged groups in a wrapping row before notes; reserve its height and preserve handlers, save-on-blur, zoom and export policy. The new notes packet records the scoped before/after proof. |

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

## Notes and canvas controls: current scoped acceptance

The [notes-controls packet](promotion/evidence/notes-controls-20260905/README.md) records the current three-source layout repair and its independent source judgment. Pager and zoom now occupy their own wrapping row before notes. Ten before states retain the original obstruction; eleven after states show separated rows and unobstructed positive-size targets. The proof includes twelve consecutive note revisions and three native toggle/navigation/zoom/reload bundles, including phone and doubled-text conditions.

The original interaction script remains failed at its final PPTX wait: the replacement note removed the required illustrative disclosure, so export was correctly refused. Recovery restored that disclosure plus the new note, advanced the deck from version 15 to 16, and downloaded actual JSON and PPTX. All three earlier files, other slides and source data remained exact. Independent parsing verifies Unicode/LF notes and the two PPTX ZIP/XML structures. This is file inspection, not native Office rendering.

One ordinary current `npm run check` passed on 2026-09-05 in 150.969 seconds: lint, app/workspace typechecks, 2,823 root tests with seven existing skips, 42 workspace tests and builds. This does not explain or repair the earlier Windows NodeBook deadline failure. The twelve-round interaction proof is not a one-minute endurance or multi-user test.

To inspect this packet without a backend, from the repository root run:

```powershell
python promotion/evidence/notes-controls-20260905/verify.py
```

For your own local author journey, use the setup above, open notes, edit and blur, navigate away and back, adjust minus/plus/Fit, then reload and inspect JSON/PPTX. Preserve any illustrative disclosure required by export policy. The archived operator scripts are inert records with historical paths and synthetic access assumptions; do not run them as bootstrap instructions.

Historical integration only: PR 185 merged as `8177142416b6a6f59df057d0e5ab25df08db93ec` on 2026-09-05 at 16:54:08Z. An independent public read at 17:11:48Z identified that base and its content after normal CI/deployment automation. [The dated base judgment](promotion/evidence/notes-controls-20260905/raw/E6g_NODESLIDE_POSTMERGE_FINAL_JUDGE.md.inert.txt) is historical evidence. The current notes repair is local and has no shared-CI or deployment claim yet.

## Remaining work before a complete product handoff

- Notes/control separation is accepted only for the captured states. Enlarged header, slide text, inspector navigation, density controls and the fixed-height footer can still clip text; textarea resize and short-height behavior remain open. Doubled text is computed-font scaling, not browser zoom or device acceptance.
- Six normal viewport sizes have captured evidence, but complete accessibility, keyboard, touch, human-device, performance and long-session coverage is unfinished. Full visual, responsive and interaction dimension grades remain unassigned.
- The deterministic CSV chart uses the generic unit `value`. Source-column fidelity, prose-only numeric extraction and bare-CR CSV parsing are not certified. The native Office application was not opened.
- The real model-provider path and production deployment are unverified in this slice. Export success is not proof that a deck meets every quality check.
- Shared CI and consumer integration must be judged at the actual review commit. Historical package-consumer proofs remain bound to their original source; the latest full check does not relabel them as new consumer runs.
- Original dirty clones, branches and worktrees remain preserved. Do not wholesale merge them into this candidate or retire them based on this scoped repair.

The next product work must start from the remaining observed layout/device limits and the unexplained Windows timing evidence. The current notes repair is ready for publication review; it does not close those separate requirements.

## Production dependency boundary — 2026-09-07

This dependency patch pins PDF.js 6.2.108, resolves fast-uri 3.1.6 and qs 6.16.0, and uses the [documented PptxGenJS manifest-only derivative](vendor/pptxgenjs/README.md). Use Node 22.13 or later within major 22; the recorded environment is 22.22.2. The derivative preserves every upstream executable body and the MIT license while removing the unused image-size dependency. Native lock reconciliation also removed the stale root cmdk and @types/katex declarations absent from package.json; MCP's required @types/katex package remains.

The fresh ordinary `npm ci` passed, and `npm audit --omit=dev --json` reported zero vulnerabilities. Actual root, CLI, MCP and PptxGenJS resolution could not find image-size; all ten installed PptxGenJS member bodies matched the reviewed derivative. Offline old/patched fast-uri and qs cases reproduced the reported library faults before the update and passed afterward, including 100 bounded repetitions. They do not establish exploit reachability in an application endpoint.

The full `npm run check` remains failed: lint and typechecks passed, then 2,822 root tests passed, seven were skipped and the unchanged six-kind NodeBook host scenario hit its 60-second deadline. That same named failure is recorded above; its timing cause remains unresolved. The four NodeBook packages' 685 installed member bodies and the test/host source stayed exact. No timeout, retry, skip or test source was changed. The previously unreached workspace tests (42 passed) and ordinary build then passed separately. Those separate results do not make the full check pass.

The bounded dependency proof passed 17 PptxGenJS CJS/ESM checks, 19 actual NodeSlide exporter/importer checks and 10 Chromium PDF checks. Saved PPTX files retained editable text, Unicode notes, native chart values and embedded image bytes through repeated import; malformed PPTX was rejected. The two-page PDF was rendered, saved without edits and reopened, with a malformed-input rejection. Its parser/worker bytes match the new Vite output, and all three PDF images were inspected. This is ZIP/XML, actual importer and parser/rendering proof, not native Office, PDF authoring, a complete app journey or a provider test.

Root overrides cover this checkout and its linked CLI/MCP workspaces. Separately packed consumers do not inherit them and retain their independent audit/distribution boundary. Historical UI, consumer and source-hash packets remain unchanged and certify their recorded source, not these new descriptors. The original installation, overwritten outputs, failed collector/helper/check attempts and native receipts are retained in operator-local custody; no private state, profiles or logs are included here. No shared CI, deployment or full-product acceptance is implied.


## Development dependency refresh — 2026-09-07

The current local lock advances Browserslist to 4.28.9 and PostCSS’s nested Nanoid to 3.3.18 within their existing parent ranges, together with five Browserslist data/updater packages. All production, workspace and vendor lock rows and package declarations remain unchanged, including root Nanoid 6.0.0 and PostCSS 8.5.25. A fresh ordinary `npm ci`, complete dependency inventory and full installed `npm audit --json` passed; the full audit reported zero findings. Exactly seven installed package metadata files changed. These tools participate in building the application; their development classification is not an advisory exemption.

The unchanged normal check passed lint and typechecks, then failed three assertions in the NodeKit reference-authority test: 2,820 root tests passed and seven were skipped. The immutable verifier reported a reference rule as untracked because its catch masks the underlying Git exception. A bounded diagnostic on the retained fixture exposed Git’s `Filename too long` error for the full revision plus rule path; the same tracked bytes were readable through the shorter `HEAD` expression. The test, adapter and installed authority implementation are unchanged. The six-kind NodeBook case passed in 57.772 seconds with its original 60-second deadline; that observation does not explain the historical timeouts. Workspace tests were not reached by this check. The unreached ordinary package/application build passed separately; it does not convert the failed check into a pass. Local build warnings retain the absent `VITE_GIT_SHA` value and large chunks.

One causal successor changed only the runner’s owned `TEMP`/`TMP` to a shorter path, retaining the isolated Git configuration and every source, wrapper and deadline. All four reference-authority tests passed. The unchanged full check still failed: 2,821 root tests passed, seven were skipped, and the approved-PDF extraction case and six-kind NodeBook case timed out at their existing 5- and 60-second limits. Their timing causes remain unresolved. Workspace tests and build were not reached. The earlier accepted complete build was restored with exact byte continuity from custody; it was not regenerated by this check. No third full check or extended-timeout retry ran.

The old installation, build outputs, tracked generated preimages and failure receipts remain in operator custody. The ignored local environment file was temporarily retained and restored with exact inode/metadata, without reading its contents. Historical proof packets remain tied to their original inputs. This slice has no new browser, provider, shared-CI or full-product acceptance claim.
