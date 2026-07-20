# Next coding-agent session — start here

Written 2026-07-19; last updated same day at `main` = `7e20b9c` (clean tree,
prod verified live). Read this, then `docs/CAPABILITY_PLAN.md` (the checklist
of record), then `docs/EXTRACTION_BOUNDARY.md` (rules you must not break).
Mirror rule: every change under `src/domains/nodeslide/` or `convex/` must
also land in `HomenShum/parity-studio` (dev monorepo, main @ `96c6e45`) in the
same session.

## Where things stand

- **Prod is live and publicly replicable**: https://nodeslide.vercel.app
  (frontend, Vercel project `nodeslide`) + Convex prod `agile-stoat-411`
  (has `OPENROUTER_API_KEY`, `NODESLIDE_PUBLIC_CREATION=true`). Deployed
  bundle at handoff: `index-C0jhFaau.js`.
- **Test corpus: 635 tests / 84 files, all green.** tsc 0, biome clean.
  The corpus only grows — never delete a failing test; retarget honestly.
- Four capability arcs shipped today (see CAPABILITY_PLAN checkmarks, each
  with commit + live-proof evidence): measured layout + 6 archetypes +
  geometry gates (A complete, 6/6 live-deck acceptance), charts D complete
  (7 types, native PPTX, live bar→line switch), creation self-critique B1,
  orchestrator/worker routing B2 (live-proved: Planner · Kimi K3 +
  Executor · Gemini 3.5 Flash in one turn), edit shadow-verify loop B4,
  KaTeX C1/C3 + PPTX math seam C2, Openverse licensed images E1/E4,
  evidence lineage F1–F3, UX debt G1/G4, CI runtime smoke H1,
  ecosystem map J1–J4 (`docs/ECOSYSTEM.md`).

## What is open (priority order for the next arc)

1. **I2–I6 packaging** (the platform arc — everything else is stable enough):
   backend ports (`NodeSlideRepository` + Memory/Convex/Http adapters),
   StudioShell/ConvexStudioAdapter split of `NodeSlideStudio.tsx` (the ONE
   backend seam — see EXTRACTION_BOUNDARY.md "one-seam discovery"),
   headless/styled react split, installer. The adapter contract draft is in
   `docs/ECOSYSTEM.md`.
2. **I7–I8 NodeRoom consumer proof** — required architectural test; NodeRoom
   repo is at `D:/VSCode Projects/noderoom` (NodeAgent surface mapped in
   ECOSYSTEM.md with file anchors). Use NodeRoom's existing NodeAgent
   runtime; never embed a second runtime.
3. **H2–H3 ops**: nightly fail-closed prod probe (create→edit→export;
   scripts exist in session scratchpads — rewrite cleanly into `scripts/`),
   CI-driven Vercel deploys (replace manual prebuilt staging).
4. Smaller: C4 (open the math-raster PPTX in real PowerPoint), B6-camera
   (routed run recorded on video — the trace token/cost readout half is now
   PROVED live, see CAPABILITY_PLAN B6), B5 judged variations, E2/E3 (BYOK
   image gen, crop), J5, H4 (repo hygiene: `nodeslide-deploy/` staging dir,
   stale local branches `extract/codebase` / `feat/ai-elements-composer` /
   `feat/depth-governance-port` are merged — prune).
5. **B6 revise-branch demo (small, honest-checkmark blocker)**: the
   2026-07-19 fault-injection runs showed a robust model absorbs induced
   layout faults at generation time, so the self-critique REVISE pass never
   fires live ("1 pass, clean" every run). To demonstrate + regression-test
   the 2-pass path honestly, add a dev-only synthetic fault flag (env-gated,
   labeled in the trace) or run a deliberately weak model. Do not fake it.
6. **Stale-socket UX (real user pain, found live)**: after a prod redeploy,
   an already-open client's Convex ACTIONS fail with masked "Server Error"
   until reload (queries keep working). Reproduced this session; backend
   proven healthy via direct `npx convex run`. Detect the failure class and
   show an honest "NodeSlide was updated — reload to continue" banner.
