import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const campaignDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(campaignDir, '..', '..');
const phase = process.argv[2] ?? 'before';
const requested = new Set(process.argv.slice(3));
const scenarios = JSON.parse(readFileSync(path.join(campaignDir, 'scenarios.json'), 'utf8')).filter(
  (scenario) => requested.size === 0 || requested.has(scenario.id),
);
const results = [];

for (const scenario of scenarios) {
  const output = path.join(campaignDir, phase, scenario.id);
  mkdirSync(output, { recursive: true });
  let finalStatus = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const stdoutPath = path.join(output, `attempt-${attempt}.stdout.log`);
    const stderrPath = path.join(output, `attempt-${attempt}.stderr.log`);
    const stdout = openSync(stdoutPath, 'w');
    const stderr = openSync(stderrPath, 'w');
    const startedAt = new Date().toISOString();
    const result = spawnSync(
      process.execPath,
      [
        path.join(repo, 'packages', 'cli', 'dist', 'cli.js'),
        'generate',
        '--title',
        scenario.title,
        '--prompt',
        scenario.prompt,
        '--output',
        output,
      ],
      {
        cwd: repo,
        windowsHide: true,
        stdio: ['ignore', stdout, stderr],
        timeout: 420_000,
      },
    );
    closeSync(stdout);
    closeSync(stderr);
    finalStatus = {
      id: scenario.id,
      attempt,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: result.status,
      signal: result.signal,
      timedOut: result.error?.code === 'ETIMEDOUT',
      stdoutPath,
      stderrPath,
    };
    if (result.status === 0) break;
  }
  results.push(finalStatus);
  writeFileSync(
    path.join(campaignDir, `${phase}-results.json`),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}

if (results.some((result) => result?.exitCode !== 0)) {
  process.exitCode = 1;
}
