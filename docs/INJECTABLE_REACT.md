# Injectable React contract

`@nodeslide/react-headless` and `@nodeslide/react` are the first UI consumers of
the portable contracts extracted in the injectable core. They deliberately
expose a smaller surface than the standalone NodeSlide studio.

## Ownership boundary

NodeSlide headless owns:

- ordered-slide and active-slide derivation;
- controlled previous, next, click, and keyboard navigation intent;
- ARIA tab/panel props and focus-request intent without DOM queries;
- deterministic proposal previews and fail-closed review-state models.

NodeSlide styled React owns:

- read-only normalized slide rendering;
- current/proposed comparison;
- accept/reject intent callbacks;
- accessible names, focus order, and keyboard tab navigation;
- optional CSS-variable styling scoped below `data-nodeslide-surface`.

The host owns:

- authentication and `NodeSlidePrincipal` construction;
- repository calls and authorization;
- proposal state and pending/error state;
- routes, application shell, notifications, analytics, and telemetry;
- CAS enforcement, durable application, and receipts;
- React error boundaries and product-specific loading states.

Neither package imports from `convex/`, `src/`, WorkOS, the standalone router,
or standalone global styles. The headless package ships no CSS and performs no
DOM query; `@nodeslide/react` supplies focus refs and opt-in visual styling.

The host must pass a validated `DeckSnapshot`. Rendering an image, video,
poster, or captions URL causes the browser to request that resource, so a host
handling untrusted or agent-produced decks must resolve those references
through its authorized asset store or an explicit network allowlist before
mounting this package. The React layer is not an egress-policy boundary.

## Controlled integration

```tsx
<NodeSlideProposalReview
  currentSnapshot={snapshot}
  proposal={proposal}
  activeSlideId={activeSlideId}
  onActiveSlideChange={setActiveSlideId}
  pendingDecision={pendingDecision}
  onDecision={(decision) => resolveThroughHostRepository(decision)}
/>
```

The component uses the pure patch engine to show what the proposal would do,
but it never applies that result to durable state. Invalid or stale proposals
fail closed and disable both decision buttons.

## Styling

Import the opt-in stylesheet:

```ts
import '@nodeslide/react/styles.css';
```

Override tokens from a host wrapper:

```css
.my-product-deck {
  --nodeslide-surface: var(--panel);
  --nodeslide-surface-muted: var(--panel-muted);
  --nodeslide-ink: var(--foreground);
  --nodeslide-muted: var(--muted-foreground);
  --nodeslide-accent: var(--primary);
  --nodeslide-border: var(--border);
  --nodeslide-radius: var(--radius);
  --nodeslide-font-display: var(--font-heading);
  --nodeslide-font-body: var(--font-sans);
  --nodeslide-font-data: var(--font-mono);
}
```

The stylesheet does not target `:root`, `html`, `body`, generic buttons, or
generic headings outside a NodeSlide surface.

## Intentionally deferred

- editable drag/resize canvas;
- rich chart and LaTeX parity with the standalone studio;
- presenter mode;
- comments, trace inspector, and agent thread;
- concrete Convex and HTTP repositories;
- source-installed application compositions;
- npm publication and schema migration policy.

Those surfaces should be extracted only after this controlled contract passes
in a second host application.
