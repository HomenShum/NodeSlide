# Injectable React contract

`@nodeslide/react` is the first UI consumer of the portable contracts extracted
in the injectable core. It deliberately exposes a smaller surface than the
standalone NodeSlide studio.

## Ownership boundary

NodeSlide React owns:

- read-only normalized slide rendering;
- controlled slide navigation intent;
- in-memory proposal materialization through `@nodeslide/engine`;
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

The package has no imports from `convex/`, `src/`, WorkOS, the standalone
router, or standalone global styles.

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
