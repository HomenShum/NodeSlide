# Clause 2's motion ban, narrowed from presence to direction

**Status:** implemented in `scripts/nodeslide-trust-surface-runtime-probe.mjs` (clause A).
**Proposes:** a wording change to the `trust-surfaces` skill and a clarification to `motion-ladder`.
Those two files live outside this repo (`~/.claude/skills/`) and are not edited here — this note
is the proposal, and the code is the reference implementation of it.

## What happened

The runtime probe went red on production against one surface:

```
[data-testid="ai-web-research-toggle"] A_noAnimationOnDecisionAffordance:
computed motion: button[data-testid=ai-web-research-toggle] transition:all/0.15s
;; (declared state data-agent-web-consent="per-send")
```

The declaration is `transition-all` in the shadcn `buttonVariants` base at
`src/components/ui/button.tsx:8` (`transition-all`), reaching the annotated tag through
`InputGroupButton` → `PromptInputButton` — three components above it. The source-static census
reads the annotated element's own `className`, finds it clean, and passes. Only a computed read
sees it. That part of the gate worked exactly as designed.

The verdict it produced was still wrong.

## The judgment: the rule was over-broad, not the code

`trust-surfaces` clause 2 opens with *"No motion on the surface itself (motion-ladder's
forbidden list, inherited whole)"*. Reading the inherited list against the thing it caught is
the whole argument:

- motion-ladder forbids motion on `proposal`, `conflict`, `failed_safe` and diff/review
  surfaces. It gives three reasons: motion can **hide what changed** by moving it while the eye
  is elsewhere, **imply a commit that has not happened** because arrival reads as acceptance, or
  **make a failure look like a loading state**. All three are about *content arriving on a
  review surface*. None is about a button shading under the cursor.
- The same skill's **rung 2 is literally "CSS — hover, focus, open/close, opacity, simple
  transforms"**. The ladder blesses the exact treatment its forbidden-surface clause was being
  read to ban.
- `consent` and `permission` are not on motion-ladder's list at all. `trust-surfaces` added them
  to its own surface taxonomy and then inherited the motion ban "whole" onto them. The ban
  widened by inheritance, without the three reasons widening with it.

So the ban stays; its target gets stated directly instead of by proxy:

> **A transition is a lie iff it can move the element's paint toward the ACCEPTED appearance
> while the element's DECLARED STATE stays the same.**

Both halves are load-bearing.

**"toward the accepted appearance"** — direction, not presence. A hover that shades a
not-yet-granted control toward the granted hue makes it look granted before it is. A hover that
shades it toward a neutral surface colour makes no claim about the decision at all.

**"while the declared state stays the same"** — the deception is *paint running ahead of state*.
When the consent toggle is actually pressed, `aria-pressed` and the variant class flip
synchronously and the paint then catches up over 150ms: the paint **lags** a decision that was
already committed. Feedback that lags a committed decision is not a claim about an uncommitted
one. This is why the probe measures only the endpoints reachable through `:hover`, `:focus`,
`:focus-visible` and `:active` — precisely the paint an element can reach while the DOM still
says nothing has changed.

Keyframe and WAAPI animations are **not** narrowed and stay banned outright. A running animation
is not affordance feedback; it is the arrival/pulse class the ladder names.

## The measurement that settles this specific case

The toggle renders `variant="ghost"` (transparent) while web egress is OFF and `variant="default"`
(`bg-primary`) while it is ON.

| | token | value | OKLab distance to the granted fill |
| --- | --- | --- | --- |
| granted fill (`variant="default"`) | `--primary` → `--color-accent` | `oklch(0.62 0.16 35)` | — |
| ungranted hover endpoint | `--accent` → `--color-surface-hover` | `oklch(0.96 0.015 75)` | **0.372** |
| success token | `--color-success` | `#4f7a52` | 0.431 (from the hover endpoint) |
| threshold | `ACCEPT_PROXIMITY_OKLAB` | `0.10` | — |

