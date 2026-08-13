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
| D1 | critical | J1 | Fresh clone → `npx convex dev` (anonymous local) → `npm run dev:web` → `localhost:5180` at 1280×800 → type any brief into `#nodeslide-landing-prompt` → set `[data-testid="landing-model-select"]` to `deterministic` → **Create presentation**. The composer shows "Reading the brief and evidence…", then fails with `ConvexError {"kind":"nodeslide_create","code":"preview_not_configured"}`. No deck is created — on the route the README calls "needs no API keys". Root cause traced: `convex/nodeslideAgent.ts:1799-1809` admits a create only if `NODESLIDE_PUBLIC_CREATION=true`, or a durable job row exists, or `validateNodeSlidePreviewAdmission` finds `NODESLIDE_PREVIEW_ACCESS_CODE` **and** `NODESLIDE_PREVIEW_ADMISSION_SUBJECT` in the Convex environment (`convex/lib/nodeslideValidators.ts:255`). `npx convex dev` sets none of the three, and none of them appear in the README, `docs/`, or any `.env.example` (there is no `.env.example`, though the README links one). Evidence: `promotion/evidence/baseline/j1-after-create.png`. | open |
| D2 | major | J1, J5 | Same page, keyboard only: Tab to the brief textarea (`#nodeslide-landing-prompt`, 5th stop) or to the model select (`[data-testid="landing-model-select"]`, 8th stop) and read the computed style of `document.activeElement` — `outlineStyle: "none"` with `boxShadow: "none"`. Every other stop in the first eight reports `outlineStyle: "solid"`. A keyboard user cannot see where they are on the two controls the landing exists for. Evidence: `report.json` step `keyboard-tab-order`. | open |
| D3 | major | J5 | The failure text a stranger is given is "NodeSlide private-preview admission is not configured." — an internal concept, no next action, and no control on the landing can supply an access code (the only `[data-testid="preview-access-code"]` field lives in `ProjectDialog.tsx`, and `NodeSlideLanding.start()` sends no `accessCode` at all). Typed input is correctly preserved and the message is announced (`role="alert"` + toast), so the recovery *mechanics* are fine and only the content fails. Evidence: `promotion/evidence/baseline/j1-after-create.png`. | open |
| D4 | major | (build) | `npm run build` fails twice out of two at `packages:build` step 11 with `'tsup' is not recognized as an internal or external command`, although `tsup` **is** present at `node_modules/.bin/tsup` and `npm run build --workspace @nodeslide/convex` alone exits 0. Suspected — *not measured* — Windows `PATH` growth across ten chained `npm run build --workspace …` invocations dropping the root `.bin` entry. Verifying that hypothesis is Wave 2's job. Evidence: build log excerpt in the table above. | open |
| D5 | major | (tests) | `npm test` exits 1: `convex/nodeslideUploadExtraction.test.ts`, `convex/lib/nodeslideVariationHarness.test.ts`, `scripts/tests/nodeslide-trust-surface-census.test.mjs` and `src/domains/nodeslide/components/NodeBookWorkspacePanel.test.tsx` each fail with `Test timed out` (5 s, 5 s, 5 s, 60 s), and three further files (`TraceWaterfall.test.tsx`, `JsonInspector.test.tsx`, `packages/react/src/reactSurface.test.tsx`) report `[vitest-pool]: Failed to start forks worker`. All four failures are timeouts rather than assertion failures, so a faster host may hide this; it was still red twice on the machine that ran the baseline. | open |
| D6 | minor | J0 | Vite binds `[::1]:5180` only, so the README's "open the printed localhost URL" works but any tooling that resolves to `127.0.0.1:5180` gets connection-refused. Reproduced with `curl 127.0.0.1:5180` (no route) vs `curl localhost:5180` (200). | open |

## Iterations

_none yet — Wave 1 is the starting line, not a fix cycle._
