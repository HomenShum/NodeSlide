import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NODESLIDE_IMMUTABLE_MANIFEST_FILE,
  NODESLIDE_IMMUTABLE_PACKAGE_NAMES,
  assertArtifactDirectoriesByteEqual,
  assertCanonicalPackageRoster,
  assertExactArtifactDirectory,
  assertFullCommitSha,
  assertManifestReleaseId,
} from './immutable-package-set.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('immutable package release invariants', () => {
  it('requires full lowercase commit SHAs', () => {
    expect(assertFullCommitSha('a'.repeat(40), 'release ID')).toBe('a'.repeat(40));
    expect(() => assertFullCommitSha('a'.repeat(39), 'release ID')).toThrow(/40-character/);
    expect(() => assertFullCommitSha('A'.repeat(40), 'release ID')).toThrow(/lowercase/);
    expect(() =>
      assertManifestReleaseId({ releaseId: 'a'.repeat(40) }, 'b'.repeat(40), 'Candidate'),
    ).toThrow(/does not match tag commit/);
  });

  it('rejects incomplete, extra, and reordered public package rosters', () => {
    expect(() => assertCanonicalPackageRoster(NODESLIDE_IMMUTABLE_PACKAGE_NAMES.slice(1))).toThrow(
      /missing: @nodeslide\/agent/,
    );
    expect(() =>
      assertCanonicalPackageRoster([...NODESLIDE_IMMUTABLE_PACKAGE_NAMES, '@nodeslide/extra']),
    ).toThrow(/extra: @nodeslide\/extra/);
    expect(() =>
      assertCanonicalPackageRoster([
        NODESLIDE_IMMUTABLE_PACKAGE_NAMES[1],
        NODESLIDE_IMMUTABLE_PACKAGE_NAMES[0],
        ...NODESLIDE_IMMUTABLE_PACKAGE_NAMES.slice(2),
      ]),
    ).toThrow(/order is not canonical/);
  });

  it('requires exactly the manifest and canonical 11 tarballs', async () => {
    const { directory, manifest } = await writeArtifactSet('same');
    await expect(
      assertExactArtifactDirectory(directory, manifest, 'Fixture'),
    ).resolves.toHaveLength(12);
    await writeFile(path.join(directory, 'unexpected.txt'), 'extra');
    await expect(assertExactArtifactDirectory(directory, manifest, 'Fixture')).rejects.toThrow(
      /extra: unexpected\.txt/,
    );
  });

  it('byte-compares every public tarball and the manifest against the rebuild', async () => {
    const published = await writeArtifactSet('same');
    const rebuilt = await writeArtifactSet('same');
    await expect(
      assertArtifactDirectoriesByteEqual(
        published.directory,
        published.manifest,
        rebuilt.directory,
        rebuilt.manifest,
      ),
    ).resolves.toBeUndefined();

    await writeFile(path.join(rebuilt.directory, rebuilt.manifest.packages[3].file), 'different');
    await expect(
      assertArtifactDirectoriesByteEqual(
        published.directory,
        published.manifest,
        rebuilt.directory,
        rebuilt.manifest,
      ),
    ).rejects.toThrow(/asset bytes do not match/);
  });
});

async function writeArtifactSet(contents: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-immutable-set-'));
  temporaryDirectories.push(directory);
  const packages = NODESLIDE_IMMUTABLE_PACKAGE_NAMES.map((name, index) => ({
    name,
    file: `nodeslide-package-${String(index).padStart(2, '0')}.tgz`,
  }));
  const manifest = { releaseId: 'a'.repeat(40), packages };
  await Promise.all(
    packages.map((artifact) => writeFile(path.join(directory, artifact.file), contents)),
  );
  await writeFile(
    path.join(directory, NODESLIDE_IMMUTABLE_MANIFEST_FILE),
    `${JSON.stringify(manifest)}\n`,
  );
  return { directory, manifest };
}
