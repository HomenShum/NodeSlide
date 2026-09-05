# Web Interface Guidelines review — NodeSlide

Gate condition 7. **This is a review, not a tool run.** A Lighthouse score is not
a Web Interface Guidelines review and cannot be substituted for one: Lighthouse
measures load and a fixed accessibility rule set, the guidelines are a list of
interface decisions most of which no tool checks. The two are scored separately —
the tool half lives in condition 8, and its raw output is in
[`promotion/evidence/audit-2026-08-13/`](evidence/audit-2026-08-13).

## What was reviewed, and against what

- **Guidelines:** the Vercel Web Interface Guidelines, fetched live from
  <https://vercel.com/design/guidelines> on 2026-08-13. Reachable; no fallback
  checklist was needed. Sections: Interactions, Animations, Layout, Content,
  Forms, Performance, Design, Copywriting.
- **Surface:** the production bundle (`vite build` → `vite preview`, served at
  `http://127.0.0.1:4906`), not the dev server. Two surfaces were driven: the
  landing (`[data-testid="nodeslide-landing"]`) and the deck editor
  (`[data-testid="nodeslide-studio"]`), reached by creating a deck from a brief
  on the deterministic route against an anonymous local Convex deployment.
- **Widths:** 390×844, 768×1024, 1440×900, both surfaces.
- **Measurements:** every finding below cites a number or a screenshot produced
  by `node promotion/run-web-audits.mjs`, whose output is committed under
  `promotion/evidence/audit-2026-08-13/prod/`. Findings that were fixed cite the
  before/after pair (`before-dev/` and `after-dev/`, same dev server, same script
  revision, fixes the only difference).

Reviewing the *rendered* surface is the point. Three of the four resolved
findings below are invisible in the source and obvious in a measurement, and the
one open major finding was found by looking at a screenshot after every
automated check on that screen had passed.

## Findings

Severity is about the person using the product: **major** blocks or silently
misleads someone completing a journey; **minor** is a guideline miss with no
observed blocking consequence.

### Major — open

**W1. The canvas overlays are drawn on top of the presenter-notes field.**
*Guideline: Layout → "Deliberate alignment"; Interactions → "No dead zones"
("if it looks interactive, make it interactive" — and its converse: nothing
should sit invisibly over something that is).*

In the deck editor, the slide pager (`.ns-slide-stepper`) and the zoom controls
(`.ns-zoom-controls`) are `position: absolute; bottom: 14px; z-index: 8` inside
`.ns-canvas-panel`. That panel's last row is the presenter-notes strip, so
"14px from the bottom of the panel" resolves to *inside the notes field* rather
than above it. Measured at all three widths:

| Width | Notes textarea | `.ns-slide-stepper` | `.ns-zoom-controls` | Covered |
|---|---|---|---|---|
| 390 | 12,759 → 378,835 | 12,804 → 113,844 | 104,804 → 287,844 | 101×31 px + 183×31 px |
| 768 | 12,939 → 756,1015 | 12,984 → 113,1024 | 198,984 → 570,1024 | 101×31 px + 372×31 px |
| 1440 | 312,815 → 1088,891 | 312,860 → 413,900 | 506,860 → 894,900 | 101×31 px + 388×31 px |

The chips are opaque (`background: rgb(252 252 250 / 94%)`) and sit above the
textarea in the stacking order, so the bottom third of a 76px-tall notes field
is both unreadable and unclickable — a click there hits "Fit" or the pager, not
the text. Evidence:
[`prod/editor-notes-desktop-1440.png`](evidence/audit-2026-08-13/prod/editor-notes-desktop-1440.png)
shows the third line of notes text behind the controls;
`prod/report.json` records the rectangles under `widths[].overlay.collisions`.

Not fixed here. The correct fix moves the overlays into a non-scrolling wrapper
around `.ns-canvas-viewport` — a DOM change to the editor shell with pan/zoom
behaviour to re-verify, which is a different change from this one. Logged as D7
in [PROMOTION_LOG.md](PROMOTION_LOG.md).

