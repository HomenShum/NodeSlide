# Promotion log — NodeSlide

Loop state lives here, in git, so any agent can resume cold. One entry per
iteration. Append; never rewrite history, because the list of things that turned
out to be wrong is more useful to the next reader than the current values alone.

Iteration cap: **10** (default). On reaching the cap without a gate pass, stop
and leave the remaining defect ledger below — a documented stop is a valid
outcome; a silent one is not.

## Entry shape

```
### Iteration N — YYYY-MM-DD
- Journey exercised: J<k> <name>
- Observed: <the defect, with its reproduction — inputs, width, state>
- Fixed: <the change, using existing components; file paths>
- Re-proved: <evidence path showing the defect gone in the rendered app>
- Tests: <command and result>
- Conditions newly PASS: <numbers, or "none">
```

---

## Baseline — 2026-08-13

Fresh clone of `main` at `4c6f9ba`, Windows 11, npm workspaces, Playwright
Chromium 149.0.7827.55 at 1280×800 and 390×844. **Nothing was fixed this
iteration** — a baseline that quietly repairs the product is a baseline nobody
can compare against.

- **App started:** yes. `npm run dev:web` (vite 6.4.3, `localhost:5180`) against
  `npx convex dev`, which provisioned an **anonymous local** Convex deployment
  at `http://127.0.0.1:3210` with no account and wrote `VITE_CONVEX_URL` into
  `.env.local`. Without that variable `src/main.tsx` renders the
  `deployment-configuration-error` guard instead of the app; it did not, so the
  guard was never hit.
- **Journeys drivable:** 2 of 6 completed (J0 quickstart, J4 Artifact Atlas).
  J1 failed server-side, J5 failed on message quality, J2 and J3 were
  unreachable because they need the deck J1 never produced.
- **Secrets:** none were created, set, or rotated. `OPENROUTER_API_KEY` and the
  private-preview admission variables were absent, which is exactly the state a
  stranger is in, so the failures below are the real first-run experience rather
  than an artefact of a missing key I could have supplied.
- **Scorecard at baseline:** see [PRODUCT_GOAL.md](PRODUCT_GOAL.md) — 0/12 PASS
  (4 FAIL, 8 UNVERIFIED).
- **Capture:** `node promotion/capture-baseline.mjs` →
  `promotion/evidence/baseline/` (5 screenshots + `report.json`).

### Commands run, with real exit codes

| Command | Exit | Note |
|---|---|---|
| `git clone --depth 50` | 0 | 3855 files |
| `npm install` | 0 | ~7 min, 709 + 977 packages, no lockfile change |
| `npx convex dev --once` | 124 | first attempt: killed by my own 90 s time-box during a 36 s typecheck |
| `npx convex dev --once` | 0 | second attempt, 240 s budget: functions ready in 47.6 s, components installed |
| `npm run dev:web` | (long-running) | vite ready in 2.0 s, `localhost:5180` — note it binds `[::1]` only, so `127.0.0.1:5180` refuses |
| `npm test` | **1** | 310 files: 4 failed / 306 passed; 2768 tests: 4 failed / 2757 passed / 7 skipped |
| `npm run build` | **1** | `'tsup' is not recognized` in `packages/convex` |
| `npm run build` (repeat) | **1** | same failure, same place — deterministic, not flaky |
| `npm run build --workspace @nodeslide/convex` | 0 | the identical workspace build succeeds when run alone |
| `npm run lint` | 0 | biome, 1080 files (after formatting the capture script this baseline added) |
| `node promotion/capture-baseline.mjs` | 0 | the capture succeeded; the journey inside it did not |

## Defect ledger

Open defects, most-impactful first. A defect is only listed once it has a
reproduction; a hunch is not a defect.

