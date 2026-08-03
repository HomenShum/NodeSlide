# NodeSlide as an installed NodeKit Caseflow consumer

## Status and claim boundary

NodeSlide installs the exact locally packed `@homenshum/nodekit` tarball recorded in
`vendor/homenshum-nodekit-0.2.1.provenance.json` and mounts its real Convex component through
`convex/convex.config.ts`.

This repository proves the **local engineering consumer** only. It does not claim a production
deployment, signed-in browser journey, npm publication, or public Convex Component submission.
Those gates remain external and fail-closed.

## No copied Caseflow backend

The former application-local Caseflow implementation and its copied lifecycle tables were
deleted. Component-owned state now lives exclusively inside the installed NodeKit component:

```text
@homenshum/nodekit/convex.config.js
        -> isolated NodeKit Caseflow component
        -> cases, runs, artifacts, proposals, approvals,
           exceptions, events, and receipt v2 records
```

NodeSlide stores one host-owned authorization bridge table:

```text
nodeslide_nodekit_bindings
  deckId
  ownerSubject
  opaque scopeKey
  public case/run/artifact locators
```

That table contains no duplicate lifecycle state and never stores the preview bearer.

## Authority boundary

| Concern | Authority |
| --- | --- |
| Deck snapshot and slide/element state | NodeSlide repository/component |
| Candidate validation and patch application | NodeSlide engine and repository |
| Domain deck versions and receipts | NodeSlide repository/component |
| User identity and deck ownership | NodeSlide application wrapper via `ctx.auth` |
| Case, run, stage, review, exception and terminal progression | Installed NodeKit component |
| Portable artifact versions and content-addressed receipts | Installed NodeKit component |

The host wrapper at `convex/nodekitCaseflow.ts` authenticates the caller, resolves the deck
binding, validates every referenced generation, patch, validation result, and domain receipt,
then calls the component with an opaque `scopeKey`. Callers cannot provide or override that key.

The existing anonymous preview owner capability is accepted only by
`bindAuthenticatedDeck`. The wrapper verifies it once, binds the deck to `ctx.auth.subject`, and
discards it. Every normal lifecycle function is bearer-free. IDs locate records; they do not
grant authority.

## Presentation-specific lifecycle

The deterministic consumer suite exercises:

```text
authenticated deck binding
-> intent and stage plan
-> deck artifact
-> persisted NodeSlide patch proposal
-> human approval
-> stale same-base conflict
-> validation exception and recovery
-> completion / cancellation / safe failure
-> receipt-v2 hash verification and reload
```

It additionally proves:

- cross-owner and anonymous denial;
- no persisted owner bearer;
- component public IDs rather than Convex document IDs;
- trimmed idempotency keys and mismatched retry rejection;
- duplicate stage-plan mismatch rejection;
- multiple exceptions remain blocked until all are resolved;
- ordinary mutations are blocked during exceptions and after terminal state;
- completion is bound to a canonical deck artifact;
- cancellation and safe failure receive immutable receipts;
- real NodeSlide patch operations become the component proposal payload;
- real generation, validation, and package-receipt references are checked in the host;
- the final receipt binds artifact, proposal, approval, actor, event payload, case, and run hashes;
- the host schema contains no copied `nodekitCaseflow*` lifecycle tables.

## Reproducible local proof

After the exact tarball is installed:

```bash
npm run test:nodekit-caseflow
npx tsc --noEmit -p convex/tsconfig.json --pretty false
npx tsc -b --pretty false
npm run build
npm run proof:nodekit-caseflow
```

`proof/nodekit-caseflow-consumer/receipt.json` binds the exact package source commit, NodeKit
source hash, tarball SHA-256, installed package identity, consumer implementation hash, command
logs, and every decisive evidence file by path, byte count, and SHA-256.

## Remaining external proof

Before NodeSlide can count as a production consumer for a Convex submission, an authorized
candidate must still provide:

- an exact-revision signed-in production or isolated-preview browser journey;
- screenshots and trace evidence from the real NodeSlide UI;
- deployed frontend/backend revision identity;
- independent verification of the exported deck and receipt;
- explicit authorization for deployment or publication.

This local consumer work deliberately does not synthesize or infer any of those results.
