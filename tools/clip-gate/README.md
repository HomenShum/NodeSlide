# clip-gate — the two-axis demo gate

Vendored from [FeatureClipStudio](https://github.com/HomenShum/FeatureClipStudio),
which is the canonical copy. Three files, zero dependencies beyond node's builtins
and a `GEMINI_API_KEY`.

## Why it exists

Demo videos here were judged once, at the end, by whoever remembered. That makes
the judgement a grade rather than a gate, and it measures only one thing: **craft**
— cursor truth, pacing, legibility, whether there is a signature moment.

Craft is what the demo's author notices missing. It is not what anyone else
notices missing. The cut that motivated this gate scored **craft 11/20 and
comprehension 9/20**: well made, real states, a genuine peak — and a viewer still
could not say who it was for, what problem it solved, or how to point it at their
own question. That gap never shows up in a craft score, so it gets optimised away
unless it is its own axis with its own number.

So `rubric.mjs` carries two rubrics, scored independently, 40 points total:

- **CRAFT** (20) — storyboard clarity, state coverage, cursor truth, caption sync,
  pacing, legibility, proof feel, safety, signature moment, loop etiquette.
- **COMPREHENSION** (20) — persona, purpose, use case, feature legibility, full
  interaction, responsiveness, flow, result, lay sense, own-case transfer.

Comprehension is scored **from a named audience's seat**, which is the point of
`--for`. The same cut is a 2 on `lay_sense` for a domain expert and a 0 for
someone who has never heard the jargon; `--for` turns that from an argument into
a number.

## Use

```bash
npm run clip:judge -- out/demo.mp4 --for "a non-technical viewer"
npm run clip:judge -- out/demo.mp4 --for "a frontend engineer evaluating adoption" --gate 28
npm run clip -- --comp <CompositionId> --out out/demo.mp4 --rounds 2   # render→judge→brief loop
```

`--gate N` exits non-zero below N/40, so CI can hold the line. The judge writes
`<video>.judge.md` (scorecard split by axis), `.judge.json`, and — when it fails
the gate — `.next-cut.md`, a revision brief naming the storyboard changes that
would raise the weakest comprehension dimensions.

## Two things it does deliberately

**It does not auto-apply its own notes.** A loop that edits the storyboard from
its critic's brief converges on whatever the critic likes, and nobody is left
holding the taste. The brief is written; a human or agent applies it; round N+1
starts.

**Anti-uniformity is enforced in code, not asked for in the prompt.** The rubric
carried an anti-uniformity clause for three revisions and the judge still returned
1/2 on 18 of 20 dimensions — a description wearing a score's clothes. Now, if one
score covers more than 70% of dimensions, the judgement is re-requested once with
the offending distribution quoted back. A gate that returns the same verdict for
every input is not a gate, and that includes the flat-1 verdict.
