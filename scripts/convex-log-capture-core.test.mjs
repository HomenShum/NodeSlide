import { describe, expect, it } from 'vitest';
import { isRecognizedConvexExecutionRecord } from './lib/convex-log-capture-core.mjs';

const completion = {
  kind: 'Completion',
  timestamp: 1_784_602_317.45,
  udfType: 'Query',
  identifier: 'nodeslide:getWorkspace',
  componentPath: null,
  executionId: 'execution-1',
  requestId: 'request-1',
  logLines: [],
  cachedResult: false,
  caller: 'ConvexClient',
  environment: 'production',
  executionTime: 0.012,
  identityType: 'unknown',
  willRetry: false,
  usageStats: {},
};

describe('Convex production JSONL recognition', () => {
  it('accepts only schema-shaped execution records', () => {
    expect(isRecognizedConvexExecutionRecord(completion)).toBe(true);
    expect(
      isRecognizedConvexExecutionRecord({
        kind: 'Progress',
        timestamp: completion.timestamp,
        udfType: 'Action',
        identifier: 'nodeslideAgent:createDeckFromBrief',
        executionId: 'execution-2',
        requestId: 'request-2',
        logLines: [],
      }),
    ).toBe(true);
  });

  it.each([
    {},
    { status: 'connected', cursor: 42 },
    { kind: 'Completion', timestamp: completion.timestamp },
    { ...completion, kind: 'Metadata' },
    { ...completion, requestId: '' },
    { ...completion, timestamp: '1784602317' },
    { ...completion, usageStats: null },
  ])('rejects metadata-only or malformed JSON without counting it as evidence', (value) => {
    expect(isRecognizedConvexExecutionRecord(value)).toBe(false);
  });
});
