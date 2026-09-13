import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['mcp/dist/index.js'],
  env: {
    ...process.env,
    NODESLIDE_CONVEX_URL: 'https://energetic-mallard-535.convex.cloud',
  },
});

const client = new Client({ name: 'nodeslide-mcp-live-test', version: '0.1.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

const created = await client.callTool({
  name: 'nodeslide.create_deck',
  arguments: {
    title: 'MCP live test: composition grammars',
    prompt:
      'Show a risk committee how the NIST AI RMF governance loop moves one AI system to a governed release decision, with GOVERN cross-cutting MAP, MEASURE, and MANAGE, a release gate, and a success metric.',
    audience: 'Chief risk officer and model risk committee',
    purpose: 'Move one AI system to a governed release decision',
    successCriteria: [
      'Keep GOVERN cross-cutting',
      'Show the release gate',
      'Name one decision metric',
    ],
    themeId: 'editorial-signal',
    clientSessionId: 'mcp-live-test-session-0001',
    accessCode: 'mcp-live-test-code-2026',
    execution: 'deterministic',
    publish: true,
  },
});
const text = created.content?.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
console.log('CREATE_RESULT:', text);

await client.close();
process.exit(0);
