import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ATLAS_V2_ARTIFACTS } from './lib/artifact-atlas-v2-definition.mjs';
import { validateArtifactSpec } from './lib/artifact-spec-core.mjs';

describe('Artifact Atlas V2 typed-spec refresh', () => {
  it('keeps every canonical definition valid and digest-identical to the public catalog', async () => {
    const catalog = JSON.parse(await readFile('public/artifact-atlas-v2/catalog.json', 'utf8'));
    const entries = new Map(catalog.entries.map((entry) => [entry.id, entry]));
    for (const artifact of ATLAS_V2_ARTIFACTS) {
      const validation = validateArtifactSpec(artifact.artifactSpec);
      expect(validation.ok, artifact.id).toBe(true);
      expect(entries.get(artifact.id)?.artifactSpec.specDigest, artifact.id).toBe(
        artifact.artifactSpec.specDigest,
      );
      expect(entries.get(artifact.id)?.receipt.specDigest, artifact.id).toBe(validation.specDigest);
    }
  });
});