### Major — resolved this iteration

**W2. Focus moved between three composer controls with no visual change.**
*Guideline: Interactions → "Clear focus (use `:focus-visible`, set
`:focus-within` for grouped controls)".*

`.ns-landing-composer textarea` and `.ns-landing-model select` both set
`outline: 0`. The page does have a global ring, but it is written
`:where(:focus-visible)` in `src/styles.css`, and `:where()` contributes zero
specificity, so any element rule beats it. What made this survive review before
is that something *was* highlighted: the composer's own `:focus-within` ring.
But that ring is on the group, identical for every child, and already on by the
time focus reaches the second control — so tabbing brief → model → effort
changed nothing on screen at all.

Measured by snapshotting every element's computed style with nothing focused,
then tabbing and reporting which node in the focused element's ancestor chain
changed (`wig.tabStops[].indicatorOn` in the reports):

| Run | Tab stops whose own style changes | Stops indicating only on the group |
|---|---|---|
| `before-dev` | 10 of 13 | 3 (`TEXTAREA`, `landing-model-select`, `landing-effort-select`) |
| `after-dev`, `prod` | 13 of 13 | 0 |

Fixed by deleting both `outline: 0` declarations, so the global
`:focus-visible` ring applies (`none|0px` → `solid|2px` on each of the three).
The editor's 12 tab stops were already at 13/13 and still are.

**W3. The file input had no accessible name.**
*Guideline: Forms → "Labels everywhere"; Content → "Don't ship the schema
(accessible names still exist for assistive tech)".*

`input[data-testid="landing-file-input"]` is visually hidden and driven by the
visible "Attach data" button, but it is a real focusable control in the tab
order and it carried no label of any kind. axe-core 4.13.0 scored it `label`,
impact **critical**, and it was the sole reason the Lighthouse accessibility
category sat at 0.93. Fixed with `aria-label="Attach data files"`; axe
violations 1 → 0, Lighthouse accessibility 0.93 → 1.00.

**W4. The brand link's visible words are not in its accessible name.**
*Guideline: Content → "Icon-only buttons are named"; Accessible content.*

`a.ns-landing-brand` had `aria-label="NodeSlide home"` while its visible text
was `N NodeSlide` (the "N" being the logo tile, a text node inside an
`aria-hidden` span — `aria-hidden` hides it from the accessibility tree but not
from the *visible* text the rule compares against). Someone driving the page by
voice and saying the words they can see does not activate the link. Lighthouse
scored `label-content-name-mismatch` 0. Fixed by drawing the mark with CSS
`content` instead of a text node, so visible text is `NodeSlide` ⊂
`NodeSlide home`; the audit now scores 1.

Worth recording: `@axe-core/cli` did **not** report W4 and Lighthouse did. Not a
disagreement — both embed axe-core 4.13.0, but the CLI runs the WCAG tag set by
default and `label-content-name-mismatch` is tagged best-practice. Running one
of the two is not running the audit.

**W5. Composer inputs shrank below 16px on mobile.**
*Guideline: Interactions → "Mobile input size (≥16px to prevent iOS auto-zoom)";
Interactions → "Respect zoom (never disable browser zoom)".*

Measured at 390: the brief textarea was 15px and both selects 11px
(`wig.mobile.textInputsUnder16px`). iOS Safari zooms the viewport when a focused
input is under 16px, and the page correctly does **not** take the other way out
(the viewport meta sets no `maximum-scale`, so zoom is not disabled — that part
was already right). Fixed by raising all three to 16px at the ≤699px
breakpoint; the list is now empty. Side effect, measured not assumed: the select
pills grew from 31px to 37px tall and no width overflows
(`scrollWidth == innerWidth` at all three widths, both surfaces).

