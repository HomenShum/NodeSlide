import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  NODESLIDE_IMMUTABLE_MANIFEST_FILE,
  NODESLIDE_IMMUTABLE_PACKAGE_NAMES,
  assertCanonicalPackageRoster,
  assertFullCommitSha,
} from './immutable-package-set.mjs';

const execFileAsync = promisify(execFile);
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run this proof through npm so npm_execpath is available.');

const flags = parseFlags(process.argv.slice(2));
const output = path.resolve(required(flags, 'out'));
const releaseId = assertFullCommitSha(required(flags, 'release-id'), '--release-id');
const expectedVersion = flags.get('release-version');
const producerRoot = path.resolve(flags.get('root') ?? process.cwd());
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output);

const registryVersion =
  flags.get('registry-version') ?? (await import('@nodeslide/registry')).NODESLIDE_REGISTRY_VERSION;
const packages = [];
for (const packageName of NODESLIDE_IMMUTABLE_PACKAGE_NAMES) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [npmCli, 'pack', '--json', '--workspace', packageName, '--pack-destination', output],
    { cwd: producerRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  const packed = JSON.parse(stdout)[0];
  assert.equal(packed.name, packageName, `npm pack returned the wrong package for ${packageName}.`);
  assert.equal(typeof packed.version, 'string');
  assert.equal(typeof packed.filename, 'string');
  const bytes = await readFile(path.join(output, packed.filename));
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(integrity, packed.integrity, `${packageName} npm integrity did not match bytes.`);
  packages.push({
    name: packageName,
    version: packed.version,
    file: packed.filename,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    integrity,
  });
}

const versions = new Set(packages.map((artifact) => artifact.version));
assert.equal(versions.size, 1, `Package set is mixed: ${[...versions].join(', ')}.`);
const releaseVersion = packages[0]?.version;
assert(releaseVersion, 'Package set is empty.');
assertCanonicalPackageRoster(
  packages.map((artifact) => artifact.name),
  'Packed artifact set',
);
if (expectedVersion) {
  assert.equal(
    releaseVersion,
    expectedVersion,
    'Packed release version did not match --release-version.',
  );
}
const manifest = {
  schemaVersion: 'nodeslide.artifacts/v1',
  releaseVersion,
  releaseId,
  registryVersion,
  packages,
};
const manifestPath = path.join(output, NODESLIDE_IMMUTABLE_MANIFEST_FILE);
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(manifestPath, manifestBytes, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    directory: output,
    releaseVersion,
    releaseId,
    registryVersion,
    packageCount: packages.length,
    manifestSha256: `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`,
  })}\n`,
);

function parseFlags(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Expected --name value pairs; received ${String(key)}.`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function required(flags, name) {
  const value = flags.get(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}
