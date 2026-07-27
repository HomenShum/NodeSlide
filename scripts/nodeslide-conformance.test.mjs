import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_CONFORMANCE_COMMAND,
  NODESLIDE_CONFORMANCE_SCHEMA,
  NODESLIDE_CONFORMANCE_STEPS,
  assertNodeSlideConformanceReceipt,
  buildNodeSlideConformanceReceipt,
  nodeSlideConformanceExitStatus,
  nodeSlideConformanceNotRunStep,
  nodeSlideConformanceStepStatus,
  parseVitestTallies,
  totalVitestTests,
} from './lib/nodeslide-conformance-core.mjs';

const COMMIT = 'a'.repeat(40);

function evidence(name, byteSize = 1024) {
  return { path: `artifacts/conformance/${name}`, sha256: 'b'.repeat(64), byteSize };
}

function ranStep(id, exitCode = 0) {
  const declared = NODESLIDE_CONFORMANCE_STEPS.find((step) => step.id === id);
  return {
    id: declared.id,
    command: declared.command,
    status: nodeSlideConformanceStepStatus(exitCode),
    exitCode,
    startedAt: '2026-07-25T00:00:00.000Z',
    durationMs: 42_000,
    evidence: [evidence(`${id}.stdout.log`), evidence(`${id}.stderr.log`, 0)],
  };
}

function build(steps, overrides = {}) {
  return buildNodeSlideConformanceReceipt({
    commitSha: COMMIT,
    worktreeClean: true,
    startedAt: '2026-07-25T00:00:00.000Z',
    completedAt: '2026-07-25T00:05:00.000Z',
    steps,
    ...overrides,
  });
}

describe('nodeslide conformance receipt', () => {
  it('binds the whole proof command when every declared step ran and passed', () => {
    const receipt = build([ranStep('test'), ranStep('external-agent-smoke')]);
    expect(receipt.schemaVersion).toBe(NODESLIDE_CONFORMANCE_SCHEMA);
    expect(receipt.command).toBe(NODESLIDE_CONFORMANCE_COMMAND);
    expect(receipt.commitSha).toBe(COMMIT);
    expect(receipt.passed).toBe(true);
    expect(receipt.steps.map((step) => `${step.id}:${step.status}`)).toEqual([
      'test:passed',
      'external-agent-smoke:passed',
    ]);
  });

  it('records the smoke step as not-run when the suite failed before it, and fails the receipt', () => {
    const receipt = build([ranStep('test', 1)]);
    expect(receipt.passed).toBe(false);
    expect(receipt.steps[0]).toMatchObject({ status: 'failed', exitCode: 1 });
    expect(receipt.steps[1]).toMatchObject({ status: 'not-run', exitCode: null, evidence: [] });
    expect(receipt.verdict).toBe('PROOF_COMMAND_DID_NOT_COMPLETE_EVERY_DECLARED_STEP');
  });

  it('refuses a receipt that claims a later step passed after an earlier step failed', () => {
    expect(() =>
      assertNodeSlideConformanceReceipt({
        ...build([ranStep('test'), ranStep('external-agent-smoke')]),
        passed: false,
        steps: [ranStep('test', 1), ranStep('external-agent-smoke')],
      }),
    ).toThrow(/cannot have run/u);
  });

  it('refuses a receipt that drops a declared step instead of reporting it not-run', () => {
    expect(() =>
      assertNodeSlideConformanceReceipt({
        ...build([ranStep('test')]),
        steps: [ranStep('test')],
      }),
    ).toThrow(/must account for all 2 declared steps/u);
  });

  it('refuses a passed verdict that its steps do not support', () => {
    expect(() =>
      assertNodeSlideConformanceReceipt({ ...build([ranStep('test', 1)]), passed: true }),
    ).toThrow(/derived from its steps/u);
  });

  it('refuses a not-run step that smuggles in an exit code or evidence', () => {
    const notRun = nodeSlideConformanceNotRunStep(NODESLIDE_CONFORMANCE_STEPS[1]);
    expect(() =>
      assertNodeSlideConformanceReceipt({
        ...build([ranStep('test', 1)]),
        steps: [ranStep('test', 1), { ...notRun, exitCode: 0 }],
      }),
    ).toThrow(/claims not-run but recorded an exit code/u);
    expect(() =>
      assertNodeSlideConformanceReceipt({
        ...build([ranStep('test', 1)]),
        steps: [ranStep('test', 1), { ...notRun, evidence: [evidence('smuggled.log')] }],
      }),
    ).toThrow(/claims not-run but carries evidence/u);
  });

  it('refuses a passed step whose exit code was not zero', () => {
    expect(() =>
      assertNodeSlideConformanceReceipt({
        ...build([ranStep('test')]),
        steps: [
          { ...ranStep('test'), exitCode: 2 },
          nodeSlideConformanceNotRunStep(NODESLIDE_CONFORMANCE_STEPS[1]),
        ],
      }),
    ).toThrow(/status does not match its exit code/u);
  });

  it('refuses a receipt that does not bind an exact commit or disclose worktree state', () => {
    expect(() => build([ranStep('test')], { commitSha: 'HEAD' })).toThrow(/40-character commit/u);
    expect(() => build([ranStep('test')], { worktreeClean: undefined })).toThrow(
      /whether the worktree was clean/u,
    );
  });

  it('refuses evidence without a digest, so a log cannot be swapped after the fact', () => {
    expect(() =>
      assertNodeSlideConformanceReceipt({
        ...build([ranStep('test', 1)]),
        steps: [
          {
            ...ranStep('test', 1),
            evidence: [{ path: 'artifacts/conformance/x.log', byteSize: 1 }],
          },
          nodeSlideConformanceNotRunStep(NODESLIDE_CONFORMANCE_STEPS[1]),
        ],
      }),
    ).toThrow(/must carry a sha256 digest/u);
  });
});

