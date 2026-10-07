# Canonical chart creation and handoff

A reviewer creates a presentation from supplied numbers, edits the title, reloads it, and exports an editable chart. The chart must retain its original values and its actual source after each step. A requested chart without numeric input remains missing; the generator does not invent numbers to make a release check pass.

The deterministic generator now sends already parsed chart values through the existing canonical compiler (ArtifactSpec). It identifies the creation brief as the source and classifies the values as derived, including synthetic examples. Repeated normalization retains the validated authoring input and recompiles it; caller-provided cached receipts and geometry are not trusted. The existing source policy still rejects promotion of brief instructions to observed evidence.

The production probe supplies explicitly labelled sample scores, Alpha 42 and Beta 61. Its positive canonical-artifact and persisted-binding assertions remain required. Creation, title commit, reload, routing and cleanup gates are unchanged.

## Verification

The local repair passed the 47-case seed/compiler/owner-evidence/create batch. The strengthened registered create/title/reload scenario and three existing export scenarios then passed 4/4. These checks validate three accepted title changes, unchanged chart values and source binding, and positive shadow-compilation receipts. Ten normalization passes, forged source provenance and cached receipts, missing input, and exact zero values are covered separately.

The normal application and Convex no-emit typechecks and source function-bundle check passed. Scoped Biome checks passed after two test-style corrections. An extra strict project covering the test files found new fixture annotations to correct; its final result still reports four pre-existing errors in unchanged test bodies. That extra project is not a standard application or backend typecheck pass.

An exported synthetic deck passed HTML and PowerPoint verification: the actual native chart XML preserves Alpha/Beta and 42/61. The local HTML presenter displayed the real chart at 1440 and 390 pixels, with pointer and keyboard navigation and no browser errors. The desktop chart is readable; the phone presenter scales the entire slide and its text is small. These observations do not certify mobile reading quality, the complete application UI, authenticated flows, native Office rendering, providers or production.

No deployment, provider call, credential retrieval or dependency installation was used for the local proof. Shared CI, actual production probe and benchmark credentials remain separate release gates.

## Reproduce the bounded checks

```sh
npx vitest run convex/lib/nodeslideSeed.test.ts convex/lib/nodeslideAuthoredArtifact.test.ts convex/nodeslideArtifactSpec.test.ts convex/nodeslideCanonicalCreation.test.ts
npx vitest run src/domains/nodeslide/slidelang/artifactSpecExport.test.ts
npx tsc --noEmit --incremental false
npx tsc --noEmit --incremental false --project convex/tsconfig.json
npm run verify:function-bundle
```

Use the existing production runbook and deployment coordination for a real hosted check. Local export success alone does not establish that the hosted app contains this change.
