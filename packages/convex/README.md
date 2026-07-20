# `@nodeslide/convex`

Reference Convex client adapter for the NodeSlide backend ports. Generated
function references are injected by the host; this package never imports an
application's `_generated/api`. Host wrapper functions resolve the authenticated
principal server-side and call the isolated component API.

The `component/` directory is source-owned Convex component material: isolated
table definitions and a versioned migration manifest. It intentionally does
not pretend that copying a schema mounts a backend. The installer copies these
files into a new package-specific directory, while the host adds authenticated
wrappers and runs Convex codegen. The adapter only receives a production
descriptor after the host supplies a complete `nodeslide.governance/v1`
declaration and passes repository conformance.

NodeSlide's current app uses an anonymous, server-issued owner capability
rather than an identity-provider session. `createNodeSlideCapabilityConvexAdapters`
is the production bridge for that host: it sends only the capability in the
host's existing authorization arguments, strips client-asserted provenance,
and consumes receipts derived by the existing server mutation path. The
host-owned generated-reference binding lives outside this package.

The isolated schema is still installation material, not a second live backend
inside the NodeSlide app. Mounting it today would fork deck state and duplicate
the monolithic validation/trace logic. A true isolated-component mount remains
blocked on extracting that mutation core into a shared server module; the
capability bridge deliberately reuses the authoritative tables until then.
