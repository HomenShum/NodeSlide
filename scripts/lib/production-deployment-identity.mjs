import { createHash } from 'node:crypto';

export const NODESLIDE_PRODUCTION_ORIGIN = 'https://nodeslide.vercel.app/';
export const NODESLIDE_REPOSITORY = 'HomenShum/NodeSlide';
export const NODESLIDE_DEPLOY_WORKFLOW_PATH = '.github/workflows/deploy-production.yml';
export const NODESLIDE_CI_WORKFLOW_PATH = '.github/workflows/ci.yml';
export const NODESLIDE_DEPLOY_RUN_TITLE_PREFIX = 'Deploy production - ';
export const NODESLIDE_DEPLOYMENT_HTML_MAX_BYTES = 2_000_000;
export const NODESLIDE_DEPLOYMENT_ASSET_MAX_BYTES = 32_000_000;
export const NODESLIDE_DEPLOYMENT_ASSET_MAX_COUNT = 64;
export const NODESLIDE_DEPLOYMENT_TOTAL_ASSET_MAX_BYTES = 128_000_000;

export function requiredNodeSlideProductionOrigin(value, envName) {
  let url;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(`${envName} must be the canonical NodeSlide production origin.`);
  }
  if (url.href !== NODESLIDE_PRODUCTION_ORIGIN) {
    throw new Error(`${envName} must be the canonical NodeSlide production origin.`);
  }
  return url;
}

export function requiredExactMainSha(value, envName) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${envName} must be the exact 40-character main SHA.`);
  }
  return value;
}

export function assertNodeSlideProductionDeployKey(value) {
  if (typeof value !== 'string' || !/^prod:agile-stoat-411\|[^\s|]{16,}$/u.test(value)) {
    throw new Error(
      'CONVEX_DEPLOY_KEY must be scoped to the pinned NodeSlide production deployment.',
    );
  }
}

export function nodeSlideDeploymentRunTitle(commitSha) {
  return `${NODESLIDE_DEPLOY_RUN_TITLE_PREFIX}${requiredExactMainSha(commitSha, 'commitSha')}`;
}

export function nodeSlideDeploymentRunSourceSha(value) {
  if (typeof value !== 'string' || !value.startsWith(NODESLIDE_DEPLOY_RUN_TITLE_PREFIX)) {
    throw new Error('Deployment run title does not attest an exact source commit.');
  }
  return requiredExactMainSha(
    value.slice(NODESLIDE_DEPLOY_RUN_TITLE_PREFIX.length),
    'deployment run source SHA',
  );
}

export function requiredNodeSlideWorkflowRun(value, envName) {
  let url;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(`${envName} must be an exact GitHub Actions run URL.`);
  }
  const match = url.pathname.match(/^\/HomenShum\/NodeSlide\/actions\/runs\/(\d+)\/?$/u);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match
  ) {
    throw new Error(`${envName} must be an exact GitHub Actions run URL.`);
  }
  return { id: match[1], url: url.href };
}

export function validateNodeSlideConvexBuildIdentity(value, expectedCommitSha) {
  if (
    !value ||
    value.schemaVersion !== 'nodeslide.convex-build-identity/v1' ||
    value.commitSha !== expectedCommitSha
  ) {
    throw new Error('Production Convex build identity does not match the expected main commit.');
  }
  return { schemaVersion: value.schemaVersion, commitSha: value.commitSha };
}

export async function captureNodeSlideConvexBuildIdentity(
  query,
  expectedCommitSha,
  // Convex's public HTTP edge can converge after the deploy command and the
  // deployment-local identity check have already succeeded. Keep this window
  // bounded while covering the propagation lag observed in production.
  { attempts = 31, delayMs = 2_000 } = {},
) {
  if (typeof query !== 'function') {
    throw new Error('Production Convex build identity query must be callable.');
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60) {
    throw new Error('Production Convex build identity attempts must be between 1 and 60.');
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5_000) {
    throw new Error('Production Convex build identity retry delay must be between 0 and 5000ms.');
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return validateNodeSlideConvexBuildIdentity(await query(), expectedCommitSha);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error(`Production Convex build identity did not converge after ${attempts} attempts.`, {
    cause: lastError,
  });
}

export async function verifyNodeSlideDeploymentRun(workflowRun, expectedCommitSha) {
  const response = await fetch(
    `https://api.github.com/repos/HomenShum/NodeSlide/actions/runs/${workflowRun.id}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'NodeSlide-production-evidence',
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
    },
  );
  if (!response.ok)
    throw new Error(`GitHub deployment run lookup returned HTTP ${response.status}.`);
  const run = await response.json();
  if (
    run?.html_url !== workflowRun.url ||
    run?.repository?.full_name !== NODESLIDE_REPOSITORY ||
    run?.path !== NODESLIDE_DEPLOY_WORKFLOW_PATH ||
    run?.display_title !== nodeSlideDeploymentRunTitle(expectedCommitSha) ||
    !['workflow_run', 'workflow_dispatch'].includes(run?.event) ||
    run?.head_branch !== 'main' ||
    (run?.event === 'workflow_dispatch' && run?.head_sha !== expectedCommitSha) ||
    run?.status !== 'completed' ||
    run?.conclusion !== 'success'
  ) {
    throw new Error('GitHub deployment run is not a successful exact-main NodeSlide deployment.');
  }
  return {
    id: String(run.id),
    url: run.html_url,
    workflow: run.name,
    workflowPath: run.path,
    displayTitle: run.display_title,
    event: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    sourceCommitSha: expectedCommitSha,
    status: run.status,
    conclusion: run.conclusion,
  };
}

