import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const NODESLIDE_IMMUTABLE_MANIFEST_FILE = 'nodeslide-artifacts.json';

export const NODESLIDE_IMMUTABLE_PACKAGE_NAMES = Object.freeze([
  '@nodeslide/agent',
  '@nodeslide/contracts',
  '@nodeslide/engine',
  '@nodeslide/backend',
  '@nodeslide/client-http',
  '@nodeslide/convex',
  '@nodeslide/testing',
  '@nodeslide/react-headless',
  '@nodeslide/react',
  '@nodeslide/registry',
  '@nodeslide/cli',
]);

export function assertFullCommitSha(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a full 40-character lowercase commit SHA.`);
  }
  return value;
}

export function assertCanonicalPackageRoster(packageNames, label = 'Artifact manifest') {
  const actual = [...packageNames];
  const expected = [...NODESLIDE_IMMUTABLE_PACKAGE_NAMES];
  const missing = expected.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !expected.includes(name));
  const duplicate = actual.filter((name, index) => actual.indexOf(name) !== index);
  if (missing.length > 0 || extra.length > 0 || duplicate.length > 0) {
    const details = [
      missing.length > 0 ? `missing: ${missing.join(', ')}` : undefined,
      extra.length > 0 ? `extra: ${extra.join(', ')}` : undefined,
      duplicate.length > 0 ? `duplicate: ${[...new Set(duplicate)].join(', ')}` : undefined,
    ].filter(Boolean);
    throw new Error(
      `${label} must contain the exact canonical 11-package roster (${details.join('; ')}).`,
    );
  }
  const outOfOrder = actual.findIndex((name, index) => name !== expected[index]);
  if (outOfOrder >= 0) {
    throw new Error(
      `${label} package order is not canonical at position ${outOfOrder + 1}: expected ${expected[outOfOrder]}, received ${actual[outOfOrder]}.`,
    );
  }
}

export function assertManifestReleaseId(manifest, expectedReleaseId, label) {
  const expected = assertFullCommitSha(expectedReleaseId, `${label} expected release ID`);
  const actual = assertFullCommitSha(manifest.releaseId, `${label} manifest release ID`);
  if (actual !== expected) {
    throw new Error(
      `${label} manifest release ID ${actual} does not match tag commit ${expected}.`,
    );
  }
}

export async function assertExactArtifactDirectory(directory, manifest, label) {
  const expected = artifactAssetNames(manifest, label);
  const entries = await readdir(directory, { withFileTypes: true });
  const nonFiles = entries.filter((entry) => !entry.isFile()).map((entry) => entry.name);
  const actual = entries.map((entry) => entry.name).sort();
  if (nonFiles.length > 0 || !sameStrings(actual, expected)) {
    const missing = expected.filter((name) => !actual.includes(name));
    const extra = actual.filter((name) => !expected.includes(name));
    const details = [
      missing.length > 0 ? `missing: ${missing.join(', ')}` : undefined,
      extra.length > 0 ? `extra: ${extra.join(', ')}` : undefined,
      nonFiles.length > 0 ? `non-file entries: ${nonFiles.join(', ')}` : undefined,
    ].filter(Boolean);
    throw new Error(
      `${label} must contain exactly its manifest and 11 tarballs (${details.join('; ')}).`,
    );
  }
  return expected;
}

export async function assertArtifactDirectoriesByteEqual(
  publicDirectory,
  publicManifest,
  rebuiltDirectory,
  rebuiltManifest,
) {
  const publicAssets = await assertExactArtifactDirectory(
    publicDirectory,
    publicManifest,
    'Public candidate artifact set',
  );
  const rebuiltAssets = await assertExactArtifactDirectory(
    rebuiltDirectory,
    rebuiltManifest,
    'Rebuilt candidate artifact set',
  );
  if (!sameStrings(publicAssets, rebuiltAssets)) {
    throw new Error('Rebuilt candidate asset filenames do not match the public release.');
  }
  for (const asset of publicAssets) {
    const [publishedBytes, rebuiltBytes] = await Promise.all([
      readFile(path.join(publicDirectory, asset)),
      readFile(path.join(rebuiltDirectory, asset)),
    ]);
    if (!publishedBytes.equals(rebuiltBytes)) {
      throw new Error(`Rebuilt candidate asset bytes do not match the public release: ${asset}.`);
    }
  }
}

function artifactAssetNames(manifest, label) {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.packages)) {
    throw new Error(`${label} is missing its package roster.`);
  }
  assertCanonicalPackageRoster(
    manifest.packages.map((artifact) => artifact.name),
    label,
  );
  const tarballs = manifest.packages.map((artifact) => artifact.file);
  if (new Set(tarballs).size !== tarballs.length) {
    throw new Error(`${label} contains duplicate artifact filenames.`);
  }
  return [NODESLIDE_IMMUTABLE_MANIFEST_FILE, ...tarballs].sort();
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
