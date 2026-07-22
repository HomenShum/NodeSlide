'use node';

import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import {
  nodeSlideArtifactArenaJsonSchema,
  nodeSlideArtifactArenaSystemPrompt,
  nodeSlideArtifactArenaUserPayload,
  parseNodeSlideArtifactArenaCandidate,
  validateNodeSlideArtifactArenaBatch,
} from './lib/nodeslideArtifactArena';
import { callNodeSlideFreeJson } from './lib/nodeslideProvider';

/** Server-only, non-mutating Artifact Arena planner. */
export const runCandidate = internalAction({
  args: { candidateJson: v.string() },
  handler: async (_ctx, args) => runCandidateJson(args.candidateJson),
});

/** Bounded operator batch; three independent candidates maximum. */
export const runBatch = internalAction({
  args: { candidateJsons: v.array(v.string()) },
  handler: async (_ctx, args) => {
    validateNodeSlideArtifactArenaBatch(args.candidateJsons);
    return await Promise.all(
      args.candidateJsons.map((candidateJson) => runCandidateJson(candidateJson)),
    );
  },
});

async function runCandidateJson(candidateJson: string) {
  const candidate = parseNodeSlideArtifactArenaCandidate(candidateJson);
  const startedAt = Date.now();
  const result = await callNodeSlideFreeJson(
    {
      model: candidate.model,
      reasoningEffort: candidate.reasoningEffort,
      systemPrompt: nodeSlideArtifactArenaSystemPrompt(candidate),
      userText: nodeSlideArtifactArenaUserPayload(candidate),
      maxTokens: 1_800,
      jsonSchema: nodeSlideArtifactArenaJsonSchema(candidate),
    },
    { timeoutMs: 180_000 },
  );
  return {
    schemaVersion: 'nodeslide.artifact-arena-plan-result/v1',
    candidateId: candidate.candidateId,
    candidateDigest: candidate.candidateDigest,
    fixtureId: candidate.fixtureId,
    artifactType: candidate.artifactType,
    model: candidate.model,
    directionId: candidate.directionId,
    durationMs: Date.now() - startedAt,
    status: result.ok ? ('passed' as const) : ('failed' as const),
    ...(result.ok ? { plan: result.value } : { failure: result.reason }),
    ...(result.telemetry ? { telemetry: result.telemetry } : {}),
  };
}
