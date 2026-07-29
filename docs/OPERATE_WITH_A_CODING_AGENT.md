# Operate NodeSlide from your coding agent

NodeSlide exposes fifteen MCP tools. Once registered, Claude Code, Codex, or any MCP client can
inspect a deck, propose an edit, validate it, and apply it — without opening the web app.

This document exists because that capability was complete and undocumented. The server built, the
tools registered, and the only thing missing was a sentence telling anyone how to start it.

## What you get

**Offline file mode** — works with no backend, no account, no keys. Reads and writes canonical
`DeckSnapshot` JSON under a directory you nominate.

| tool | what it does |
|---|---|
| `nodeslide.inspect_file` | read a local DeckSpec file |
| `nodeslide.propose_file_patch` | draft an edit as a patch, nothing is written |
| `nodeslide.validate_file_patch` | check the patch against the schema and the gates |
| `nodeslide.apply_file_proposal` | write the validated patch |

**Hosted mode** — adds the eleven tools that talk to a deployed backend.

| tool | what it does |
|---|---|
| `nodeslide.create_deck` · `get_deck` · `list_slides` · `list_versions` | read the deck graph |
| `nodeslide.upload_source` | attach evidence a claim can cite |
| `nodeslide.propose_edit` · `accept_proposal` · `reject_proposal` | the review loop |
| `nodeslide.get_trace` | the run record: provider, tokens, cost, validation |
| `nodeslide.byok_status` · `search_web` | key status and research |

The split matters. Offline mode is the whole propose-validate-apply loop with no network, so an
agent can operate a deck in a repository the same way it operates code.

## Register it — Claude Code

```bash
git clone https://github.com/HomenShum/NodeSlide
cd NodeSlide/mcp && npm install && npm run build
```

```bash
claude mcp add nodeslide --scope user -- node "$(pwd)/dist/index.js"
```

For offline file tools, point the server at a directory it is allowed to touch:

```bash
claude mcp add nodeslide --scope user \
  --env NODESLIDE_LOCAL_ROOT="$HOME/decks" \
  -- node "$(pwd)/dist/index.js"
```

Add `--env NODESLIDE_CONVEX_URL=https://your-deployment.convex.cloud` to enable the hosted tools.
Without it the server still starts and the hosted tools return an explicit configuration error
rather than failing silently.

## Register it — Codex or any MCP client

The server speaks stdio. Any client that can launch a command works:

```json
{
  "mcpServers": {
    "nodeslide": {
      "command": "node",
      "args": ["/absolute/path/to/NodeSlide/mcp/dist/index.js"],
      "env": { "NODESLIDE_LOCAL_ROOT": "/absolute/path/to/your/decks" }
    }
  }
}
```

## Verify it started

```bash
node mcp/dist/index.js
```

It prints one line and waits:

```
NodeSlide MCP server 0.2.2 ready (stdio, offline-file mode; hosted tools require NODESLIDE_CONVEX_URL)
```

Silence after that line is correct. A stdio server says nothing until a client speaks to it.

## What the sandbox actually restricts

`NODESLIDE_LOCAL_ROOT` is a trust boundary, not a convenience. File tools refuse any path that
escapes it. If it is unset, the file tools are unavailable rather than defaulting to your home
directory — an agent that can write anywhere is not a safer agent.

Tools carry MCP annotations, so a client can distinguish a read from a write before calling:
`inspect_file` is `readOnlyHint: true`, the patch tools are not.

## Why propose-then-apply rather than edit

`propose_file_patch` returns a patch. `validate_file_patch` checks it. `apply_file_proposal` writes
it. Three calls where one would do, on purpose: the middle step is where the schema and the gates
run, and an agent that writes directly has no place to be refused.

That is the same shape as the web app's review flow, and the same reason `git diff` beats an editor
that saves as you type.

## Not yet published to npm

`nodeslide-mcp` and `@nodeslide/cli` are both `private: true` and carry `license: UNLICENSED`, so
`npx nodeslide-mcp` does not work and a stranger cannot install either one. The checkout route above
is the only route today.

Publishing needs two decisions that are the owner's, not an agent's: a real licence, and the choice
to distribute. The packages are otherwise ready — versioned, `bin` correct, `files` correct.
