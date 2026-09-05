# `@nodeslide/convex`

`@nodeslide/convex` is the reference production implementation of the
NodeSlide backend ports. It ships a real Convex component: its schema,
functions, generated component API type, and migration ledger are packaged
together and mount into a namespace that is isolated from the host app's
tables.

Mount it from the host application's root `convex.config.ts`:

```ts
import nodeslide from '@nodeslide/convex/convex.config.js';
import { defineApp } from 'convex/server';

const app = defineApp();
app.use(nodeslide);
export default app;
```

After host codegen, server wrappers call the mounted references under
`components.nodeslide.repository`. The public functions are
`initializeDeck`, `getDeck`, `applyPatch`, `createProposal`,
`resolveProposal`, `listVersions`, `storeReceipt`, `putAsset`, `getAsset`,
`deleteAsset`, and `applyMigration`. Consumers can import the component's
reference shape as a type:

```ts
import type { ComponentApi } from '@nodeslide/convex/_generated/component.js';
```

The host owns identity and policy. A host wrapper resolves its Clerk, WorkOS,
Auth0, Supabase, Convex Auth, NodeRoom ActorProof, or custom principal on the
server and mints a request-bound `nodeslide.component-grant/v1`. Mutation
grants are bound to the exact action, deck, and resource and are consumed once
inside the component. Credentials and host ActorProofs never enter component
tables. Read grants are checked on every query but are not persisted.

The component owns isolated deck, proposal, version, receipt, asset, migration,
and consumed-grant tables. Its mutation implementation imports only the
portable `@nodeslide/backend`, `@nodeslide/contracts`, and `@nodeslide/engine`
boundaries; it does not import the NodeSlide application's Convex schema,
mutations, or `_generated/api`.

Server governance is literal and non-bypassable. The exported
`NODESLIDE_CONVEX_COMPONENT_GOVERNANCE` requires mutation authority, CAS,
candidate validation, trace lineage, source authorization, and rollback.
`assertNodeSlideConvexComponentConfiguration` lets a host choose approval,
Turbo, publishing, and retention UX while rejecting any attempt to weaken
those six invariants.

Schema version 2 has a contiguous, non-destructive two-step migration chain.
Run the exported planner and apply each step through the mounted
`repository.applyMigration` function with a host-issued migration grant.
Component tests use the actual isolated schema through `convex-test`, including
proposal acceptance, durable reread, CAS conflict, invalid candidate,
cross-resource grant, replayed grant, and skipped-migration rejection.
