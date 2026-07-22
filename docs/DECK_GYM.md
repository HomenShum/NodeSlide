# NodeSlide Deck Gym

Deck Gym is a controlled benchmark for improving the NodeSlide agent harness. It is not a
gallery, an unbounded model sweep, or a route that can rewrite production prompts by itself.

The first production baseline is recorded in
[DECK_GYM_BASELINE_2026-07-21.md](./DECK_GYM_BASELINE_2026-07-21.md).

The frozen v1 matrix is:

```text
12 deck families × 3 model routes × 2 design directions = 72 decks
```

Every run receives the same brief, evidence pack, slide count, reference identifiers, model
budget, validation rules, and export expectations for its benchmark cell. Results are retained
with prompt, corpus, harness, run, render, evaluation, and tournament digests.

## Corpus

`benchmarks/deck-gym/v1/corpus.json` contains one frozen brief for each family:

1. Startup roadshow
2. Research talk
3. Technical architecture
4. Product demo
5. Executive update
6. Finance/investment
7. Data story
8. Strategy proposal
9. Educational explainer
10. Policy briefing
11. Case study
12. Scrollytelling deck

Each brief names its audience, decision, evidence attachments, required claims, required
artifacts, prohibited claims, references, and exact slide count. The baseline negative fixture
describes the known editorial-template monoculture: valid and coherent, but visually repetitive.

## Harness manifest

`benchmarks/deck-gym/v1/harness.json` freezes:

- model routes and reasoning effort;
- two design directions;
- run, latency, concurrency, and cost ceilings;
- semantic, rhythm, layout, collision, artifact, render, and export gates;
- human-gated promotion thresholds.

Changing the corpus or harness creates a new version. Do not edit v1 after benchmark receipts
exist; copy it to a new version instead.

## Commands

Validate and plan the full matrix:

```powershell
npm run deck-gym:validate
npm run deck-gym:matrix
```

Create a filtered matrix for development:

```powershell
node scripts/deck-gym.mjs matrix `
  --briefs research-talk,technical-architecture `
  --models moonshotai/kimi-k3 `
  --directions evidence-editorial `
  --out artifacts/deck-gym/dev-matrix.json
```

Run the planned production matrix. The user must explicitly authorize live model generation and
its cost before this command is used:

```powershell
npm run deck-gym:run -- `
  --matrix artifacts/deck-gym/deck-gym-v1/matrix.json `
  --runs-dir artifacts/deck-gym/deck-gym-v1/runs `
  --concurrency 4
```

The runner uses a fresh browser context for every disposable deck, uploads only its frozen
evidence pack, captures the editor, records the visible Trace attribution, and downloads the
validated PPTX. It never prints credentials or provider response text.

Render every exported PPTX with the presentation QA tools:

```powershell
$env:DECK_GYM_PYTHON='<python executable>'
$env:DECK_GYM_RENDER_SLIDES='<render_slides.py>'
$env:DECK_GYM_SLIDES_TEST='<slides_test.py>'
npm run deck-gym:render
```

Rendering supports bounded parallelism, for example
`npm run deck-gym:render -- --concurrency 3`.

Evaluate and build blind matches:

```powershell
npm run deck-gym:evaluate
npm run deck-gym:tournament
```

Generate evidence-based model capability cards, findings, and routing policy:

```powershell
npm run deck-gym:model-ledger
```

See [MODEL_SPECIALIZATION.md](./MODEL_SPECIALIZATION.md) for the current routing evidence,
provisional skills, and required promotion ablations.

`deck-gym:evaluate` exits nonzero when any deck fails. A nonzero exit is expected while the
harness has known defects; the evaluation artifacts remain the evidence.

## Evaluation

The deterministic v1 evaluator inspects the exported PPTX rather than trusting the creation UI.
It checks:

- frozen-claim coverage and prohibited claims;
- slide count;
- requested editable charts, images, diagrams, formulae, and code proof where detectable;
- element collisions derived from exported PowerPoint geometry;
- text-area ratio;
- meaningful visual-slide count;
- layout-signature diversity and adjacent similarity;
- rendered-slide parity and canvas overflow.

The five score groups are factual, visual, narrative, rhythm, and artifact integrity. A deck may
export successfully and still fail. In particular, generic fallback content fails claim coverage,
and a zero-overflow deck fails when internal collisions remain.

Rendered-pixel and human judgments remain separate layers. Deterministic metrics can reject clear
failures, but they do not certify taste.

## Blind tournament and human preferences

Tournament files expose candidates as A and B without model labels. Human reviews are appended to
`human-preferences.jsonl`:

```json
{"matchId":"match_...","winner":"A","reasons":["stronger_visual_hierarchy","less_repetition"],"note":"The screenshot is large enough to prove the claim."}
```

Allowed reasons are stored on each match. The reason is more valuable than a bare winner because
it can become a reference annotation, repair rule, deterministic regression, or provisional route
lesson.

A match is review-eligible when both candidates have a complete rendered PPTX with the expected
slide count. It is promotion-eligible only when both candidates pass every deterministic gate.

## Promotion boundary

```powershell
node scripts/deck-gym.mjs propose-promotion
```

Promotion output is always a proposal. It remains blocked until every eligible match receives a
human review and minimum evidence thresholds are met. `autoApply` must remain false. A proposal
contains no production edits; an operator must separately implement, test, compare, approve, and
retain a rollback path.

Winning slides may enter the reference library only with their benchmark provenance, archetype,
narrative job, evidence type, preference reasons, and repair history. Individual user edits do not
become global taste rules without repetition or explicit confirmation.

## Definition of done for a harness version

A candidate harness version can be proposed for promotion only when it:

- improves blind preference rate on matched cases;
- improves or preserves factual accuracy and evidence lineage;
- reduces internal collisions and repetitive silhouettes;
- preserves editable primitives and rendered PPTX parity;
- stays within declared latency, token, step, and cost budgets;
- has no gated dimension regression;
- includes a human-reviewed proposal and rollback path.

No generated deck, model critic, benchmark score, or post-run reflection can directly mutate the
production harness.
