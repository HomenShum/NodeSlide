# NodeSlide Execution Port

NodeSlide can accept candidate work from its native executor, a RocketRide
sidecar, or a LangChain sidecar through the versioned
`node.workflow-execution/v1` envelope. The app does not import either framework.

The executor returns a typed `NodeSlidePatchInput`. `inspectNodeSlideWorkflowCandidate()` verifies:

- request, fixture, trace, input digest, and idempotency-key binding;
- the frozen application commit and runtime provenance;
- canonical candidate SHA-256, bounded size, event order, deadline, counters, and reported runtime health;
- NodeSlide's existing candidate invariants.

A successful receipt says `candidate_validated`, not committed. Final authority
remains with server validation, fine-grained CAS, proposal persistence, and human
review. The inspector accepts no backend mutation port, so a sidecar cannot
bypass those controls.

## Adapter Shape

```ts
const executionPort = createNodeWorkflowSidecarExecutionPort<NodeSlidePatchInput>({
  framework: 'rocketride', // Use 'langchain' for that sidecar.
  endpoint: process.env.NODESLIDE_WORKFLOW_SIDECAR_URL!,
  headers: sidecarToken ? { authorization: `Bearer ${sidecarToken}` } : {},
});
const result = await executionPort.execute(request, { signal });
const admission = await inspectNodeSlideWorkflowCandidate({
  request,
  result,
  expectedAppCommit,
  snapshot,
  digestCandidate,
});

if (!admission.accepted) return admission.receipt;
// Submit admission.candidate to the existing proposal path; do not write directly.
```

The endpoint is fixed at port creation, requires HTTPS except on localhost,
inherits the request deadline, and rejects non-JSON or oversized responses.
`createNativeNodeWorkflowExecutionPort()` wraps the current native control
behind the same request/result contract.

The deterministic study requires no model or cloud credential. A cloud transport
may implement the same port, but must report `location: "cloud"` and is an
operational appendix rather than a replacement for the pinned local benchmark.

## Verify

```powershell
npm test -- --run convex/lib/nodeslideWorkflowCandidate.test.ts
```
