import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const workflowDirectory = path.join(root, '.github', 'workflows');

// Each immutable pin below was checked against the action's action.yml at that
// commit: every one declares `using: node24`.
const NODE24_ACTION_PINS = new Map([
  ['actions/checkout', 'df4cb1c069e1874edd31b4311f1884172cec0e10'],
  ['actions/setup-node', '249970729cb0ef3589644e2896645e5dc5ba9c38'],
  ['actions/github-script', 'ed597411d8f924073f98dfc5c65a23a2325f34cd'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
  ['actions/download-artifact', '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'],
]);

describe('production GitHub workflow configuration', () => {
  it('pins every first-party JavaScript action to an approved Node 24 commit', async () => {
    const files = (await readdir(workflowDirectory)).filter((file) => /\.ya?ml$/u.test(file));
    let matchCount = 0;
    for (const file of files) {
      const workflow = await readFile(path.join(workflowDirectory, file), 'utf8');
      for (const [, action, pin] of workflow.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/gu)) {
        expect(pin, `${file}: ${action} must use a full immutable SHA`).toMatch(/^[0-9a-f]{40}$/u);
      }
      const uses = [...workflow.matchAll(/uses:\s+(actions\/[^@\s]+)@([^\s#]+)/gu)];
      for (const [, action, pin] of uses) {
        matchCount += 1;
        expect(pin, `${file}: ${action} must use its approved Node 24 SHA`).toBe(
          NODE24_ACTION_PINS.get(action),
        );
      }
    }
    expect(matchCount).toBeGreaterThan(0);

    const conformance = await readFile(
      path.join(workflowDirectory, 'node-platform-conformance.yml'),
      'utf8',
    );
    expect(conformance).toContain(
      'HomenShum/node-platform/.github/workflows/repo-conformance.yml@5c9aa6443ca8e61dc8886fbf0a0b4a7b72858e63',
    );
  });

  it('keeps production deployment exact-main, CI-coupled, scoped, and dual-stamped', async () => {
    const workflow = await readFile(path.join(workflowDirectory, 'deploy-production.yml'), 'utf8');
    const index = await readFile(path.join(root, 'index.html'), 'utf8');
    const generatedIdentity = await readFile(
      path.join(root, 'convex', 'lib', 'nodeslideBuildIdentity.generated.ts'),
      'utf8',
    );

    expect(workflow).toContain(
      'run-name: Deploy production - ${{ github.event.workflow_run.head_sha || github.sha }}',
    );
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository',
    );
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$DEPLOY_SHA"');
    expect(occurrences(workflow, 'node scripts/verify-github-exact-main.mjs "$DEPLOY_SHA"')).toBe(
      2,
    );
    expect(workflow).toContain('node scripts/verify-production-secret-scopes.mjs');
    expect(workflow).toContain(
      'node scripts/verify-vercel-project-binding.mjs .vercel/project.json',
    );
    expect(workflow).toContain(
      'node scripts/verify-built-web-identity.mjs dist/index.html "$DEPLOY_SHA"',
    );
    expect(workflow).toContain(
      'node scripts/verify-built-web-identity.mjs .vercel/output/static/index.html "$DEPLOY_SHA"',
    );
    expect(workflow).toContain('node scripts/write-convex-build-identity.mjs "$DEPLOY_SHA"');
    expect(workflow).toContain('node scripts/verify-convex-build-identity.mjs "$DEPLOY_SHA"');
    expect(workflow).toContain(
      'node scripts/verify-live-web-identity.mjs "$DEPLOY_SHA" "$PROD_WEB_URL/"',
    );
    expect(
      occurrences(
        workflow,
        'node scripts/verify-deployed-html.mjs .vercel/output/static/index.html',
      ),
    ).toBe(2);
    expect(workflow).toContain(
      'VITE_GIT_SHA: ${{ github.event.workflow_run.head_sha || github.sha }}',
    );
    expect(index).toContain('<meta name="nodeslide-build-sha" content="%VITE_GIT_SHA%" />');
    expect(generatedIdentity).toContain("NODESLIDE_DEPLOYED_BUILD_SHA = 'development'");

    expect(appearsBefore(workflow, 'verify-github-exact-main.mjs', 'npm ci')).toBe(true);
    expect(
      appearsBefore(workflow, 'verify-vercel-project-binding.mjs', 'vercel@56.3.2 build'),
    ).toBe(true);
    expect(appearsBefore(workflow, 'write-convex-build-identity.mjs', 'npx convex deploy')).toBe(
      true,
    );
    expect(appearsBefore(workflow, 'npx convex deploy', 'verify-convex-build-identity.mjs')).toBe(
      true,
    );
    expect(
      appearsBefore(workflow, 'verify-convex-build-identity.mjs', 'vercel@56.3.2 deploy'),
    ).toBe(true);
    expect(appearsBefore(workflow, 'vercel@56.3.2 deploy', 'verify-live-web-identity.mjs')).toBe(
      true,
    );

    const jobEnvironment = workflow.slice(
      workflow.indexOf('    env:'),
      workflow.indexOf('    steps:'),
    );
    expect(jobEnvironment).not.toContain('secrets.');
  });

  it('keeps the Gym tarball out of the strict NodeSlide package directory', async () => {
    const workflow = await readFile(path.join(workflowDirectory, 'ci.yml'), 'utf8');

    expect(workflow).toContain(
      'npm pack --workspace @nodekit/gym-core --pack-destination "$RUNNER_TEMP/node-gym-packages"',
    );
    expect(workflow).toContain(
      'gym_tarballs=("$RUNNER_TEMP"/node-gym-packages/nodekit-gym-core-*.tgz)',
    );
    expect(workflow).toContain('NODESLIDE_PACKAGE_ARTIFACT: ${{ runner.temp }}/nodeslide-packages');
    expect(workflow).not.toContain(
      'npm pack --workspace @nodekit/gym-core --pack-destination "$RUNNER_TEMP/nodeslide-packages"',
    );
  });

  it('checks out deployed code and keeps the complete manual evidence matrix fail closed', async () => {
    const workflow = await readFile(
      path.join(workflowDirectory, 'nightly-production-probe.yml'),
      'utf8',
    );
    const uiCapture = await readFile(
      path.join(root, 'scripts', 'capture-gap-closure-ui-qa.mjs'),
      'utf8',
    );
    const productionProbe = await readFile(path.join(root, 'scripts', 'prod-probe.mjs'), 'utf8');
    const nodeGymUiExecutor = await readFile(
      path.join(root, 'scripts', 'node-gym-ui-executor.mjs'),
      'utf8',
    );
    const fleetCapture = await readFile(
      path.join(root, 'scripts', 'capture-model-fleet-probe.mjs'),
      'utf8',
    );
    const deploymentIdentity = await readFile(
      path.join(root, 'scripts', 'lib', 'production-deployment-identity.mjs'),
      'utf8',
    );

    expect(workflow).toContain('timeout-minutes: 60');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('const title = /^Deploy production - ([0-9a-f]{40})$/;');
    expect(workflow).toContain('source === context.sha');
    expect(workflow).toContain("candidate.path === '.github/workflows/deploy-production.yml'");
    expect(workflow).not.toContain("candidate.name === 'Deploy production'");
    expect(deploymentIdentity).not.toContain("run?.name !== 'Deploy production'");
    expect(workflow).toContain('ref: ${{ steps.deployed.outputs.sha }}');
    expect(
      appearsBefore(workflow, 'id: deployed', 'Check out the exact deployed source commit'),
    ).toBe(true);
    expect(workflow).toContain('Clear checkout-bundled evidence outputs');
    for (const artifact of [
      'artifacts/prod-probe/report.json',
      'artifacts/convex-logs/production.jsonl',
      'artifacts/model-fleet/model-fleet-probe.json',
      'artifacts/model-fleet/free-router-fleet-probe.json',
      'artifacts/model-fleet/free-router-structured-probe.json',
    ]) {
      expect(workflow).toContain(`rm -f ${artifact}`);
    }
    expect(workflow).toContain('rm -rf artifacts/close-all-gaps-20260722/acceptance/ui-qa');
    expect(
      appearsBefore(workflow, 'Clear checkout-bundled evidence outputs', 'Set up Node.js'),
    ).toBe(true);

    const requiredManualStages = [
      ['offered_fleet', 'node scripts/capture-model-fleet-probe.mjs'],
      ['free_text_fleet', 'npm run capture:free-router:prod'],
      ['free_structured_fleet', 'npm run capture:free-router:structured:prod'],
      ['ui_qa', 'node scripts/capture-gap-closure-ui-qa.mjs'],
    ];
    for (const [id, command] of requiredManualStages) {
      expect(workflow).toContain(`id: ${id}`);
      expect(workflow).toContain(command);
      expect(workflow).toContain(`steps.${id}.outcome`);
    }
    for (const artifact of [
      'artifacts/prod-probe/report.json',
      'artifacts/convex-logs/production.jsonl',
      'artifacts/model-fleet/model-fleet-probe.json',
      'artifacts/model-fleet/free-router-fleet-probe.json',
      'artifacts/model-fleet/free-router-structured-probe.json',
      'artifacts/close-all-gaps-20260722/acceptance/ui-qa',
    ]) {
      expect(workflow).toContain(artifact);
    }
    expect(workflow).toContain('At least one bounded production evidence matrix is incomplete.');
    expect(occurrences(productionProbe, 'new ConvexHttpClient(convexUrl.origin)')).toBe(3);
    expect(productionProbe).not.toContain('new ConvexHttpClient(convexUrl.href)');
    expect(occurrences(nodeGymUiExecutor, 'new ConvexHttpClient(targetConvexUrl.origin)')).toBe(2);
    expect(occurrences(nodeGymUiExecutor, 'new ConvexHttpClient(convexUrl.origin)')).toBe(1);
    expect(nodeGymUiExecutor).not.toMatch(/new ConvexHttpClient\([^)]*\.href\)/u);
    for (const evidenceCollector of [productionProbe, fleetCapture, uiCapture]) {
      expect(occurrences(evidenceCollector, 'verifyNodeSlideExactMainSource(')).toBe(2);
    }
    expect(workflow).toContain("const manual = context.eventName === 'workflow_dispatch';");
    expect(workflow).toContain('[ops] Manual NodeSlide production evidence matrix is red');
    expect(workflow).toContain('[ops] Nightly NodeSlide production probe is red');
    expect(uiCapture).toContain('viewport: { width: viewport.width, height: viewport.height }');
    expect(uiCapture).not.toMatch(/viewport:\s*theme ===/u);
  });
});

function occurrences(value, needle) {
  return value.split(needle).length - 1;
}

function appearsBefore(value, first, second) {
  const firstIndex = value.indexOf(first);
  const secondIndex = value.indexOf(second);
  return firstIndex >= 0 && secondIndex > firstIndex;
}
