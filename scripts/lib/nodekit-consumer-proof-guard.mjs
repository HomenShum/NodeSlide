import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';

function repositoryPath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty repository-relative path.`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.endsWith('/..')
  ) {
    throw new Error(`${label} escapes the repository.`);
  }
  return normalized.replace(/^\.\//u, '');
}

function runGit(repoRoot, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function statusPaths(repoRoot) {
  const output = runGit(
    repoRoot,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    'buffer',
  );
  const records = output.toString('utf8').split('\0');
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error('Unable to parse Git status while proving the NodeKit consumer.');
    }
    const code = record.slice(0, 2);
    paths.push(repositoryPath(record.slice(3), 'Git status path'));
    if (code.includes('R') || code.includes('C')) {
      const original = records[index + 1];
      if (!original) throw new Error('Git rename status is missing its original path.');
      paths.push(repositoryPath(original, 'Git status original path'));
      index += 1;
    }
  }
  return paths;
}

function ignored(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function assertNodeKitPackageProvenance(provenance) {
  if (provenance === null || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error('NodeKit package provenance must be an object.');
  }
  if (provenance.sourceWorkingTreeCleanAtPackTime !== true) {
    throw new Error('NodeKit package provenance must prove a clean source tree at pack time.');
  }
  if (!/^[a-f0-9]{40}$/u.test(provenance.sourceCommit ?? '')) {
    throw new Error('NodeKit package provenance requires an exact 40-character source commit.');
  }
  if (!/^[a-f0-9]{64}$/u.test(provenance.sourceHash ?? '')) {
    throw new Error('NodeKit package provenance requires an exact 64-character source hash.');
  }
  if (typeof provenance.version !== 'string' || provenance.version.length === 0) {
    throw new Error('NodeKit package provenance requires a package version.');
  }
  if (provenance.tarball === null || typeof provenance.tarball !== 'object') {
    throw new Error('NodeKit package provenance requires tarball metadata.');
  }
  const path = repositoryPath(provenance.tarball.path, 'NodeKit tarball path');
  if (!/^[a-f0-9]{64}$/u.test(provenance.tarball.sha256 ?? '')) {
    throw new Error('NodeKit package provenance requires an exact tarball SHA-256.');
  }
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(provenance.tarball.integrity ?? '')) {
    throw new Error('NodeKit package provenance requires npm SHA-512 integrity.');
  }
  return { ...provenance, tarball: { ...provenance.tarball, path } };
}

export function assertCommittedCleanConsumerTree({
  repoRoot,
  requiredPaths,
  ignoredPrefixes = [],
}) {
  const normalizedRequired = [
    ...new Set(requiredPaths.map((path) => repositoryPath(path, 'Proof input path'))),
  ];
  const normalizedIgnored = ignoredPrefixes.map((path) =>
    repositoryPath(path, 'Ignored proof-output path'),
  );

  for (const path of normalizedRequired) {
    try {
      const tracked = runGit(repoRoot, ['ls-files', '--error-unmatch', '--', path]).trim();
      if (tracked.replaceAll('\\', '/') !== path) {
        throw new Error(`Git resolved an unexpected tracked path for ${path}.`);
      }
    } catch {
      throw new Error(`NodeKit consumer proof input is not committed: ${path}`);
    }
  }

  const dirty = statusPaths(repoRoot).filter((path) => !ignored(path, normalizedIgnored));
  if (dirty.length > 0) {
    throw new Error(
      `NodeKit consumer source tree is dirty outside proof outputs: ${[...new Set(dirty)].sort().join(', ')}`,
    );
  }
  return { requiredPaths: normalizedRequired, ignoredPrefixes: normalizedIgnored };
}
