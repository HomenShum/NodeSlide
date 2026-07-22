import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ledger = JSON.parse(
  await readFile('docs/demo/nodeslide-artifact-semantics-v3/v2-issue-ledger.json', 'utf8'),
);
const catalog = JSON.parse(await readFile('public/artifact-atlas-v2/catalog.json', 'utf8'));

describe('Artifact Atlas V2 issue ledger', () => {
  it('binds every repaired issue to the exact inspected Atlas', async () => {
    expect(ledger.schemaVersion).toBe('nodeslide.artifact-atlas-v2-issue-ledger/v1');
    expect(ledger.issueCount).toBe(ledger.issues.length);
    expect(ledger.issues).toHaveLength(23);
    expect(new Set(ledger.issues.map((entry) => entry.issueCode)).size).toBe(23);
    expect(ledger.issues.every((entry) => entry.repairStatus === 'repaired')).toBe(true);

    const pptx = await readFile(ledger.atlasPptx);
    const inspection = await readFile(ledger.visualInspection);
    expect(ledger.atlasPptxDigest).toBe(`sha256:${sha256(pptx)}`);
    expect(ledger.visualInspectionDigest).toBe(`sha256:${sha256(inspection)}`);
  });

  it('maps each slide issue to the canonical catalog artifact', () => {
    const artifactsBySlide = new Map(
      catalog.entries.map((entry) => [Number(entry.number), entry.id]),
    );
    for (const issue of ledger.issues) {
      if (issue.slide === null) {
        expect(issue.artifactId).toBe('complete-deck');
        continue;
      }
      expect(artifactsBySlide.get(issue.slide)).toBe(issue.artifactId);
      expect(issue.validatorOwner).toMatch(/^[a-z0-9][a-z0-9/-]+$/u);
      expect(issue.repairEvidence.length).toBeGreaterThan(20);
    }
  });
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
