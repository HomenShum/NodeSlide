import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  NODESLIDE_CONVEX_URL,
  NODESLIDE_MCP_PACKAGE,
  buildNodeSlideCodexConfig,
  buildNodeSlideMcpJson,
  resolveNodeslideConvexUrl,
} from './NodeSlideConnectionsDialog';

const env = {
  PARITY_CONVEX_URL: NODESLIDE_CONVEX_URL,
  PARITY_DASHBOARD: 'disabled',
  NODESLIDE_BYOK_MODEL: 'z-ai/glm-5.2',
  OPENROUTER_API_KEY: 'qa-placeholder',
};

describe('NodeSlide coding-agent connection config', () => {
  it("points MCP clients at the running app's own Convex deployment when it is known", () => {
    // The deckId + ownerAccessKey this dialog hands out live in whatever deployment
    // VITE_CONVEX_URL points at in that build (production: agile-stoat-411, not
    // parity-studio's blissful-pig-998) — see the comment on NODESLIDE_CONVEX_URL.
    expect(resolveNodeslideConvexUrl('https://agile-stoat-411.convex.cloud')).toBe(
      'https://agile-stoat-411.convex.cloud',
    );
    expect(resolveNodeslideConvexUrl('  https://agile-stoat-411.convex.cloud  ')).toBe(
      'https://agile-stoat-411.convex.cloud',
    );
  });

  it('falls back to the documented parity-studio literal when VITE_CONVEX_URL is unset', () => {
    const fallback = 'https://blissful-pig-998.convex.cloud';
    expect(resolveNodeslideConvexUrl(undefined)).toBe(fallback);
    expect(resolveNodeslideConvexUrl('')).toBe(fallback);
  });

  it('pins Claude and Cursor to the production-served MCP package', () => {
    const config = JSON.parse(buildNodeSlideMcpJson(env, 'npx.cmd'));

    expect(config.mcpServers.nodeslide.command).toBe('npx.cmd');
    expect(config.mcpServers.nodeslide.args).toEqual(['-y', NODESLIDE_MCP_PACKAGE]);
    expect(config.mcpServers.nodeslide.env).toEqual(env);
    expect(JSON.stringify(config)).not.toContain('parity-studio-mcp@latest');
  });

  it('emits a Codex config with writes approval and explicit production routing', () => {
    const config = buildNodeSlideCodexConfig(env, 'npx.cmd');

    expect(config).toContain(`args = ["-y", "${NODESLIDE_MCP_PACKAGE}"]`);
    expect(config).toContain('default_tools_approval_mode = "writes"');
    expect(config).toContain(`PARITY_CONVEX_URL = "${NODESLIDE_CONVEX_URL}"`);
    expect(config).toContain('PARITY_DASHBOARD = "disabled"');
    expect(config).not.toContain('parity-studio-mcp@latest');
  });

  it('keeps the pinned MCP tarball in Vercel deployments', () => {
    const vercelIgnore = readFileSync(
      new URL('../../../../.vercelignore', import.meta.url),
      'utf8',
    );
    const archiveIgnore = vercelIgnore.indexOf('*.tgz');
    const packageInclude = vercelIgnore.indexOf('!public/downloads/parity-studio-mcp-*.tgz');

    expect(archiveIgnore).toBeGreaterThanOrEqual(0);
    expect(packageInclude).toBeGreaterThan(archiveIgnore);
  });
});
