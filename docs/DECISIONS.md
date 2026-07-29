# NodeSlide decisions of record

A decision recorded only in a chat thread will be re-decided by the code. This file is where a
verdict lands so the next commit has to argue with it instead of quietly reversing it.

**How to use this.** Every entry states the decision, who made it, the evidence behind it, and its
current implementation status. `NOT IMPLEMENTED` is a legitimate state — a decision can be recorded
before it is executed, and recording it is what stops the code drifting further while it waits.
When you change code that an entry governs, update the entry in the same commit.

**What belongs here.** Decisions about *this repo's* product and architecture that were reached
somewhere the compiler cannot see: a design council, an owner instruction, a cross-session
agreement. Not implementation notes — those belong next to the code.

---

## D-2026-07-27-01 · The Design tab is not a standalone destination

**Decision.** Delete the Design tab as a top-level inspector destination. Keep all eight of its
controls and move them into the object inspector, so they appear by selection: text selected shows
typography, chart selected shows chart controls, nothing selected shows no design controls.

**Decided by** the NodeKit design council (2026-07-27), overruling this session's own proposal to
keep the tab and cut its prose.

**Evidence.** Measured on the deployed build: the Design tab asks **20.9 words of reading per
available action** against the AI tab's 6.4 — 3.3× the reading per action. It is not busier than
other tabs; it is wordier. The council's reasoning, verbatim: *"The owner's refusal is stronger
evidence than the raw control count. The tab has failed as an entry point."* And: *"This is not
deleting design capability. It deletes a navigation edge that the measured user does not take."*

**Status: NOT IMPLEMENTED as of 2026-07-29.** `'design'` remains in `InspectorTab`
(`src/domains/nodeslide/inspector/types.ts:1`), in the tab strip (`InspectorPanel.tsx`), and
addressable from the command palette (`NodeSlideStudio.tsx`). Commit `a836c6a` did **not** implement
this — it reinforced the seven-tab strip, which is precisely the drift this file exists to stop.

**Partial credit, and it lowers the cost.** `DesignInspector.tsx` already operates on
`selectedElements`, so the panel is selection-aware today. The remaining work is removing the
destination, not rebuilding the panel.

---

## D-2026-07-28-01 · Google Slides two-way sync ships

**Decision.** Keep the two-way Google Slides sync and port it into this repo.

**Decided by** the owner, 2026-07-28 ("we keeping openui and uicontract" — same instruction round;
the Google Slides call was made separately and earlier the same day).

**Evidence.** The board recorded it as *"ZERO Google integration — capability LABELS, not an API"*,
which was the opposite of the truth: real OAuth authorization-code with PKCE under the narrow
`drive.file` scope, and `slides.googleapis.com/v1/presentations` for read and batchUpdate. A P2 row
describing a working two-way sync as vapour is a row that gets closed during a cleanup.

**Status: SHIPPED, INERT.** The code is on `main` and fails closed. `begin()` throws *"Google Slides
connection is not configured for this deployment"* until the owner sets `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `NODESLIDE_OAUTH_TOKEN_ENCRYPTION_KEY`, `NODESLIDE_GOOGLE_REDIRECT_URI`,
and `NODESLIDE_APP_ORIGINS`. Failing closed is correct; **present-and-non-functional is worse for a
new user than absent**, so this should either be configured or hidden.

---

## D-2026-07-28-02 · OpenUI ships, with its costs accepted

**Decision.** Port the OpenUI visual-materials lab, accepting a 0.x third-party dependency.

**Decided by** the owner, 2026-07-28.

**Terms the decision accepted, which are not negotiable afterwards.** The incoming family renames to
`OpenUi*` so the destination's shipped `NodeSlideVisualMaterial` vocabulary keeps its name. The demo
spec keeps its `verification: 'unverified_scenario'` label, and the banner copy derives from that
field through a lookup table so the sentence cannot drift from the data. **Upgrading that label to
make the port look finished is the move the claim-gate exists to refuse.**

**Status: SHIPPED.**

---

## D-2026-07-28-03 · `uiContract` lands as one channel, never a second version constant

**Decision.** Port `uiContract`, folding its fields into the existing DOM-attribute surface on the
studio root — one writer, one mount point.

**Decided by** the owner, 2026-07-28; the one-channel constraint was not waived by that
confirmation.

