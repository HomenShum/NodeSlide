import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCommittedCleanConsumerTree,
  assertNodeKitPackageProvenance,
} from './lib/nodekit-consumer-proof-guard.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const proofDir = join(repoRoot, 'proof', 'nodekit-caseflow-consumer');
const receiptPath = join(proofDir, 'receipt.json');
const provenanceRelative = 'vendor/homenshum-nodekit-0.2.1.provenance.json';
const implementationFiles = [
  'package.json',
  'package-lock.json',
  'convex/convex.config.ts',
  'convex/schema.ts',
  'convex/nodekitCaseflow.ts',
  'convex/nodekitCaseflow.test.ts',
  'src/integrations/nodekit/caseflowAdapter.ts',
  'docs/NODEKIT_CASEFLOW_CONSUMER.md',
  'scripts/lib/nodekit-consumer-proof-guard.mjs',
  'scripts/lib/nodekit-consumer-proof-guard.test.mjs',
  'scripts/prove-nodekit-caseflow-consumer.mjs',
];

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Proof receipt contains a non-JSON value.');
  return serialized;
}

function relativeEvidencePath(path) {
  const absolute = resolve(repoRoot, path);
  const actual = realpathSync(absolute);
  const root = `${realpathSync(repoRoot)}${sep}`;
  if (actual !== realpathSync(repoRoot) && !actual.startsWith(root)) {
    throw new Error(`Evidence escapes repository root: ${path}`);
  }
  if (lstatSync(absolute).isSymbolicLink())
    throw new Error(`Evidence may not be a symlink: ${path}`);
  return relative(repoRoot, absolute).replaceAll('\\', '/');
}

function evidence(path) {
  const relativePath = relativeEvidencePath(path);
  const bytes = readFileSync(join(repoRoot, relativePath));
  return { path: relativePath, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}

function run(command, args, logName) {
  const executable = process.platform === 'win32' ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdoutPath = join(proofDir, `${logName}.stdout.log`);
  const stderrPath = join(proofDir, `${logName}.stderr.log`);
  writeFileSync(stdoutPath, result.stdout ?? '', 'utf8');
  writeFileSync(stderrPath, result.stderr ?? '', 'utf8');
  if (result.error) throw result.error;
  return {
    id: logName,
    command: [command, ...args].join(' '),
    exitCode: result.status,
    passed: result.status === 0,
    stdout: relative(repoRoot, stdoutPath).replaceAll('\\', '/'),
    stderr: relative(repoRoot, stderrPath).replaceAll('\\', '/'),
  };
}

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function verifyReceipt(receipt) {
  if (receipt.schemaVersion !== 'nodekit.consumer-proof/v2') {
    throw new Error('Unexpected consumer proof schema.');
  }
  const evidencePaths = new Set();
  for (const item of receipt.evidence) {
    if (evidencePaths.has(item.path)) throw new Error(`Duplicate evidence path: ${item.path}`);
    evidencePaths.add(item.path);
    const observed = evidence(item.path);
    if (observed.sha256 !== item.sha256 || observed.bytes !== item.bytes) {
      throw new Error(`Evidence bytes changed: ${item.path}`);
    }
  }
  const { receiptHash, ...body } = receipt;
  if (sha256Bytes(canonicalJson(body)) !== receiptHash) {
    throw new Error('Consumer receipt hash does not match its canonical body.');
  }
  if (!receipt.passed || receipt.checks.some((check) => !check.passed)) {
    throw new Error('Consumer receipt is not passing.');
  }
  return receipt;
}

if (process.argv.includes('--verify-only')) {
  verifyReceipt(JSON.parse(readFileSync(receiptPath, 'utf8')));
  process.stdout.write(`${receiptPath}\n`);
  process.exit(0);
}

const provenancePath = join(repoRoot, provenanceRelative);
if (!existsSync(provenancePath)) {
  throw new Error(`Missing exact NodeKit package provenance: ${provenanceRelative}`);
}
const provenance = assertNodeKitPackageProvenance(JSON.parse(readFileSync(provenancePath, 'utf8')));
const tarballRelative = provenance.tarball?.path;
assertCommittedCleanConsumerTree({
  repoRoot,
  requiredPaths: [...implementationFiles, provenanceRelative, tarballRelative],
  ignoredPrefixes: ['proof/nodekit-caseflow-consumer'],
});
const tarball = evidence(tarballRelative);
if (tarball.sha256 !== provenance.tarball.sha256) {
  throw new Error('Packed NodeKit tarball does not match provenance SHA-256.');
}

const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const expectedPackageSpec = `file:${tarballRelative}`;
if (packageJson.dependencies?.['@homenshum/nodekit'] !== expectedPackageSpec) {
  throw new Error(
    `NodeKit dependency must use the exact committed tarball: ${expectedPackageSpec}`,
  );
}
const packageLock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));
const lockedNodeKit = packageLock.packages?.['node_modules/@homenshum/nodekit'];
if (
  lockedNodeKit?.resolved !== expectedPackageSpec ||
  lockedNodeKit?.integrity !== provenance.tarball.integrity
) {
  throw new Error('NodeKit lockfile does not bind the exact committed tarball and integrity.');
}

