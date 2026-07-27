import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The gate exists because PR #74 shipped a route that passed every in-process
 * test and returned FUNCTION_INVOCATION_FAILED to every live reader. So these
 * are adversarial: a gate that only proves the happy path would have let the
 * original defect through, and would let a weakened version of it through
 * again. Each case reconstructs a real shape of the failure on disk and
 * requires a non-zero exit.
 *
 * The script is run as a child process, from a scratch repo root, because the
 * exit code is the contract — the deploy workflow reads nothing else.
 */

const GATE = path.resolve('scripts/verify-function-bundle.mjs');

const roots = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

function scratchRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'function-bundle-gate-'));
  roots.push(root);
  mkdirSync(path.join(root, 'api'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  return root;
}

function write(root, relative, contents) {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
  return full;
}

function runGate(root, mode) {
  const result = spawnSync(process.execPath, [GATE, mode], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Build an emitted `<name>.func` the way `vercel build` lays one out. */
function emittedFunction(root, name, files, config = {}) {
  const dir = path.join('.vercel', 'output', 'functions', 'api', `${name}.func`);
  write(
    root,
    path.join(dir, '.vc-config.json'),
    JSON.stringify({ handler: `api/${name}.js`, runtime: 'nodejs24.x', ...config }),
  );
  write(root, path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const [relative, contents] of Object.entries(files)) {
    write(root, path.join(dir, relative), contents);
  }
}

describe('verify-function-bundle --source', () => {
  it('accepts a graph whose relative specifiers are all fully specified', () => {
    const root = scratchRepo();
    write(
      root,
      'api/share.ts',
      "import { render } from '../shared/render.js';\nexport default render;\n",
    );
    write(root, 'shared/render.ts', 'export const render = () => null;\n');

    const { status, output } = runGate(root, '--source');
    expect(output).toContain('PASS');
    expect(status).toBe(0);
  });

  it('rejects the exact defect that shipped: an extensionless relative import', () => {
    const root = scratchRepo();
    write(
      root,
      'api/share.ts',
      "import { api } from '../convex/_generated/api';\nexport default api;\n",
    );
    write(root, 'convex/_generated/api.js', 'export const api = {};\n');

    const { status, output } = runGate(root, '--source');
    // The file exists. Only the specifier is wrong — that is the whole bug.
    expect(output).toContain('is not fully specified');
    expect(status).not.toBe(0);
  });

  it('follows the graph transitively rather than checking only the entrypoint', () => {
    const root = scratchRepo();
    write(root, 'api/share.ts', "export { render } from '../src/render.js';\n");
    write(root, 'src/render.ts', "export { helper as render } from './deep/helper';\n");
    write(root, 'src/deep/helper.ts', 'export const helper = () => null;\n');

    const { status, output } = runGate(root, '--source');
    expect(output).toContain('src/render.ts');
    expect(status).not.toBe(0);
  });

  it('rejects a tsconfig path alias, which does not exist at runtime', () => {
    const root = scratchRepo();
    write(root, 'api/share.ts', "import { render } from '@/render';\nexport default render;\n");

    const { status, output } = runGate(root, '--source');
    expect(output).toContain('tsconfig path alias');
    expect(status).not.toBe(0);
  });

  it('ignores test files beside a route, which are not deployed', () => {
    const root = scratchRepo();
    write(root, 'api/share.ts', 'export default () => null;\n');
    write(root, 'api/share.test.ts', "import handler from './share';\nexport default handler;\n");

    const { status } = runGate(root, '--source');
    expect(status).toBe(0);
  });
});

describe('verify-function-bundle --emitted', () => {
  it('accepts a bundle whose handler links under Node', () => {
    const root = scratchRepo();
    emittedFunction(root, 'share', {
      'api/share.js': "import { render } from '../shared/render.js';\nexport default render;\n",
      'shared/render.js': 'export const render = () => null;\n',
    });

    const { status, output } = runGate(root, '--emitted');
    expect(output).toContain('loads under node');
    expect(status).toBe(0);
  });

  it('reproduces the production failure from an emitted bundle', () => {
    const root = scratchRepo();
    // Byte-for-byte the deployed shape: the imported file IS in the bundle.
    emittedFunction(root, 'share', {
      'api/share.js': "import { api } from '../convex/_generated/api';\nexport default api;\n",
      'convex/_generated/api.js': 'export const api = {};\n',
    });

    const { status, output } = runGate(root, '--emitted');
    expect(output).toContain('ERR_MODULE_NOT_FOUND');
    expect(status).not.toBe(0);
  });

  it('refuses a test file deployed as a public route', () => {
    const root = scratchRepo();
    emittedFunction(root, 'share.http.test', {
      'api/share.http.test.js': 'export default () => null;\n',
    });

    const { status, output } = runGate(root, '--emitted');
    expect(output).toContain('test file was emitted as a public serverless function');
    expect(status).not.toBe(0);
  });

  it('refuses to pass when there is no build to inspect', () => {
    const root = scratchRepo();

    const { status, output } = runGate(root, '--emitted');
    // Silence must not read as success: an unbuilt tree proves nothing.
    expect(output).toContain('no emitted functions found');
    expect(status).not.toBe(0);
  });

  it('fails when the declared handler is missing from the bundle', () => {
    const root = scratchRepo();
    emittedFunction(root, 'share', {});

    const { status, output } = runGate(root, '--emitted');
    expect(output).toContain('is not in the bundle');
    expect(status).not.toBe(0);
  });
});
