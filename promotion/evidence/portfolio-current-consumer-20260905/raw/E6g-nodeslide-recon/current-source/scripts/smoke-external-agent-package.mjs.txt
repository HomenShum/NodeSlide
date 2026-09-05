import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.env.npm_execpath
  ? { command: process.execPath, prefix: [process.env.npm_execpath] }
  : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefix: [] };
const consumer = await mkdtemp(join(tmpdir(), 'nodeslide-external-consumer-'));

try {
  runNpm(['run', 'build', '--workspace', '@nodeslide/external-agent'], repositoryRoot);
  const pack = runNpm(
    ['pack', './packages/external-agent', '--pack-destination', consumer, '--json'],
    repositoryRoot,
  );
  const packed = JSON.parse(pack);
  const tarball = join(consumer, packed[0]?.filename ?? '');
  if (!packed[0]?.filename) throw new Error('npm pack did not return a tarball filename.');
  runNpm(['run', 'build', '--workspace', 'nodeslide-mcp'], repositoryRoot);
  const mcpPack = JSON.parse(
    runNpm(['pack', './mcp', '--pack-destination', consumer, '--json'], repositoryRoot),
  );
  const mcpTarball = join(consumer, mcpPack[0]?.filename ?? '');
  if (!mcpPack[0]?.filename) throw new Error('npm pack did not return an MCP tarball filename.');
  runNpm(['run', 'build', '--workspace', '@nodeslide/recipelang'], repositoryRoot);
  const recipeLangPack = JSON.parse(
    runNpm(
      ['pack', './packages/recipelang', '--pack-destination', consumer, '--json'],
      repositoryRoot,
    ),
  );
  const recipeLangTarball = join(consumer, recipeLangPack[0]?.filename ?? '');
  if (!recipeLangPack[0]?.filename) {
    throw new Error('npm pack did not return a RecipeLang tarball filename.');
  }

  await writeFile(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'nodeslide-external-consumer-smoke', private: true, type: 'module' }, null, 2)}\n`,
  );
  runNpm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      tarball,
      recipeLangTarball,
      mcpTarball,
    ],
    consumer,
  );

  const snapshot = createSnapshot();
  const patch = createPatch(snapshot);
  await writeFile(join(consumer, 'deck.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(join(consumer, 'patch.json'), `${JSON.stringify(patch, null, 2)}\n`);

  const cli = join(consumer, 'node_modules', '@nodeslide', 'external-agent', 'dist', 'cli.js');
  const help = run(process.execPath, [cli, '--help'], consumer);
  if (!help.includes('nodeslide apply')) throw new Error('Packed CLI help is incomplete.');
  const inspect = JSON.parse(
    run(process.execPath, [cli, 'inspect', 'deck.json', '--compact'], consumer),
  );
  if (inspect.deck?.deckId !== snapshot.deck.id) throw new Error('Packed CLI inspect failed.');
  const patchBefore = await readFile(join(consumer, 'patch.json'), 'utf8');
  const overwriteRefusal = runFailure(
    process.execPath,
    [cli, 'propose', 'deck.json', 'patch.json', '--out', 'patch.json', '--compact'],
    consumer,
  );
  const refusal = JSON.parse(overwriteRefusal.stderr.trim());
  if (!refusal.error?.message?.includes('must not overwrite an input')) {
    throw new Error('Packed CLI did not fail closed when asked to overwrite an input.');
  }
  if ((await readFile(join(consumer, 'patch.json'), 'utf8')) !== patchBefore) {
    throw new Error('Packed CLI changed an input after refusing an overwrite.');
  }
  await writeFile(join(consumer, 'occupied.json'), 'sentinel');
  const existingOutputRefusal = runFailure(
    process.execPath,
    [cli, 'propose', 'deck.json', 'patch.json', '--out', 'occupied.json', '--compact'],
    consumer,
  );
  const existingOutputEnvelope = JSON.parse(existingOutputRefusal.stderr.trim());
  if (!existingOutputEnvelope.error?.message?.includes('Refusing to overwrite existing output')) {
    throw new Error('Packed CLI did not refuse an existing non-input output.');
  }
  if ((await readFile(join(consumer, 'occupied.json'), 'utf8')) !== 'sentinel') {
    throw new Error('Packed CLI changed an existing output after refusing it.');
  }
  const validated = JSON.parse(
    run(process.execPath, [cli, 'validate', 'deck.json', 'patch.json', '--compact'], consumer),
  );

  const proposed = JSON.parse(
    run(
      process.execPath,
      [cli, 'propose', 'deck.json', 'patch.json', '--out', 'proposal.json', '--compact'],
      consumer,
    ),
  );
  if (!proposed.proposalId) throw new Error('Packed CLI did not create a proposal.');
  if (proposed.candidateSnapshotDigest !== validated.validation?.candidateSnapshotDigest) {
    throw new Error('Packed CLI validate and propose compiled different candidate digests.');
  }
  run(
    process.execPath,
    [
      cli,
      'apply',
      'deck.json',
      'proposal.json',
      '--approve',
      proposed.proposalId,
      '--out',
      'next-deck.json',
      '--compact',
    ],
    consumer,
  );
  const next = JSON.parse(await readFile(join(consumer, 'next-deck.json'), 'utf8'));
  if (next.deck?.version !== 2 || next.elements?.[0]?.content !== 'After') {
    throw new Error('Packed CLI apply did not produce the expected governed deck version.');
  }
  const imported = run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { inspectDeckSnapshot } from '@nodeslide/external-agent'; console.log(typeof inspectDeckSnapshot)",
    ],
    consumer,
  );
  if (imported.trim() !== 'function') throw new Error('Packed library export is unavailable.');
  const mcp = join(consumer, 'node_modules', 'nodeslide-mcp', 'dist', 'index.js');
  const mcpHelp = run(process.execPath, [mcp, '--help'], consumer);
  if (!mcpHelp.includes('Offline file tools are always available')) {
    throw new Error('Packed MCP help does not expose the offline file-tool mode.');
  }
  const recipe = createRecipe();
  await writeFile(join(consumer, 'recipe.json'), `${JSON.stringify(recipe, null, 2)}\n`);
  const recipeLangCli = join(
    consumer,
    'node_modules',
    '@nodeslide',
    'recipelang',
    'dist',
    'cli.js',
  );
  const recipeAlignment = JSON.parse(
    run(process.execPath, [recipeLangCli, 'verify-alignment', 'recipe.json', '--json'], consumer),
  );
  if (recipeAlignment.alignment?.passed !== true) {
    throw new Error('Packed RecipeLang CLI failed its alignment gate.');
  }

  console.log(
    JSON.stringify({
      ok: true,
      proof: 'external-agent-and-mcp-tarball-consumer',
      packages: [
        '@nodeslide/external-agent@0.2.2',
        '@nodeslide/recipelang@0.2.2',
        'nodeslide-mcp@0.2.2',
      ],
      commands: [
        '--help',
        'inspect',
        'propose',
        'apply',
        'recipelang verify-alignment',
        'nodeslide-mcp --help',
      ],
      resultingDeckVersion: next.deck.version,
      recipeAlignmentPassed: true,
    }),
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}).\n${result.error ? `error:\n${result.error.stack ?? result.error.message}\n` : ''}stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function runNpm(args, cwd) {
  return run(npm.command, [...npm.prefix, ...args], cwd);
}

function runFailure(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status === 0) {
    throw new Error(`${command} ${args.join(' ')} unexpectedly succeeded.`);
  }
  if (result.error) throw result.error;
  return result;
}

function createSnapshot() {
  return {
    deck: {
      schemaVersion: 'nodeslide.slidelang/v1',
      toolchainVersion: 'local-slidelang-adapter/1.1.0',
      id: 'deck:consumer-smoke',
      projectId: 'project:consumer-smoke',
      title: 'External consumer smoke',
      brief: {
        prompt: 'Prove the packed CLI.',
        audience: 'External agents',
        purpose: 'Package verification',
        successCriteria: ['Apply one governed edit.'],
      },
      theme: {
        id: 'smoke-theme',
        name: 'Smoke theme',
        mode: 'light',
        colors: {
          canvas: '#ffffff',
          ink: '#111111',
          muted: '#666666',
          accent: '#3155d9',
          accentSoft: '#e9edff',
          insight: '#dfe9d8',
          insightInk: '#1e3b2b',
          trace: '#10213f',
          border: '#d9d9d2',
        },
        typography: { display: 'Aptos Display', body: 'Aptos', data: 'Aptos Mono' },
        defaultRadius: 8,
        spacingUnit: 8,
      },
      slideOrder: ['slide:1'],
      version: 1,
      status: 'ready',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
    slides: [
      {
        id: 'slide:1',
        deckId: 'deck:consumer-smoke',
        title: 'Opening',
        background: '#ffffff',
        elementOrder: ['element:1'],
        version: 1,
      },
    ],
    elements: [
      {
        id: 'element:1',
        slideId: 'slide:1',
        name: 'Title',
        kind: 'text',
        role: 'title',
        bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
        rotation: 0,
        content: 'Before',
        style: { color: '#111111', fontSize: 40, fontWeight: 700 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable'],
        version: 1,
      },
    ],
    sources: [],
  };
}

function createPatch(snapshot) {
  return {
    id: 'patch:consumer-smoke',
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: { 'slide:1': 1 },
    baseElementVersions: { 'element:1': 1 },
    scope: {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: ['slide:1'],
      elementIds: ['element:1'],
      operationMode: 'copy',
    },
    operations: [{ op: 'replace_text', slideId: 'slide:1', elementId: 'element:1', text: 'After' }],
    source: 'agent',
    summary: 'Replace the title.',
  };
}

function createRecipe() {
  return {
    schemaVersion: 'recipelang/v1',
    kind: 'Recipe',
    meta: { id: 'packed-smoke', title: 'Packed RecipeLang smoke', version: 1 },
    inputs: [{ id: 'source', label: 'Source', produces: 'raw' }],
    artifacts: [
      { id: 'raw', shape: 'Item[]' },
      { id: 'brief', shape: 'Brief' },
    ],
    steps: [
      {
        id: 'synthesize',
        label: 'Synthesize',
        consumes: ['raw'],
        produces: ['brief'],
        executor: { kind: 'agent', deterministic: false },
      },
    ],
    outputs: [{ artifact: 'brief', label: 'Brief' }],
  };
}
