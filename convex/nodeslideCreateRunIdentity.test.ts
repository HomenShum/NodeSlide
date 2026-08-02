import { describe, expect, it } from 'vitest';
import { nodeSlideDirectCreateRunId } from './nodeslideAgent';

describe('direct create run identity', () => {
  const sessionId = 'session-risk-committee';
  const requestDigest = 'sha256:identical-risk-committee-brief';

  it('replays a transport retry of one submission against the same budget row', () => {
    const attemptId = 'create-submission-a';
    expect(nodeSlideDirectCreateRunId(sessionId, attemptId, requestDigest)).toBe(
      nodeSlideDirectCreateRunId(sessionId, attemptId, requestDigest),
    );
  });

  it('dispatches a fresh run when an analyst deliberately resubmits the identical brief', () => {
    const first = nodeSlideDirectCreateRunId(sessionId, 'create-submission-a', requestDigest);
    const second = nodeSlideDirectCreateRunId(sessionId, 'create-submission-b', requestDigest);
    expect(second).not.toBe(first);
  });

  it('cannot collide across browser sessions even if a caller repeats an attempt id', () => {
    const first = nodeSlideDirectCreateRunId(sessionId, 'create-submission-a', requestDigest);
    const second = nodeSlideDirectCreateRunId(
      'session-governance-team',
      'create-submission-a',
      requestDigest,
    );
    expect(second).not.toBe(first);
  });
});
