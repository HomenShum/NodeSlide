# Canonical journeys — NodeSlide

Five real workflows, in the order a stranger meets them. Not feature tours: a
journey is one person, one goal, and the artifact they hold when it worked.
These are the promotion loop's work queue.

**A journey with no browser evidence is unfinished**, regardless of test status.

Baseline evidence for all of them was captured by
[`promotion/capture-baseline.mjs`](capture-baseline.mjs) against a local run
(`npx convex dev` anonymous local backend + `npm run dev:web` on `:5180`) and
written to `promotion/evidence/baseline/`.

## Journey shape

Each journey states, in this order:

- **Persona and situation** — who arrived, and why today.
- **Goal** — what they want to be true when they leave.
- **Steps** — what they actually do, in the UI, in order.
- **Done when** — the observable artifact or state that proves completion.
- **Evidence** — path to the capture that shows it working. Empty until proven.

---

## J0 — "I cloned it. Make it run." (quickstart)

- **Persona and situation:** An engineer evaluating the repo before trusting it
  with a real deck. They have Node and a terminal, no Convex account, no
  OpenRouter key, and about ten minutes.
- **Goal:** Reach a working NodeSlide in the browser using only the README
  Quickstart.
- **Steps:**
  1. `git clone` → `npm install`
  2. `npx convex dev` (README: "one-time: provisions a Convex deployment, writes
     `.env.local`")
  3. `npm run dev` (or `npm run dev:web`), open the printed `localhost:5180`
- **Done when:** The landing (`[data-testid="nodeslide-landing"]`, heading "What
  presentation should we build?") renders against a live backend — not the
  `deployment-configuration-error` guard in `src/main.tsx`.
- **Status:** **PASS.** `npm install` exit 0 (~7 min). `npx convex dev --once`
  exit 0 — it offered an anonymous **local** deployment (`http://127.0.0.1:3210`,
  "No Convex account") and wrote `VITE_CONVEX_URL` into `.env.local`, so no
  account was needed. Landing rendered.
- **Evidence:** `promotion/evidence/baseline/j1-landing-desktop.png`,
  `promotion/evidence/baseline/report.json` (step `landing-desktop`).

## J1 — "Turn my brief into a deck I can edit" (the product's first promise)

- **Persona and situation:** The person from PRODUCT_GOAL.md, Tuesday night,
  with a brief for Thursday's diligence review and a `pilot-metrics.csv`.
- **Goal:** A deck of the slides they asked for, open in the editor, made of
  editable primitives rather than a picture of slides.
- **Steps:**
  1. Type the brief into `#nodeslide-landing-prompt` on the landing.
  2. Choose a route in `[data-testid="landing-model-select"]` — including
     **"Deterministic · no external model"**, which the README describes as
     needing no API keys.
  3. Press **Create presentation** (`button[aria-label="Create presentation"]`),
     which calls `convex/nodeslideAgent.ts → createDeckFromBrief`.
- **Done when:** `[data-testid="nodeslide-studio"]` renders with the requested
  slides and the slide rail is populated.
- **Status:** **FAIL — this is the baseline's headline defect (D1).** On the
  deterministic route the action rejects with
  `ConvexError {"code":"preview_not_configured","message":"NodeSlide
  private-preview admission is not configured."}`. No deck is ever created.
- **Evidence:** `promotion/evidence/baseline/j1-creating.png` (loading state),
  `promotion/evidence/baseline/j1-after-create.png` (error state),
  `report.json` step `j1-create-deck`.

## J2 — "Ask for a change, then decide whether to take it" (steering + receipt)

- **Persona and situation:** The same person, an hour later. The headline on
  slide 1 is flabby and the chart is pointed at last quarter's numbers.
- **Goal:** Ask in plain language, see exactly what the agent proposes, and
  accept or reject it — never be silently overwritten.
- **Steps:**
  1. Open the **AI** inspector tab (`src/domains/nodeslide/inspector/AiInspector.tsx`).
  2. Type the instruction into the composer (`[data-testid="ai-composer"]`); the
     turn echoes in the thread (`AgentThread.tsx`).
  3. When the proposal lands (`[data-testid="proposal-card"]`), open the
     side-by-side compare (`[data-testid="proposal-preview"]`).
  4. Press **Accept** (`[data-testid="proposal-accept"]` /
     `[data-testid="agent-thread-patch-accept"]`), which commits through
     `convex/nodeslide.ts → applyPatch`/`commitPatch` with a CAS check on
     `baseVersion`.
- **Done when:** The deck version advances, the canvas shows the accepted
  change, and the **Trace** inspector shows the model, the operations, the token
  and cost figures, and the human decision.
- **Status:** **UNVERIFIED** — unreachable: J1 never produces a deck, and the
  live route additionally needs `OPENROUTER_API_KEY` in the Convex environment,
  which this session did not have and did not create.
- **Evidence:** _none yet_

This journey is the **steering** and **receipt** journey the template asks for:
the correction is the steer, the proposal card plus Trace is the receipt.

## J3 — "Take it to the meeting" (export)

- **Persona and situation:** Thursday morning. The room runs PowerPoint on
  someone else's laptop.
- **Goal:** A `.pptx` whose text and shapes are still editable, plus the option
  of semantic HTML.
- **Steps:**
  1. In the studio toolbar, press **Export** →
     `[data-testid="export-pptx"]` (or `[data-testid="export-html"]`).
  2. Validation gates run first and block an unsafe export.
- **Done when:** A `.pptx` downloads and its labelled capability report matches
  what the toolbar promised ("Editable PPTX with fallbacks").
- **Status:** **UNVERIFIED** — blocked by J1; the toolbar was never rendered.
- **Evidence:** _none yet_

## J4 — "Show me what this thing can even make" (Artifact Atlas)

- **Persona and situation:** A skeptical reviewer who does not want to type a
  brief before deciding whether the output is any good.
- **Goal:** Browse real, evidence-bound examples and read their receipts.
- **Steps:**
  1. Open `/?domain=atlas` (`src/domains/nodeslide/atlas/AtlasGallery.tsx`), or
     the **Artifact Lab** button in the landing header.
  2. Filter with `[data-testid="atlas-search"]`, open a card, read the recipe /
     harness / builder / PPTX receipt, download the source JSON
     (`/artifact-atlas-v2/catalog.json`).
- **Done when:** `[data-testid="atlas-gallery"]` renders with a non-zero count
  and a card's receipt fields are readable.
- **Status:** **PASS** at 1280 — "NodeSlide Atlas · 53 slide archetypes across 8
  families, 5 reviewed sources" rendered with the filter rail, the archetype
  grid, and a detail pane showing the source-lane permission table; no
  horizontal overflow, no failed requests. (The **Artifact Lab** panel reached
  from the landing header is a *different* surface — 38 evidence-bound recipes —
  and was not driven this session.)
- **Evidence:** `promotion/evidence/baseline/j4-atlas.png`, `report.json` step
  `j4-atlas`.

## J5 — "It broke — get me back to a good state" (recovery)

- **Persona and situation:** Anyone whose create or agent run fails: no key, a
  provider timeout, a stale deck version.
- **Goal:** Understand what failed and what to do next, without reloading or
  losing the brief they typed.
- **Steps:**
  1. Trigger a failing create (this baseline did so by accident: a fresh local
     deployment).
  2. Read the inline message under the composer and the toast.
  3. Correct the cause and retry from the same screen.
- **Done when:** The message names the cause **in the user's terms**, offers the
  next action, and the retry succeeds without losing typed input.
- **Status:** **FAIL (partial).** The mechanics hold — the brief is preserved,
  the error is announced in a `role="alert"` region and mirrored in a dismissible
  toast, the app does not crash. The content does not: "NodeSlide private-preview
  admission is not configured." names an internal concept, offers no next action,
  and no control anywhere on the landing can supply what it is asking for.
- **Evidence:** `promotion/evidence/baseline/j1-after-create.png`.

---

## Journeys every agent surface owes

- **Recovery** — J5. Exercised, and it is where the baseline's usability defect
  lives.
- **Steering** — J2, step 1–3. Not yet reachable.
- **Receipt** — J2, "Done when" (Trace inspector). Not yet reachable.
