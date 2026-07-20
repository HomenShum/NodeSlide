#!/usr/bin/env node
/**
 * Bounded, artifact-safe Convex production log capture.
 *
 * The underlying command intentionally includes all four required switches:
 *   convex logs --history <n> --success --jsonl --prod
 *
 * Raw JSONL is never persisted. Successful return values and request ids can
 * contain capabilities or user data, so the default artifact is an allowlisted
 * execution summary. Set CONVEX_LOG_INCLUDE_MESSAGES=1 only for a secured local
 * diagnostic; CI must leave it unset.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const history = boundedInteger(process.env.CONVEX_LOG_HISTORY, 50, { min: 1, max: 1_000 });
const durationMs = boundedInteger(process.env.CONVEX_LOG_DURATION_MS, 15_000, {
  min: 2_000,
  max: 60_000,
});
const maxEvents = boundedInteger(process.env.CONVEX_LOG_MAX_EVENTS, 250, { min: 1, max: 2_000 });
const outputPath = path.resolve(
  process.env.CONVEX_LOG_OUTPUT ?? 'artifacts/convex-logs/production.jsonl',
);
const includeMessages = process.env.CONVEX_LOG_INCLUDE_MESSAGES === '1';
const deployKey = process.env.CONVEX_DEPLOY_KEY;

if (!deployKey)
  fail('CONVEX_DEPLOY_KEY is required (use a production key with deployment:logs:view only)');
if (!/^prod:agile-stoat-411\|/.test(deployKey)) {
  fail('CONVEX_DEPLOY_KEY is not scoped to the expected agile-stoat-411 production deployment');
}
if (process.env.CI && includeMessages) {
  fail('CONVEX_LOG_INCLUDE_MESSAGES=1 is forbidden in CI artifacts');
}

const convexBin = path.join(process.cwd(), 'node_modules', 'convex', 'bin', 'main.js');
const args = [convexBin, 'logs', '--history', String(history), '--success', '--jsonl', '--prod'];
const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdoutBuffer = '';
let stderrBuffer = '';
let stopReason = 'timeout';
let eventCount = 0;
let childExitCode = null;
const lines = [];

child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk;
  const parts = stdoutBuffer.split(/\r?\n/);
  stdoutBuffer = parts.pop() ?? '';
  for (const line of parts) acceptLine(line);
});
child.stderr.on('data', (chunk) => {
  stderrBuffer = `${stderrBuffer}${chunk}`.slice(-4_000);
});

const timer = setTimeout(() => stop('timeout'), durationMs);
child.on('error', (error) => {
  stderrBuffer = `${stderrBuffer}\n${error.message}`;
});
child.on('exit', (code) => {
  childExitCode = code;
});

await new Promise((resolve) => {
  child.once('close', resolve);
  setTimeout(() => {
    stop('timeout');
    resolve();
  }, durationMs + 2_000);
});
clearTimeout(timer);
if (stdoutBuffer.trim()) acceptLine(stdoutBuffer);

const cliFailed = childExitCode !== null && childExitCode !== 0 && stopReason !== 'max-events';
// A green empty capture recreates the original blind spot: the operator gets
// no execution evidence but the command appears healthy. History mode should
// return recent completions on an active production deployment, so fail closed
// and retain a machine-readable reason when it returns nothing.
const emptyHistory = !cliFailed && eventCount === 0;
const failed = cliFailed || emptyHistory;
lines.push(
  JSON.stringify({
    capture: {
      schemaVersion: 1,
      command: 'convex logs --history <n> --success --jsonl --prod',
      history,
      durationMs,
      maxEvents,
      capturedEvents: eventCount,
      includeMessages,
      stopReason: cliFailed ? 'cli-error' : emptyHistory ? 'empty-history' : stopReason,
      status: failed ? 'failed' : 'completed',
      failureCode: cliFailed ? 'convex-cli-error' : emptyHistory ? 'no-production-events' : null,
      ...(cliFailed && stderrBuffer.trim()
        ? { diagnostic: redact(stderrBuffer.trim()).slice(0, 800) }
        : {}),
    },
  }),
);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(
  `[convex-logs] ${failed ? 'FAIL' : 'PASS'} captured ${eventCount} sanitized event(s) with --history ${history} --success --jsonl --prod`,
);
console.log(`[convex-logs] artifact: ${path.relative(process.cwd(), outputPath)}`);
if (failed) process.exit(1);

function acceptLine(line) {
  if (!line.trim() || eventCount >= maxEvents) return;
  try {
    const parsed = JSON.parse(line);
    lines.push(JSON.stringify(safeExecution(parsed, includeMessages)));
    eventCount += 1;
    if (eventCount >= maxEvents) stop('max-events');
  } catch {
    // Status text belongs on stderr in --jsonl mode. If a future CLI writes it
    // to stdout, preserve only a redacted diagnostic rather than raw content.
    lines.push(JSON.stringify({ kind: 'unparsed', message: redact(line).slice(0, 300) }));
  }
}

function safeExecution(value, withMessages) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const logLines = Array.isArray(record.logLines) ? record.logLines : [];
  const levels = {};
  for (const line of logLines) {
    const level =
      line && typeof line === 'object' && !Array.isArray(line) && typeof line.level === 'string'
        ? line.level
        : 'UNKNOWN';
    levels[level] = (levels[level] ?? 0) + 1;
  }
  const error = typeof record.error === 'string' && record.error ? record.error : null;
  return {
    kind: safeEnum(record.kind, ['Completion', 'Progress'], 'Unknown'),
    timestamp: safeNumber(record.timestamp),
    udfType: safeEnum(record.udfType, ['Query', 'Mutation', 'Action', 'HttpAction'], 'Unknown'),
    identifier: safeIdentifier(record.identifier),
    componentPath: safeIdentifier(record.componentPath),
    status: error ? 'failure' : record.kind === 'Completion' ? 'success' : 'progress',
    executionTimeMs:
      typeof record.executionTime === 'number'
        ? Math.round(record.executionTime * 1_000 * 100) / 100
        : null,
    cachedResult: typeof record.cachedResult === 'boolean' ? record.cachedResult : null,
    logLineLevels: levels,
    ...(error ? { errorDigest: digest(error) } : {}),
    ...(withMessages
      ? {
          error: error ? redact(error).slice(0, 1_000) : null,
          messages: logLines
            .flatMap((line) =>
              line &&
              typeof line === 'object' &&
              !Array.isArray(line) &&
              Array.isArray(line.messages)
                ? line.messages
                : [],
            )
            .map((message) => redact(String(message)).slice(0, 500))
            .slice(0, 20),
        }
      : {}),
  };
}

function stop(reason) {
  if (childExitCode !== null || child.killed) return;
  stopReason = reason;
  child.kill('SIGTERM');
}

function safeEnum(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function safeIdentifier(value) {
  if (typeof value !== 'string') return null;
  return /^[A-Za-z0-9_./:-]{1,200}$/.test(value) ? value : '[REDACTED_IDENTIFIER]';
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

function boundedInteger(value, fallback, { min, max }) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`numeric option must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function redact(value) {
  return String(value)
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:prod|dev|preview):[^|\s]+\|[^\s"']+/gi, '[REDACTED_DEPLOY_KEY]')
    .replace(/([?&](?:token|key|secret|authorization|ownerAccessKey)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(
      /("?(?:ownerAccessKey|accessToken|apiKey|secret|authorization)"?\s*[:=]\s*)["']?[^\s,"'}]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\b[A-Za-z0-9_-]{64,}\b/g, '[REDACTED_LONG_VALUE]');
}

function fail(message) {
  console.error(`[convex-logs] FAIL ${message}`);
  process.exit(1);
}
