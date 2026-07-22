import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run the portability proof through npm so npm_execpath is available.');

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const flags = parseFlags(process.argv.slice(2));
const reportPath = path.resolve(
  flags.get('report') ?? 'artifacts/node-gym/node-gym-core-portability-proof.json',
);
const nodeRoomRoot = path.resolve(
  flags.get('noderoom-root') ?? path.join(rootDirectory, '..', 'NodeRoom'),
);
const candidateManifest = JSON.parse(
  await readFile(path.join(rootDirectory, 'packages', 'gym-core', 'package.json'), 'utf8'),
);
assert.equal(candidateManifest.name, '@nodekit/gym-core');
assert.equal(candidateManifest.version, '0.1.0');
assert.equal(candidateManifest.dependencies, undefined, 'gym-core must remain dependency-free.');
assert.equal(candidateManifest.peerDependencies, undefined, 'gym-core must remain peer-free.');

const temporaryRoot = path.resolve(tmpdir());
const proofRoot = await mkdtemp(path.join(temporaryRoot, 'node-gym-portability-'));
const safeTemporaryPrefix = `${temporaryRoot}${path.sep}`;
assert(proofRoot.startsWith(safeTemporaryPrefix), 'Refusing to write outside the temporary root.');
await writeFile(path.join(proofRoot, '.guard'), 'node-gym portability proof\n', 'utf8');

