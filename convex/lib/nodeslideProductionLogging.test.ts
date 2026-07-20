import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production Convex log observability gate', () => {
  it('uses bounded history JSONL and fails closed when production returns no events', () => {
    const source = readFileSync(
      new URL('../../scripts/capture-convex-logs.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      "'logs', '--history', String(history), '--success', '--jsonl', '--prod'",
    );
    expect(source).toContain('const emptyHistory = !cliFailed && eventCount === 0');
    expect(source).toContain("'no-production-events'");
    expect(source).not.toContain('lines.push(line)');
  });
});
