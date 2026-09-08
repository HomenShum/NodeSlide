import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MANIFEST = fileURLToPath(
  new URL('../benchmarks/production-scenarios/v1/scenarios.json', import.meta.url),
);

const REQUIRED_DOMAINS = ['research', 'finance', 'startup', 'operating', 'governance'];
const REQUIRED_DELIVERY_FILES = ['pptx', 'html', 'nodeslide.json', 'receipt.json'];

export async function validateProductionScenarios(manifestPath = DEFAULT_MANIFEST) {
  const manifest = JSON.parse(await readFile(path.resolve(manifestPath), 'utf8'));
  const issues = [];
  if (manifest.schemaVersion !== 'nodeslide.production-scenarios/v1') {
    issues.push('schemaVersion must be nodeslide.production-scenarios/v1');
  }
  const scenarios = Array.isArray(manifest.scenarios) ? manifest.scenarios : [];
  const domains = scenarios.map((scenario) => scenario.domain);
  if (scenarios.length !== REQUIRED_DOMAINS.length) {
    issues.push(`expected ${REQUIRED_DOMAINS.length} scenarios, received ${scenarios.length}`);
  }
  for (const domain of REQUIRED_DOMAINS) {
    if (domains.filter((candidate) => candidate === domain).length !== 1) {
      issues.push(`domain ${domain} must appear exactly once`);
    }
  }
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length) {
    issues.push('scenario ids must be unique');
  }
  for (const file of REQUIRED_DELIVERY_FILES) {
    if (!manifest.sharedAcceptance?.deliveryFiles?.includes(file)) {
      issues.push(`shared delivery files must include ${file}`);
    }
  }
  if ((manifest.sharedAcceptance?.minimumDistinctSilhouettes ?? 0) < 4) {
    issues.push('minimumDistinctSilhouettes must be at least 4');
  }
  if ((manifest.sharedAcceptance?.maximumAdjacentSilhouetteSimilarity ?? 1) > 0.85) {
    issues.push('maximumAdjacentSilhouetteSimilarity must fail at or below 0.85');
  }
  if (!manifest.sharedAcceptance?.mustFailClosedOn?.includes('failed_diversity_gate')) {
    issues.push('failed diversity must be a fail-closed condition');
  }
  for (const scenario of scenarios) {
    const prefix = scenario.id ?? '<missing-id>';
    if (!scenario.persona || !scenario.jobToFinish || !scenario.brief) {
      issues.push(`${prefix} must name a persona, jobToFinish, and brief`);
    }
    if (!Number.isInteger(scenario.acceptance?.slideCount) || scenario.acceptance.slideCount < 6) {
      issues.push(`${prefix} must require an integer slideCount of at least 6`);
    }
    if ((scenario.acceptance?.requiredArtifacts?.length ?? 0) < 4) {
      issues.push(`${prefix} must require at least four semantic artifacts`);
    }
    if ((scenario.acceptance?.narrativeBeats?.length ?? 0) < 5) {
      issues.push(`${prefix} must define at least five narrative beats`);
    }
    if (!scenario.acceptance?.visualMetaphor) {
      issues.push(`${prefix} must define a transforming visual metaphor`);
    }
    if ((scenario.acceptance?.truthRules?.length ?? 0) < 3) {
      issues.push(`${prefix} must define at least three truth rules`);
    }
    if ((scenario.adversarial?.length ?? 0) < 3) {
      issues.push(`${prefix} must define at least three adversarial cases`);
    }
    if ((scenario.sustained?.repeatRuns ?? 0) < 12) {
      issues.push(`${prefix} must define a sustained run of at least 12 repetitions`);
    }
  }
  return { manifest, issues, valid: issues.length === 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateProductionScenarios(process.argv[2]);
  process.stdout.write(
    `${JSON.stringify({ valid: result.valid, scenarioCount: result.manifest.scenarios?.length ?? 0, issues: result.issues }, null, 2)}\n`,
  );
  if (!result.valid) process.exitCode = 1;
}
