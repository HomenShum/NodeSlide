# `@nodeslide/client-http`

Hosted-API adapters for the NodeSlide repository, asset, and telemetry ports.
The client never serializes `NodeSlidePrincipal`; the host converts its trusted
session into authorization headers and the server independently resolves the
principal. A production adapter requires an explicit `nodeslide.governance/v1`
declaration and must pass the shared repository conformance suite.

The default endpoint layout is rooted at `/v1` and can be changed with
`apiPrefix`. Errors use `{ "error": { "code", "message" } }` and are
normalized to `NodeSlideRepositoryError`.
