# NodeSlide as an authenticated NodeKit Caseflow consumer

## Status

NodeSlide consumes the supported `@homenshum/nodekit/caseflow` entry point from exact NodeKit
source revision:

```text
5cc61578b3c1bd5b5c8195b83347b91f8b83242b
```

The package is pinned by full Git commit in `package.json` and `package-lock.json`. No deep
NodeKit source import is used.

## Authority boundary

NodeKit Caseflow is a lifecycle projection. It does not replace or fork the existing
`NodeSlideRepository`, the NodeSlide patch engine, candidate validation, or the isolated
`@nodeslide/convex` component.

| Concern | Authority |
| --- | --- |
| Deck snapshot and slide/element state | NodeSlide deck repository/component |
| Candidate validation and patch application | NodeSlide engine and repository |
| Domain deck versions and receipts | NodeSlide repository/component |
| User identity and workspace ownership | NodeSlide application wrapper via `ctx.auth` |
| Case, run, stage, review, exception and completion progression | NodeKit Caseflow projection |
| Portable artifact versions and content-addressed completion receipt | NodeKit Caseflow projection |

The projection stores explicit references to the real domain records:

```text
NodeKit Case        -> NodeSlide deck
NodeKit Run         -> NodeSlide generation attempt
NodeKit Artifact    -> canonical deck/artifact reference
NodeKit Proposal    -> NodeSlide patch/proposal
NodeKit Exception   -> NodeSlide validation result
NodeKit Approval    -> NodeSlide repository receipt
NodeKit Receipt     -> all accepted domain references and lifecycle events
```

## Authentication

Every normal Caseflow query or mutation calls `ctx.auth.getUserIdentity()` and verifies that
the resolved subject owns the requested workspace. IDs are locators, not authority. A caller
cannot select another subject, owner, or workspace through request arguments.

The existing anonymous preview can be claimed once through
`bootstrapPreviewDeckBinding`. That one function validates the existing unguessable preview
owner capability, records only the resulting authenticated binding, and never persists the
capability. After binding, no Caseflow operation accepts a bearer key. Cross-workspace rebinding
fails closed.

This keeps the preview/bootstrap bridge separate from the submission-grade authenticated path.

## Conformance and adversarial proof

Run:

```bash
npm run test:nodekit-caseflow
npx tsc --noEmit -p convex/tsconfig.json --pretty false
npx tsc -b --pretty false
npm run build
```

`convex/nodekitCaseflow.test.ts` uses `convex-test` against the real application schema and
functions. It proves:

- all assertions in packaged `runCaseflowConformance()`;
- exact NodeKit source revision identity;
- authenticated workspace ownership and anonymous/cross-owner denial;
- one-time preview capability binding, followed by bearer-free normal operations;
- repeated active run start reuse;
- two proposals racing from the same artifact version;
- stale acceptance becoming a reviewable conflict;
- repeated matching decisions without another approval or artifact version;
- validation exception preservation and recovery with explicit next-action ownership;
- durable reload and artifact-version integrity;
- repeated completion returning the identical receipt without another receipt row;
- receipt hash recomputation with NodeKit's public `contentHash()`;
- real deck, generation, patch, validation, and domain-receipt references in the completion
  receipt.

## Extraction boundary

The application-owned tables are declared in `convex/nodekitCaseflowTables.ts`. They are kept
separate from NodeSlide domain tables so the repeated lifecycle subset can later be extracted as
a Convex Component only after NodeRoom, NodeSlide, and NodeVideo all pass the same package
conformance. Authentication and domain mutation remain in application wrappers after extraction.

## Release boundary

This consumer proof does not authorize a production deploy, npm publication, or Convex
Component submission. Those remain gated by the exact-candidate NodeKit timer, screenshot,
fresh-agent, fresh-human, preview, multi-consumer, and final ProofLoop evidence.
