import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { validateProductionScenarios } from '../validate-production-scenarios.mjs';

const manifestUrl = new URL(
  '../../benchmarks/production-scenarios/v1/scenarios.json',
  import.meta.url,
);
const original = JSON.parse(await readFile(manifestUrl, 'utf8'));
const scratch = new URL('../../.tmp-production-scenarios-test.json', import.meta.url);

afterEach(async () => {
  await rm(scratch, { force: true });
});

describe('production scenario acceptance pack', () => {
  it('covers one complete job for each target domain with burst, degraded, and sustained checks', async () => {
    const result = await validateProductionScenarios(fileURLToPath(manifestUrl));

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.manifest.scenarios.map((scenario) => scenario.domain).sort()).toEqual([
      'finance',
      'governance',
      'operating',
      'research',
      'startup',
    ]);
    for (const scenario of result.manifest.scenarios) {
      expect(scenario.adversarial.length).toBeGreaterThanOrEqual(3);
      expect(scenario.sustained.repeatRuns).toBeGreaterThanOrEqual(12);
    }
  });

  it('refuses a green result when a governance deck fails diversity or loses its release gate', async () => {
    const broken = structuredClone(original);
    broken.sharedAcceptance.mustFailClosedOn = broken.sharedAcceptance.mustFailClosedOn.filter(
      (code) => code !== 'failed_diversity_gate',
    );
    broken.scenarios.find(
      (scenario) => scenario.domain === 'governance',
    ).acceptance.requiredArtifacts = ['risk-matrix'];
    await writeFile(scratch, `${JSON.stringify(broken)}\n`, 'utf8');

    const result = await validateProductionScenarios(fileURLToPath(scratch));

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('failed diversity must be a fail-closed condition');
    expect(result.issues).toContain(
      'governance-release-gate must require at least four semantic artifacts',
    );
  });
});
