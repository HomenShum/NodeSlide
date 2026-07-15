import type { DeckSnapshot } from '../../shared/nodeslide';
import {
  type CandidateAdmission,
  type NodeWorkflowRequest,
  type NodeWorkflowResult,
  inspectNodeWorkflowCandidate,
} from '../../shared/workflowExecutionPort';
import {
  type NodeSlidePatchInput,
  evaluateNodeSlideCas,
  validateNodeSlidePatch,
} from './nodeslidePatches';

/**
 * Admits an executor-produced patch as a candidate only. Proposal persistence,
 * acceptance, and commit remain in NodeSlide's existing server-side path.
 */
export function inspectNodeSlideWorkflowCandidate(args: {
  request: NodeWorkflowRequest;
  result: NodeWorkflowResult<NodeSlidePatchInput>;
  expectedAppCommit: string;
  snapshot: DeckSnapshot;
  digestCandidate: (candidate: NodeSlidePatchInput) => string | Promise<string>;
  now?: () => Date;
}): Promise<CandidateAdmission<NodeSlidePatchInput>> {
  return inspectNodeWorkflowCandidate({
    request: args.request,
    result: args.result,
    expectedApp: 'nodeslide',
    expectedAppCommit: args.expectedAppCommit,
    digestCandidate: args.digestCandidate,
    validateCandidate: (candidate) => validateCandidate(args.snapshot, candidate),
    now: args.now,
  });
}

function validateCandidate(snapshot: DeckSnapshot, candidate: NodeSlidePatchInput): string[] {
  const issues = validateNodeSlidePatch(snapshot, candidate);
  const cas = evaluateNodeSlideCas(snapshot, candidate);
  if (!cas.canCommit) issues.push(...cas.reasons);
  return [...new Set(issues)];
}