| # | Severity | Journey | Reproduction | Status |
|---|----------|---------|--------------|--------|
| D1 | critical | J1 | Fresh clone → `npx convex dev` (anonymous local) → `npm run dev:web` → `localhost:5180` at 1280×800 → type any brief into `#nodeslide-landing-prompt` → set `[data-testid="landing-model-select"]` to `deterministic` → **Create presentation**. The composer shows "Reading the brief and evidence…", then fails with `ConvexError {"kind":"nodeslide_create","code":"preview_not_configured"}`. No deck is created — on the route the README calls "needs no API keys". Root cause traced: `convex/nodeslideAgent.ts:1799-1809` (`publicCreationEnabled`) admits a create only if `NODESLIDE_PUBLIC_CREATION=true`, or a durable job row exists, or `validateNodeSlidePreviewAdmission` finds `NODESLIDE_PREVIEW_ACCESS_CODE` **and** `NODESLIDE_PREVIEW_ADMISSION_SUBJECT` in the Convex environment, at `convex/lib/nodeslideValidators.ts:256` (`validateNodeSlidePreviewAdmission`). `npx convex dev` sets none of the three, and none of them appear in the README, `docs/`, or any `.env.example` (there is no `.env.example`, though the README links one). Evidence: `promotion/evidence/baseline/j1-after-create.png`. | documented, iteration 1 |
| D2 | major | J1, J5 | Same page, keyboard only: Tab to the brief textarea (`#nodeslide-landing-prompt`, 5th stop) or to the model select (`[data-testid="landing-model-select"]`, 8th stop) and read the computed style of `document.activeElement` — `outlineStyle: "none"` with `boxShadow: "none"`. Every other stop in the first eight reports `outlineStyle: "solid"`. A keyboard user cannot see where they are on the two controls the landing exists for. Evidence: `report.json` step `keyboard-tab-order`. | **fixed, iteration 2 — and the original diagnosis was half wrong.** Reading only the focused element's own computed style cannot see a group ring, and the composer draws one (`.ns-landing-composer:focus-within`), so "no visible focus indicator" was too strong: something was highlighted. What was actually broken is worse to use and was invisible to that probe — the ring is on the group, identical for all three controls, and already lit when focus arrives, so tabbing brief → model → effort changed nothing at all. Re-measured in `promotion/evidence/audit-2026-08-13/before-dev/report.json` (`wig.tabStops[].indicatorOn` = `form.ns-landing-composer` for exactly those three stops, `self` for the other ten) and closed in `after-dev`/`prod` (13 of 13 `self`). |
| D3 | major | J5 | The failure text a stranger is given is "NodeSlide private-preview admission is not configured." — an internal concept, no next action, and no control on the landing can supply an access code (the only `[data-testid="preview-access-code"]` field lives in `ProjectDialog.tsx`, and `NodeSlideLanding.start()` sends no `accessCode` at all). Typed input is correctly preserved and the message is announced (`role="alert"` + toast), so the recovery *mechanics* are fine and only the content fails. Evidence: `promotion/evidence/baseline/j1-after-create.png`. | open |
| D4 | major | (build) | `npm run build` fails twice out of two at `packages:build` step 11 with `'tsup' is not recognized as an internal or external command`, although `tsup` **is** present at `node_modules/.bin/tsup` and `npm run build --workspace @nodeslide/convex` alone exits 0. Suspected — *not measured* — Windows `PATH` growth across ten chained `npm run build --workspace …` invocations dropping the root `.bin` entry. Verifying that hypothesis is Wave 2's job. Evidence: build log excerpt in the table above. | open |
| D5 | major | (tests) | `npm test` exits 1: `convex/nodeslideUploadExtraction.test.ts`, `convex/lib/nodeslideVariationHarness.test.ts`, `scripts/tests/nodeslide-trust-surface-census.test.mjs` and `src/domains/nodeslide/components/NodeBookWorkspacePanel.test.tsx` each fail with `Test timed out` (5 s, 5 s, 5 s, 60 s), and three further files (`TraceWaterfall.test.tsx`, `JsonInspector.test.tsx`, `packages/react/src/reactSurface.test.tsx`) report `[vitest-pool]: Failed to start forks worker`. All four failures are timeouts rather than assertion failures, so a faster host may hide this; it was still red twice on the machine that ran the baseline. | open |
| D6 | minor | J0 | Vite binds `[::1]:5180` only, so the README's "open the printed localhost URL" works but any tooling that resolves to `127.0.0.1:5180` gets connection-refused. Reproduced with `curl 127.0.0.1:5180` (no route) vs `curl localhost:5180` (200). | open |
| D7 | major | J1, J2 | In the deck editor at 390, 768 and 1440, the slide pager (`.ns-slide-stepper`) and the zoom controls (`.ns-zoom-controls`) are drawn on top of the presenter-notes textarea. Both are `position: absolute; bottom: 14px; z-index: 8` inside `.ns-canvas-panel`, whose last grid row is the notes strip — so "14px above the panel's bottom" lands inside the notes field rather than above the canvas. Measured rectangles at 1440: notes `312,815 → 1088,891`; stepper `312,860 → 413,900` (101×31 px covered); zoom controls `506,860 → 894,900` (388×31 px covered). Identical at the other two widths. The chips are opaque and above the textarea in the stacking order, so the bottom third of the notes field is unreadable and a click there hits "Fit" instead of the text. Found by looking at a screenshot after every automated check on that screen had passed. Evidence: `promotion/evidence/audit-2026-08-13/prod/editor-notes-desktop-1440.png`, `prod/report.json` under `widths[].overlay.collisions`. Correct fix moves the overlays into a non-scrolling wrapper around `.ns-canvas-viewport`, which is a DOM change to the editor shell with pan/zoom to re-verify. | open |
| D8 | major | (all) | The production bundle ships one 5.05 MB vendor chunk (1.47 MB gzip) out of 2,509 KiB transferred. Lighthouse 13.4.1 against `vite preview` (its default mobile profile: 4× CPU throttle, simulated slow 4G) measures FCP 10.4 s, LCP 12.6 s, TTI 13.7 s, max-potential-FID 680 ms, `unused-javascript` est. 1,221 KiB savings — performance 0.46. Nothing is wrong once loaded (keystroke p95 17.5 ms, slide switch 115 ms, first create feedback 82 ms), so this is a load-weight defect, not an interaction defect. It is why conditions 8 and 10 are FAIL rather than PASS. Evidence: `promotion/evidence/audit-2026-08-13/prod/lighthouse.json`. | open |

