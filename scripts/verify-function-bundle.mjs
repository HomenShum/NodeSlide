#!/usr/bin/env node
/**
 * Fail-closed gate for the deployed serverless functions under `api/`.
 *
 * PR #74 shipped `api/share.ts` with a green build, green typecheck, and a
 * passing test that served the handler over a real socket — and every request
 * to the deployed route returned FUNCTION_INVOCATION_FAILED. The handler was
 * never reached. `@vercel/node` traces (it does not bundle): it compiles each
 * `.ts` in the graph to a `.js` at the same relative path and copies the root
 * `package.json`, which declares `"type": "module"`. TypeScript does not
 * rewrite specifiers on emit, so `import { api } from '../convex/_generated/api'`
 * survived verbatim into the deployed `api/share.js`. The file it names is
 * present in the bundle; the specifier is not resolvable, because Node's ESM
 * loader requires a fully specified relative path. The module graph failed to
 * link at cold start, before a single line of handler logic ran.
 *
 * Vitest, Vite, and `tsc` all resolve extensionless relative specifiers, so no
 * in-process test can observe this. Only Node's own ESM loader can. This gate
 * has two modes, and they catch the failure at different distances from truth:
 *
 *   --source   Static. Walks the relative-import graph reachable from every
 *              deployable file under `api/` and requires each relative
 *              specifier to be fully specified. Needs no build and no
 *              credentials, so it runs on every pull request. It is a proxy:
 *              it enforces the rule that makes the bundle loadable, but it does
 *              not prove the bundle loads.
 *
 *   --emitted  Ground truth. Runs each function `vercel build` actually emitted
 *              under a real `node` process, exactly as Lambda would at cold
 *              start, and fails on any import-time error. Requires
 *              `.vercel/output` and therefore Vercel credentials, so it runs in
 *              the deploy workflow between the build and the deploy.
 *
 * What this gate does NOT catch: anything that only fails once a request is
 * being served. It proves the module graph links, not that the handler is
 * correct. The live share probe in the deploy workflow covers the request path.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const apiDir = path.join(repoRoot, 'api');
const outputFunctions = path.join(repoRoot, '.vercel', 'output', 'functions');

/** Extensions Node's ESM loader accepts on a relative specifier. */
const ESM_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json', '.node'];
/** Source extensions a fully specified `./x.js` may actually live behind. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'];

const IMPORT_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bexport\s*\*\s*from\s*)['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;

/** A test beside a route is not a route; `.vercelignore` keeps it undeployed. */
const isTestFile = (file) => /\.test\.[cm]?[jt]sx?$/.test(file);
/** The same rule applied to an emitted `<name>.func` directory, which has no extension. */
const isTestFunctionName = (name) => /(^|\.)test$/.test(name);

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function relativeSpecifiers(file) {
  const source = readFileSync(file, 'utf8');
  const found = [];
  IMPORT_PATTERN.lastIndex = 0;
  let match = IMPORT_PATTERN.exec(source);
  while (match) {
    const specifier = match[1] ?? match[2];
    if (specifier?.startsWith('.')) found.push(specifier);
    match = IMPORT_PATTERN.exec(source);
  }
  return found;
}

/** Resolve a fully specified `./x.js` back to the source file that emits it. */
function resolveSource(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  if (existsSync(base) && statSync(base).isFile()) return base;
  const withoutExt = base.replace(/\.[cm]?js$/, '');
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${withoutExt}${extension}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function verifySourceGraph() {
  if (!existsSync(apiDir)) {
    notes.push('no api/ directory: nothing to check');
    return;
  }
  const roots = readdirSync(apiDir)
    .filter((entry) => /\.[cm]?tsx?$/.test(entry) || /\.[cm]?js$/.test(entry))
    .filter((entry) => !isTestFile(entry))
    .map((entry) => path.join(apiDir, entry));

  if (roots.length === 0) {
    notes.push('no deployable entrypoints under api/');
    return;
  }

  const visited = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of relativeSpecifiers(file)) {
      const shown = path.relative(repoRoot, file).replaceAll(path.sep, '/');
      if (!ESM_EXTENSIONS.some((extension) => specifier.endsWith(extension))) {
        fail(
          `${shown}: relative specifier '${specifier}' is not fully specified. Node's ESM loader will not resolve it in the deployed function; add the '.js' extension.`,
        );
        continue;
      }
      const resolved = resolveSource(file, specifier);
      if (!resolved) {
        fail(`${shown}: relative specifier '${specifier}' does not resolve to a file`);
        continue;
      }
      queue.push(resolved);
    }
  }
  notes.push(
    `source graph: ${visited.size} file(s) reachable from ${roots.length} api/ entrypoint(s)`,
  );
}

function functionDirectories(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.endsWith('.func')) found.push(full);
    else found.push(...functionDirectories(full));
  }
  return found;
}

function verifyEmittedFunctions() {
  const functions = functionDirectories(outputFunctions);
  if (functions.length === 0) {
    fail(
      'no emitted functions found under .vercel/output/functions. ' +
        'Run `vercel build` before this mode, or the gate proves nothing.',
    );
    return;
  }

  for (const dir of functions) {
    const shown = path.relative(repoRoot, dir).replaceAll(path.sep, '/');

    if (isTestFunctionName(path.basename(dir).replace(/\.func$/, ''))) {
      fail(`${shown}: a test file was emitted as a public serverless function`);
      continue;
    }

    const configPath = path.join(dir, '.vc-config.json');
    if (!existsSync(configPath)) {
      fail(`${shown}: missing .vc-config.json`);
      continue;
    }
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    if (typeof config.runtime === 'string' && config.runtime.startsWith('edge')) {
      notes.push(`${shown}: edge runtime, not loadable by node — skipped`);
      continue;
    }
    const handler = config.handler;
    if (typeof handler !== 'string' || handler.length === 0) {
      fail(`${shown}: .vc-config.json declares no handler`);
      continue;
    }
    const handlerPath = path.join(dir, handler);
    if (!existsSync(handlerPath)) {
      fail(`${shown}: declared handler '${handler}' is not in the bundle`);
      continue;
    }

    // Load the handler the way a cold start does: a real node process, rooted
    // in the emitted bundle, using Node's own ESM resolver.
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(pathToFileURL(handlerPath).href)})`,
      ],
      { cwd: dir, encoding: 'utf8', timeout: 60_000 },
    );

    if (result.error) {
      fail(`${shown}: could not run node against the emitted handler: ${result.error.message}`);
      continue;
    }
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '')
        .trim()
        .split('\n')
        .slice(0, 6)
        .join('\n');
      fail(`${shown}: emitted handler '${handler}' failed to load under node\n${detail}`);
      continue;
    }
    notes.push(`${shown}: '${handler}' loads under node (${config.runtime ?? 'unknown runtime'})`);
  }
}

const argv = new Set(process.argv.slice(2));
const wantSource = argv.has('--source') || argv.size === 0;
const wantEmitted = argv.has('--emitted') || argv.size === 0;

if (wantSource) verifySourceGraph();
if (wantEmitted) {
  if (argv.size === 0 && !existsSync(outputFunctions)) {
    notes.push('no .vercel/output/functions: skipped the emitted-bundle mode (no build present)');
  } else {
    verifyEmittedFunctions();
  }
}

for (const note of notes) console.log(`[function-bundle] ${note}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`[function-bundle] FAIL ${failure}`);
  console.error(`[function-bundle] ${failures.length} failure(s)`);
  process.exit(1);
}

console.log('[function-bundle] PASS');
