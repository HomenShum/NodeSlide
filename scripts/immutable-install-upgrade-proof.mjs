import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  NODESLIDE_ARTIFACT_MANIFEST_FILE,
  disposeNodeSlideArtifactSet,
  verifyNodeSlideArtifactSet,
} from '@nodeslide/cli';
import {
  NODESLIDE_IMMUTABLE_PACKAGE_NAMES,
  assertArtifactDirectoriesByteEqual,
  assertCanonicalPackageRoster,
  assertExactArtifactDirectory,
  assertFullCommitSha,
  assertManifestReleaseId,
} from './immutable-package-set.mjs';

const execFileAsync = promisify(execFile);
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run this proof through npm so npm_execpath is available.');

const flags = parseFlags(process.argv.slice(2));
const fromDirectory = path.resolve(required(flags, 'from'));
const toDirectory = path.resolve(required(flags, 'to'));
const rebuiltToDirectory = flags.get('rebuilt-to');
const fromReleaseId = assertFullCommitSha(required(flags, 'from-release-id'), '--from-release-id');
const toReleaseId = assertFullCommitSha(required(flags, 'to-release-id'), '--to-release-id');
const fromUrl = flags.get('from-url');
const toUrl = flags.get('to-url');
if (flags.has('require-public')) {
  assertPublicReleaseUrl(fromUrl, 'from-url');
  assertPublicReleaseUrl(toUrl, 'to-url');
  assert(
    typeof rebuiltToDirectory === 'string',
    '--rebuilt-to is required for a public release proof.',
  );
}

