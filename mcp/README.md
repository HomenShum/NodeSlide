# NodeSlide MCP

The stdio MCP server exposes the existing 11 host-backed NodeSlide tools plus
four offline DeckSnapshot file tools. Both local file mutation and the
standalone CLI use the canonical `@nodeslide/engine`; this package does not
carry a second patch implementation.

```bash
npm run build
node dist/index.js --help
```

- Offline: set `NODESLIDE_LOCAL_ROOT`; no Convex or model key is required.
- Local paths are realpath-contained (including symlinks/junctions), output
  parents must exist, and writes never clobber an existing destination.
- Host-backed: also set `NODESLIDE_CONVEX_URL` and the appropriate owner
  capability environment.

See [`../docs/EXTERNAL_AGENT_ACCESS.md`](../docs/EXTERNAL_AGENT_ACCESS.md) for
tool names, configuration, security boundaries, and tarball verification.