export async function verifyNodeSlideExactMainSource(expectedCommitSha, token) {
  const commitSha = requiredExactMainSha(expectedCommitSha, 'expectedCommitSha');
  if (typeof token !== 'string' || token.length < 16 || /\s/u.test(token)) {
    throw new Error('GITHUB_TOKEN is required to verify the exact main source.');
  }
  const main = await githubJson(
    `https://api.github.com/repos/${NODESLIDE_REPOSITORY}/git/ref/heads/main`,
    token,
    'main ref',
  );
  if (
    main?.ref !== 'refs/heads/main' ||
    main?.object?.type !== 'commit' ||
    main?.object?.sha !== commitSha
  ) {
    throw new Error('Deployment source is no longer the current NodeSlide main commit.');
  }
  const runs = await githubJson(
    `https://api.github.com/repos/${NODESLIDE_REPOSITORY}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=20`,
    token,
    'CI workflow runs',
  );
  const ciRun = Array.isArray(runs?.workflow_runs)
    ? runs.workflow_runs.find(
        (run) =>
          run?.repository?.full_name === NODESLIDE_REPOSITORY &&
          run?.name === 'CI' &&
          run?.path === NODESLIDE_CI_WORKFLOW_PATH &&
          run?.event === 'push' &&
          run?.head_branch === 'main' &&
          run?.head_sha === commitSha &&
          run?.status === 'completed' &&
          run?.conclusion === 'success',
      )
    : undefined;
  if (!ciRun) {
    throw new Error('Current NodeSlide main commit has no successful trusted CI push run.');
  }
  const mainAfterCi = await githubJson(
    `https://api.github.com/repos/${NODESLIDE_REPOSITORY}/git/ref/heads/main`,
    token,
    'main ref recheck',
  );
  if (
    mainAfterCi?.ref !== 'refs/heads/main' ||
    mainAfterCi?.object?.type !== 'commit' ||
    mainAfterCi?.object?.sha !== commitSha
  ) {
    throw new Error('NodeSlide main changed while exact-source evidence was being verified.');
  }
  return {
    commitSha,
    mainRef: main.ref,
    ciRunId: String(ciRun.id),
    ciRunUrl: ciRun.html_url,
  };
}

