# NodeSlide MCP

The stdio MCP server exposes the existing 11 host-backed NodeSlide tools plus
four offline DeckSnapshot file tools. Both local file mutation and the
standalone CLI use the canonical `@nodeslide/engine`; this package does not
carry a second patch implementation.

```bash
npm run build
node dist/index.js --help
```

- Offline: set a trusted `NODESLIDE_LOCAL_ROOT`; no Convex or model key is required.
- Local paths are realpath-contained (including symlinks/junctions), output
  parents must exist, and writes never clobber an existing destination.
- The root and its parents must not be concurrently writable or renameable by
  untrusted local processes; portable filesystem APIs cannot close that
  check-to-open race.
- The file apply tool's exact proposal-ID echo is caller confirmation, not
  independent reviewer authentication or authorization.
- Host-backed: also set `NODESLIDE_CONVEX_URL` and the appropriate owner
  capability environment.

See [`../docs/EXTERNAL_AGENT_ACCESS.md`](../docs/EXTERNAL_AGENT_ACCESS.md) for
tool names, configuration, security boundaries, and tarball verification.

`nodeslide.create_deck` is a completion transaction, not a draft-only call. It
creates and validates the deck, rejects silent deterministic fallback by
default, publishes the share, and writes bounded PPTX, HTML, snapshot, and
receipt artifacts beneath `NODESLIDE_LOCAL_ROOT`. The response returns the
public URL and artifact paths while retaining the owner capability only inside
the MCP process. This makes the same finished-deck path available to Codex,
Claude Code, Cursor, Devin, Goose, Hermes, and any other MCP client.
