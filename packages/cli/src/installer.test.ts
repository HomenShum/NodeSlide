import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NODESLIDE_ARTIFACT_MANIFEST_FILE,
  planNodeSlideInstallation,
  runNodeSlideInit,
  runNodeSlideUpgrade,
  verifyNodeSlideArtifactSet,
} from './index';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 })),
  );
});

async function project(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-installer-'));
  temporaryDirectories.push(directory);
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify({ name: 'consumer', private: true, scripts: {} }, null, 2)}\n`,
  );
  return directory;
}

describe('@nodeslide/cli installer', () => {
  it('writes only new package-specific sources and a hashed receipt', async () => {
    const cwd = await project();
    const manifestBefore = await readFile(path.join(cwd, 'package.json'), 'utf8');
    const receipt = await runNodeSlideInit({
      cwd,
      profile: 'full-studio',
      backend: 'hosted',
      uiMode: 'host-tokens',
      skipInstall: true,
      skipChecks: true,
    });

    expect(receipt.packageSource).toBe('skipped');
    expect(receipt.packages).toContain('@nodeslide/client-http');
    expect(receipt.files.length).toBeGreaterThan(2);
    expect(receipt.files.every((file) => file.sha256.startsWith('sha256:'))).toBe(true);
    expect(await readFile(path.join(cwd, 'package.json'), 'utf8')).toBe(manifestBefore);
    await expect(readFile(path.join(cwd, '.env'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(path.join(cwd, 'src', 'routes.ts'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves host edits during upgrade and emits a reviewable diff', async () => {
    const cwd = await project();
    await runNodeSlideInit({
      cwd,
      profile: 'full-studio',
      backend: 'hosted',
      uiMode: 'host-tokens',
      skipInstall: true,
      skipChecks: true,
    });
    const generated = path.join(cwd, 'components', 'nodeslide', 'NodeSlideExample.tsx');
    const hostEdit = '// host-owned edit\n';
    await writeFile(generated, hostEdit, 'utf8');

    const upgraded = await runNodeSlideUpgrade({ cwd, skipInstall: true, skipChecks: true });

    expect(await readFile(generated, 'utf8')).toBe(hostEdit);
    const diffPath = upgraded.upgrades.at(-1)?.diffs[0];
    expect(diffPath).toBe('.nodeslide/updates/studio-shell.diff');
    expect(await readFile(path.join(cwd, String(diffPath)), 'utf8')).toContain('+import type');
  });

  it('refuses a second init before changing dependencies or sources', async () => {
    const cwd = await project();
    const options = {
      cwd,
      profile: 'renderer' as const,
      backend: 'custom' as const,
      uiMode: 'headless' as const,
      skipInstall: true,
      skipChecks: true,
    };
    await runNodeSlideInit(options);
    await expect(runNodeSlideInit(options)).rejects.toThrow(/already installed/);
  });

  it('pins an immutable artifact set and advances it during upgrade', async () => {
    const cwd = await project();
    const from = await artifactSet('0.1.0', 'release:0.1.0');
    const to = await artifactSet('0.2.0', 'release:0.2.0');
    const plan = await planNodeSlideInstallation({
      cwd,
      profile: 'agent-pack-only',
      backend: 'custom',
      uiMode: 'headless',
      artifactsDirectory: from,
      skipInstall: true,
      skipChecks: true,
    });
    expect(plan.artifactSet?.manifest.releaseVersion).toBe('0.1.0');
    expect(plan.installSpecs.every((specifier) => path.isAbsolute(specifier))).toBe(true);
    expect(plan.installSpecs).toHaveLength(5);

    const installed = await runNodeSlideInit({
      cwd,
      profile: 'agent-pack-only',
      backend: 'custom',
      uiMode: 'headless',
      artifactsDirectory: from,
      skipInstall: true,
      skipChecks: true,
    });
    expect(installed.artifactSet).toMatchObject({
      releaseVersion: '0.1.0',
      releaseId: 'release:0.1.0',
    });
    expect(installed.artifactSet?.packages).toHaveLength(5);

    const upgraded = await runNodeSlideUpgrade({
      cwd,
      artifactsDirectory: to,
      skipInstall: true,
      skipChecks: true,
    });
    expect(upgraded.artifactSet).toMatchObject({
      releaseVersion: '0.2.0',
      releaseId: 'release:0.2.0',
    });
    expect(upgraded.upgrades.at(-1)).toMatchObject({
      fromRegistryVersion: '0.2.0',
      toRegistryVersion: '0.2.0',
    });
  });

  it('rejects tampered tarballs, mixed versions, and artifact downgrades', async () => {
    const tampered = await artifactSet('0.2.0', 'release:tampered');
    const tamperedManifest = JSON.parse(
      await readFile(path.join(tampered, NODESLIDE_ARTIFACT_MANIFEST_FILE), 'utf8'),
    ) as { packages: Array<{ file: string; version: string }> };
    const firstFile = tamperedManifest.packages[0]?.file;
    if (!firstFile) throw new Error('Fixture artifact manifest is empty.');
    await writeFile(path.join(tampered, firstFile), 'tampered-bytes', 'utf8');
    await expect(verifyNodeSlideArtifactSet(tampered)).rejects.toThrow(/integrity mismatch/);

    const mixed = await artifactSet('0.2.0', 'release:mixed');
    const mixedManifestPath = path.join(mixed, NODESLIDE_ARTIFACT_MANIFEST_FILE);
    const mixedManifest = JSON.parse(await readFile(mixedManifestPath, 'utf8')) as {
      packages: Array<{ version: string }>;
    };
    if (!mixedManifest.packages[0]) throw new Error('Fixture artifact manifest is empty.');
    mixedManifest.packages[0].version = '0.1.0';
    await writeFile(mixedManifestPath, `${JSON.stringify(mixedManifest, null, 2)}\n`, 'utf8');
    await expect(verifyNodeSlideArtifactSet(mixed)).rejects.toThrow(/mixed into release/);

    const cwd = await project();
    const newer = await artifactSet('0.2.0', 'release:newer');
    const older = await artifactSet('0.1.0', 'release:older');
    await runNodeSlideInit({
      cwd,
      profile: 'agent-pack-only',
      backend: 'custom',
      uiMode: 'headless',
      artifactsDirectory: newer,
      skipInstall: true,
      skipChecks: true,
    });
    await expect(
      runNodeSlideUpgrade({
        cwd,
        artifactsDirectory: older,
        skipInstall: true,
        skipChecks: true,
      }),
    ).rejects.toThrow(/must advance 0.2.0/);
  });
});

async function artifactSet(version: string, releaseId: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodeslide-artifacts-'));
  temporaryDirectories.push(directory);
  const packages = [
    '@nodeslide/agent',
    '@nodeslide/backend',
    '@nodeslide/contracts',
    '@nodeslide/react-headless',
    '@nodeslide/cli',
  ].map((name) => {
    const file = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
    const bytes = Buffer.from(`${name}@${version}\n`, 'utf8');
    return {
      name,
      version,
      file,
      bytes,
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    };
  });
  for (const artifact of packages) {
    await writeFile(path.join(directory, artifact.file), artifact.bytes);
  }
  await writeFile(
    path.join(directory, NODESLIDE_ARTIFACT_MANIFEST_FILE),
    `${JSON.stringify(
      {
        schemaVersion: 'nodeslide.artifacts/v1',
        releaseVersion: version,
        releaseId,
        registryVersion: '0.2.0',
        packages: packages.map(({ bytes: _bytes, ...artifact }) => artifact),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return directory;
}
