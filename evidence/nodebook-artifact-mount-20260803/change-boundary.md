# NodeBook artifact mount — NodeSlide preflight

- Baseline route: `http://127.0.0.1:5180/?deck=deck_golden_1wtmxcs`
- Persona: a deck author selects a real slide element, then opens the Design inspector.
- Intended change boundary: the selected-artifact preview at the top of the Design inspector, before the existing content/appearance/advanced controls.
- In scope: deterministic projection of the active slide graph into a package-owned NodeBook visual artifact; deck-scoped host identity; bounded empty/degraded states.
- Out of scope: canvas rendering, element selection, patch/CAS semantics, AI review, comments, versions, evidence, JSON, trace, deck ACL, and persistence.
- Proof required after the edit: one visible package-owned diagram in this real inspector; existing design controls remain operable; no console errors; ordinary selections without a projected diagram retain the current inspector.

The red box in `change-boundary.png` marks the only intended UI behavior boundary.

## After observation

- Proof deck: a real deterministic three-slide deck created through the checked-in Convex action after syncing the development deployment.
- Canonical graph on slide 2: three graph nodes and two graph edges.
- Visible result: selecting a graph node opened the existing Design inspector and rendered one package-owned structured diagram inside the marked boundary.
- DOM receipt: `hosts=1`, `rendered=1`, `diagrams=1`, and the NodeBook workspace ID matched the active deck ID.
- Browser console after navigating from slide 1 to slide 2 and selecting the graph node: zero errors and zero warnings.
- Existing Content, Appearance, and Advanced controls remained below the preview.
- Screenshot: `after-nodebook-inspector.png`.

Focused scenarios: 18/18 passed across the projection, packed consumer, and real Design-inspector integration. This includes executable 201-node and 401-edge rejection scenarios, deterministic reordering, ordinary selection preservation, explicit invalid states, and cross-deck artifact identity.

Production build: `npm run build` exited 0 after all workspace packages, TypeScript projects, and 6,219 Vite modules completed. The compact raw-result receipt is `build-receipt.md`; its two advisory warnings are preserved there.

Browser capture provenance is stored in `dom-receipt.json`, including route shape, interaction sequence, selectors, viewport, console result, and the SHA-256 digest of `after-nodebook-inspector.png`. The strict same-fixture before/after neighbor comparison remains unavailable because the pre-edit capture used a different deck; the screenshot certifies the after-state only.
