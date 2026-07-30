# RecipeLang

RecipeLang is NodeSlide's versioned, model-neutral process-contract compiler.
Authors describe inputs, typed artifact handoffs, steps, outputs, executors,
and notes. The compiler owns normalization, validation, topology, provenance,
row spans, stable hashing, and geometry.

```bash
recipelang validate workflow.recipe.yaml --strict --json
recipelang compile workflow.recipe.yaml --out workflow.recipe.json
recipelang render workflow.recipe.json --format svg --out workflow.svg
recipelang verify-alignment workflow.recipe.json --json
recipelang inspect workflow.recipe.json --artifact deduped-items --json
cat patch.json | recipelang patch workflow.recipe.json --base-version 12 --json
```

The CLI never invokes a model or prompts interactively. Validation failures
exit `2`; command or I/O failures exit `1`; success exits `0`. YAML and JSON
share the canonical `recipelang/v1` interchange contract. Rendering and patch
receipts include stable SHA-256 content identity.

The same implementation is exposed through NodeSlide MCP as:

```text
recipelang.get_schema
recipelang.validate
recipelang.normalize
recipelang.inspect
recipelang.verify_alignment
recipelang.create_proposal
recipelang.apply_patch
recipelang.render
recipelang.export
```

See `benchmarks/recipelang/edge-data-contract.recipe.yaml` for the checked-in
many-to-one reference fixture. `npm run recipelang:reference` deterministically
rebuilds the live HTML/SVG fixture in `public/recipelang/`; `:check` fails when
those artifacts drift. The alignment receipt uses Cooking for Engineers'
Tabular Recipe Notation as its structural reference: shared row boundaries,
merged consumption spans, parallel scan paths, and left-to-right convergence.