let from;
let to;
let rebuilt;
try {
  from = await verifyNodeSlideArtifactSet(fromDirectory, NODESLIDE_IMMUTABLE_PACKAGE_NAMES);
  to = await verifyNodeSlideArtifactSet(toDirectory, NODESLIDE_IMMUTABLE_PACKAGE_NAMES);
  assertCanonicalPackageRoster(
    from.manifest.packages.map((artifact) => artifact.name),
    'Baseline artifact manifest',
  );
  assertCanonicalPackageRoster(
    to.manifest.packages.map((artifact) => artifact.name),
    'Candidate artifact manifest',
  );
  assertManifestReleaseId(from.manifest, fromReleaseId, 'Baseline');
  assertManifestReleaseId(to.manifest, toReleaseId, 'Candidate');
  await assertExactArtifactDirectory(fromDirectory, from.manifest, 'Baseline artifact set');
  await assertExactArtifactDirectory(toDirectory, to.manifest, 'Candidate artifact set');
  assert.notEqual(from.manifestSha256, to.manifestSha256, 'Upgrade manifests must be distinct.');

  let candidateRebuildMatchesPublicAssets = false;
  if (typeof rebuiltToDirectory === 'string') {
    const rebuiltDirectory = path.resolve(rebuiltToDirectory);
    rebuilt = await verifyNodeSlideArtifactSet(rebuiltDirectory, NODESLIDE_IMMUTABLE_PACKAGE_NAMES);
    assertCanonicalPackageRoster(
      rebuilt.manifest.packages.map((artifact) => artifact.name),
      'Rebuilt candidate artifact manifest',
    );
    assertManifestReleaseId(rebuilt.manifest, toReleaseId, 'Rebuilt candidate');
    await assertArtifactDirectoriesByteEqual(
      toDirectory,
      to.manifest,
      rebuiltDirectory,
      rebuilt.manifest,
    );
    candidateRebuildMatchesPublicAssets = true;
  }

  const proofRoot = await mkdtemp(path.join(tmpdir(), 'nodeslide-immutable-upgrade-'));
  const consumer = path.join(proofRoot, 'consumer');
  const controller = path.join(proofRoot, 'controller');
  await writeFile(path.join(proofRoot, '.guard'), 'nodeslide immutable proof\n', 'utf8');
  try {
    await mkdir(consumer);
    await mkdir(controller);
    await writePackageJson(consumer, 'nodeslide-immutable-consumer');
    await writePackageJson(controller, 'nodeslide-immutable-controller');
    await installBootstrap(controller, to);
    await runCli(controller, consumer, [
      'init',
      '--profile',
      'full-studio',
      '--backend',
      'convex',
      '--ui',
      'headless',
      '--artifacts',
      fromDirectory,
      '--skip-checks',
    ]);
    const installed = await receipt(consumer);
    assert.equal(installed.artifactSet?.manifestSha256, from.manifestSha256);
    await assertLockPins(consumer, installed.artifactSet);

    await runCli(controller, consumer, ['upgrade', '--artifacts', toDirectory, '--skip-checks']);
    const upgraded = await receipt(consumer);
    assert.equal(upgraded.artifactSet?.manifestSha256, to.manifestSha256);
    assert.equal(upgraded.artifactSet?.releaseVersion, to.manifest.releaseVersion);
    await assertLockPins(consumer, upgraded.artifactSet);

    await proveTamperRejection(proofRoot, toDirectory);
    await proveMixedReleaseRejection(proofRoot, toDirectory);

    const report = {
      schemaVersion: 'nodeslide.immutable-install-upgrade-proof/v1',
      passedAt: new Date().toISOString(),
      from: artifactEvidence(from, fromUrl),
      to: artifactEvidence(to, toUrl),
      cleanConsumer: true,
      candidateCliController: true,
      exactVersionPins: true,
      lockfileIntegrityPins: true,
      upgradeReceiptAdvanced: true,
      tamperedArtifactRejected: true,
      mixedReleaseRejected: true,
      candidateRebuildMatchesPublicAssets,
    };
    const reportPath = flags.get('report');
    if (reportPath) {
      await writeFile(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, {
        flag: 'wx',
      });
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    if (!flags.has('keep')) {
      const guard = await readFile(path.join(proofRoot, '.guard'), 'utf8');
      assert.equal(guard, 'nodeslide immutable proof\n');
      await rm(proofRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  }
} finally {
  await Promise.all(
    [from, to, rebuilt].map((artifactSet) => disposeNodeSlideArtifactSet(artifactSet)),
  );
}

async function installBootstrap(consumer, artifactSet) {
  const cli = artifactSet.packages.get('@nodeslide/cli');
  const registry = artifactSet.packages.get('@nodeslide/registry');
  assert(cli && registry, 'Artifact set must include CLI and registry packages.');
  await runNpm(
    [
      'install',
      '--save-exact',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      cli.absolutePath,
      registry.absolutePath,
    ],
    consumer,
  );
}

async function runCli(controller, consumer, args) {
  const cli = path.join(controller, 'node_modules', '@nodeslide', 'cli', 'dist', 'cli.js');
  await execFileAsync(process.execPath, [cli, ...args, '--cwd', consumer], {
    cwd: consumer,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function writePackageJson(directory, name) {
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify({ name, private: true, type: 'module' }, null, 2)}\n`,
  );
}

async function receipt(consumer) {
  return JSON.parse(await readFile(path.join(consumer, '.nodeslide', 'installation.json'), 'utf8'));
}

async function assertLockPins(consumer, artifactReceipt) {
  assert(artifactReceipt, 'Installation receipt did not pin an artifact set.');
  const lock = JSON.parse(await readFile(path.join(consumer, 'package-lock.json'), 'utf8'));
  for (const artifact of artifactReceipt.packages) {
    const installed = lock.packages?.[`node_modules/${artifact.name}`];
    assert(installed, `Lockfile is missing ${artifact.name}.`);
    assert.equal(installed.version, artifact.version, `${artifact.name} version was not exact.`);
    assert.equal(
      installed.integrity,
      artifact.integrity,
      `${artifact.name} integrity was not pinned.`,
    );
    assert(
      String(installed.resolved).replaceAll('\\', '/').endsWith(`/${artifact.file}`),
      `${artifact.name} did not resolve from ${artifact.file}.`,
    );
  }
}

async function proveTamperRejection(proofRoot, source) {
  const target = path.join(proofRoot, 'tampered');
  await cp(source, target, { recursive: true, errorOnExist: true });
  const manifest = JSON.parse(
    await readFile(path.join(target, NODESLIDE_ARTIFACT_MANIFEST_FILE), 'utf8'),
  );
  await appendFile(path.join(target, manifest.packages[0].file), Buffer.from('tampered'));
  await assert.rejects(() => verifyNodeSlideArtifactSet(target), /integrity mismatch/);
}

async function proveMixedReleaseRejection(proofRoot, source) {
  const target = path.join(proofRoot, 'mixed');
  await cp(source, target, { recursive: true, errorOnExist: true });
  const manifestPath = path.join(target, NODESLIDE_ARTIFACT_MANIFEST_FILE);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.packages[0].version = '0.0.0';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await assert.rejects(() => verifyNodeSlideArtifactSet(target), /mixed into release/);
}

function artifactEvidence(set, url) {
  return {
    releaseVersion: set.manifest.releaseVersion,
    releaseId: set.manifest.releaseId,
    registryVersion: set.manifest.registryVersion,
    manifestSha256: set.manifestSha256,
    packageCount: set.manifest.packages.length,
    ...(url ? { publicUrl: url } : {}),
  };
}

async function runNpm(args, cwd) {
  return execFileAsync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function assertPublicReleaseUrl(value, label) {
  assert(
    typeof value === 'string' &&
      /^https:\/\/github\.com\/HomenShum\/NodeSlide\/releases\/tag\/[A-Za-z0-9._-]+$/u.test(value),
    `--${label} must be a public immutable NodeSlide release URL.`,
  );
}

function parseFlags(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith('--')) throw new Error(`Unexpected argument ${String(token)}.`);
    const name = token.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(name, next);
      index += 1;
    } else {
      values.set(name, true);
    }
  }
  return values;
}

function required(flags, name) {
  const value = flags.get(name);
  if (typeof value !== 'string') throw new Error(`--${name} is required.`);
  return value;
}
