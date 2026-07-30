import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RecipeLang production reference source', () => {
  it('lets a release engineer reproduce the checked-in artifact from a source Vercel uploads', async () => {
    const ignore = await readFile(resolve('.vercelignore'), 'utf8');
    const buildScript = await readFile(resolve('scripts/build-recipelang-reference.mjs'), 'utf8');
    expect(ignore).toContain('benchmarks/');
    expect(ignore).not.toMatch(/^packages\/?$/m);
    expect(buildScript).toContain(
      "resolve('packages/recipelang/reference/edge-data-contract.recipe.yaml')",
    );
    await expect(
      readFile(resolve('packages/recipelang/reference/edge-data-contract.recipe.yaml'), 'utf8'),
    ).resolves.toContain('schemaVersion: recipelang/v1');
  });

  it('keeps the shipped reference identical to the benchmark corpus copy', async () => {
    const shipped = await readFile(
      resolve('packages/recipelang/reference/edge-data-contract.recipe.yaml'),
      'utf8',
    );
    const benchmark = await readFile(
      resolve('benchmarks/recipelang/edge-data-contract.recipe.yaml'),
      'utf8',
    );
    expect(shipped).toBe(benchmark);
  });
});
