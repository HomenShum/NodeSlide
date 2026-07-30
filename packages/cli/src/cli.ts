#!/usr/bin/env node
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type {
  NodeSlideBackendChoice,
  NodeSlideInstallProfile,
  NodeSlideUiMode,
} from '@nodeslide/registry';
import { generateDeck } from './generate';
import { type NodeSlideInitOptions, runNodeSlideInit, runNodeSlideUpgrade } from './index';

const args = process.argv.slice(2);
const command = args[0];

try {
  if (command === '--help' || command === '-h' || command === 'help') {
    usage();
  } else if (command === '--version' || command === '-v') {
    stdout.write('0.2.2\n');
  } else if (command === 'init') {
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
  } else if (command === 'generate') {
    const flags = parseFlags(args.slice(1));
    const title = requiredValue(flags, 'title');
    const prompt = requiredValue(flags, 'prompt');
    const receipt = await generateDeck({
      convexUrl:
        pathValue(flags, 'convex-url') ??
        process.env['NODESLIDE_CONVEX_URL'] ??
        'https://agile-stoat-411.convex.cloud',
      title,
      prompt,
      audience: pathValue(flags, 'audience') ?? 'Decision-makers described in the brief',
      purpose: pathValue(flags, 'purpose') ?? 'Create an editable, reviewable presentation',
      successCriteria: values(flags, 'success').length
        ? values(flags, 'success')
        : ['A coherent narrative', 'Editable structured primitives', 'Validation before publish'],
      outputDirectory: pathValue(flags, 'output') ?? process.cwd(),
      clientSessionId:
        pathValue(flags, 'session') ?? `cli-${Date.now()}-${crypto.randomUUID().slice(0, 12)}`,
      model: pathValue(flags, 'model') ?? 'moonshotai/kimi-k3',
      effort: effortValue(flags),
      ...((pathValue(flags, 'access-code') ?? process.env['NODESLIDE_PREVIEW_ACCESS_CODE'])
        ? {
            accessCode:
              pathValue(flags, 'access-code') ?? process.env['NODESLIDE_PREVIEW_ACCESS_CODE'],
          }
        : {}),
      allowFallback: boolFlag(flags, 'allow-fallback'),
      publish: !boolFlag(flags, 'no-publish'),
    });
    stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
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

function requiredValue(flags: Flags, name: string): string {
  const value = pathValue(flags, name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function values(flags: Flags, name: string): string[] {
  const value = pathValue(flags, name);
  return value
    ? value
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];
}

function boolFlag(flags: Flags, name: string): boolean {
  return flags.get(name) === true;
}

function effortValue(flags: Flags): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  const effort = pathValue(flags, 'effort') ?? 'low';
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
    throw new Error('--effort must be low, medium, high, xhigh, or max.');
  }
  return effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

function usage(): void {
  stdout.write(
    'Usage: nodeslide init --profile <profile> --backend <backend> --ui <mode> [--artifacts <dir>]\n' +
      '       nodeslide upgrade [--artifacts <dir>] [--dry-run]\n' +
      '       nodeslide generate --title <title> --prompt <brief> [--output <dir>] [--model <id>] [--effort <level>] [--allow-fallback] [--no-publish]\n',
  );
}
