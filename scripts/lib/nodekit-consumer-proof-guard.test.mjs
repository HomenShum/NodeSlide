import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertCommittedCleanConsumerTree,
  assertNodeKitPackageProvenance,
} from './nodekit-consumer-proof-guard.mjs';

const exactProvenance = {
  version: '0.2.1',
  sourceCommit: 'a'.repeat(40),
  sourceHash: 'b'.repeat(64),
  sourceWorkingTreeCleanAtPackTime: true,
  tarball: {
    path: 'vendor/homenshum-nodekit-0.2.1.tgz',
    sha256: 'c'.repeat(64),
    integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
  },
};

function git(repoRoot, ...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

function fixtureRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'nodeslide-nodekit-proof-'));
  mkdirSync(join(repoRoot, 'vendor'));
  mkdirSync(join(repoRoot, 'scripts'));
  writeFileSync(join(repoRoot, 'package.json'), '{}\n');
  writeFileSync(join(repoRoot, 'scripts', 'proof.mjs'), 'export {};\n');
  writeFileSync(join(repoRoot, 'vendor', 'nodekit.json'), '{}\n');
  git(repoRoot, 'init');
  git(repoRoot, 'add', '.');
  git(
    repoRoot,
    '-c',
    'user.name=NodeSlide proof test',
    '-c',
    'user.email=proof@nodeslide.test',
    'commit',
    '-m',
    'fixture',
  );
  return repoRoot;
}

test('requires package provenance to bind a clean exact source and tarball', () => {
  assert.equal(
    assertNodeKitPackageProvenance(exactProvenance).tarball.path,
    exactProvenance.tarball.path,
  );
  assert.throws(
    () =>
      assertNodeKitPackageProvenance({
        ...exactProvenance,
        sourceWorkingTreeCleanAtPackTime: false,
      }),
    /clean source tree/u,
  );
  assert.throws(
    () =>
      assertNodeKitPackageProvenance({
        ...exactProvenance,
        sourceHash: 'not-exact',
      }),
    /64-character source hash/u,
  );
});

test('requires every proof input to be committed and the consumer tree to be clean', () => {
  const repoRoot = fixtureRepo();
  const requiredPaths = ['package.json', 'scripts/proof.mjs', 'vendor/nodekit.json'];
  assert.doesNotThrow(() => assertCommittedCleanConsumerTree({ repoRoot, requiredPaths }));

  writeFileSync(join(repoRoot, 'scripts', 'proof.mjs'), 'export const dirty = true;\n');
  assert.throws(
    () => assertCommittedCleanConsumerTree({ repoRoot, requiredPaths }),
    /source tree is dirty/u,
  );
});

test('rejects uncommitted provenance but ignores generated proof outputs', () => {
  const repoRoot = fixtureRepo();
  mkdirSync(join(repoRoot, 'proof', 'nodekit-caseflow-consumer'), { recursive: true });
  writeFileSync(join(repoRoot, 'proof', 'nodekit-caseflow-consumer', 'receipt.json'), '{}\n');
  assert.doesNotThrow(() =>
    assertCommittedCleanConsumerTree({
      repoRoot,
      requiredPaths: ['package.json'],
      ignoredPrefixes: ['proof/nodekit-caseflow-consumer'],
    }),
  );

  writeFileSync(join(repoRoot, 'vendor', 'uncommitted-provenance.json'), '{}\n');
  assert.throws(
    () =>
      assertCommittedCleanConsumerTree({
        repoRoot,
        requiredPaths: ['vendor/uncommitted-provenance.json'],
        ignoredPrefixes: ['proof/nodekit-caseflow-consumer'],
      }),
    /not committed/u,
  );
});
