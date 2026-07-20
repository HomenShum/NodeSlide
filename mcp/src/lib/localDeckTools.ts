import { randomUUID } from 'node:crypto';
import { link, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  applyDeckProposal,
  inspectDeckSnapshot,
  proposeDeckPatch,
  validateDeckPatch,
} from '@nodeslide/external-agent';
import { z } from 'zod';

const MAX_INPUT_BYTES = 16 * 1024 * 1024;

interface LocalToolArguments {
  snapshotPath: string;
  patchPath: string;
  proposalPath?: string;
  outputPath: string;
  approveProposalId: string;
}

interface LocalToolConfig {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    openWorldHint: boolean;
  };
}

function registerLocalTool(
  server: McpServer,
  name: string,
  config: LocalToolConfig,
  handler: (args: LocalToolArguments) => Promise<unknown>,
): void {
  const register = server.registerTool as unknown as (
    toolName: string,
    toolConfig: LocalToolConfig,
    toolHandler: (args: LocalToolArguments) => Promise<unknown>,
  ) => void;
  register.call(server, name, config, handler);
}

export function registerNodeSlideLocalTools(server: McpServer): void {
  registerLocalTool(
    server,
    'nodeslide.inspect_file',
    {
      title: 'Inspect a local NodeSlide DeckSpec file',
      description:
        'Offline, read-only inspection of canonical DeckSnapshot JSON under a trusted NODESLIDE_LOCAL_ROOT.',
      inputSchema: { snapshotPath: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ snapshotPath }) => textResult(await inspectLocalDeckFile(snapshotPath)),
  );

  registerLocalTool(
    server,
    'nodeslide.validate_file_patch',
    {
      title: 'Validate a local governed NodeSlide patch',
      description:
        'Offline edit preflight through the canonical patch engine and product validators. Requires exact deck, slide, and element version clocks, rejects caller-authored validation receipts and propagation metadata, and never writes a file.',
      inputSchema: { snapshotPath: z.string().min(1), patchPath: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ snapshotPath, patchPath }) =>
      textResult(await validateLocalDeckPatch(snapshotPath, patchPath)),
  );

  registerLocalTool(
    server,
    'nodeslide.propose_file_patch',
    {
      title: 'Create a digest-bound local NodeSlide proposal',
      description:
        'Offline propose-before-apply. Returns a governed, unapplied proposal and optionally stores it under NODESLIDE_LOCAL_ROOT.',
      inputSchema: {
        snapshotPath: z.string().min(1),
        patchPath: z.string().min(1),
        proposalPath: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ snapshotPath, patchPath, proposalPath }) =>
      textResult(await proposeLocalDeckPatch(snapshotPath, patchPath, proposalPath)),
  );

  registerLocalTool(
    server,
    'nodeslide.apply_file_proposal',
    {
      title: 'Apply a caller-confirmed local NodeSlide proposal',
      description:
        'Offline governed application. Requires the caller to echo the exact proposal ID, revalidates every digest and pinned version, and writes a new output file without overwriting an input. The echoed ID binds the proposal but is not independent reviewer authorization.',
      inputSchema: {
        snapshotPath: z.string().min(1),
        proposalPath: z.string().min(1),
        outputPath: z.string().min(1),
        approveProposalId: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ snapshotPath, proposalPath, outputPath, approveProposalId }) =>
      textResult(
        await applyLocalDeckProposal(
          snapshotPath,
          requiredToolString(proposalPath, 'proposalPath'),
          outputPath,
          approveProposalId,
        ),
      ),
  );
}

export async function inspectLocalDeckFile(snapshotPath: string) {
  const snapshot = await readRootJson(snapshotPath);
  return { mode: 'offline_file', deck: inspectDeckSnapshot(snapshot) };
}

export async function validateLocalDeckPatch(snapshotPath: string, patchPath: string) {
  const [snapshot, patch] = await Promise.all([
    readRootJson(snapshotPath),
    readRootJson(patchPath),
  ]);
  const { candidateSnapshot: _candidateSnapshot, ...validation } = validateDeckPatch(
    snapshot,
    patch,
  );
  return { mode: 'offline_file', validation };
}

export async function proposeLocalDeckPatch(
  snapshotPath: string,
  patchPath: string,
  proposalPath?: string,
) {
  const [snapshot, patch] = await Promise.all([
    readRootJson(snapshotPath),
    readRootJson(patchPath),
  ]);
  const proposal = proposeDeckPatch(snapshot, patch);
  if (!proposalPath) return { mode: 'offline_file', proposal };
  const storedAt = await writeRootJson(proposalPath, proposal, [snapshotPath, patchPath]);
  return {
    mode: 'offline_file',
    proposalId: proposal.id,
    storedAt,
    applied: false,
    candidateSnapshotDigest: proposal.candidate.snapshotDigest,
  };
}

export async function applyLocalDeckProposal(
  snapshotPath: string,
  proposalPath: string,
  outputPath: string,
  approveProposalId: string,
) {
  const [snapshot, proposal] = await Promise.all([
    readRootJson(snapshotPath),
    readRootJson(proposalPath),
  ]);
  const application = applyDeckProposal(snapshot, proposal, {
    approvedProposalId: approveProposalId,
  });
  const storedAt = await writeRootJson(outputPath, application.snapshot, [
    snapshotPath,
    proposalPath,
  ]);
  return { mode: 'offline_file', storedAt, receipt: application.receipt };
}

async function readRootJson(path: string): Promise<unknown> {
  const absolute = await resolveExistingInsideRoot(path);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(`${absolute} is not a file.`);
  if (info.size > MAX_INPUT_BYTES) {
    throw new Error(`${absolute} exceeds the ${MAX_INPUT_BYTES}-byte input limit.`);
  }
  const text = await readFile(absolute, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${absolute} is not valid JSON.`);
  }
}

async function writeRootJson(
  path: string,
  value: unknown,
  forbiddenInputs: readonly string[],
): Promise<string> {
  const absolute = await resolveOutputInsideRoot(path);
  const forbidden = await Promise.all(forbiddenInputs.map(resolveExistingInsideRoot));
  if (forbidden.includes(absolute)) {
    throw new Error('The output path must not overwrite an input file.');
  }
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
  return absolute;
}

async function resolveExistingInsideRoot(path: string): Promise<string> {
  const root = await resolveLocalRoot();
  const lexical = resolveLexicallyInsideRoot(path, root);
  const absolute = await realpath(lexical);
  assertInsideRoot(absolute, root);
  return absolute;
}

async function resolveOutputInsideRoot(path: string): Promise<string> {
  const root = await resolveLocalRoot();
  const lexical = resolveLexicallyInsideRoot(path, root);
  const parent = await realpath(dirname(lexical));
  assertInsideRoot(parent, root);
  const absolute = resolve(parent, basename(lexical));
  assertInsideRoot(absolute, root);
  return absolute;
}

async function resolveLocalRoot(): Promise<string> {
  return realpath(resolve(process.env.NODESLIDE_LOCAL_ROOT ?? process.cwd()));
}

function resolveLexicallyInsideRoot(path: string, root: string): string {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  assertInsideRoot(absolute, root);
  return absolute;
}

function assertInsideRoot(absolute: string, root: string): void {
  const fromRoot = relative(root, absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Path must stay within NODESLIDE_LOCAL_ROOT (${root}).`);
  }
}

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function requiredToolString(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
