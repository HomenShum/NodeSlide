# Before — agent generation and storytelling

Captured: 2026-07-29
Revision: `12153fb7af63668182dc0e36dd8bd320fc1154d1`

## Observable 1 — installed CLI

Commands:

```text
npm ci
npm run build --workspace @nodeslide/cli
node packages/cli/dist/cli.js --help
```

Result:

```text
npm ci: 557 packages installed in 46 seconds
CLI bundle: success
CLI execution: ERR_MODULE_NOT_FOUND
Missing: node_modules/@nodeslide/registry/dist/index.js
```

The CLI cannot show help after its own build unless another internal workspace is
built first. Its command surface contains `init` and `upgrade`, not brief-to-deck
generation.

## Observable 2 — live hosted MCP generation

The same held-out brief asked for a seven-slide cinematic, evidence-led story and
explicitly prohibited repeated card grids, dashboards, and generic title/body
layouts.

```json
{
  "handshakeMs": 377,
  "toolCount": 15,
  "createMs": 118749,
  "slides": 7,
  "requestedModel": "z-ai/glm-5.2",
  "actualAuthorship": "deterministic fallback",
  "reason": "invalid JSON after one repair attempt",
  "publishedShareReachable": false,
  "pptxDelivered": false,
  "htmlDelivered": false
}
```

Produced sequence:

1. User title
2. The moment to solve
3. The decisive insight
4. How the approach works
5. What success looks like
6. A practical path forward
7. The decision

## Observable 3 — checked-in production Deck Gym

```text
72 scenarios
53 degraded deterministic fallbacks
17 live model-authored traces
2 missing trace classification
```

Representative rendered “cinematic-minimal” decks reuse the cream editorial
shell, repeat headline/body/chart silhouettes, lack scene continuity, and contain
visible text collisions.

## After acceptance target

Using the identical held-out brief:

- CLI and MCP both create, validate, publish, and deliver HTML + PPTX.
- Production trace identifies a real model with positive token flow and no
  fallback suffix.
- Story receipt proves scene continuity, one coherent visual metaphor, reveal
  pacing, rising-and-releasing emotional intensity, and at least four distinct
  composition families.
- Browser and PowerPoint renders contain zero collisions.