describe('conformance exit status', () => {
  it('exits zero only when the receipt passed', () => {
    expect(
      nodeSlideConformanceExitStatus(build([ranStep('test'), ranStep('external-agent-smoke')])),
    ).toBe(0);
    expect(nodeSlideConformanceExitStatus(build([ranStep('test', 2)]))).toBe(2);
  });

  it('does not pass through an exit code a process cannot carry', () => {
    // 4294967295 is what npm reported on Windows the first time this runner caught a real failure.
    expect(nodeSlideConformanceExitStatus(build([ranStep('test', 4_294_967_295)]))).toBe(1);
    expect(nodeSlideConformanceExitStatus(build([ranStep('test', 256)]))).toBe(1);
    expect(nodeSlideConformanceExitStatus(build([ranStep('test', 255)]))).toBe(255);
  });
});

describe('vitest tally parsing', () => {
  it('reads the counts a real coloured vitest summary reported', () => {
    expect(
      parseVitestTallies([
        '\u001B[2m Test Files \u001B[22m \u001B[1m\u001B[32m157 passed\u001B[39m\u001B[22m\u001B[90m (157)\u001B[39m',
        '\u001B[2m      Tests \u001B[22m \u001B[1m\u001B[32m1168 passed\u001B[39m\u001B[22m\u001B[90m (1168)\u001B[39m',
      ]),
    ).toEqual([
      {
        files: { passed: 157, failed: 0, skipped: 0, total: 157 },
        tests: { passed: 1168, failed: 0, skipped: 0, total: 1168 },
      },
    ]);
  });

  it('keeps one tally per workspace invocation and totals only what it read', () => {
    const tallies = parseVitestTallies([
      ' Test Files  157 passed (157)',
      '      Tests  1168 passed (1168)',
      ' Test Files  1 failed | 1 passed (2)',
      '      Tests  1 failed | 10 passed | 2 skipped (13)',
    ]);
    expect(tallies).toHaveLength(2);
    expect(totalVitestTests(tallies)).toEqual({
      passed: 1178,
      failed: 1,
      skipped: 2,
      total: 1181,
    });
  });

  it('drops a suite killed before its test counts instead of pairing it with the next run', () => {
    const tallies = parseVitestTallies([
      ' Test Files  3 passed (3)',
      ' Test Files  1 passed (1)',
      '      Tests  11 passed (11)',
    ]);
    expect(tallies).toEqual([
      {
        files: { passed: 1, failed: 0, skipped: 0, total: 1 },
        tests: { passed: 11, failed: 0, skipped: 0, total: 11 },
      },
    ]);
  });

  it('answers empty rather than guessing when no summary was captured', () => {
    expect(parseVitestTallies(['build failed before vitest started'])).toEqual([]);
    expect(parseVitestTallies(undefined)).toEqual([]);
  });
});
