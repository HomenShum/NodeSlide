export const NODESLIDE_CONFORMANCE_SCHEMA = 'nodeslide.conformance/v1';
export const NODESLIDE_CONFORMANCE_COMMAND = 'npm run proof';
export const NODESLIDE_CONFORMANCE_RECEIPT_PATH = 'artifacts/conformance/proof-receipt.json';

/**
 * The exact sequence `npm run proof` executes, in order. The receipt binds this list, so a step
 * cannot be dropped from the receipt to make an incomplete run look complete.
 */
export const NODESLIDE_CONFORMANCE_STEPS = [
  { id: 'test', script: 'test', command: 'npm run test' },
  {
    id: 'external-agent-smoke',
    script: 'proof:external-agent',
    command: 'npm run proof:external-agent',
  },
];

const STEP_STATUSES = new Set(['passed', 'failed', 'not-run']);

export function nodeSlideConformanceStepStatus(exitCode) {
  if (exitCode === null || exitCode === undefined) return 'not-run';
  if (!Number.isInteger(exitCode)) {
    throw new Error('A conformance step exit code must be an integer or null.');
  }
  return exitCode === 0 ? 'passed' : 'failed';
}

export function nodeSlideConformanceNotRunStep(step) {
  return {
    id: step.id,
    command: step.command,
    status: 'not-run',
    exitCode: null,
    startedAt: null,
    durationMs: null,
    evidence: [],
  };
}

/**
 * `npm run test` fans out over the workspaces, so a run reports one vitest summary per invocation.
 * The runner collects only the summary lines while the output streams past, which keeps the memory
 * bound without truncating the tallies the way a fixed-size tail of the log would.
 */
const VITEST_SUMMARY_LINE = /^\s*(Test Files|Tests)\s+(.+?)\s+\((\d+)\)\s*$/u;
// Built at runtime: an escape byte in the pattern trips noControlCharactersInRegex.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

export function isVitestSummaryLine(line) {
  return VITEST_SUMMARY_LINE.test(stripAnsi(line));
}

export function stripAnsi(value) {
  return String(value ?? '').replaceAll(ANSI, '');
}

function parseSummaryLine(line) {
  const match = stripAnsi(line).match(VITEST_SUMMARY_LINE);
  if (!match) return null;
  const counts = { passed: 0, failed: 0, skipped: 0, total: Number(match[3]) };
  for (const [, count, outcome] of match[2].matchAll(/(\d+)\s+(passed|failed|skipped)/gu)) {
    counts[outcome] = Number(count);
  }
  return { kind: match[1] === 'Test Files' ? 'files' : 'tests', counts };
}

/**
 * Pair each `Test Files` summary with the `Tests` summary that follows it, one pair per vitest
 * invocation. An unpaired summary is dropped rather than half-reported.
 */
export function parseVitestTallies(summaryLines) {
  if (!Array.isArray(summaryLines)) return [];
  const tallies = [];
  let files = null;
  for (const line of summaryLines) {
    const parsed = parseSummaryLine(line);
    if (!parsed) continue;
    if (parsed.kind === 'files') {
      files = parsed.counts;
      continue;
    }
    if (files) tallies.push({ files, tests: parsed.counts });
    files = null;
  }
  return tallies;
}

export function totalVitestTests(tallies) {
  return tallies.reduce(
    (total, tally) => ({
      passed: total.passed + tally.tests.passed,
      failed: total.failed + tally.tests.failed,
      skipped: total.skipped + tally.tests.skipped,
      total: total.total + tally.tests.total,
    }),
    { passed: 0, failed: 0, skipped: 0, total: 0 },
  );
}

function assertEvidence(evidence, stepId) {
  if (!Array.isArray(evidence)) {
    throw new Error(`Conformance step "${stepId}" must carry an evidence array.`);
  }
  for (const item of evidence) {
    if (typeof item?.path !== 'string' || !item.path) {
      throw new Error(
        `Conformance step "${stepId}" evidence must name a repository-relative path.`,
      );
    }
    if (!/^[0-9a-f]{64}$/u.test(item.sha256 ?? '')) {
      throw new Error(`Conformance step "${stepId}" evidence must carry a sha256 digest.`);
    }
    if (!Number.isInteger(item.byteSize) || item.byteSize < 0) {
      throw new Error(`Conformance step "${stepId}" evidence must carry a byte size.`);
    }
  }
  return evidence;
}

