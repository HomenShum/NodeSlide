export const NODESLIDE_SEMANTIC_ISSUE_CATALOG_VERSION: 'nodeslide.semantic-issue-catalog/v1';

export interface NodeSlideSemanticIssue {
  code: string;
  severity: 'error';
  message: string;
  path: string;
  repair: 'replace';
}

export function validateNodeSlideArtifactDepth(
  spec: Record<string, unknown>,
  options?: { now?: number },
): NodeSlideSemanticIssue[];

export function validateNodeSlideDeckRhythm(
  slides: Array<Record<string, unknown>>,
  options?: {
    maxConsecutiveText?: number;
    maxSameComposition?: number;
    minimumArchetypes?: number;
  },
): NodeSlideSemanticIssue[];