**Evidence.** A byte-identical copy previously sat unwired on an abandoned branch with zero callers.
The concrete collision the constraint prevents: the ported module wrote `data-ns-theme` to
`document.documentElement`, while the studio root writes it to `.nodeslide-studio`, keys all theme
CSS off that node, and reads it there in a QA gate. Two writers of one attribute on different nodes,
free to disagree.

**Status: SHIPPED.** The ported module does not write `data-ns-theme` at all. The agent-UI linter
grew from 9 to 24 assertions and was proven able to go red before its new count was believed.

---

## D-2026-07-28-04 · Motion is not forbidden on trust surfaces — *directional* motion is

**Decision.** Narrow the trust-surfaces motion rule. The forbidden thing is a transition that can
move paint toward the **accepted** appearance while the **declared state stays the same**. A generic
hover or focus transition on a decision affordance is ordinary feedback and carries no claim about
the decision.

**Decided by** this session, 2026-07-28, after a runtime probe flagged the consent toggle and the
measurement said the rule was wrong rather than the code.

**Evidence.** motion-ladder forbids motion on review surfaces for three stated reasons — hiding what
changed, implying an uncommitted commit, making failure look like loading. All three concern content
arriving on a review surface; none concerns a button shading under the cursor. The same skill's rung
2 is literally *"CSS — hover, focus, open/close"*. `consent` is not on motion-ladder's list at all;
trust-surfaces added it to its taxonomy and inherited the ban whole — **the ban widened, its reasons
did not.**

The second clause is load-bearing: when the toggle is pressed, `aria-pressed` flips synchronously
and paint catches up over 150ms. **Paint lagging a committed decision is not a claim about an
uncommitted one.**

**Status: SHIPPED and gated.** The probe measures `:hover/:focus/:active` endpoints in Oklab against
the accept hue. Keyframe and WAAPI animations are **not** narrowed. A permanent
`DIRECTIONAL_KNOCKOUT` changes exactly one thing on the live toggle — the ungranted hover endpoint
becomes the granted fill — and flips the clause red, so the narrowed rule cannot quietly become no
rule. The static census stays deliberately stricter, because a source-static gate cannot resolve the
cascade and faking that narrowing would be dishonest.

---

## D-2026-07-28-05 · The durable edit-job path stays rejected

**Decision.** Port the durable-job seam for **create** (validator plus identity binding). Leave
**edit** rejected, and move its refusal to enqueue time.

**Decided by** this session, 2026-07-28, after settling the question empirically against the
deployed backend rather than by reading code.

**Evidence.** Both paths did fail, on `ArgumentValidationError`. Convex rejects undeclared arguments
**at the callee boundary, before the handler runs** — so the deck-id prefix mismatch was real but
unreachable, because validation always fired first. The edit path has **four** undeclared fields,
not one: `clientSessionId`, `durableJob`, `maxCostUsd`, `sourceRefreshBinding`. Convex reports only
the alphabetically first.

**Why edit stays rejected.** `maxCostUsd` is a caller-supplied hard spend ceiling. Declaring it
without honouring it would accept a dollar limit and ignore it — worse than refusing. The refusal now
happens before the idempotency lookup, the quota, the budget row, and the workflow start, naming the
missing fields.

**Status: SHIPPED.** Nothing a user touches enqueues a durable job — the shipped bundle has zero
references to `nodeslideJobs`. The live path is the direct action call from `NodeSlideStudio.tsx`
and MCP, which was never affected.

---

## D-2026-07-29-01 · `clientSessionId`'s authorization model is an open product decision

**Decision.** Not made. Recorded so it is not decided by default.

**The shape.** `clientSessionId` is a de-facto bearer token: the sole argument to the public
`listSessionJobs` query, with no second factor. The primary path is `crypto.randomUUID()` (122 bits,
fine). But `src/lib/sessionIdentity.ts` falls back to `session-<Date.now()>-<Math.random()>`, which is
**not cryptographically random**, is written to `localStorage`, and never rotates.

**What was fixed, and what was not.** Error bodies no longer carry deck capabilities — that was the
urgent half, and it shipped. Whether a guessable session id should gate error detail at all is a
product decision, and an agent deliberately declined to widen or narrow the auth model on its own
authority.

**Status: OPEN — owner decision.**
