import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeSlideTestSnapshot, createNodeSlideTextPatch } from '@nodeslide/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyLocalDeckProposal,
  inspectLocalDeckFile,
  proposeLocalDeckPatch,
} from './localDeckTools.js';

describe('NodeSlide MCP local-file containment', () => {
  let root: string;
  let outside: string;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    previousRoot = process.env.NODESLIDE_LOCAL_ROOT;
    root = await mkdtemp(join(tmpdir(), 'nodeslide-mcp-root-'));
    outside = await mkdtemp(join(tmpdir(), 'nodeslide-mcp-outside-'));
    process.env.NODESLIDE_LOCAL_ROOT = root;
    const snapshot = createNodeSlideTestSnapshot();
    await writeFile(join(root, 'deck.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    await writeFile(
      join(root, 'patch.json'),
      `${JSON.stringify(createNodeSlideTextPatch(snapshot, 'After'), null, 2)}\n`,
    );
  });

  afterEach(async () => {
    if (previousRoot === undefined) process.env.NODESLIDE_LOCAL_ROOT = undefined;
    else process.env.NODESLIDE_LOCAL_ROOT = previousRoot;
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });

  it('refuses an existing output without changing it', async () => {
    const proposed = await proposeLocalDeckPatch('deck.json', 'patch.json', 'proposal.json');
    if (!('proposalId' in proposed)) throw new Error('Expected a stored proposal.');
    await writeFile(join(root, 'occupied.json'), 'sentinel');

    await expect(
      applyLocalDeckProposal('deck.json', 'proposal.json', 'occupied.json', proposed.proposalId),
    ).rejects.toThrow('Refusing to overwrite existing output');
    await expect(readFile(join(root, 'occupied.json'), 'utf8')).resolves.toBe('sentinel');
  });

  it('does not echo malformed JSON contents in tool errors', async () => {
    const marker = 'secret-prefix-must-not-escape';
    await writeFile(join(root, 'malformed.json'), `{"private":"${marker}", nope`);

    let message = '';
    try {
      await inspectLocalDeckFile('malformed.json');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('is not valid JSON.');
    expect(message).not.toContain(marker);
  });

  it('rejects read and write escapes through a symlink or junction', async (context) => {
    await writeFile(
      join(outside, 'deck.json'),
      `${JSON.stringify(createNodeSlideTestSnapshot('deck:outside'), null, 2)}\n`,
    );
    try {
      await symlink(
        outside,
        join(root, 'escape'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if ((error as { code?: unknown }).code === 'EPERM') {
        context.skip();
        return;
      }
      throw error;
    }

    await expect(inspectLocalDeckFile('escape/deck.json')).rejects.toThrow(
      'Path must stay within NODESLIDE_LOCAL_ROOT',
    );
    await expect(
      proposeLocalDeckPatch('deck.json', 'patch.json', 'escape/proposal.json'),
    ).rejects.toThrow('Path must stay within NODESLIDE_LOCAL_ROOT');
    await expect(access(join(outside, 'proposal.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
