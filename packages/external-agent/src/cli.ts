#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import {
  applyDeckProposal,
  externalErrorEnvelope,
  inspectDeckSnapshot,
  proposeDeckPatch,
  validateDeckPatch,
} from './index.js';

const VERSION = '0.1.0';
const MAX_INPUT_BYTES = 16 * 1024 * 1024;

const HELP = `NodeSlide external-agent CLI ${VERSION}

Usage:
  nodeslide inspect <deck.json> [--compact]
  nodeslide validate <deck.json> <patch.json> [--compact]
  nodeslide propose <deck.json> <patch.json> [--out <proposal.json>] [--compact]
  nodeslide apply <deck.json> <proposal.json> --approve <proposal-id> [--out <next-deck.json>] [--compact]
  nodeslide --help
  nodeslide --version

Safety:
  - Inputs must be canonical NodeSlide DeckSnapshot and patch-command JSON.
  - validate/propose/apply fail closed on stale deck, slide, or element clocks.
  - apply accepts only a digest-bound proposal and exact --approve proposal ID.
  - Input files are never overwritten; --out must name a different path.

Output:
  Successful commands emit JSON to stdout. Failures emit a JSON error envelope
  to stderr and exit non-zero. Use --compact for single-line JSON.`;

interface ParsedArguments {
  command: string;
  positionals: string[];
  out?: string;
  approve?: string;
  compact: boolean;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
    console.log(VERSION);
    return;
  }
  const args = parseArguments(argv);
  const serialize = (value: unknown): string => JSON.stringify(value, null, args.compact ? 0 : 2);

  switch (args.command) {
    case 'inspect': {
      requirePositionals(args, 1);
      const deck = await readJson(args.positionals[0] as string);
      console.log(serialize({ ok: true, command: 'inspect', deck: inspectDeckSnapshot(deck) }));
      return;
    }
    case 'validate': {
      requirePositionals(args, 2);
      const [deck, patch] = await Promise.all([
        readJson(args.positionals[0] as string),
        readJson(args.positionals[1] as string),
      ]);
      const { candidateSnapshot: _candidateSnapshot, ...validation } = validateDeckPatch(
        deck,
        patch,
      );
      console.log(serialize({ ok: true, command: 'validate', validation }));
      return;
    }
    case 'propose': {
      requirePositionals(args, 2);
      const deckPath = args.positionals[0] as string;
      const patchPath = args.positionals[1] as string;
      const [deck, patch] = await Promise.all([readJson(deckPath), readJson(patchPath)]);
      const proposal = proposeDeckPatch(deck, patch);
      if (args.out) {
        await writeJsonSafely(args.out, proposal, [deckPath, patchPath]);
        console.log(
          serialize({
            ok: true,
            command: 'propose',
            proposalId: proposal.id,
            outputPath: resolve(args.out),
            baseDeckVersion: proposal.base.deckVersion,
            candidateDeckVersion: proposal.candidate.deckVersion,
            candidateSnapshotDigest: proposal.candidate.snapshotDigest,
            applied: false,
          }),
        );
      } else {
        console.log(serialize({ ok: true, command: 'propose', proposal }));
      }
      return;
    }
    case 'apply': {
      requirePositionals(args, 2);
      if (!args.approve) throw new Error('apply requires --approve <proposal-id>.');
      const deckPath = args.positionals[0] as string;
      const proposalPath = args.positionals[1] as string;
      const [deck, proposal] = await Promise.all([readJson(deckPath), readJson(proposalPath)]);
      const application = applyDeckProposal(deck, proposal, {
        approvedProposalId: args.approve,
      });
      if (args.out) {
        await writeJsonSafely(args.out, application.snapshot, [deckPath, proposalPath]);
        console.log(
          serialize({
            ok: true,
            command: 'apply',
            outputPath: resolve(args.out),
            receipt: application.receipt,
          }),
        );
      } else {
        console.log(serialize({ ok: true, command: 'apply', ...application }));
      }
      return;
    }
    default:
      throw new Error(`Unknown command ${JSON.stringify(args.command)}. Run nodeslide --help.`);
  }
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const command = argv[0];
  if (!command) throw new Error('A command is required. Run nodeslide --help.');
  const positionals: string[] = [];
  let out: string | undefined;
  let approve: string | undefined;
  let compact = false;
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index] as string;
    if (value === '--compact') {
      compact = true;
      continue;
    }
    if (value === '--out' || value === '--approve') {
      const optionValue = argv[index + 1];
      if (!optionValue || optionValue.startsWith('--')) {
        throw new Error(`${value} requires a value.`);
      }
      index += 1;
      if (value === '--out') out = optionValue;
      else approve = optionValue;
      continue;
    }
    if (value.startsWith('-')) throw new Error(`Unknown option ${value}. Run nodeslide --help.`);
    positionals.push(value);
  }
  return {
    command,
    positionals,
    compact,
    ...(out ? { out } : {}),
    ...(approve ? { approve } : {}),
  };
}

function requirePositionals(args: ParsedArguments, expected: number): void {
  if (args.positionals.length !== expected) {
    throw new Error(
      `${args.command} requires ${expected} file argument${expected === 1 ? '' : 's'}. Run nodeslide --help.`,
    );
  }
}

async function readJson(path: string): Promise<unknown> {
  const absolute = resolve(path);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(`${absolute} is not a file.`);
  if (info.size > MAX_INPUT_BYTES) {
    throw new Error(`${absolute} exceeds the ${MAX_INPUT_BYTES}-byte input limit.`);
  }
  const text = await readFile(absolute, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${absolute} is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
    );
  }
}

async function writeJsonSafely(
  outputPath: string,
  value: unknown,
  forbiddenInputs: readonly string[],
): Promise<void> {
  const absolute = resolve(outputPath);
  if (forbiddenInputs.some((input) => resolve(input) === absolute)) {
    throw new Error('The output path must not overwrite an input deck.');
  }
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = resolve(dirname(absolute), `.${basename(absolute)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    try {
      await link(temporary, absolute);
    } catch (error) {
      if ((error as { code?: unknown }).code === 'EEXIST') {
        throw new Error(`Refusing to overwrite existing output ${absolute}.`);
      }
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify(externalErrorEnvelope(error)));
  process.exitCode = 1;
});