## Iterations

### Iteration 1 — 2026-08-13
- Journey exercised: J0 quickstart, read the way a stranger reads it.
- Observed: three defects that live in the documents, not in the runtime.
  (a) The quickstart's promise that "the deterministic path needs no API keys" was
  true about keys and false about the button — deck creation is admission-gated and a
  fresh deployment admits nothing, so **Create presentation** fails with
  `preview_not_configured` (D1). (b) The same paragraph linked `.env.example`, which does
  not exist and *could not* exist: `.gitignore` line 51 is `.env*`, so git refuses the
  file — the link had never resolved once. (c) `promotion/PROMOTION_LOG.md` and
  `promotion/PRODUCT_JOURNEYS.md` were unreachable from the README.
- Fixed: the `README.md` quickstart now runs
  `npx convex env set NODESLIDE_PUBLIC_CREATION true` and names all three admission
  variables and where they live; the dead `.env.example` link is deleted rather than
  replaced, because all three are Convex deployment variables and a dotfile example would
  have pointed at the wrong mechanism; the Documentation section links both promotion
  documents. No runtime behavior changed — the admission gate is untouched.
- Re-proved: `scripts/tests/docs-citations.test.mjs`, a new guard, plus the knockout that
  shows it is not decorative. Reverting the quickstart line and restoring the
  `.env.example` link fails it with `README.md -> .env.example` and
  `expected … to contain 'npx convex env set NODESLIDE_PUBLIC_CREATION true'`. Moving one
  citation twenty lines *inside* its own file — the drift a range check cannot see — fails
  it with `convex/nodeslideAgent.ts:1779-1789 does not contain "publicCreationEnabled"`.
- Also found by the new guard, which is why it was worth writing: of the 14 `file:line`
  citations in `README.md`, `docs/` and `promotion/`, **8 pointed at the wrong line** —
  `convex/schema.ts` cited at line 486 for a table that starts at 1004, `nodeslideAgent.ts`
  at 94 for an action at 481, `nodeslide.ts` at 368/382/396 for queries at 751/769/787. All
  are repointed, and every citation now carries the symbol the reader should land on.
- Tests: `npx vitest run scripts/tests/docs-citations.test.mjs` — 5 passed.
- Conditions newly PASS: none. D1's *runtime* cause is unchanged; what changed is that the
  documented path now works, so the row reads `documented`, not `fixed`.

### Iteration 2 — 2026-08-13 (the two audits the baseline could not run)

- Journey exercised: J1 end to end — brief → **Create presentation** → editor — at 390, 768
  and 1440, plus the error and empty states, on both the dev server and the **built** bundle.
- **The baseline's blocker is gone.** With `npx convex env set NODESLIDE_PUBLIC_CREATION true`
  (the line iteration 1 added to the README quickstart), `createDeckFromBrief` returns a deck
  instead of `preview_not_configured`: outcome `studio` in 682 ms on the deterministic route,
  in every one of the five audit runs. So the editor — the surface the baseline scored eight
  conditions UNVERIFIED against because it never rendered — was measured this time.
- Observed, and what it cost to see each one:
  - **W2/D2, focus.** Three composer controls indicated focus only on the shared composer,
    which is already lit when focus arrives, so tabbing between them changed nothing. Invisible
    to a probe that reads the focused element's own style — see D2's revised row.
  - **W3, the file input had no accessible name.** axe `label`, impact critical; the sole
    reason Lighthouse accessibility was 0.93.
  - **W4, brand link `label-content-name-mismatch`.** Reported by Lighthouse and **not** by
    `@axe-core/cli`: same axe-core 4.13.0, different default tag sets. Running one is not
    running the audit.
  - **W5, 15px textarea and 11px selects at 390** — iOS zooms the viewport on focus under 16px.
  - **W6, the create button was 40×40 at 390**, under the 44px mobile floor.
  - **D7, the canvas overlays are drawn over the presenter-notes field** at all three widths.
    Every automated check on that screen passed; it took looking at a screenshot.
  - **D8, one 5.05 MB vendor chunk** → LCP 12.6 s / TTI 13.7 s on Lighthouse's throttled mobile
    profile, against interaction that is fine once loaded (keystroke p95 17.5 ms).
