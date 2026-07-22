# Model evidence contract

## Capability card fields

Record model ID and version, profile version, attempted and evaluated runs, brief families, harness version, tool surface, renderer, validators, layer confidence, observed metrics, strengths, weaknesses, best roles, avoid roles, required scaffolding, and status.

## Failure taxonomy

- `BRIEF_MISS`: explicit requirements or frozen claims are missing.
- `GENERIC_FALLBACK`: a valid but unrelated default artifact substitutes for the request.
- `OVERPLANNING`: planning consumes the budget without execution.
- `UNDERPLANNING`: execution begins before slide jobs and constraints are identified.
- `WRONG_PRIMITIVE`: prose replaces a required chart, diagram, screenshot, timeline, or other artifact.
- `LAYOUT_REPETITION`: substantially identical compositions recur.
- `TEXT_DENSITY`: copy exceeds the layout's readable capacity.
- `INTERNAL_OVERLAP`: content collides inside the slide canvas.
- `TOOL_AVOIDANCE`: prose replaces an available required tool call.
- `TOOL_MISUSE`: tool selection is correct but arguments or ordering are invalid.
- `NO_RESULT_INSPECTION`: screenshots, traces, renders, or assertions are not inspected.
- `FALSE_COMPLETION`: success is declared despite missing artifacts or failed checks.
- `WEAK_REPAIR`: a defect is recognized but the correction does not pass.
- `CONTEXT_DRIFT`: earlier evidence or constraints are lost.
- `ORCHESTRATION_FAILURE`: delegated work is poorly scoped or unvalidated.
- `UNSUPPORTED_CLAIM`: content lacks source support.
- `COST_INEFFICIENCY`: expensive reasoning replaces deterministic execution.
- `EXPORT_FAILURE`: generation reaches the editor but the artifact cannot be exported or rendered.

## Finding fields

Require `findingId`, model, harness version, brief ID, behavior, failure class, evidence with run and artifact paths, severity, probable cause, repair result, and status.

## Confidence

- `high`: at least 20 controlled artifact runs or 12 controlled trace runs with consistent behavior.
- `medium`: at least six controlled observations across two briefs.
- `low`: fewer observations, missing layers, or an untested causal hypothesis.

Do not aggregate an unmeasured layer into an overall capability score.
