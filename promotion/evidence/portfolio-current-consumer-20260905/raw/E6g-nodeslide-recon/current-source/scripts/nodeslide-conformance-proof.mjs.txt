import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NODESLIDE_CONFORMANCE_RECEIPT_PATH,
  NODESLIDE_CONFORMANCE_STEPS,
  buildNodeSlideConformanceReceipt,
  isVitestSummaryLine,
  nodeSlideConformanceExitStatus,
  nodeSlideConformanceNotRunStep,
  nodeSlideConformanceStepStatus,
  parseVitestTallies,
  stripAnsi,
  totalVitestTests,
} from './lib/nodeslide-conformance-core.mjs';

// Both caps bound what a runaway step can hold in memory; the log file itself keeps everything.
const KEPT_LINES_MAX = 256;
const KEPT_LINE_MAX_CHARS = 4096;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receiptPath = path.join(repositoryRoot, NODESLIDE_CONFORMANCE_RECEIPT_PATH);
const logDirectory = path.dirname(receiptPath);
const npm = process.env.npm_execpath
  ? { command: process.execPath, prefix: [process.env.npm_execpath] }
  : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefix: [] };

await mkdir(logDirectory, { recursive: true });

const startedAt = new Date().toISOString();
const steps = [];
let halted = false;

for (const declared of NODESLIDE_CONFORMANCE_STEPS) {
  if (halted) {
    steps.push(nodeSlideConformanceNotRunStep(declared));
    continue;
  }
  const step = await runStep(declared);
  steps.push(step);
  if (step.status !== 'passed') halted = true;
}

const receipt = buildNodeSlideConformanceReceipt({
  commitSha: git(['rev-parse', 'HEAD']),
  worktreeClean: git(['status', '--porcelain']) === '',
  startedAt,
  completedAt: new Date().toISOString(),
  steps,
});

await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(
  `\n${NODESLIDE_CONFORMANCE_RECEIPT_PATH} ${receipt.verdict}\n${JSON.stringify(receipt, null, 2)}\n`,
);
process.exitCode = nodeSlideConformanceExitStatus(receipt);

async function runStep(declared) {
  const stdout = captureStream(
    path.join(logDirectory, `${declared.id}.stdout.log`),
    process.stdout,
  );
  const stderr = captureStream(
    path.join(logDirectory, `${declared.id}.stderr.log`),
    process.stderr,
  );
  const stepStartedAt = new Date().toISOString();
  const start = Date.now();
  const child = spawn(npm.command, [...npm.prefix, 'run', declared.script], {
    cwd: repositoryRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', stdout.write);
  child.stderr.on('data', stderr.write);
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve(signal ? 128 : (code ?? 1)));
  });
  const durationMs = Date.now() - start;
  const captured = [await stdout.close(), await stderr.close()];
  return {
    id: declared.id,
    command: declared.command,
    status: nodeSlideConformanceStepStatus(exitCode),
    exitCode,
    startedAt: stepStartedAt,
    durationMs,
    evidence: captured.map(({ evidence }) => evidence),
    ...observeStep(declared.id, captured[0].keptLines),
  };
}

/**
 * Read back what the step itself reported, so the receipt binds the run rather than restating the
 * exit code. Anything that cannot be read stays null instead of being assumed.
 */
function observeStep(id, keptLines) {
  if (id === 'test') {
    const suites = parseVitestTallies(keptLines);
    return { vitest: suites.length > 0 ? { suites, tests: totalVitestTests(suites) } : null };
  }
  if (id === 'external-agent-smoke') {
    const line = keptLines.findLast((candidate) => candidate.startsWith('{'));
    try {
      return { smoke: JSON.parse(line ?? '') };
    } catch {
      return { smoke: null };
    }
  }
  return {};
}

/**
 * Tee a child stream to the terminal and to a log file, digesting it on the way through, and keep
 * only the lines a receipt can read back: vitest summaries and JSON result lines.
 */
function captureStream(absolutePath, mirror) {
  const file = createWriteStream(absolutePath);
  const hash = createHash('sha256');
  const keptLines = [];
  let byteSize = 0;
  let pending = '';

  function keep(rawLine) {
    const line = stripAnsi(rawLine).trim().slice(0, KEPT_LINE_MAX_CHARS);
    if (!line.startsWith('{') && !isVitestSummaryLine(line)) return;
    if (keptLines.length >= KEPT_LINES_MAX) keptLines.shift();
    keptLines.push(line);
  }

  return {
    write(chunk) {
      hash.update(chunk);
      byteSize += chunk.length;
      file.write(chunk);
      mirror.write(chunk);
      const lines = (pending + chunk.toString('utf8')).split(/\r?\n/u);
      pending = lines.pop() ?? '';
      if (pending.length > KEPT_LINE_MAX_CHARS) pending = pending.slice(-KEPT_LINE_MAX_CHARS);
      for (const line of lines) keep(line);
    },
    async close() {
      if (pending) keep(pending);
      await new Promise((resolve, reject) => {
        file.on('error', reject);
        file.end(resolve);
      });
      return {
        keptLines,
        evidence: {
          path: path.relative(repositoryRoot, absolutePath).replaceAll('\\', '/'),
          sha256: hash.digest('hex'),
          byteSize,
        },
      };
    },
  };
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.status}).\n${result.stderr}`);
  }
  return result.stdout.trim();
}