- Fixed: W2–W6, all in `src/domains/nodeslide/nodeslideV3.css` and
  `src/domains/nodeslide/components/NodeSlideLanding.tsx`. Two `outline: 0` declarations
  deleted so the existing global `:where(:focus-visible)` ring applies (it never fired because
  `:where()` contributes zero specificity); `aria-label` on the file input; the brand mark
  moved from a text node into CSS `content`; 16px inputs and a 44×44 submit at the ≤699px
  breakpoint. No runtime behaviour changed. D7 and D8 are **not** fixed — both are structural
  changes to surfaces this iteration did not otherwise touch, and both are logged with
  reproductions rather than attempted at the end of an audit.
- Re-proved: three full audit runs, same script, committed under
  `promotion/evidence/audit-2026-08-13/` — `before-dev/` and `after-dev/` isolate the fixes on
  the dev server, `prod/` is the built bundle and is what the scorecard cites.
  axe violations 1 → 0, Lighthouse accessibility 0.93 → 1.00, focus stops with their own ring
  10/13 → 13/13, mobile inputs under 16px 3 → 0. Console errors 0 and failed requests 0 across
  every run, now including the editor.
- Also measured, for D4's open hypothesis: all **15** workspaces build alone, exit 0 each
  (`npm run build --workspace <name>` in a loop), and `npx tsc -b && npx vite build` then
  succeeds. `npm run build` still fails — at the *first* chained workspace, not a later one,
  which does not fit "PATH grows across ten invocations" and points instead at the three-deep
  `npm run` → `npm run` → `npm run --workspace` nesting. D4 stays open; this narrows it.
- Tests: `npx vitest run scripts/tests/nodeslide-landing-a11y.test.mjs` — 7 passed. Knockout:
  restoring `outline: 0`, dropping the `aria-label`, putting the `N` back in the link text and
  reverting the mobile font size fails 4 of 7. The guard is source-level on purpose so it runs
  in `npm test` with no browser; the rendered proof is `node promotion/run-web-audits.mjs`.
- Commands run, with real exit codes:

  | Command | Exit | Note |
  |---|---|---|
  | `npm install` | 0 | fresh clone |
  | `npx convex dev --once` | 0 | anonymous local deployment, functions ready in 1.23 m |
  | `npx convex env set NODESLIDE_PUBLIC_CREATION true` | 0 | the README quickstart line |
  | `npx vite --port 4906 --strictPort --host 127.0.0.1` | (long-running) | `--host 127.0.0.1` also side-steps D6 |
  | `node promotion/run-web-audits.mjs` ×3 | 0 | before-dev, after-dev, prod |
  | `npx --yes lighthouse@13.4.1 http://127.0.0.1:4906 --output=json --output-path=… --chrome-flags="--headless"` | 0 | inside the script; 3 runs |
  | `npx --yes @axe-core/cli@4.13.0 http://127.0.0.1:4906 --save promotion/evidence/audit-2026-08-13/<run>/axe.json` | 0 | `--save` resolves against cwd — an absolute path is concatenated onto it and the write ENOENTs *after* a clean-looking audit |
  | `npm run build` | **1** | D4, unchanged |
  | `npm run build --workspace <each of 15>` | 0 ×15 | every workspace builds alone |
  | `npx tsc -b && npx vite build` | 0 | the bundle the `prod/` run audits |
  | `npx vite preview --port 4906 --strictPort --host 127.0.0.1` | (long-running) | serves that bundle |
  | `npm test` | **1** | 3 failed / 2809 passed / 7 skipped in 136 s; all three are timeouts, no assertion failures — one fewer failure than the baseline's four |
  | `npm run lint` | 0 | after adding `promotion/evidence` to `biome.json`'s ignore list: biome reformats committed tool output, and reformatted Lighthouse output is no longer Lighthouse's output |
  | `npx vitest run scripts/tests/nodeslide-landing-a11y.test.mjs scripts/tests/docs-citations.test.mjs` | 0 | 12 passed |

  Screenshots were kept only for the `prod/` run; `before-dev/` and `after-dev/` retain their
  three JSON files each, which is what the A/B cites. The producer regenerates all of it.
- Conditions newly PASS: **3, 4, 5, 6, 9, 12** — 0/12 → 6/12. Six of those were UNVERIFIED only
  because the baseline never got past the landing; the editor is where they were measured this
  time. 7, 8 and 10 move UNVERIFIED → **FAIL**, which is the point of running the audits: the
  reviews happened and each found something real that is still open (D7 for 7, D8 for 8 and 10).
  1, 2 and 11 stay FAIL. **Nothing is UNVERIFIED any more.**
