# `@nodeslide/react-headless`

Unstyled, controlled React state for embedding NodeSlide without adopting its
visual identity. It owns proposal preview derivation, repository loading and
commands, and accessible deck-navigation props. It renders no elements,
imports no CSS, queries no DOM, and knows nothing about Convex or host auth.

Repository state is explicit: `loading`, `ready`, `not_found`, or `error`.
Mutations update the local snapshot only from the adapter's authoritative
result. Invalid slide IDs and invalid proposals fail closed.
