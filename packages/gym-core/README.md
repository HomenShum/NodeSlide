# `@nodekit/gym-core`

Portable, dependency-free contracts for reproducible model and agent-harness
experiments. The package owns immutable run plans, matched comparisons,
diagnosis, curriculum boundaries, advisory promotion proposals, bounded
training exports, and user-invisible shadow-route selection.

```ts
import { buildNodeGymMatrix } from '@nodekit/gym-core';
```

The package deliberately does not include NodeSlide artifact evaluators,
provider SDKs, persistence, UI, or automatic routing changes. Those remain in
domain and adapter packages. Promotion is always advisory (`autoApply: false`).

## Versioning and upgrades

The package follows semver and is distributed as an exact `npm pack` tarball.
The `nodekit.gym/v1` schema is independent of the package release version.

- `0.0.1 -> 0.1.0`: no persisted-state migration is required. Immutable run
  pairing keys remain byte-for-byte compatible; `0.1.0` adds diagnosis,
  curriculum, advisory promotion, bounded training-export, and shadow-route
  contracts.
- Consumers must pin the tarball and its lockfile integrity. Mutable tags or
  workspace links are not accepted as portability proof.

Run `npm run proof:node-gym-portability` from NodeSlide to rebuild the package,
prove a clean install and upgrade, type-check the packed declarations, and run
the independent NodeSlide and NodeRoom domain consumers.

The NodeRoom proof is an isolated, committed consumer contract with its own
NodeAgent frame-evidence task and evaluator. When an external NodeRoom checkout
is available, the proof records its commit and working-tree fingerprint before
and after the run but does not mutate it. This proves package portability and a
second-product contract; it does not claim the package was integrated into an
uncommitted NodeRoom branch.
