import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(repoRoot, 'evidence/live-governance-after');
const statusPath = resolve(outputDirectory, 'run-status.json');
const stdoutPath = resolve(outputDirectory, 'cli.stdout.log');
const stderrPath = resolve(outputDirectory, 'cli.stderr.log');
const prompt =
  'Create a 7-slide executive risk-committee decision deck for a regulated financial institution operationalizing the NIST AI Risk Management Framework 1.0. Primary sources: https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10 and https://airc.nist.gov/airmf-resources/airmf/5-sec-core/. Audience: chief risk officer, general counsel, model risk, security, data science, and product leaders. Communication job: move the committee from abstract framework language to one governed release decision. Preserve the four functions GOVERN, MAP, MEASURE, and MANAGE; show governance as cross-cutting rather than a first step; distinguish model performance from residual risk; assign an owner and evidence requirement at the release gate. Do not present the framework as a linear checklist and do not invent regulatory obligations. Visual expectations: one lifecycle diagram, one risk matrix or evidence table, a continuous gate metaphor that changes state, visible escalation to a release decision, and no unresolved media placeholders.';

await mkdir(outputDirectory, { recursive: true });
const startedAt = new Date().toISOString();
const child = spawn(
  process.execPath,
  [
    resolve(repoRoot, 'packages/cli/dist/cli.js'),
    'generate',
    '--title',
    'From AI Inventory to Release Decision',
    '--prompt',
    prompt,
    '--output',
    outputDirectory,
  ],
  { cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
const stdout = [];
const stderr = [];
child.stdout.on('data', (chunk) => stdout.push(chunk));
child.stderr.on('data', (chunk) => stderr.push(chunk));
const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('close', resolveExit);
});
await Promise.all([
  writeFile(stdoutPath, Buffer.concat(stdout)),
  writeFile(stderrPath, Buffer.concat(stderr)),
  writeFile(
    statusPath,
    `${JSON.stringify(
      {
        schemaVersion: 'nodeslide.live-governance-proof/v1',
        startedAt,
        finishedAt: new Date().toISOString(),
        sourceCommit: process.env.NODESLIDE_SOURCE_COMMIT ?? null,
        exitCode,
        stdoutPath,
        stderrPath,
      },
      null,
      2,
    )}\n`,
  ),
]);
process.exitCode = typeof exitCode === 'number' ? exitCode : 1;