let nodeRoomCheckout;
try {
  nodeRoomCheckout = await inspectNodeRoomCheckout(nodeRoomRoot);
  const packDirectory = path.join(proofRoot, 'packs');
  await mkdir(packDirectory);
  const baseline = await packPackage(
    [
      'pack',
      '--json',
      path.join(scriptDirectory, 'fixtures', 'node-gym-core-v0.0.1'),
      '--pack-destination',
      packDirectory,
    ],
    rootDirectory,
    packDirectory,
  );
  const candidate = await packPackage(
    ['pack', '--json', '--workspace', '@nodekit/gym-core', '--pack-destination', packDirectory],
    rootDirectory,
    packDirectory,
  );
  assert.equal(baseline.name, '@nodekit/gym-core');
  assert.equal(baseline.version, '0.0.1');
  assert.equal(candidate.name, '@nodekit/gym-core');
  assert.equal(candidate.version, '0.1.0');
  assertPackedEntrypoints(baseline);
  assertPackedEntrypoints(candidate);

  const nodeSlideConsumer = await prepareConsumer('nodeslide', proofRoot);
  const nodeRoomConsumer = await prepareConsumer('noderoom', proofRoot);
  await assertCleanConsumer(nodeSlideConsumer);
  await assertCleanConsumer(nodeRoomConsumer);

  const nodeRoomBaselineLock = await installAndInspect(nodeRoomConsumer, baseline);
  const nodeRoomBaselineResult = await runConsumer(nodeRoomConsumer, 'baseline');
  assert.equal(nodeRoomBaselineResult.product, 'NodeRoom');
  assert.equal(nodeRoomBaselineResult.phase, 'baseline');
  assert.equal(nodeRoomBaselineResult.version, '0.0.1');
  assert.equal(typeof nodeRoomBaselineResult.pairingKey, 'string');

  const nodeRoomCandidateLock = await installAndInspect(nodeRoomConsumer, candidate);
  const nodeRoomCandidateResult = await runConsumer(nodeRoomConsumer, 'candidate');
  assert.equal(nodeRoomCandidateResult.product, 'NodeRoom');
  assert.equal(nodeRoomCandidateResult.phase, 'candidate');
  assert.equal(nodeRoomCandidateResult.version, '0.1.0');
  assert.equal(nodeRoomCandidateResult.plans, 6);
  assert.equal(nodeRoomCandidateResult.domainEvaluator, 'NodeAgent frame evidence');
  assert.equal(nodeRoomCandidateResult.paired, true);
  assert.equal(
    nodeRoomCandidateResult.pairingKey,
    nodeRoomBaselineResult.pairingKey,
    'The immutable run-plan pairing key changed across a schema-compatible upgrade.',
  );
  await runTypeConsumer(nodeRoomConsumer);

  const nodeSlideCandidateLock = await installAndInspect(nodeSlideConsumer, candidate);
  const nodeSlideResult = await runConsumer(nodeSlideConsumer);
  assert.deepEqual(nodeSlideResult, {
    product: 'NodeSlide',
    plans: 6,
    domainEvaluator: 'equation-semantics',
    paired: true,
  });
  await runTypeConsumer(nodeSlideConsumer);

  assert.equal(
    nodeRoomCandidateLock.integrity,
    nodeSlideCandidateLock.integrity,
    'Both products must install byte-identical candidate tarballs.',
  );
  assert.equal(nodeRoomCandidateLock.integrity, candidate.integrity);
  assert.notEqual(nodeRoomBaselineLock.integrity, nodeRoomCandidateLock.integrity);
  assert.notEqual(baseline.sha256, candidate.sha256);

  const nodeRoomAfter = await inspectNodeRoomCheckout(nodeRoomRoot);
  assert.deepEqual(
    nodeRoomAfter,
    nodeRoomCheckout,
    'The external NodeRoom checkout changed during the isolated proof.',
  );

  const receipt = {
    schemaVersion: 'nodekit.gym-core-portability-proof/v1',
    passedAt: new Date().toISOString(),
    package: '@nodekit/gym-core',
    packageSchemaVersion: 'nodekit.gym/v1',
    dependencyFree: true,
    baseline: artifactEvidence(baseline),
    candidate: artifactEvidence(candidate),
    cleanInstall: true,
    exactTarballPins: true,
    lockfileIntegrityPins: true,
    runtimeExportsVerified: true,
    declarationFilesTypeChecked: true,
    upgradeReceiptAdvanced: true,
    candidateAddedShadowRouteContract: true,
    runPlanCompatibility: true,
    persistedStateMigration: 'not-required-schema-unchanged',
    autoPromotionDisabled: true,
    byteIdenticalCandidateProvenance: true,
    isolatedSecondProductContractProof: true,
    directNodeRoomRepositoryIntegration: false,
    consumers: {
      nodeslide: {
        fixture: 'scripts/fixtures/node-gym-consumers/nodeslide',
        version: nodeSlideCandidateLock.version,
        integrity: nodeSlideCandidateLock.integrity,
        domainEvaluator: nodeSlideResult.domainEvaluator,
        result: 'passed',
      },
      noderoom: {
        fixture: 'scripts/fixtures/node-gym-consumers/noderoom',
        fromVersion: nodeRoomBaselineLock.version,
        toVersion: nodeRoomCandidateLock.version,
        integrity: nodeRoomCandidateLock.integrity,
        domainEvaluator: nodeRoomCandidateResult.domainEvaluator,
        independentTaskClass: 'nodeagent-frame-verification',
        result: 'passed',
      },
    },
    externalNodeRoomCheckout: {
      ...nodeRoomCheckout,
      mutated: false,
      note: nodeRoomCheckout.available
        ? 'The checkout was inspected and fingerprinted but not modified; its dirty user work was preserved.'
        : 'No external checkout was available; the committed isolated NodeRoom consumer ran instead.',
    },
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `[node-gym-portability] PASS @nodekit/gym-core ${baseline.version} -> ${candidate.version}; NodeSlide + NodeRoom consumers; ${candidate.sha256}\n`,
  );
} finally {
  const guard = await readFile(path.join(proofRoot, '.guard'), 'utf8');
  assert.equal(guard, 'node-gym portability proof\n');
  await rm(proofRoot, { recursive: true, force: true, maxRetries: 3 });
}

async function packPackage(args, cwd, destination) {
  const { stdout } = await runNpm(args, cwd);
  const result = JSON.parse(stdout);
  const packed = Array.isArray(result) ? result[0] : undefined;
  assert(packed?.filename, 'npm pack returned no tarball filename.');
  const tarball = path.join(destination, packed.filename);
  const bytes = await readFile(tarball);
  const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(integrity, packed.integrity, `${packed.name} npm integrity did not match bytes.`);
  return { ...packed, tarball, sha256, integrity };
}

