import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('RecipeLang production reference source', () => {
  it('survives the Vercel upload so production can reproduce the checked-in artifact', async () => {
    const ignore = await readFile(resolve('.vercelignore'), 'utf8');
    const broadIgnore = ignore.indexOf('benchmarks/');
    const sourceException = ignore.indexOf('!benchmarks/recipelang/edge-data-contract.recipe.yaml');
    expect(broadIgnore).toBeGreaterThanOrEqual(0);
    expect(sourceException).toBeGreaterThan(broadIgnore);
    await expect(
      readFile(resolve('benchmarks/recipelang/edge-data-contract.recipe.yaml'), 'utf8'),
    ).resolves.toContain('schemaVersion: recipelang/v1');
  });
});
