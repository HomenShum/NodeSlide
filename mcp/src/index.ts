#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerNodeSlideLocalTools } from './lib/localDeckTools.js';
import { registerNodeSlideTools } from './lib/nodeslideTools.js';

const VERSION = '0.1.0';

// Optional. Local-file tools work without a hosted deployment; the original 11
// tools stay registered and fail with an explicit configuration error if called
// without a host.
const CONVEX_URL = (process.env.NODESLIDE_CONVEX_URL ?? '').replace(/\/+$/, '');

async function convexCall(
  kind: 'query' | 'mutation' | 'action',
  path: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!CONVEX_URL) {
    throw new Error(
      'This NodeSlide tool requires host-backed mode. Set NODESLIDE_CONVEX_URL and restart the MCP server.',
    );
  }
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
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`NodeSlide MCP ${VERSION}

Usage:
  nodeslide-mcp [--help] [--version]

Modes:
  Offline file tools are always available and are restricted to NODESLIDE_LOCAL_ROOT
  (default: process cwd). Set NODESLIDE_CONVEX_URL to enable the existing 11
  host-backed deck, proposal, source, research, trace, and BYOK tools.

Transport:
  stdio (stdout is reserved for MCP protocol messages).`);
    return;
  }
  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    return;
  }
  if (args.length > 0) {
    throw new Error(`Unknown option or argument ${args[0]}. Run nodeslide-mcp --help.`);
  }

  const server = new McpServer({ name: 'nodeslide', version: VERSION });
  registerNodeSlideTools(server, convexCall);
  registerNodeSlideLocalTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only: stdout is the MCP transport and must stay clean.
  console.error(
    `NodeSlide MCP server ${VERSION} ready (stdio, ${CONVEX_URL ? `host-backed -> ${CONVEX_URL}` : 'offline-file mode; hosted tools require NODESLIDE_CONVEX_URL'})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
