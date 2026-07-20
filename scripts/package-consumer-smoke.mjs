import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const temporaryRoot = path.resolve(tmpdir());
const packageNames = [
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
];
const npmCli = process.env.npm_execpath;

assert(npmCli, 'Run the packed consumer proof through npm so npm_execpath is available.');

const consumerDirectory = await mkdtemp(path.join(temporaryRoot, 'nodeslide-consumer-'));
const safeTemporaryPrefix = `${temporaryRoot}${path.sep}`;
assert(
  consumerDirectory.startsWith(safeTemporaryPrefix),
  `Refusing to use a temporary consumer outside ${temporaryRoot}.`,
);

try {
  const packDirectory = path.join(consumerDirectory, 'packs');
  await mkdir(packDirectory);
  const packedArtifacts = new Map();

  for (const packageName of packageNames) {
    const { stdout } = await runNpm(
      ['pack', '--json', '--workspace', packageName, '--pack-destination', packDirectory],
      rootDirectory,
    );
    const packResult = JSON.parse(stdout);
    const packed = Array.isArray(packResult) ? packResult[0] : undefined;
    assert(packed?.filename, `npm pack returned no filename for ${packageName}.`);
    assertPackedEntrypoints(packageName, packed.files);
    packedArtifacts.set(packageName, {
      filename: packed.filename,
      tarball: path.join(packDirectory, packed.filename),
    });
  }

  const rootManifest = JSON.parse(await readFile(path.join(rootDirectory, 'package.json'), 'utf8'));
  const rootLock = JSON.parse(
    await readFile(path.join(rootDirectory, 'package-lock.json'), 'utf8'),
  );
  assert(typeof rootManifest.dependencies?.react === 'string', 'Root React dependency is missing.');
  assert(
    typeof rootManifest.dependencies?.['react-dom'] === 'string',
    'Root React DOM dependency is missing.',
  );
  const reactVersion = lockedDependencyVersion(rootLock, 'react');
  const reactDomVersion = lockedDependencyVersion(rootLock, 'react-dom');
  const convexVersion = lockedDependencyVersion(rootLock, 'convex');

  await writeFile(
    path.join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ name: 'nodeslide-packed-consumer-smoke', private: true, type: 'module' }, null, 2)}\n`,
  );
  await runNpm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      ...[...packedArtifacts.values()].map((artifact) => artifact.tarball),
      `react@${reactVersion}`,
      `react-dom@${reactDomVersion}`,
      `convex@${convexVersion}`,
    ],
    consumerDirectory,
  );
  await assertPackedInstallProvenance(
    consumerDirectory,
    packedArtifacts,
    reactVersion,
    reactDomVersion,
  );

  const consumerScript = path.join(consumerDirectory, 'verify.mjs');
  await writeFile(consumerScript, consumerSource());
  const { stdout } = await execFileAsync(process.execPath, [consumerScript], {
    cwd: consumerDirectory,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const receipt = JSON.parse(stdout.trim());
  assert.deepEqual(receipt, {
    ok: true,
    proposalVersion: 1,
    acceptedVersion: 2,
    rendered: true,
    cssExported: true,
    headless: true,
    httpAdapter: true,
    migrationCount: 1,
    registrySource: true,
    cliPlan: true,
    agentProposal: true,
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  await rm(consumerDirectory, { recursive: true, force: true, maxRetries: 3 });
}

async function runNpm(args, cwd) {
  try {
    return await execFileAsync(process.execPath, [npmCli, ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    if (error && typeof error === 'object') {
      const stdout = typeof error.stdout === 'string' ? error.stdout : '';
      const stderr = typeof error.stderr === 'string' ? error.stderr : '';
      error.message = `${error.message}\n${stdout}\n${stderr}`.trim();
    }
    throw error;
  }
}

function assertPackedEntrypoints(packageName, files) {
  const paths = new Set(Array.isArray(files) ? files.map((file) => file.path) : []);
  assert(paths.has('dist/index.js'), `${packageName} tarball is missing dist/index.js.`);
  assert(paths.has('dist/index.d.ts'), `${packageName} tarball is missing dist/index.d.ts.`);
  if (packageName === '@nodeslide/react') {
    assert(
      paths.has('src/styles.css'),
      '@nodeslide/react tarball is missing its opt-in CSS export.',
    );
  }
  if (packageName === '@nodeslide/convex') {
    assert(paths.has('dist/react.js'), '@nodeslide/convex tarball is missing its React binding.');
    assert(paths.has('dist/component.js'), '@nodeslide/convex tarball is missing migrations.');
    assert(
      paths.has('dist/componentSchema.js'),
      '@nodeslide/convex tarball is missing its isolated schema.',
    );
    assert(
      paths.has('component/convex.config.ts'),
      '@nodeslide/convex tarball is missing its source-owned component config.',
    );
  }
  if (packageName === '@nodeslide/registry') {
    assert(
      paths.has('sources/studio/NodeSlideExample.tsx'),
      '@nodeslide/registry tarball is missing studio source.',
    );
  }
  if (packageName === '@nodeslide/cli') {
    assert(paths.has('dist/cli.js'), '@nodeslide/cli tarball is missing its executable.');
  }
}

function lockedDependencyVersion(lock, packageName) {
  const version = lock.packages?.[`node_modules/${packageName}`]?.version;
  assert(
    typeof version === 'string' && version.length > 0,
    `Lockfile version missing for ${packageName}.`,
  );
  return version;
}

async function assertPackedInstallProvenance(
  consumerDirectory,
  packedArtifacts,
  reactVersion,
  reactDomVersion,
) {
  const lock = JSON.parse(
    await readFile(path.join(consumerDirectory, 'package-lock.json'), 'utf8'),
  );
  const expectedKeys = new Set();
  for (const [packageName, artifact] of packedArtifacts) {
    const key = `node_modules/${packageName}`;
    expectedKeys.add(key);
    const installed = lock.packages?.[key];
    assert(installed, `Packed consumer lockfile is missing ${packageName}.`);
    const expectedResolution = `file:packs/${artifact.filename}`;
    assert.equal(
      installed.resolved?.replaceAll('\\', '/'),
      expectedResolution,
      `${packageName} did not resolve from its freshly packed tarball.`,
    );
  }
  const unexpectedNodeSlideCopies = Object.keys(lock.packages ?? {}).filter(
    (key) => key.includes('node_modules/@nodeslide/') && !expectedKeys.has(key),
  );
  assert.deepEqual(
    unexpectedNodeSlideCopies,
    [],
    `Packed consumer installed unexpected NodeSlide copies: ${unexpectedNodeSlideCopies.join(', ')}`,
  );
  assert.equal(lock.packages?.['node_modules/react']?.version, reactVersion);
  assert.equal(lock.packages?.['node_modules/react-dom']?.version, reactDomVersion);
}

function consumerSource() {
  return `
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createNodeSlideRoomTools } from '@nodeslide/agent';
import {
  NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
  NodeSlideRepositoryError,
} from '@nodeslide/backend';
import { planNodeSlideInstallation } from '@nodeslide/cli';
import { createNodeSlideHttpAdapters } from '@nodeslide/client-http';
import { NODESLIDE_SCHEMA_VERSION } from '@nodeslide/contracts';
import { planNodeSlideConvexMigrations } from '@nodeslide/convex/component';
import { applyDeckPatch } from '@nodeslide/engine';
import { NodeSlideDeckViewer } from '@nodeslide/react';
import { nodeSlideStudioPermissionsForPrincipal } from '@nodeslide/react-headless';
import {
  NODESLIDE_REGISTRY_ENTRIES,
  readNodeSlideRegistryEntry,
} from '@nodeslide/registry';
import {
  MemoryNodeSlideRepository,
  NODESLIDE_TEST_PRINCIPAL,
  createNodeSlideTestSnapshot,
  createNodeSlideTextPatch,
  runNodeSlideRepositoryConformance,
} from '@nodeslide/testing';

