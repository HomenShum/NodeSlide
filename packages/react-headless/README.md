# `@nodeslide/react-headless`

Unstyled, controlled React state for embedding NodeSlide without adopting its
visual identity.

The package owns deterministic proposal previews, proposal-review state, and
the accessible navigation contract for a deck. It returns data and React props
only. It does not render elements, query the DOM, import CSS, persist changes,
resolve authorization, or own routing.

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
focus implementation.