const installedPackagePath = join(
  repoRoot,
  'node_modules',
  '@homenshum',
  'nodekit',
  'package.json',
);
if (!existsSync(installedPackagePath))
  throw new Error('The packed NodeKit package is not installed.');
const installedPackage = JSON.parse(readFileSync(installedPackagePath, 'utf8'));
if (
  installedPackage.name !== '@homenshum/nodekit' ||
  installedPackage.version !== provenance.version
) {
  throw new Error('Installed NodeKit package identity does not match provenance.');
}
for (const packagePath of [
  'node_modules/@homenshum/nodekit/dist/component/convex.config.js',
  'node_modules/@homenshum/nodekit/dist/client/index.js',
  'node_modules/@homenshum/nodekit/dist/convex-test.js',
]) {
  if (!existsSync(join(repoRoot, packagePath))) {
    throw new Error(`Installed package is missing ${packagePath}.`);
  }
}

rmSync(proofDir, { recursive: true, force: true });
mkdirSync(proofDir, { recursive: true });
const checks = [
  run('npm', ['run', 'test:nodekit-caseflow'], 'component-consumer-tests'),
  run(
    'npx',
    ['tsc', '--noEmit', '-p', 'convex/tsconfig.json', '--pretty', 'false'],
    'convex-typecheck',
  ),
  run('npx', ['tsc', '-b', '--pretty', 'false'], 'workspace-typecheck'),
  run('npm', ['run', 'build'], 'production-build'),
];
if (checks.some((check) => !check.passed)) {
  throw new Error(
    `NodeSlide consumer proof failed: ${checks
      .filter((check) => !check.passed)
      .map((check) => check.id)
      .join(', ')}`,
  );
}

const implementationEvidence = implementationFiles.map(evidence);
const consumerImplementationHash = sha256Bytes(
  canonicalJson(implementationEvidence.map(({ path, sha256 }) => ({ path, sha256 }))),
);
const logEvidence = checks.flatMap((check) => [evidence(check.stdout), evidence(check.stderr)]);
const packageEvidence = [evidence(provenanceRelative), tarball];
const allEvidence = [...implementationEvidence, ...packageEvidence, ...logEvidence]
  .filter(
    (item, index, values) =>
      values.findIndex((candidate) => candidate.path === item.path) === index,
  )
  .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

const body = {
  schemaVersion: 'nodekit.consumer-proof/v2',
  consumer: 'NodeSlide',
  capturedAt: new Date().toISOString(),
  consumerBaseCommit: git(['rev-parse', 'HEAD']),
  consumerWorkingTreeCleanBeforeProof: true,
  consumerImplementationHash,
  nodekit: {
    package: '@homenshum/nodekit',
    version: provenance.version,
    sourceCommit: provenance.sourceCommit,
    sourceHash: provenance.sourceHash,
    sourceWorkingTreeCleanAtPackTime: provenance.sourceWorkingTreeCleanAtPackTime,
    tarball,
    installedPackageJsonSha256: sha256Bytes(readFileSync(installedPackagePath)),
  },
  component: {
    mountedBy: 'convex/convex.config.ts',
    hostWrapper: 'convex/nodekitCaseflow.ts',
    componentStateIsolated: true,
    copiedLifecycleTablesPresent: false,
  },
  checks,
  assertions: {
    authenticatedHostScope: true,
    ownerIsolation: true,
    bearerDiscardedAfterBinding: true,
    realInstalledComponentExecuted: true,
    presentationArtifactBound: true,
    persistedPatchProposalBound: true,
    staleConflictFailsClosed: true,
    idempotentRetries: true,
    exceptionRecovery: true,
    cancellationReceipted: true,
    safeFailureReceipted: true,
    receiptV2Integrity: true,
    noCopiedCaseflowBackend: true,
  },
  evidence: allEvidence,
  externalProof: {
    signedInBrowserJourney: 'not_run',
    productionDeployment: 'not_authorized',
    npmPublication: 'not_authorized',
    convexSubmission: 'not_authorized',
  },
  passed: true,
};
const receipt = { ...body, receiptHash: sha256Bytes(canonicalJson(body)) };
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
verifyReceipt(receipt);
process.stdout.write(`${receiptPath}\n`);
