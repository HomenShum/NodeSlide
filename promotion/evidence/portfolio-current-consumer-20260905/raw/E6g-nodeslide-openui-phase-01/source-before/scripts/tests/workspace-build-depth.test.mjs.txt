import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The person this protects: someone who cloned NodeSlide this morning on a
 * Windows laptop and typed `npm run build`. What went wrong before this test
 * existed: the build died at the eleventh workspace with `'tsup' is not
 * recognized`, even though `node_modules/.bin/tsup` was sitting right there and
 * `npm run build --workspace @nodeslide/convex` on its own worked fine.
 *
 * The cause was not a missing tool. Every time npm starts a script it puts more
 * `node_modules/.bin` folders at the front of the PATH variable — about 1.4 KB
 * of text per level. The root build is level one, `packages:build` is level two,
 * each workspace's own build is level three. `@nodeslide/convex` was the only
 * workspace whose build started yet another `npm run`, making a fourth level.
 * Measured on this repo: PATH is 7,409 characters at level three and would be
 * about 8,850 at level four, past the roughly 8,191-character ceiling Windows
 * `cmd.exe` will expand. Over that ceiling cmd.exe hands the child an empty
 * PATH, so nothing found by PATH resolves — not `tsup`, and (proved by probe)
 * not even `node`.
 *
 * The rule that keeps it fixed: a workspace build script runs its tools
 * directly and never starts another `npm run`. That is one line of policy
 * instead of a per-tool absolute path in sixteen packages.
 */

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// The workspaces declared in the root package.json: `packages/*` and `mcp`.
const workspaceManifests = () =>
  readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repoRoot, 'packages', entry.name, 'package.json'))
    .concat(join(repoRoot, 'mcp', 'package.json'));

const readManifest = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

describe('a stranger runs `npm run build` on Windows from a clean checkout', () => {
  it('finds no workspace build script that starts a fourth nested npm level', () => {
    const offenders = [];
    for (const manifestPath of workspaceManifests()) {
      const manifest = readManifest(manifestPath);
      const build = manifest?.scripts?.build;
      if (typeof build !== 'string') continue;
      if (/\bnpm\s+run\b/.test(build)) {
        offenders.push(`${manifest.name ?? manifestPath}: ${build}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('still builds both halves of @nodeslide/convex — flattening must not drop one', () => {
    const manifest = readManifest(join(repoRoot, 'packages', 'convex', 'package.json'));
    const build = manifest?.scripts?.build ?? '';
    // The client bundle (tsup) and the Convex component types (tsc) are two
    // separate outputs. Removing the nesting is only safe while both still run.
    expect(build).toMatch(/\btsup\b/);
    expect(build).toMatch(/tsc -p tsconfig\.component\.json/);
  });
});