7. **Convex log observability**: `npx convex logs --prod` streamed nothing
   during live failing AND succeeding actions this session (CLI vs
   deployment issue?). Diagnose — blind prod made a 10-minute bug chase into
   an hour.
8. **Open PRs to triage (do not blind-merge)**: nodeslide draft PR #5
   "injectable core boundary" (Codex); parity-studio draft PR #18
   "external interoperability" (Codex) and PR #17 (nodeslide README docs,
   open since 07-14 — review or close).

## How to work (proven pattern, keep it)

- **Arc = one Workflow run, sequential agents, each: implement → gate →
  commit.** Parallel only for read-only work. One git-index owner at a time.
- Every agent prompt carries: boundary rules, gate commands, honest-return
  clause ("complete every step before returning — no 'waiting' returns"),
  and a stop-rule (revert + report if blast radius explodes).
- **Fail-closed verification is the house style**: assert real product
  state, never claim by caption/log. "Build passed" is not "it runs" —
  `scripts/smoke.mjs` exists because a green build once shipped a blank
  page. Live-DOM verify prod after every deploy (bundle hash must match
  local dist).
- A **second Claude session pushes to origin/main mid-arc** sometimes
  (PR #4, dialog fixes landed that way). On push rejection: pull --rebase,
  re-run gates, push. Never force-push, never reset.

## Commands that matter

```bash
# gates
npm run typecheck && npm test
npx biome check --write <touched files>
# prod build + runtime smoke
VITE_CONVEX_URL=https://agile-stoat-411.convex.cloud \
VITE_CONVEX_SITE_URL=https://agile-stoat-411.convex.site npm run build
SMOKE_PORT=43xx node scripts/smoke.mjs
# deploy
npx convex deploy -y
# frontend: stage dist/* + vercel.json rewrites into
# "D:/VSCode Projects/nodeslide-deploy/nodeslide", then from there:
npx vercel deploy --prod --yes --archive=tgz   # archive flag: plain deploy once hung 13min
```

## Traps already paid for (do not re-pay)

- `manualChunks` substring matches break React init order — exact folder
  regex only (vite.config.ts comment).
- OpenRouter models with `reasoning:true` burn budget before JSON (Kimi,
  Gemini Flash) — pin overrides via `NODESLIDE_OPENREF_MODEL_OVERRIDES`
  pattern in `convex/lib/nodeslideProvider.ts` (`openrouterProviderWithOverrides`).
- Creation needs the 240s provider budget; slide count is enforced by the
  response schema, not the prompt.
- The default bar chart is DIV-based (`.ns-chart--bar`); SVG only for the
  other chart types — probes must not assume `svg rect`.
- Export gate = client `validateSnapshot`; geometry checks are now
  single-sourced in shared — keep them agreeing (A4).
- Windows autocrlf: local biome CRLF noise on untouched files is expected;
  committed blobs are LF.
- Playwright scripts must run from the repo root (module resolution); the
  landing model select is native (`selectOption`), the composer/radix
  selects are not.
- Native `<dialog>` elements resolve to `position:absolute` — flex centering
  on a backdrop never applies, and a content-sized dialog collapses its
  `minmax(0,1fr)` grid row to 0. Fixed on `.ns-project-dialog` with
  `inset:0; margin:auto` + definite `height` (commit `40dc0bd`, live-verified
  via computed geometry on prod). Reuse this pattern for any future modal.
- git-bash `/tmp` is invisible to Windows Python; use a real Windows path
  (session scratchpad) for files shared across tools. Stray `./NUL` files
  break `git add -A`.
- `npx convex run <fn> '<json>' --prod` is the fastest way to get an
  UNSANITIZED server error when the client only shows "Server Error" —
  valid providerModes are `deterministic` / `openrouter_free` / `nebius`,
  consent token `openrouter_full_brief_v1`.

## Submission context (why this repo exists)

AI Fund SlideLang Build Challenge (Mike Rubino). The demo video is embedded
in README (plays on GitHub); the Gmail draft to mike@aifund.ai has a
`<VIDEO LINK TO INSERT>` placeholder — the human sends it. Honesty doctrine
is the product thesis: never let a caption, capability claim, or trace say
something the system didn't do.