**W6. The primary action was under the mobile hit-target floor.**
*Guideline: Interactions → "Match visual & hit targets (…44px on mobile)".*

`button[aria-label="Create presentation"]` measured 40×40 at 390. Fixed to
44×44 at the ≤699px breakpoint; it no longer appears in
`wig.mobile.controlsUnder44`.

### Minor — open

Each is measured, none was observed to block a journey, and none is claimed as
resolved.

| # | Guideline | Measurement | Note |
|---|---|---|---|
| W7 | Design → "Browser UI matches your background (`theme-color`)" | `wig.desktop.meta.themeColor` is `null` | The page sets `color-scheme: light` but no `theme-color`, so mobile browser chrome does not match the warm off-white background. |
| W8 | Interactions → "Prevent double-tap zoom on controls (`touch-action: manipulation`)" | every control reports `touchAction: "auto"` | Adds the ~300ms double-tap delay on touch devices. |
| W9 | Design → "Windows `<select>` background" | both selects compute `background-color: rgba(0, 0, 0, 0)` | On Windows the native option popup is drawn by the OS; a transparent background is the case the guideline calls out. Contrast in the closed state passes (`color-contrast` scores 1). |
| W10 | Content → "Headings & skip link" | `wig.desktop.skipLink` is `[]` | No "Skip to content" link. The landing has 13 stops before the main action, the editor more. |
| W11 | Interactions → "Match visual & hit targets" | 10 controls under 44px at 390, smallest 35×35 ("BYOK / Agents"); starters are 360×33 | All are above the 24px hard floor. The starters are full-bleed, so the miss is height only. |
| W12 | Animations → "Never `transition: all`" | `wig.desktop.css.transitionAll` = 1 rule of 2612 | One rule. `prefers-reduced-motion` is honoured in 5 blocks, so the reduced-motion half of that section passes. |
| W13 | Performance → asset weight | `unused-javascript`: est. 1,221 KiB; one 5.05 MB vendor chunk (1.47 MB gzip) | Scored under conditions 8 and 10 rather than restated as a WIG finding, since it is the same defect. See D8 in [PROMOTION_LOG.md](PROMOTION_LOG.md). |

### Checked and passing

Recorded so a later reviewer knows these were looked at rather than skipped:
keyboard reachability of every control on both surfaces (25 stops, sane order,
no traps); `prefers-reduced-motion` honoured; `<title>` describes the product;
`lang="en"`; `role="alert"` on the composer error with the typed brief preserved
(`states.error.briefPreserved: true`); the loading state keeps its label and
adds an elapsed timer plus a three-step explainer rather than swapping in a
spinner; the placeholder ends with a typographic ellipsis and no `...` appears
anywhere in the rendered text (`straightEllipsis: 0`); `color-contrast` and
`heading-order` both score 1; no element renders a useless scrollbar apart from
the standard `.ns-sr-only` clip; CLS 0.001; no horizontal overflow at any of the
three widths on either surface.

## Verdict

**Condition 7: FAIL.** One major finding (W1) is open with a reproduction and a
measurement. Four majors (W2–W6) were found and closed in this iteration, and
the seven minors are recorded rather than resolved. FAIL is the honest score
while W1 stands; it is not UNVERIFIED, because the review was performed.

## Re-running this

    npx convex dev                                          # anonymous local is fine
    npx convex env set NODESLIDE_PUBLIC_CREATION true       # per the README quickstart
    npx tsc -b && npx vite build                            # see D4 before using `npm run build`
    npx vite preview --port 4906 --strictPort --host 127.0.0.1
    NODESLIDE_AUDIT_OUT=promotion/evidence/audit-2026-08-13/prod \
      node promotion/run-web-audits.mjs

The source-level half of W2–W5 is guarded by
`scripts/tests/nodeslide-landing-a11y.test.mjs`, which runs in `npm test` with no
browser; reverting any one of those fixes fails it.