Note the naming trap that makes this non-obvious by inspection: Tailwind's `--accent` is **not**
the design system's `--color-accent`. `--primary` maps to `--color-accent` (the brand terracotta)
and `--accent` maps to `--color-surface-hover` (a near-achromatic near-white). The hover moves
*away* from the granted appearance in lightness and carries roughly a tenth of its chroma.

It is not a near miss. A genuine near miss — a slightly lighter shade of the same accept hue —
measures 0.032, comfortably inside the threshold, and is pinned as a test.

## What the reference corpus does and does not support

From parity-studio, branch `feat/design-dna-trust-surfaces`, commit `37db583`
(`docs/design/references/design-dna/`): 20 external observations, all `capturedVia: mobbin-live`.

**It does NOT support the claim that shipped consent surfaces carry hover transitions.** Scanning
every fact across all 20 observations for `hover|transition|animat|duration|ease|spinner|motion`
returns four hits, none of which is a hover or a transition. This is structural and the corpus
says so: `rule-failed-state-carries-no-success-marker-1` notes *"Mobbin captures still frames, so
a spinner that runs for 400ms would not appear in any of them."* A still-frame gallery cannot
witness a hover state. Anyone citing this corpus for "shipped products hover-transition their
consent buttons" is citing something it does not contain, and closing that gap needs an M2 live
re-observation.

**It does support where the boundary sits**, which is the more useful thing:

- `rule-decision-colour-containment-1`, statement: *"The decision colour may sit on the button;
  it may not tint the thing being decided."* The consent toggle **is** the committing control,
  not a container awaiting a decision. The rule explicitly permits the decision colour there.
- The rule's named defect is the counter-instance
  `obs-air-duplicate-asset-conflict-1/f4` = *"selected option row border = blue, matching the
  Confirm button fill"* — commit hue reaching a not-yet-committed container. That is precisely
  what clause A now measures, and it is precisely what the production styling does not do.
- Rubric level 0: *"the accept hue fills or outlines the undecided container"* — direction, again.
- `obs-todoist-calendar-grant-1/f6` = *"accept-control hue = red-orange, matching the product's
  brand mark rather than a green success token"*. This is why `ACCEPT_APPEARANCE_TOKENS` includes
  `--primary` and not only the success tokens: **there is no universal accept hue**, so the
  accepted look must be resolved per product. NodeSlide's `--primary` is itself a terracotta in
  the same family, which is exactly why the direction test has to be perceptual rather than a
  "is it green" test.

Two limits, stated because the corpus states them: every external record is bronze/M1, and
`corpusGaps[2]` reads *"No rule built on it may claim that a pattern WORKS — only that shipped
products do it."* Also `obs-mercor-cookie-purposes-1/f2` = *"optional purposes rendered in the
granted state = 2 of 2"* is a shipped product doing the wrong thing. A reference cannot override
the gate where a pending state is styled as accepted; it can inform where the boundary sits, and
that is all it is used for here.

## Proposed skill wording

In `trust-surfaces`, clause 2, replace the first bullet:

> - **No motion** on the surface itself (motion-ladder's forbidden list, inherited whole). An
>   agent proposal may animate *in* — arrival is authorship information — but the diff you are
>   about to accept may not animate at all.

with:

> - **No motion that implies an outcome.** No keyframe or scripted animation on the surface
>   itself (motion-ladder's forbidden list, inherited whole). A *transition* is judged by what it
>   moves and where to: a transition is forbidden when it can move the surface toward the
>   ACCEPTED appearance while the declared state stays the same — background toward the accept
>   hue, opacity toward settled, transform toward dismissal. A transition on a neutral affordance
>   property (hover elevation, focus ring, a hover tint that moves away from the accept hue) is
>   ordinary rung-2 feedback and carries no claim about the decision. The accept hue is
>   per-product, not semantic: it is whatever fills the committing control, which may be a brand
>   colour rather than a success green. An agent proposal may animate *in* — arrival is authorship
>   information — but the diff you are about to accept may not animate at all.
>
>   Paint that *lags* a committed decision is not motion that implies an outcome. When a control
>   is pressed, its state attributes flip synchronously and the paint catches up; the forbidden
>   direction is paint running **ahead** of state, not behind it.

And in `motion-ladder`, under "Where motion is forbidden regardless of rung", the checklist item
`Not on proposal, conflict, failed_safe, or a diff surface` is worth a sentence noting that the
three stated reasons are about content arriving on a review surface, so the ban reaches hover and
focus feedback on an affordance only when that feedback is directional in the sense above.

## What would now make the probe red

1. Any keyframe or WAAPI animation on a decision affordance — unchanged, unnarrowed.
2. A `:hover`/`:focus`/`:focus-visible`/`:active` endpoint on a decision-implying property
   (`background`, `background-color`, `color`, `fill`, `opacity`, `transform`) landing within
   0.10 OKLab of any resolved accept appearance.
3. `opacity` filling in toward 1 from a sub-1 rest value.
4. A `transform` endpoint that translates or collapses the element.
5. **Not-run, never passed**, when the endpoints cannot be measured: a cross-origin stylesheet in
   the scan, an endpoint colour that will not resolve, a colour form the probe cannot place in
   OKLab, or no accept appearance resolving at all.

Item 5 is the one that already caught a bug in this very change — see below.

## The bug this change committed, and the pin that stops it recurring

The first live run of the narrowed clause reported the consent surface as **passed** with every
distance silently `null`. Chromium does not serialize a wide-gamut computed colour down to
`rgb()`: `--primary` came back as the literal string `oklch(0.62 0.16 35)`. An rgb-only parser
returned `null` for every comparison, so nothing was ever "near" an accept hue, so the surface
passed — for a reason that was not the reason printed next to it. Right verdict, false evidence,
which is worse than a red.

Fixed in two places, because the parser alone would have left the trap armed for the next colour
form: `toOklab()` now handles `oklch()`/`oklab()` natively, and an endpoint that cannot be placed
in OKLab is reported **unmeasurable → not-run**, never counted as neutral.

## Knockout

`npm run probe:trust-surfaces:selftest` runs two knockouts. The original one proves the probe can
still see motion at all. The second, `DIRECTIONAL_KNOCKOUT`, guards the narrowing itself: it
targets the live consent toggle and changes exactly one thing — the hover endpoint of the
*ungranted* control becomes the granted fill. Same element, same duration, same property, same
declared state. Only the direction moves.

```
clause A clean    : passed
clause A poisoned : failed
  :hover moves background-color to oklch(0.62 0.16 35), which is 0.000 in OKLab from
  --primary=oklch(0.62 0.16 35) (threshold 0.1) — the accepted appearance, reached without
  the declared state changing
DIRECTION PROVED: true
```

If clause A could not separate those two, the narrowing would be an allowlist wearing a lab coat,
and this run says so.

## The static half is deliberately left stricter

`nodeslide-trust-surface-census.mjs` (clause 3) still fails on *any* transition or motion utility
declared at the declaration site of an enumerated surface, and `MOTION_DECEPTION_CORPUS` #4
("trust surface animates toward apparent approval") still records that as `detected`. That is not
an oversight and it is not a contradiction — it is an asymmetry with a reason:

- The census is source-static by charter. It does not resolve the cascade, does not compute
  values and never sees a rendered page, so it **cannot** measure direction. A narrowing it
  cannot evaluate would have to be faked.
- The two halves police different things. The census polices what an author *writes on the
  annotated element*; the runtime probe polices what the element *actually does*. Requiring an
  author to justify a motion utility typed directly onto a consent toggle is a reasonable local
  bar, and it is not the bar that failed here — the live finding came from three components up,
  which is exactly the gap the runtime half was built to close.

Consequence worth knowing: a `transition-colors` written directly onto an annotated tag will go
red in the census even where the runtime probe would clear it as neutral. Move it to the shared
component, or argue it at the declaration site.

## Known bound

The endpoint scan covers pseudo-class rules, which is the paint reachable with no state change.
A transition driven by a *class* change while `data-decision` stays undecided is outside it. That
case is not uncovered — it lands on the element and clauses B and C read computed paint against
the declared state — but it is caught at rest rather than in flight, so a colour that transits
through an accept hue and settles elsewhere within one observation window would be missed.
Closing that needs frame sampling, which no clause here claims to do.
