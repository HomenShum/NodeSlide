import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Enforces SemVer precedence, not merely different tag or manifest strings. */
export function assertStrictSemverIncrease(fromVersion, toVersion) {
  const from = parseSemver(fromVersion, 'Baseline release version');
  const to = parseSemver(toVersion, 'Candidate release version');
  assert(
    compareSemver(to, from) > 0,
    `Candidate release version ${toVersion} must be strictly newer than baseline ${fromVersion}.`,
  );
  return { from: fromVersion, to: toVersion };
}

/**
 * Compiles and executes imports from the isolated consumer itself. A successful
 * npm install and lockfile are insufficient when a tarball's JS or declarations
 * are broken.
 */
export async function runInstalledNodeSlideConsumerProbe({
  consumerDirectory,
  typeScriptBin,
  packageNames,
}) {
  assert(path.isAbsolute(consumerDirectory), 'Consumer directory must be absolute.');
  assert(path.isAbsolute(typeScriptBin), 'TypeScript executable must be absolute.');
  assert(Array.isArray(packageNames) && packageNames.length > 0, 'Package roster is required.');
  assert.equal(new Set(packageNames).size, packageNames.length, 'Package roster is duplicated.');
  for (const packageName of packageNames) {
    assert(
      /^@[a-z0-9-]+\/[a-z0-9-]+$/u.test(packageName),
      `Invalid package name in consumer probe: ${String(packageName)}.`,
    );
  }

  const typeProbe = path.join(consumerDirectory, '.nodeslide-install-proof-types.ts');
  const runtimeProbe = path.join(consumerDirectory, '.nodeslide-install-proof-runtime.mjs');
  await writeFile(typeProbe, typeProbeSource(packageNames), 'utf8');
  await writeFile(runtimeProbe, runtimeProbeSource(packageNames), 'utf8');

  await execFileAsync(
    process.execPath,
    [
      typeScriptBin,
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
      'ES2022,DOM',
      typeProbe,
    ],
    { cwd: consumerDirectory, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
  );
  const { stdout } = await execFileAsync(process.execPath, [runtimeProbe], {
    cwd: consumerDirectory,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const receipt = JSON.parse(stdout.trim());
  assert.deepEqual(receipt, {
    typecheckPassed: true,
    runtimePassed: true,
    importedPackageCount: packageNames.length,
  });
  return receipt;
}

function parseSemver(value, label) {
  assert(typeof value === 'string', `${label} must be a SemVer string.`);
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
  );
  assert(match, `${label} must be valid SemVer.`);
  const prerelease = match[4]?.split('.') ?? [];
  for (const identifier of prerelease) {
    assert(
      !/^\d+$/u.test(identifier) || identifier === '0' || !identifier.startsWith('0'),
      `${label} has a numeric prerelease identifier with a leading zero.`,
    );
  }
  const main = [match[1], match[2], match[3]].map(Number);
  assert(main.every(Number.isSafeInteger), `${label} exceeds the supported integer range.`);
  return {
    major: main[0],
    minor: main[1],
    patch: main[2],
    prerelease,
  };
}

function compareSemver(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === rightIdentifier) continue;
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const leftNumeric = /^\d+$/u.test(leftIdentifier);
    const rightNumeric = /^\d+$/u.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      if (leftIdentifier.length !== rightIdentifier.length)
        return leftIdentifier.length > rightIdentifier.length ? 1 : -1;
      return leftIdentifier > rightIdentifier ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }
  return 0;
}

function typeProbeSource(packageNames) {
  const imports = packageNames
    .map((packageName, index) => `import * as Package${index} from ${JSON.stringify(packageName)};`)
    .join('\n');
  const references = packageNames.map((_, index) => `Package${index}`).join(', ');
  return `${imports}\nconst installedPackages: readonly object[] = [${references}];\nvoid installedPackages;\n`;
}

function runtimeProbeSource(packageNames) {
  return `
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const packageNames = ${JSON.stringify(packageNames)};
const nodeModules = path.resolve(process.cwd(), 'node_modules');
for (const packageName of packageNames) {
  const resolved = fileURLToPath(import.meta.resolve(packageName));
  const relative = path.relative(nodeModules, resolved);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), packageName + ' resolved outside the isolated consumer.');
  const namespace = await import(packageName);
  assert(namespace && Object.keys(namespace).length > 0, packageName + ' exposed no runtime surface.');
}
process.stdout.write(JSON.stringify({ typecheckPassed: true, runtimePassed: true, importedPackageCount: packageNames.length }) + '\\n');
`;
}