const consumerDirectory = path.dirname(fileURLToPath(import.meta.url));
const nodeModulesPrefix = path.join(consumerDirectory, 'node_modules') + path.sep;
for (const packageName of ${JSON.stringify(packageNames)}) {
  const resolved = fileURLToPath(import.meta.resolve(packageName));
  assert(
    resolved.startsWith(nodeModulesPrefix),
    \`\${packageName} resolved outside the isolated consumer: \${resolved}\`,
  );
}

const snapshot = createNodeSlideTestSnapshot('deck:packed-consumer');
assert.equal(snapshot.deck.schemaVersion, NODESLIDE_SCHEMA_VERSION);
const proposal = createNodeSlideTextPatch(snapshot, 'Packed package accepted');
const enginePreview = applyDeckPatch(snapshot, proposal, snapshot.deck.updatedAt + 1);
assert.equal(enginePreview.snapshot.elements[0]?.content, 'Packed package accepted');
assert.equal(snapshot.elements[0]?.content, 'Before');
const normalizedError = new NodeSlideRepositoryError('not_found', 'Packed runtime export');
assert.equal(normalizedError.code, 'not_found');

let now = snapshot.deck.updatedAt;
const repository = new MemoryNodeSlideRepository({ snapshots: [snapshot], now: () => ++now });
const result = await runNodeSlideRepositoryConformance({
  repository,
  principal: NODESLIDE_TEST_PRINCIPAL,
  initialSnapshot: snapshot,
  proposal,
});
assert.equal(result.proposalVersion, 1);
assert.equal(result.acceptedVersion, 2);

const governance = {
  version: NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
  enforced: {
    mutation_authority: true,
    version_cas: true,
    candidate_validation: true,
    trace_lineage: true,
    source_authorization: true,
    rollback: true,
  },
};
const http = createNodeSlideHttpAdapters({
  baseUrl: 'https://api.example.test',
  governance,
  headersForPrincipal: () => ({ authorization: 'Bearer consumer' }),
  fetch: async () => new Response(null, { status: 204 }),
});
assert.equal(http.repository.descriptor.adapter, 'http');
assert.equal(nodeSlideStudioPermissionsForPrincipal(NODESLIDE_TEST_PRINCIPAL).canRead, true);
assert.equal(planNodeSlideConvexMigrations(0).length, 1);
const registrySource = await readNodeSlideRegistryEntry(NODESLIDE_REGISTRY_ENTRIES[0]);
assert.match(registrySource, /NodeSlideStudioShell/);
const cliPlan = await planNodeSlideInstallation({
  cwd: consumerDirectory,
  profile: 'agent-pack-only',
  backend: 'custom',
  uiMode: 'headless',
  skipInstall: true,
  skipChecks: true,
});
assert(cliPlan.packages.includes('@nodeslide/agent'));

const agentPatch = createNodeSlideTextPatch(
  result.resolution.snapshot,
  'Agent proposal remains unapplied',
);
const roomTools = createNodeSlideRoomTools({
  deckId: snapshot.deck.id,
  principal: NODESLIDE_TEST_PRINCIPAL,
  repository,
  approvalPolicy: { byOperationMode: {} },
  locks: {
    acquire: async () => ({ ok: true }),
    release: async () => undefined,
  },
  say: async () => undefined,
});
const agentOutcome = await roomTools.applyDeckPatch({
  patch: agentPatch,
  expectedVersion: result.acceptedVersion,
});
assert.equal(agentOutcome.ok, false);
assert.equal(agentOutcome.pendingApproval, true);

const markup = renderToStaticMarkup(
  React.createElement(NodeSlideDeckViewer, {
    snapshot: result.resolution.snapshot,
    activeSlideId: snapshot.deck.slideOrder[0],
  }),
);
assert.match(markup, /Packed package accepted/);
assert.match(markup, /data-nodeslide-surface="deck-viewer"/);

const cssPath = fileURLToPath(import.meta.resolve('@nodeslide/react/styles.css'));
assert(
  cssPath.startsWith(nodeModulesPrefix),
  'React CSS resolved outside the isolated consumer: ' + cssPath,
);
await access(cssPath);
process.stdout.write(JSON.stringify({
  ok: true,
  proposalVersion: result.proposalVersion,
  acceptedVersion: result.acceptedVersion,
  rendered: true,
  cssExported: true,
  headless: true,
  httpAdapter: http.repository.descriptor.adapter === 'http',
  migrationCount: planNodeSlideConvexMigrations(0).length,
  registrySource: registrySource.includes('NodeSlideStudioShell'),
  cliPlan: cliPlan.packages.includes('@nodeslide/agent'),
  agentProposal: agentOutcome.ok === false && agentOutcome.pendingApproval === true,
}));
`;
}
