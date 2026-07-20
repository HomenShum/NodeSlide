#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/** Read-only repository hygiene inventory. This script never prunes or deletes. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const json = process.argv.includes('--json');
const failOnFindings = process.argv.includes('--fail-on-findings');
const baseArg = process.argv.find((argument) => argument.startsWith('--base='));
const base = baseArg?.slice('--base='.length) || 'origin/main';
if (!/^[A-Za-z0-9_./-]+$/.test(base)) fail('invalid --base ref');

const root = git(['rev-parse', '--show-toplevel']).trim();
git(['rev-parse', '--verify', `${base}^{commit}`]);
const currentBranch = git(['branch', '--show-current']).trim() || null;
const statusLines = nonEmptyLines(git(['status', '--short']));
const mergedBranches = nonEmptyLines(
  git(['branch', '--format=%(refname:short)', '--merged', base]),
).filter((branch) => branch !== currentBranch && branch !== 'main' && branch !== base);
const worktrees = parseWorktrees(git(['worktree', 'list', '--porcelain']));
const stagingPath = path.resolve(
  process.env.NODESLIDE_DEPLOY_STAGING ?? path.join(root, '..', 'nodeslide-deploy'),
);

const findings = [];
if (statusLines.length > 0) findings.push('working-tree-not-clean');
if (mergedBranches.length > 0) findings.push('merged-local-branches');
if (worktrees.some((worktree) => worktree.prunable)) findings.push('prunable-worktrees');
if (existsSync(stagingPath)) findings.push('legacy-deploy-staging-present');

const report = {
  schemaVersion: 1,
  base,
  currentBranch,
  clean: statusLines.length === 0,
  changedPathCount: statusLines.length,
  mergedBranches,
  worktrees,
  legacyDeployStaging: {
    path: stagingPath,
    present: existsSync(stagingPath),
  },
  findings,
  destructiveActionsTaken: false,
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Repository: ${root}`);
  console.log(`Base: ${base}`);
  console.log(`Working tree: ${report.clean ? 'clean' : `${statusLines.length} changed path(s)`}`);
  console.log(
    `Merged local branch candidates: ${mergedBranches.length ? mergedBranches.join(', ') : 'none'}`,
  );
  console.log(`Registered worktrees: ${worktrees.length}`);
  for (const worktree of worktrees) {
    const flags = [worktree.branch ?? 'detached'];
    if (worktree.locked) flags.push('locked');
    if (worktree.prunable) flags.push('prunable');
    console.log(`  - ${worktree.path} (${flags.join(', ')})`);
  }
  console.log(
    `Legacy deploy staging: ${report.legacyDeployStaging.present ? 'present' : 'absent'} at ${stagingPath}`,
  );
  console.log('No branches, worktrees, or directories were changed.');
}

if (failOnFindings && findings.length > 0) process.exitCode = 2;

function parseWorktrees(value) {
  const blocks = value
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean);
  return blocks.map((block) => {
    const result = {
      path: '',
      head: null,
      branch: null,
      detached: false,
      locked: false,
      prunable: false,
    };
    for (const line of block.split(/\r?\n/)) {
      const [key, ...rest] = line.split(' ');
      const field = rest.join(' ');
      if (key === 'worktree') result.path = field;
      else if (key === 'HEAD') result.head = field;
      else if (key === 'branch') result.branch = field.replace(/^refs\/heads\//, '');
      else if (key === 'detached') result.detached = true;
      else if (key === 'locked') result.locked = true;
      else if (key === 'prunable') result.prunable = true;
    }
    return result;
  });
}

function nonEmptyLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function git(args) {
  const result = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8', shell: false });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail((result.stderr || result.stdout || `git ${args[0]} failed`).trim());
  return result.stdout;
}

function fail(message) {
  console.error(`[repo-hygiene] FAIL ${message}`);
  process.exit(1);
}