export function validateNodeSlideBuiltHtmlIdentity(html, expectedCommitSha) {
  const commitSha = requiredExactMainSha(expectedCommitSha, 'expectedCommitSha');
  const embeddedCommitSha =
    String(html).match(
      /<meta\s+name=["']nodeslide-build-sha["']\s+content=["']([0-9a-f]{40})["']\s*\/?\s*>/iu,
    )?.[1] ?? null;
  if (embeddedCommitSha !== commitSha) {
    throw new Error('Frontend build identity does not match the expected main commit.');
  }
  return embeddedCommitSha;
}

export function validateNodeSlideVercelProjectBinding(value, expectedOrgId, expectedProjectId) {
  if (
    typeof expectedOrgId !== 'string' ||
    expectedOrgId.length < 4 ||
    typeof expectedProjectId !== 'string' ||
    expectedProjectId.length < 4 ||
    value?.orgId !== expectedOrgId ||
    value?.projectId !== expectedProjectId ||
    value?.projectName !== 'nodeslide'
  ) {
    throw new Error(
      'Vercel project binding does not match the protected NodeSlide production project.',
    );
  }
  return { projectName: value.projectName, scoped: true };
}

export async function captureWebDeploymentIdentity(origin, expectedCommitSha) {
  const htmlResponse = await fetch(origin.href, { redirect: 'error', cache: 'no-store' });
  if (!htmlResponse.ok) throw new Error(`Production HTML returned HTTP ${htmlResponse.status}.`);
  const htmlBytes = await readBoundedDeploymentResponse(
    htmlResponse,
    NODESLIDE_DEPLOYMENT_HTML_MAX_BYTES,
    'Production HTML',
  );
  const html = htmlBytes.toString('utf8');
  const embeddedCommitSha = validateNodeSlideBuiltHtmlIdentity(html, expectedCommitSha);
  const assets = [];
  const seen = new Set();
  let totalAssetBytes = 0;
  for (const match of html.matchAll(
    /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/giu,
  )) {
    const assetUrl = new URL(match[1], origin);
    if (
      assetUrl.origin !== origin.origin ||
      !/\.(?:css|js)$/u.test(assetUrl.pathname) ||
      seen.has(assetUrl.href)
    ) {
      continue;
    }
    if (seen.size >= NODESLIDE_DEPLOYMENT_ASSET_MAX_COUNT) {
      throw new Error('Production HTML exposed too many same-origin JavaScript/CSS assets.');
    }
    seen.add(assetUrl.href);
    const response = await fetch(assetUrl, { redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new Error(`Production asset returned HTTP ${response.status}.`);
    const bytes = await readBoundedDeploymentResponse(
      response,
      NODESLIDE_DEPLOYMENT_ASSET_MAX_BYTES,
      'Production asset',
    );
    totalAssetBytes += bytes.length;
    if (totalAssetBytes > NODESLIDE_DEPLOYMENT_TOTAL_ASSET_MAX_BYTES) {
      throw new Error('Production assets exceeded their aggregate bounded evidence size.');
    }
    assets.push({
      path: `${assetUrl.pathname}${assetUrl.search}`,
      bytes: bytes.length,
      digest: sha256(bytes),
    });
  }
  assets.sort((left, right) => left.path.localeCompare(right.path));
  if (!assets.some((asset) => asset.path.endsWith('.js'))) {
    throw new Error('Production HTML did not expose a same-origin JavaScript bundle.');
  }
  return {
    embeddedCommitSha,
    html: {
      path: `${origin.pathname}${origin.search}`,
      bytes: htmlBytes.length,
      digest: sha256(htmlBytes),
    },
    assets,
  };
}

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function readBoundedDeploymentResponse(response, maxBytes, label) {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > maxBytes) {
      throw new Error(`${label} exceeded its bounded evidence size.`);
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${label} did not expose a readable response body.`);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeded its bounded evidence size.`);
    }
    chunks.push(Buffer.from(value));
  }
  if (total === 0) throw new Error(`${label} returned an empty response body.`);
  return Buffer.concat(chunks, total);
}

async function githubJson(url, token, label) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'NodeSlide-production-release-gate',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`GitHub ${label} lookup returned HTTP ${response.status}.`);
  return response.json();
}
