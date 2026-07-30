import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  buildDesignRule,
  buildReferenceCandidateReceipt,
  buildReferenceObservation,
  recordDesignRule,
  recordReferenceObservation,
} from '@homenshum/nodekit/reference-loop';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NODESLIDE_NODEKIT_REFERENCE_AUTHORITY,
  authorizeNodeSlideReferenceRelease,
} from '../lib/nodeslide-reference-authority.mjs';

const execFileAsync = promisify(execFile);
const temporaryRepositories = [];
const RENDER_PATH = 'reference/render-proof.json';
const REQUIRED_EVIDENCE = 'evidence://nodeslide/reference-rule';
const NODEKIT_COMMIT = 'ab7c9e69e53e2eb1838f0d854dafb490f960537c';

afterEach(async () => {
  await Promise.all(
    temporaryRepositories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('NodeSlide NodeKit reference authority', () => {
  it('lets the immutable NodeKit verifier authorize an owned-reference candidate', async () => {
    const fixture = await referenceFixture({ origin: 'nodekit-owned' });
    const projection = localProjection(fixture.candidateReceipt, 'FAIL');

    const decision = await authorizeNodeSlideReferenceRelease({
      repoRoot: fixture.root,
      candidateReceipt: fixture.candidateReceipt,
      ruleIds: [fixture.rule.ruleId],
      profile: 'nodeslide',
      projection,
    });

    expect(decision).toMatchObject({
      authoritative: true,
      releaseAuthority: '@homenshum/nodekit/reference-loop',
      authoritySourceCommit: NODEKIT_COMMIT,
      verdict: 'PASS',
      findings: [],
      projection: {
        authoritative: false,
        projectionVerdict: 'FAIL',
        aligned: true,
      },
    });
    expect(decision.authorityReceipt?.receiptId).toMatch(/^score_[0-9a-f]{24}$/u);
    expect(decision.authorityReceiptPath).toMatch(
      /^\.nodekit\/references\/scores\/[0-9a-f]{64}\.json$/u,
    );
    expect(decision.decisionDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  }, 15_000);

  it('blocks a plain local Mobbin PASS when the candidate commit has no signed external run', async () => {
    const fixture = await referenceFixture({ origin: 'mobbin-without-attestation' });
    const projection = localProjection(fixture.candidateReceipt, 'PASS');

    const decision = await authorizeNodeSlideReferenceRelease({
      repoRoot: fixture.root,
      candidateReceipt: fixture.candidateReceipt,
      ruleIds: [fixture.rule.ruleId],
      profile: 'nodeslide',
      projection,
    });

    expect(decision).toMatchObject({
      authoritative: true,
      verdict: 'FAIL',
      authorityReceipt: null,
      authorityReceiptPath: null,
      projection: {
        authoritative: false,
        projectionVerdict: 'PASS',
        aligned: true,
      },
    });
    expect(decision.findings.join(' ')).toMatch(
      /requires exactly one tracked valid external run/iu,
    );
  }, 15_000);

  it('keeps one immutable authority receipt across retry bursts and sustained worker retries', async () => {
    const fixture = await referenceFixture({ origin: 'nodekit-owned' });
    const request = {
      repoRoot: fixture.root,
      candidateReceipt: fixture.candidateReceipt,
      ruleIds: [fixture.rule.ruleId],
      profile: 'nodeslide',
      projection: localProjection(fixture.candidateReceipt, 'PASS'),
    };

    const burst = await Promise.all(
      Array.from({ length: 4 }, () => authorizeNodeSlideReferenceRelease(request)),
    );
    const sustained = [];
    for (let index = 0; index < 4; index += 1) {
      sustained.push(await authorizeNodeSlideReferenceRelease(request));
    }
    const decisions = [...burst, ...sustained];
    const storedReceipts = await readdir(
      path.join(fixture.root, '.nodekit', 'references', 'scores'),
    );

    expect(decisions).toHaveLength(8);
    expect(decisions.every((decision) => decision.verdict === 'PASS')).toBe(true);
    expect(new Set(decisions.map((decision) => decision.decisionDigest)).size).toBe(1);
    expect(new Set(decisions.map((decision) => decision.authorityReceiptPath)).size).toBe(1);
    expect(storedReceipts).toHaveLength(1);
  }, 30_000);

  it('pins the server authority to the exact NodeKit Git commit and keeps it out of shared code', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    const packageLock = JSON.parse(
      await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'),
    );
    const sharedSource = await readFile(
      new URL('../../shared/nodeslideReferenceKnowledge.ts', import.meta.url),
      'utf8',
    );
    const expectedDependency = `git+https://github.com/HomenShum/node-platform.git#${NODEKIT_COMMIT}`;

    expect(packageJson.dependencies['@homenshum/nodekit']).toBe(expectedDependency);
    expect(packageLock.packages['node_modules/@homenshum/nodekit'].resolved).toMatch(
      new RegExp(`#${NODEKIT_COMMIT}$`, 'u'),
    );
    expect(NODESLIDE_NODEKIT_REFERENCE_AUTHORITY.sourceCommit).toBe(NODEKIT_COMMIT);
    expect(sharedSource).not.toMatch(
      /(?:from|import\s*\()\s*['"]@homenshum\/nodekit\/reference-loop['"]/u,
    );
  });
});

async function referenceFixture({ origin }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodeslide-nodekit-authority-'));
  temporaryRepositories.push(root);
  await mkdir(path.join(root, 'reference'), { recursive: true });
  await writeJson(path.join(root, RENDER_PATH), {
    rendered: true,
    surface: 'nodeslide',
  });
  await writeJson(path.join(root, 'reference', 'trust-policy.json'), {
    schemaVersion: 'nodekit.reference-trust-policy/v1',
    credentials: {},
  });
  await git(root, ['init', '--quiet']);
  await git(root, ['config', 'user.name', 'NodeSlide Authority Test']);
  await git(root, ['config', 'user.email', 'nodeslide@example.test']);
  await commit(root, ['reference'], 'initialize candidate proof');

  const observationDraft =
    origin === 'nodekit-owned' ? ownedObservationDraft() : unsignedMobbinObservationDraft();
  let observation;
  if (origin === 'nodekit-owned') {
    observation = (await recordReferenceObservation(root, observationDraft)).observation;
  } else {
    observation = buildReferenceObservation(observationDraft);
    await writeJson(
      path.join(root, 'reference', 'corpus', 'observations', `${observation.contentDigest}.json`),
      observation,
    );
  }

  const ruleDraft = {
    schemaVersion: 'nodekit.reference-loop-design-rule/v1',
    sourceObservationRefs: [
      {
        observationId: observation.observationId,
        observationDigest: observation.contentDigest,
        factIds: [observation.facts[0].factId],
      },
    ],
    statement: 'A cited reference fact must be visible in the exact rendered candidate.',
    problemTags: ['uncitable-reference'],
    intentTags: ['bind-evidence'],
    layoutTags: ['ordered-surface'],
    interactionTags: ['review-before-release'],
    mechanismHypothesis: 'Exact evidence bindings make the release independently replayable.',
    appliesWhen: ['A reference influences a candidate.'],
    doesNotApplyWhen: ['The candidate is explicitly novel by intent.'],
    confidence: {
      observation: 'high',
      audienceFit: 'medium',
      causal: 'low',
    },
    requiredEvidence: [REQUIRED_EVIDENCE],
  };
  let rule;
  if (origin === 'nodekit-owned') {
    rule = (await recordDesignRule(root, ruleDraft)).rule;
  } else {
    rule = buildDesignRule(ruleDraft);
    await writeJson(
      path.join(root, 'reference', 'corpus', 'rules', `${rule.contentDigest}.json`),
      rule,
    );
  }
  await writeJson(path.join(root, 'reference', 'profiles', 'nodeslide.json'), {
    schemaVersion: 'nodekit.reference-profile-manifest/v1',
    profile: 'nodeslide',
    rules: [{ ruleId: rule.ruleId, ruleDigest: rule.contentDigest }],
  });
  await commit(
    root,
    ['reference/corpus', 'reference/profiles', 'reference/trust-policy.json'],
    'bind NodeKit reference profile',
  );

  const candidateCommit = await gitOutput(root, ['rev-parse', 'HEAD']);
  const renderBytes = await readFile(path.join(root, RENDER_PATH));
  const candidateReceipt = buildReferenceCandidateReceipt({
    schemaVersion: 'nodekit.reference-candidate-receipt/v1',
    candidateId: 'candidate_nodeslide_reference_authority',
    candidateCommit,
    renderArtifacts: [
      {
        path: RENDER_PATH,
        sha256: createHash('sha256').update(renderBytes).digest('hex'),
        bytes: renderBytes.length,
      },
    ],
    evaluations: [
      {
        ruleId: rule.ruleId,
        result: 'satisfied',
        factIds: [observation.facts[0].factId],
        evidenceRefs: [REQUIRED_EVIDENCE],
      },
    ],
  });
  return { root, observation, rule, candidateReceipt };
}

function ownedObservationDraft() {
  return {
    schemaVersion: 'nodekit.reference-loop-observation/v1',
    source: {
      origin: 'nodekit-owned',
      sourceUrl: 'https://nodeslide.local/reference/owned',
      sourcePolicyId: 'nodekit-owned/v1',
      firstSeenAt: '2026-07-28T00:00:00.000Z',
      lastVerifiedAt: '2026-07-28T00:00:00.000Z',
      accessMode: 'owned',
    },
    problemTags: ['uncitable-reference'],
    intentTags: ['bind-evidence'],
    layoutTags: ['ordered-surface'],
    interactionTags: ['review-before-release'],
    facts: [
      {
        factId: 'fact_nodeslide_owned_count',
        kind: 'count',
        subject: 'NodeSlide-owned reference fixture',
        relation: 'contains',
        object: 1,
        unit: 'facts',
        locatorDescription: 'The owned reference fixture.',
      },
    ],
    prohibitedMaterial: {
      storedPixels: false,
      cachedSourcePayload: false,
      embeddingStored: false,
    },
  };
}

function unsignedMobbinObservationDraft() {
  const inspectedAt = new Date().toISOString();
  return {
    schemaVersion: 'nodekit.reference-loop-observation/v1',
    source: {
      origin: 'mobbin',
      sourceUrl: 'https://mobbin.com/flows/033bd9d8-9418-4c27-b9f5-9a2a072a0937',
      sourcePolicyId: 'atlas:mobbin/v1',
      firstSeenAt: inspectedAt,
      lastVerifiedAt: inspectedAt,
      accessMode: 'remote-mcp',
    },
    problemTags: ['presentation-start-state'],
    intentTags: ['start-presentation'],
    layoutTags: ['three-screen-flow'],
    interactionTags: ['ordered-creation-flow'],
    facts: [
      {
        factId: 'fact_mobbin_screen_count',
        kind: 'count',
        subject: 'Starting a presentation in Figma Slides',
        relation: 'contains',
        object: 3,
        unit: 'screens',
        locatorDescription: 'Flow-level screen count from authenticated live inspection.',
      },
    ],
    prohibitedMaterial: {
      storedPixels: false,
      cachedSourcePayload: false,
      embeddingStored: false,
    },
  };
}

function localProjection(candidateReceipt, projectionVerdict) {
  return {
    candidateId: candidateReceipt.candidateId,
    commitSha: candidateReceipt.candidateCommit,
    projectionVerdict,
    projectionDigest: `sha256:${'a'.repeat(64)}`,
    provenanceMode: 'REFERENCE_CHAIN',
    externalReferenceRunDigests: [`sha256:${'b'.repeat(64)}`],
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function commit(root, paths, message) {
  await git(root, ['add', '--', ...paths]);
  await execFileAsync('git', ['commit', '--quiet', '-m', message], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-07-28T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-07-28T00:00:00Z',
    },
  });
}

async function git(root, args) {
  await execFileAsync('git', args, { cwd: root });
}

async function gitOutput(root, args) {
  const result = await execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
  return result.stdout.trim();
}
