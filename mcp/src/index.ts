#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerNodeSlideTools } from './lib/nodeslideTools.js';

const VERSION = '0.1.0';

// Your NodeSlide Convex deployment, e.g. https://your-deployment.convex.cloud.
// Required — no baked default, so the public MCP never points at someone else's backend.
const CONVEX_URL = (process.env.NODESLIDE_CONVEX_URL ?? '').replace(/\/+$/, '');

/**
 * Thin Convex HTTP client. Public (non-`internal`) functions accept POST without
 * auth; the NodeSlide tools call only governed public actions, so every write
 * still passes the server's consent / write-scope / propose-before-mutate gates.
 *
 *   POST {deployment}.convex.cloud/api/{query|mutation|action}
 *   Body: { path: "module:function", args: {...}, format: "json" }
 */
async function convexCall(
  kind: 'query' | 'mutation' | 'action',
  path: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${CONVEX_URL}/api/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  if (!res.ok) {
    throw new Error(`convex ${kind} ${path} -> HTTP ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { status?: string; value?: unknown; errorMessage?: string };
  if (json.status === 'error') {
    throw new Error(`convex ${kind} ${path} -> ${json.errorMessage ?? 'unknown error'}`);
  }
  return json.value;
}

async function main(): Promise<void> {
  if (!CONVEX_URL) {
    console.error(
      'NODESLIDE_CONVEX_URL is required (your Convex deployment, e.g. https://your-deployment.convex.cloud).',
    );
    process.exit(1);
  }
  const server = new McpServer({ name: 'nodeslide', version: VERSION });
  registerNodeSlideTools(server, convexCall);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP transport and must stay clean.
  console.error(`NodeSlide MCP server ${VERSION} ready (stdio) -> ${CONVEX_URL}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
