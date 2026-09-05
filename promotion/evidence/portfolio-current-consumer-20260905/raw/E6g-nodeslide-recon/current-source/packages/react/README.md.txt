# `@nodeslide/react`

Controlled, backend-neutral React surfaces for embedding NodeSlide in an
existing product. The styled package consumes `@nodeslide/react-headless` for
navigation and proposal-review state, while retaining rendering, focus refs,
markup, and opt-in CSS.

```tsx
import { useState } from 'react';
import {
  NodeSlideDeckViewer,
  NodeSlideProposalReview,
} from '@nodeslide/react';
import type { NodeSlideProposalDecision } from '@nodeslide/backend';
import '@nodeslide/react/styles.css';

export function DeckArtifact({ snapshot, proposal, repository, principal }) {
  const [activeSlideId, setActiveSlideId] = useState(snapshot.deck.slideOrder[0] ?? '');
  const [pendingDecision, setPendingDecision] =
    useState<NodeSlideProposalDecision | null>(null);

  if (!proposal) {
    return (
      <NodeSlideDeckViewer
        snapshot={snapshot}
        activeSlideId={activeSlideId}
        onActiveSlideChange={setActiveSlideId}
      />
    );
  }

  return (
    <NodeSlideProposalReview
      currentSnapshot={snapshot}
      proposal={proposal}
      activeSlideId={activeSlideId}
      onActiveSlideChange={setActiveSlideId}
      pendingDecision={pendingDecision}
      onDecision={async (decision) => {
        setPendingDecision(decision);
        try {
          await repository.resolveProposal({
            deckId: snapshot.deck.id,
            principal,
            proposalId: proposal.id,
            decision,
          });
        } finally {
          setPendingDecision(null);
        }
      }}
    />
  );
}
```

The host owns state, auth, persistence, routing, policy, telemetry, and error
handling. This package never imports Convex, WorkOS, application routes, or
standalone NodeSlide components. Proposal previews are materialized with the
pure `@nodeslide/engine` patch function; accepting or rejecting only emits a
callback.

Styles are opt-in and scoped below `data-nodeslide-surface`. Importing the CSS
does not set `:root`, `body`, element-wide resets, fonts, or global colors.
Override the documented `--nodeslide-*` custom properties from a host wrapper
to match the host product.

Pass only validated snapshots. Media URLs are rendered by the browser; hosts
must authorize or rewrite agent-produced asset references before rendering.
