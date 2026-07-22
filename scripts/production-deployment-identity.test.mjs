import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderConvexBuildIdentitySource } from './lib/convex-build-identity-source.mjs';
import {
  assertNodeSlideProductionDeployKey,
  captureNodeSlideConvexBuildIdentity,
  captureWebDeploymentIdentity,
  requiredExactMainSha,
  requiredNodeSlideProductionOrigin,
  requiredNodeSlideWorkflowRun,
  validateNodeSlideBuiltHtmlIdentity,
  validateNodeSlideConvexBuildIdentity,
  validateNodeSlideVercelProjectBinding,
  verifyNodeSlideDeploymentRun,
  verifyNodeSlideExactMainSource,
} from './lib/production-deployment-identity.mjs';

const sha = 'a'.repeat(40);
const runUrl = 'https://github.com/HomenShum/NodeSlide/actions/runs/123456';

afterEach(() => vi.unstubAllGlobals());

describe('exact production deployment identity', () => {
  it('accepts only the exact main SHA, workflow URL, and canonical production origin', () => {
    expect(requiredExactMainSha(sha, 'SHA')).toBe(sha);
    expect(requiredNodeSlideWorkflowRun(runUrl, 'RUN')).toMatchObject({ id: '123456' });
    expect(requiredNodeSlideProductionOrigin('https://nodeslide.vercel.app/', 'ORIGIN').href).toBe(
      'https://nodeslide.vercel.app/',
    );
    expect(() => requiredExactMainSha('abc', 'SHA')).toThrow(/40-character main SHA/i);
    expect(() => requiredNodeSlideWorkflowRun(`${runUrl}?forged=1`, 'RUN')).toThrow(
      /exact GitHub Actions run URL/i,
    );
    expect(() =>
      requiredNodeSlideProductionOrigin('https://preview.example.test/', 'ORIGIN'),
    ).toThrow(/canonical NodeSlide production origin/i);
    expect(() =>
      assertNodeSlideProductionDeployKey(`prod:agile-stoat-411|${'x'.repeat(32)}`),
    ).not.toThrow();
    expect(() => assertNodeSlideProductionDeployKey('prod:agile-stoat-411|short')).toThrow(
      /pinned NodeSlide production deployment/i,
    );
    expect(() => assertNodeSlideProductionDeployKey(`prod:different|${'x'.repeat(32)}`)).toThrow(
      /pinned NodeSlide production deployment/i,
    );
  });

  it('verifies a successful exact-main Deploy production run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          id: 123456,
          html_url: runUrl,
          repository: { full_name: 'HomenShum/NodeSlide' },
          // A top-level `run-name` replaces the API's `name` field too. The
          // workflow path and exact SHA-bound display title are the stable
          // workflow identity signals.
          name: `Deploy production - ${sha}`,
          path: '.github/workflows/deploy-production.yml',
          display_title: `Deploy production - ${sha}`,
          event: 'workflow_run',
          head_branch: 'main',
          // workflow_run metadata may point at a newer default-branch head;
          // display_title is the workflow-owned deployed-source attestation.
          head_sha: 'b'.repeat(40),
          status: 'completed',
          conclusion: 'success',
        }),
      ),
    );
    await expect(
      verifyNodeSlideDeploymentRun(requiredNodeSlideWorkflowRun(runUrl, 'RUN'), sha),
    ).resolves.toMatchObject({
      workflow: `Deploy production - ${sha}`,
      headSha: 'b'.repeat(40),
      sourceCommitSha: sha,
      status: 'completed',
      conclusion: 'success',
    });
  });

  it('rejects a red or wrong-SHA deployment run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          id: 123456,
          html_url: runUrl,
          repository: { full_name: 'HomenShum/NodeSlide' },
          name: 'Deploy production',
          path: '.github/workflows/deploy-production.yml',
          display_title: `Deploy production - ${'b'.repeat(40)}`,
          event: 'workflow_run',
          head_branch: 'main',
          head_sha: 'b'.repeat(40),
          status: 'completed',
          conclusion: 'failure',
        }),
      ),
    );
    await expect(
      verifyNodeSlideDeploymentRun(requiredNodeSlideWorkflowRun(runUrl, 'RUN'), sha),
    ).rejects.toThrow(/not a successful exact-main/i);
  });

  it('requires the commit to be current main and to have a successful trusted CI push', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ref: 'refs/heads/main', object: { type: 'commit', sha } }),
        )
        .mockResolvedValueOnce(
          Response.json({
            workflow_runs: [
              {
                id: 987,
                html_url: 'https://github.com/HomenShum/NodeSlide/actions/runs/987',
                repository: { full_name: 'HomenShum/NodeSlide' },
                name: 'CI',
                path: '.github/workflows/ci.yml',
                event: 'push',
                head_branch: 'main',
                head_sha: sha,
                status: 'completed',
                conclusion: 'success',
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ ref: 'refs/heads/main', object: { type: 'commit', sha } }),
        ),
    );
    await expect(verifyNodeSlideExactMainSource(sha, 'g'.repeat(40))).resolves.toMatchObject({
      commitSha: sha,
      ciRunId: '987',
    });
  });

  it('rejects an exact-main receipt when main moves during the trusted CI lookup', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ref: 'refs/heads/main', object: { type: 'commit', sha } }),
        )
        .mockResolvedValueOnce(
          Response.json({
            workflow_runs: [
              {
                id: 987,
                html_url: 'https://github.com/HomenShum/NodeSlide/actions/runs/987',
                repository: { full_name: 'HomenShum/NodeSlide' },
                name: 'CI',
                path: '.github/workflows/ci.yml',
                event: 'push',
                head_branch: 'main',
                head_sha: sha,
                status: 'completed',
                conclusion: 'success',
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            ref: 'refs/heads/main',
            object: { type: 'commit', sha: 'b'.repeat(40) },
          }),
        ),
    );
    await expect(verifyNodeSlideExactMainSource(sha, 'g'.repeat(40))).rejects.toThrow(
      /main changed/i,
    );
  });

  it('rejects a stale main commit before any production mutation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ref: 'refs/heads/main',
          object: { type: 'commit', sha: 'b'.repeat(40) },
        }),
      ),
    );
    await expect(verifyNodeSlideExactMainSource(sha, 'g'.repeat(40))).rejects.toThrow(
      /no longer the current/i,
    );
  });

  it('binds live HTML and every same-origin bundle to the embedded commit', async () => {
    const origin = new URL('https://nodeslide.vercel.app/');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url === origin.href) {
          return new Response(
            `<meta name="nodeslide-build-sha" content="${sha}"><script src="/assets/app.js"></script><link href="/assets/app.css">`,
          );
        }
        if (url.endsWith('/assets/app.js')) return new Response('console.log("bound")');
        if (url.endsWith('/assets/app.css')) return new Response('body{color:black}');
        return new Response('missing', { status: 404 });
      }),
    );
    const identity = await captureWebDeploymentIdentity(origin, sha);
    expect(identity.embeddedCommitSha).toBe(sha);
    expect(identity.assets.map((asset) => asset.path)).toEqual([
      '/assets/app.css',
      '/assets/app.js',
    ]);
    expect(identity.assets.every((asset) => asset.digest.startsWith('sha256:'))).toBe(true);
  });

  it('rejects live HTML with a different or missing build identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<script src="/app.js"></script>')),
    );
    await expect(
      captureWebDeploymentIdentity(new URL('https://nodeslide.vercel.app/'), sha),
    ).rejects.toThrow(/build identity/i);
  });

  it('bounds live deployment HTML, asset count, and asset bytes', async () => {
    const origin = new URL('https://nodeslide.vercel.app/');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('oversized', {
          headers: { 'Content-Length': '50000000' },
        }),
      ),
    );
    await expect(captureWebDeploymentIdentity(origin, sha)).rejects.toThrow(/bounded evidence/i);

    const tooManyAssets = Array.from(
      { length: 65 },
      (_, index) => `<script src="/assets/chunk-${index}.js"></script>`,
    ).join('');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        if (String(input) === origin.href) {
          return new Response(`<meta name="nodeslide-build-sha" content="${sha}">${tooManyAssets}`);
        }
        return new Response('asset');
      }),
    );
    await expect(captureWebDeploymentIdentity(origin, sha)).rejects.toThrow(/too many/i);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) =>
        String(input) === origin.href
          ? new Response(
              `<meta name="nodeslide-build-sha" content="${sha}"><script src="/assets/app.js"></script>`,
            )
          : new Response('oversized', { headers: { 'Content-Length': '50000000' } }),
      ),
    );
    await expect(captureWebDeploymentIdentity(origin, sha)).rejects.toThrow(/bounded evidence/i);
  });

  it('validates local web and protected Vercel project bindings without returning secrets', () => {
    expect(
      validateNodeSlideBuiltHtmlIdentity(`<meta name="nodeslide-build-sha" content="${sha}">`, sha),
    ).toBe(sha);
    expect(() =>
      validateNodeSlideBuiltHtmlIdentity(
        `<meta name="nodeslide-build-sha" content="${'b'.repeat(40)}">`,
        sha,
      ),
    ).toThrow(/frontend build identity/i);

    expect(
      validateNodeSlideVercelProjectBinding(
        { orgId: 'team_exact', projectId: 'prj_exact', projectName: 'nodeslide' },
        'team_exact',
        'prj_exact',
      ),
    ).toEqual({ projectName: 'nodeslide', scoped: true });
    expect(() =>
      validateNodeSlideVercelProjectBinding(
        { orgId: 'team_exact', projectId: 'prj_other', projectName: 'nodeslide' },
        'team_exact',
        'prj_exact',
      ),
    ).toThrow(/Vercel project binding/i);
  });

  it('generates and verifies an exact backend identity without accepting the dev placeholder', () => {
    expect(renderConvexBuildIdentitySource(sha)).toContain(`'${sha}' as const`);
    expect(() => renderConvexBuildIdentitySource('development')).toThrow(/40-character/i);
    expect(
      validateNodeSlideConvexBuildIdentity(
        { schemaVersion: 'nodeslide.convex-build-identity/v1', commitSha: sha },
        sha,
      ),
    ).toEqual({ schemaVersion: 'nodeslide.convex-build-identity/v1', commitSha: sha });
    expect(() =>
      validateNodeSlideConvexBuildIdentity(
        { schemaVersion: 'nodeslide.convex-build-identity/v1', commitSha: null },
        sha,
      ),
    ).toThrow(/Convex build identity/i);
  });

  it('retries a transient Convex identity read but fails closed on a persistent mismatch', async () => {
    const transientQuery = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary identity read failure'))
      .mockResolvedValue({
        schemaVersion: 'nodeslide.convex-build-identity/v1',
        commitSha: sha,
      });
    await expect(
      captureNodeSlideConvexBuildIdentity(transientQuery, sha, { attempts: 2, delayMs: 0 }),
    ).resolves.toEqual({
      schemaVersion: 'nodeslide.convex-build-identity/v1',
      commitSha: sha,
    });
    expect(transientQuery).toHaveBeenCalledTimes(2);

    const staleQuery = vi.fn().mockResolvedValue({
      schemaVersion: 'nodeslide.convex-build-identity/v1',
      commitSha: 'b'.repeat(40),
    });
    await expect(
      captureNodeSlideConvexBuildIdentity(staleQuery, sha, { attempts: 3, delayMs: 0 }),
    ).rejects.toThrow(/Convex build identity/i);
    expect(staleQuery).toHaveBeenCalledTimes(3);
  });
});