function assertStep(step, declared) {
  if (step?.id !== declared.id || step?.command !== declared.command) {
    throw new Error(
      `Conformance step ${declared.id} must record the command \`${declared.command}\` it actually ran.`,
    );
  }
  if (!STEP_STATUSES.has(step.status)) {
    throw new Error(`Conformance step "${declared.id}" has an unknown status.`);
  }
  if (step.status === 'not-run') {
    if (step.exitCode !== null) {
      throw new Error(
        `Conformance step "${declared.id}" claims not-run but recorded an exit code.`,
      );
    }
    if ((step.evidence ?? []).length > 0) {
      throw new Error(`Conformance step "${declared.id}" claims not-run but carries evidence.`);
    }
    return step;
  }
  if (nodeSlideConformanceStepStatus(step.exitCode) !== step.status) {
    throw new Error(
      `Conformance step "${declared.id}" status does not match its exit code (${step.exitCode}).`,
    );
  }
  if (!Number.isInteger(step.durationMs) || step.durationMs < 0) {
    throw new Error(`Conformance step "${declared.id}" must record how long it ran.`);
  }
  if (typeof step.startedAt !== 'string' || Number.isNaN(Date.parse(step.startedAt))) {
    throw new Error(`Conformance step "${declared.id}" must record when it started.`);
  }
  assertEvidence(step.evidence, declared.id);
  return step;
}

/**
 * A step can only be reported as executed while every earlier step passed, because `npm run proof`
 * chains its steps with `&&`. This is what stops a receipt claiming the suite passed when the run
 * never reached it.
 */
function assertStepSequencing(steps) {
  let halted = null;
  for (const step of steps) {
    if (halted && step.status !== 'not-run') {
      throw new Error(
        `Conformance step "${step.id}" cannot have run: "${halted}" did not pass before it.`,
      );
    }
    if (step.status !== 'passed') halted ??= step.id;
  }
  return steps;
}

export function assertNodeSlideConformanceReceipt(receipt) {
  if (receipt?.schemaVersion !== NODESLIDE_CONFORMANCE_SCHEMA) {
    throw new Error(`A conformance receipt must declare ${NODESLIDE_CONFORMANCE_SCHEMA}.`);
  }
  if (receipt.command !== NODESLIDE_CONFORMANCE_COMMAND) {
    throw new Error(`A conformance receipt must bind \`${NODESLIDE_CONFORMANCE_COMMAND}\`.`);
  }
  if (!/^[0-9a-f]{40}$/u.test(receipt.commitSha ?? '')) {
    throw new Error(
      'A conformance receipt must bind the exact 40-character commit it ran against.',
    );
  }
  if (typeof receipt.worktreeClean !== 'boolean') {
    throw new Error('A conformance receipt must disclose whether the worktree was clean.');
  }
  if (
    !Array.isArray(receipt.steps) ||
    receipt.steps.length !== NODESLIDE_CONFORMANCE_STEPS.length
  ) {
    throw new Error(
      `A conformance receipt must account for all ${NODESLIDE_CONFORMANCE_STEPS.length} declared steps.`,
    );
  }
  for (const [index, declared] of NODESLIDE_CONFORMANCE_STEPS.entries()) {
    assertStep(receipt.steps[index], declared);
  }
  assertStepSequencing(receipt.steps);
  if (receipt.passed !== receipt.steps.every((step) => step.status === 'passed')) {
    throw new Error('A conformance receipt verdict must be derived from its steps, not asserted.');
  }
  return receipt;
}

export function buildNodeSlideConformanceReceipt({
  commitSha,
  worktreeClean,
  startedAt,
  completedAt,
  steps,
}) {
  const ordered = NODESLIDE_CONFORMANCE_STEPS.map(
    (declared) =>
      steps.find((step) => step.id === declared.id) ?? nodeSlideConformanceNotRunStep(declared),
  );
  const passed = ordered.every((step) => step.status === 'passed');
  return assertNodeSlideConformanceReceipt({
    schemaVersion: NODESLIDE_CONFORMANCE_SCHEMA,
    command: NODESLIDE_CONFORMANCE_COMMAND,
    repository: 'HomenShum/NodeSlide',
    commitSha,
    worktreeClean,
    startedAt,
    completedAt,
    steps: ordered,
    passed,
    verdict: passed
      ? 'PROOF_COMMAND_RAN_AND_EVERY_DECLARED_STEP_PASSED'
      : 'PROOF_COMMAND_DID_NOT_COMPLETE_EVERY_DECLARED_STEP',
  });
}

/**
 * A receipt records the exit code exactly as the child reported it, which on Windows can be an
 * unsigned value such as 4294967295. Pass that straight to `process.exitCode` and the shell reads
 * a mangled status, so only re-use the child's code when a process can actually carry it.
 */
export function nodeSlideConformanceExitStatus(receipt) {
  if (receipt.passed) return 0;
  const exitCode = receipt.steps.find((step) => step.status === 'failed')?.exitCode;
  return Number.isInteger(exitCode) && exitCode > 0 && exitCode < 256 ? exitCode : 1;
}
