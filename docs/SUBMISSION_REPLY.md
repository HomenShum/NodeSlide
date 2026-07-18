# AI Fund Build Challenge — reply draft (Mike Rubino thread: "AI Fund - event follow up!")

Status 2026-07-18: paste-ready. The live-agent demo link was the last missing
piece — it now exists (recorded today against the deployed backend + live
Kimi K3 route). Deadline extension was requested 2026-07-12; this completes
the deliverable set.

---

Hi Mike,

Thanks for the extension — here is the complete Build Challenge submission for
the hosted deck-as-code platform.

**Hosted prototype:** https://parity-studio.vercel.app/?domain=nodeslide
(no sign-up; the landing's "Explore the editable sample workspace" drops you
into a live deck immediately)

**Demo video:** `docs/demo/agent-thread-live-kimi.mp4` in the repo (43s live
agent segment — unedited single take: instruction → agent turn streams in
under a second → validated proposal with a cited source in ~30s → side-by-side
Compare → patch accepted in place, deck version advances). The narrated 3-deck
product walkthrough is alongside it in `docs/demo/`.

**Source code:** https://github.com/HomenShum/NodeSlide — reviewer access
granted for this thread; say the word if the invite hasn't landed.

**PRD:** `docs/PRD.md` · **TDD:** `docs/TDD.md` (both code-grounded: every
claim names the file that implements it)

**What I personally built:** the deck-as-code type system (`DeckSnapshot` —
typed slides/elements/sources with normalized geometry and version clocks;
render targets are derived, never the source), the patch/review model
(agent edits land as validated, reviewable patches with CAS version guards —
never direct writes), the agent runtime on Convex (durable runs, messages,
spans with per-step model/token/cost telemetry), and the conversational
review UI (AgentThread: visible tool steps, citations, accept-in-place).

**What I reused (disclosed):** React/Vite/Convex/Tailwind + shadcn and
Vercel AI Elements primitives; OpenRouter for model routing (Kimi K3 default);
Radix for accessible interaction primitives.

**What broke and how I debugged it:** the agent route itself. The default
model route was dead (missing key + the model absent from the client catalog),
and Kimi K3 initially returned empty content because `reasoning: true`
consumed the token budget before any text. I root-caused it request-by-request
against the OpenRouter API, registered the model with honest pricing so cost
receipts are non-zero, made it the validated default, and pinned it with
tests (485 green). The demo video is that same route working end to end —
the failure, the fix, and the proof are all in the git history.

One persona, per the prep guide: the solo founder who has to walk into a
review with a deck whose every number can be defended. NodeSlide's answer is
that the deck is a typed artifact — edits are patches, patches carry sources,
and review is a diff you accept, not a bitmap you squint at.

Happy to walk through any of it live.

Best,
Homen

---

## Access notes (for the reviewer packet)

- Prototype is anonymous-access; sample workspace seeds instantly.
- The demo was recorded on the current feature branch (`feat/ai-elements-composer`)
  driving the DEPLOYED Convex backend and the LIVE Kimi K3 OpenRouter route —
  the app shell ran locally (prod build of the branch pends one vendor-chunk
  fix); nothing in the agent loop is mocked.
- Verification state at recording: `tsc -b` clean, 485/485 Vitest,
  `npx impeccable detect` zero findings on the touched UI.
