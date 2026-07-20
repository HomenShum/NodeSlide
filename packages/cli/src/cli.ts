#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type {
  NodeSlideBackendChoice,
  NodeSlideInstallProfile,
  NodeSlideUiMode,
} from '@nodeslide/registry';
import { type NodeSlideInitOptions, runNodeSlideInit, runNodeSlideUpgrade } from './index';

const args = process.argv.slice(2);
const command = args[0];

try {
  if (command === 'init') {
    const values = await initOptions(args.slice(1));
    const receipt = await runNodeSlideInit(values);
    stdout.write(`NodeSlide installation receipt: ${values.cwd}/.nodeslide/installation.json\n`);
    stdout.write(`${receipt.files.length} registry source(s) written.\n`);
  } else if (command === 'upgrade') {
    const flags = parseFlags(args.slice(1));
    const cwd = pathValue(flags, 'cwd') ?? process.cwd();
    const artifactsDirectory = pathValue(flags, 'artifacts');
    const receipt = await runNodeSlideUpgrade({
      cwd,
      ...(artifactsDirectory ? { artifactsDirectory } : {}),
      skipInstall: boolFlag(flags, 'skip-install'),
      skipChecks: boolFlag(flags, 'skip-checks'),
      dryRun: boolFlag(flags, 'dry-run'),
    });
    stdout.write(`NodeSlide upgraded to registry ${receipt.registryVersion}.\n`);
  } else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function initOptions(raw: readonly string[]): Promise<NodeSlideInitOptions> {
  const flags = parseFlags(raw);
  const interactive = stdin.isTTY && stdout.isTTY;
  const io = interactive ? createInterface({ input: stdin, output: stdout }) : null;
  try {
    const profile = await choice(
      pathValue(flags, 'profile'),
      'Install profile',
      'profile',
      ['full-studio', 'agent-thread', 'renderer', 'presenter', 'backend-only', 'agent-pack-only'],
      io,
    );
    const backend = await choice(
      pathValue(flags, 'backend'),
      'Backend',
      'backend',
      ['convex', 'hosted', 'custom'],
      io,
    );
    const uiMode = await choice(
      pathValue(flags, 'ui'),
      'UI mode',
      'ui',
      ['default-theme', 'host-tokens', 'headless'],
      io,
    );
    const artifactsDirectory = pathValue(flags, 'artifacts');
    return {
      cwd: pathValue(flags, 'cwd') ?? process.cwd(),
      profile: profile as NodeSlideInstallProfile,
      backend: backend as NodeSlideBackendChoice,
      uiMode: uiMode as NodeSlideUiMode,
      ...(artifactsDirectory ? { artifactsDirectory } : {}),
      skipInstall: boolFlag(flags, 'skip-install'),
      skipChecks: boolFlag(flags, 'skip-checks'),
      dryRun: boolFlag(flags, 'dry-run'),
    };
  } finally {
    io?.close();
  }
}

type Flags = Map<string, string | true>;

function parseFlags(raw: readonly string[]): Flags {
  const flags: Flags = new Map();
  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index];
    if (!token?.startsWith('--')) throw new Error(`Unexpected argument ${String(token)}.`);
    const key = token.slice(2);
    const next = raw[index + 1];
    if (next && !next.startsWith('--')) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }
  return flags;
}

async function choice(
  current: string | undefined,
  label: string,
  flag: string,
  values: readonly string[],
  io: ReturnType<typeof createInterface> | null,
): Promise<string> {
  if (current) {
    if (!values.includes(current)) throw new Error(`Invalid ${label}: ${current}.`);
    return current;
  }
  if (!io) throw new Error(`--${flag} is required.`);
  const answer = await io.question(`${label} (${values.join(' / ')}): `);
  if (!values.includes(answer)) throw new Error(`Invalid ${label}: ${answer}.`);
  return answer;
}

function pathValue(flags: Flags, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function boolFlag(flags: Flags, name: string): boolean {
  return flags.get(name) === true;
}

function usage(): void {
  stdout.write(
    'Usage: nodeslide init --profile <profile> --backend <backend> --ui <mode> [--artifacts <dir>]\n' +
      '       nodeslide upgrade [--artifacts <dir>] [--dry-run]\n',
  );
}
