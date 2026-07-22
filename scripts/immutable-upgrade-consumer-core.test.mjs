import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  assertStrictSemverIncrease,
  runInstalledNodeSlideConsumerProbe,
} from './lib/immutable-upgrade-consumer-core.mjs';

const execFileAsync = promisify(execFile);

describe('immutable install and upgrade consumer gates', () => {
  it('requires a strict SemVer precedence increase', () => {
    expect(assertStrictSemverIncrease('0.1.0', '0.2.2')).toEqual({
      from: '0.1.0',
      to: '0.2.2',
    });
    expect(assertStrictSemverIncrease('1.0.0-beta.2', '1.0.0')).toEqual({
      from: '1.0.0-beta.2',
      to: '1.0.0',
    });
    expect(() => assertStrictSemverIncrease('1.0.0', '1.0.0')).toThrow(/strictly newer/u);
    expect(() => assertStrictSemverIncrease('2.0.0', '1.9.9')).toThrow(/strictly newer/u);
    expect(() => assertStrictSemverIncrease('1.0.0', '1.0.0-rc.1')).toThrow(/strictly newer/u);
    expect(() => assertStrictSemverIncrease('1.0.0-01', '1.0.0')).toThrow(/leading zero/u);
    expect(() => assertStrictSemverIncrease('1.0.0', '9007199254740992.0.0')).toThrow(
      /integer range/u,
    );
  });

  it('typechecks and executes an isolated installed package', async () => {
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'nodeslide-valid-consumer-'));
    try {
      const packageRoot = path.join(sandbox, 'node_modules', '@fixture', 'runtime-valid');
      await mkdir(path.join(packageRoot, 'dist'), { recursive: true });
      await writeFile(
        path.join(packageRoot, 'package.json'),
        `${JSON.stringify({
          name: '@fixture/runtime-valid',
          version: '1.0.0',
          type: 'module',
          exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
        })}\n`,
      );
      await writeFile(
        path.join(packageRoot, 'dist', 'index.d.ts'),
        'export declare const ok: true;\n',
      );
      await writeFile(path.join(packageRoot, 'dist', 'index.js'), 'export const ok = true;\n');
      await writeFile(
        path.join(sandbox, 'package.json'),
        `${JSON.stringify({ name: 'valid-consumer', private: true, type: 'module' })}\n`,
      );

      await expect(
        runInstalledNodeSlideConsumerProbe({
          consumerDirectory: sandbox,
          typeScriptBin: path.resolve('node_modules/typescript/bin/tsc'),
          packageNames: ['@fixture/runtime-valid'],
        }),
      ).resolves.toEqual({
        typecheckPassed: true,
        runtimePassed: true,
        importedPackageCount: 1,
      });
    } finally {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('rejects a valid npm tarball whose declaration passes but runtime entry is broken', async () => {
    const npmCli = process.env.npm_execpath;
    expect(npmCli).toBeTruthy();
    const sandbox = await mkdtemp(path.join(os.tmpdir(), 'nodeslide-broken-tarball-'));
    try {
      const packageRoot = path.join(sandbox, 'package-source');
      const packRoot = path.join(sandbox, 'packs');
      const consumer = path.join(sandbox, 'consumer');
      await Promise.all([
        mkdir(path.join(packageRoot, 'dist'), { recursive: true }),
        mkdir(packRoot),
        mkdir(consumer),
      ]);
      await writeFile(
        path.join(packageRoot, 'package.json'),
        `${JSON.stringify(
          {
            name: '@fixture/runtime-broken',
            version: '1.0.0',
            type: 'module',
            files: ['dist'],
            exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        path.join(packageRoot, 'dist', 'index.d.ts'),
        'export declare const ok: true;\n',
      );
      await writeFile(path.join(packageRoot, 'dist', 'index.js'), 'export const = ;\n');
      const { stdout } = await execFileAsync(
        process.execPath,
        [npmCli, 'pack', '--json', '--pack-destination', packRoot],
        { cwd: packageRoot, encoding: 'utf8' },
      );
      const tarball = path.join(packRoot, JSON.parse(stdout)[0].filename);
      expect((await readFile(tarball)).length).toBeGreaterThan(0);
      await writeFile(
        path.join(consumer, 'package.json'),
        `${JSON.stringify({ name: 'broken-tarball-consumer', private: true, type: 'module' })}\n`,
      );
      await execFileAsync(
        process.execPath,
        [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
        { cwd: consumer, encoding: 'utf8' },
      );

      await expect(
        runInstalledNodeSlideConsumerProbe({
          consumerDirectory: consumer,
          typeScriptBin: path.resolve('node_modules/typescript/bin/tsc'),
          packageNames: ['@fixture/runtime-broken'],
        }),
      ).rejects.toThrow();
    } finally {
      await rm(sandbox, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