function assertPackedEntrypoints(packed) {
  const paths = new Set((packed.files ?? []).map((file) => file.path));
  assert(paths.has('dist/index.js'), `${packed.name}@${packed.version} lacks dist/index.js.`);
  assert(paths.has('dist/index.d.ts'), `${packed.name}@${packed.version} lacks dist/index.d.ts.`);
  assert(paths.has('package.json'), `${packed.name}@${packed.version} lacks package.json.`);
}

async function prepareConsumer(product, root) {
  const source = path.join(scriptDirectory, 'fixtures', 'node-gym-consumers', product);
  const target = path.join(root, `${product}-consumer`);
  await cp(source, target, { recursive: true, errorOnExist: true });
  return target;
}

async function assertCleanConsumer(consumer) {
  await assertMissing(path.join(consumer, 'node_modules'));
  await assertMissing(path.join(consumer, 'package-lock.json'));
}

async function installAndInspect(consumer, packed) {
  await runNpm(
    ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', packed.tarball],
    consumer,
  );
  const manifest = JSON.parse(await readFile(path.join(consumer, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(consumer, 'package-lock.json'), 'utf8'));
  const installed = lock.packages?.['node_modules/@nodekit/gym-core'];
  assert(installed, 'Consumer lockfile does not contain @nodekit/gym-core.');
  assert.equal(installed.version, packed.version, 'Installed package version was not exact.');
  assert.equal(
    installed.integrity,
    packed.integrity,
    'Installed tarball integrity was not pinned.',
  );
  assert(
    String(installed.resolved).replaceAll('\\', '/').endsWith(`/${packed.filename}`),
    `Installed package did not resolve from ${packed.filename}.`,
  );
  assert.equal(
    manifest.dependencies?.['@nodekit/gym-core'],
    `file:../packs/${packed.filename}`,
    'Consumer manifest did not pin the exact local tarball.',
  );
  return {
    version: installed.version,
    integrity: installed.integrity,
    resolved: installed.resolved,
  };
}

async function runConsumer(consumer, phase) {
  const args = [path.join(consumer, 'verify.mjs')];
  if (phase) args.push(phase);
  const { stdout } = await execFileAsync(process.execPath, args, {
    cwd: consumer,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

async function runTypeConsumer(consumer) {
  await execFileAsync(
    process.execPath,
    [
      path.join(rootDirectory, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--noEmit',
      '--strict',
      '--exactOptionalPropertyTypes',
      '--noUncheckedIndexedAccess',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--lib',
      'ES2022',
      path.join(consumer, 'verify-types.ts'),
    ],
    { cwd: consumer, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
}

async function inspectNodeRoomCheckout(directory) {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.name, 'noderoom', 'Expected the second-product checkout to be NodeRoom.');
    const [{ stdout: head }, { stdout: branch }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }),
      execFileAsync('git', ['branch', '--show-current'], { cwd: directory, encoding: 'utf8' }),
      execFileAsync('git', ['status', '--porcelain=v1'], { cwd: directory, encoding: 'utf8' }),
    ]);
    const trimmedStatus = status.trim();
    return {
      available: true,
      product: 'NodeRoom',
      head: head.trim(),
      branch: branch.trim() || '(detached)',
      clean: trimmedStatus.length === 0,
      dirtyEntryCount: trimmedStatus ? trimmedStatus.split(/\r?\n/u).length : 0,
      workingTreeFingerprint: `sha256:${createHash('sha256').update(status).digest('hex')}`,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { available: false, product: 'NodeRoom' };
    throw error;
  }
}

function artifactEvidence(packed) {
  return {
    name: packed.name,
    version: packed.version,
    filename: packed.filename,
    sha256: packed.sha256,
    integrity: packed.integrity,
    fileCount: packed.entryCount,
    unpackedBytes: packed.unpackedSize,
  };
}

async function assertMissing(file) {
  await assert.rejects(
    () => access(file),
    (error) => error?.code === 'ENOENT',
  );
}

async function runNpm(args, cwd) {
  try {
    return await execFileAsync(process.execPath, [npmCli, ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    if (error && typeof error === 'object') {
      error.message =
        `${error.message}\n${String(error.stdout ?? '')}\n${String(error.stderr ?? '')}`.trim();
    }
    throw error;
  }
}

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
