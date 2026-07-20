# `@nodeslide/registry`

Versioned, source-owned compositions installed by the NodeSlide CLI. Entries
always target a new `nodeslide/` directory and never patch routing, auth,
global CSS, or an existing Convex schema. Registry upgrades compare the
receipt hash before replacing a file and emit a diff when the host changed it.
