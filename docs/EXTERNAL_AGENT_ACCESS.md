# External-agent access

NodeSlide exposes one governed deck-editing contract through two transports:

```text
DeckSnapshot JSON + NodeSlidePatchCommand
                  |
                  v
@nodeslide/contracts + @nodeslide/engine
                  |
       +----------+----------+
       |                     |
       v                     v
nodeslide CLI          NodeSlide MCP stdio
offline files          offline files or hosted app
```

The CLI and MCP adapters do not implement another DeckSpec, patch model, or
mutation engine. Both call `@nodeslide/external-agent`, which bundles the
public `@nodeslide/contracts`, `@nodeslide/engine`, and backend patch-command
type from the injectable-core boundary.

## Offline local-file mode

Offline mode needs no Convex deployment, model key, browser, or network. A
"DeckSpec JSON" in this interface is the canonical `DeckSnapshot` object:

```json
{
  "deck": { "schemaVersion": "nodeslide.slidelang/v1", "id": "deck:1", "version": 1 },
  "slides": [],
  "elements": [],
  "sources": []
}
```

The abbreviated object above is explanatory only; runtime validation requires
the complete contract and fails closed on malformed JSON, unknown patch fields,
invalid relationships, stale clocks, out-of-scope operations, or tampered
digests.

Build the local tarball:

```bash
npm run build --workspace @nodeslide/external-agent
npm pack ./packages/external-agent
```

Install the resulting tarball in another project, then use:

```bash
nodeslide --help
nodeslide inspect deck.json
nodeslide validate deck.json patch.json
nodeslide propose deck.json patch.json --out proposal.json
nodeslide apply deck.json proposal.json \
  --approve proposal:<exact-id-from-propose> \
  --out deck.v2.json
```

Every success is JSON on stdout. Every failure is a JSON error envelope on
stderr with a non-zero exit code. `apply` never accepts a raw patch. It requires
the exact proposal ID, verifies the base snapshot digest and all version clocks,
re-runs canonical preflight, and writes a new snapshot. It will not overwrite
an input or any existing output path.

Candidate compilation is deterministic: absent an explicit override, the
candidate uses `base deck.updatedAt + 1`. Separate `validate` and `propose`
calls therefore produce the same candidate digest. Proposal `createdAt` and
application `appliedAt` remain independent event timestamps and do not alter
the compiled deck.

The same functions are available as a library:

```ts
import {
  inspectDeckSnapshot,
  validateDeckPatch,
  proposeDeckPatch,
  applyDeckProposal,
} from '@nodeslide/external-agent';
```

## MCP offline-file mode

Build the MCP tarball or run its built entry point. `NODESLIDE_CONVEX_URL` is
not required for local files:

```bash
npm run build --workspace nodeslide-mcp
set NODESLIDE_LOCAL_ROOT=D:\work\my-decks
node mcp/dist/index.js
```

`NODESLIDE_LOCAL_ROOT` defaults to the MCP process working directory. Absolute
and relative paths are resolved under that root; path traversal outside it is
rejected. Existing inputs and output parents are resolved to their real paths,
so an in-root symlink or junction cannot escape the root. Output parents must
already exist, destinations are created atomically without clobbering an
existing file, and inputs are capped at 16 MiB.

The four offline tools are:

| Tool | Effect |
| --- | --- |
| `nodeslide.inspect_file` | Read and summarize a DeckSnapshot |
| `nodeslide.validate_file_patch` | Canonical, non-writing patch preflight |
| `nodeslide.propose_file_patch` | Return or store a digest-bound, unapplied proposal |
| `nodeslide.apply_file_proposal` | Revalidate approval and write a new deck file |

## MCP host-backed mode

Set both the deployment and owner capability when an external agent should work
against a live NodeSlide application:

```bash
set NODESLIDE_CONVEX_URL=https://your-deployment.convex.cloud
set NODESLIDE_OWNER_ACCESS_KEY=<owner-capability>
node mcp/dist/index.js
```

This retains the existing 11 tools unchanged:

```text
nodeslide.byok_status
nodeslide.get_deck
nodeslide.list_slides
nodeslide.get_trace
nodeslide.list_versions
nodeslide.propose_edit
nodeslide.accept_proposal
nodeslide.reject_proposal
nodeslide.upload_source
nodeslide.search_web
nodeslide.create_deck
```

The four file tools are also available in host-backed mode. Without
`NODESLIDE_CONVEX_URL`, host-backed calls remain listed but fail with an explicit
configuration error instead of accidentally targeting a default deployment.

Hosted proposal acceptance, egress consent, owner capabilities, source upload,
web research, and provider behavior remain owned by the existing MCP adapter.
The external-agent slice does not change standalone UI behavior or add a second
host runtime.

## Verification

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run proof:external-agent
npm pack ./packages/external-agent
npm pack ./mcp
```

`proof:external-agent` installs both packed artifacts into a fresh temporary
consumer, runs both help surfaces, inspects a real DeckSnapshot, proves
input/existing-output refusal, proposes and applies a version-pinned patch, and
imports the public library export.
