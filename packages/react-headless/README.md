# `@nodeslide/react-headless`

Unstyled, controlled React state for embedding NodeSlide without adopting its
visual identity. The package owns deterministic proposal previews,
proposal-review state, repository loading and commands, permission and
selection helpers, and the accessible navigation contract for a deck. It
returns data and React props only: no rendered elements, DOM queries, CSS,
Convex coupling, host authentication, or routing.

Repository state is explicit: `loading`, `ready`, `not_found`, or `error`.
Mutations update the local snapshot only from the repository adapter's
authoritative result.

```tsx
const navigation = useNodeSlideDeckNavigation({
  snapshot,
  activeSlideId,
  onActiveSlideChange: setActiveSlideId,
  onFocusRequest: (slideId) => tabRefs.current.get(slideId)?.focus(),
});
```

Invalid active slide IDs fail closed: relative navigation does not silently
select a different slide. Hosts remain responsible for controlled state and
focus implementation. Invalid proposal previews and non-ready proposal states
also fail closed, with every blocking reason exposed to the host.
