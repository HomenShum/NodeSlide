# `@nodeslide/external-agent`

This package is NodeSlide's offline, machine-readable boundary for coding agents
and other automation. It consumes the canonical `@nodeslide/contracts`,
`@nodeslide/engine`, and `@nodeslide/backend` command types; it does not define a
second deck model or patch implementation.

The bundled `nodeslide` binary supports:

```text
nodeslide inspect <deck.json>
nodeslide validate <deck.json> <patch.json>
nodeslide propose <deck.json> <patch.json> [--out proposal.json]
nodeslide apply <deck.json> <proposal.json> --approve <proposal-id> [--out next-deck.json]
```

All successful command output is JSON. Failures emit a JSON error envelope to
stderr and exit non-zero. `apply` only accepts a digest-bound proposal created by
`propose`, requires an exact approval ID, and never overwrites an input or an
existing output path.

Default candidate compilation is reproducible from the base deck clock;
proposal and application timestamps are separate event metadata.

See `docs/EXTERNAL_AGENT_ACCESS.md` in the NodeSlide repository for the offline
file and host-backed MCP operating modes.
