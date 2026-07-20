import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runNodeSlideInit, runNodeSlideUpgrade } from './index';

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
});
