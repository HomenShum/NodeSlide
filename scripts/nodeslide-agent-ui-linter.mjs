#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The AI-Elements composer rewrite split the agent surface across two files: the tab
// shell stayed in AiInspector.tsx while the turn list and its controls moved to
// AgentThread.tsx. A single-file read here reported a missing cancel control that is
// in fact shipped, so each surface is a list and the checks run over the concatenation.
const files = {
  studio: ['src/domains/nodeslide/NodeSlideStudio.tsx'],
  agent: [
    'src/domains/nodeslide/inspector/AiInspector.tsx',
    'src/domains/nodeslide/inspector/AgentThread.tsx',
  ],
  trace: ['src/domains/nodeslide/inspector/TraceInspector.tsx'],
  data: ['src/domains/nodeslide/inspector/DataInspector.tsx'],
};

const contents = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, relatives]) => [
      key,
      (
        await Promise.all(
          relatives.map((relative) => fs.readFile(path.join(root, relative), 'utf8')),
        )
      ).join('\n'),
    ]),
  ),
);

const checks = [
  ['screen root exposes app identity', contents.studio.includes('data-app-id="nodeslide"')],
  ['screen root exposes stable state', contents.studio.includes('data-screen-state=')],
  [
    'screen root exposes agent surface',
    contents.studio.includes('data-agent-surface="deck-editor"'),
  ],
  ['composer exposes model selection', contents.agent.includes('data-testid="ai-model-select"')],
  ['composer exposes file attachment', contents.agent.includes('data-testid="ai-data-file-input"')],
  ['composer exposes web consent', contents.agent.includes('data-agent-web-consent="session"')],
  ['composer exposes cancellation', contents.agent.includes('data-testid="ai-cancel-run"')],
  [
    'trace exposes durable journal',
    contents.trace.includes('aria-label="Durable agent run journal"'),
  ],
  ['data exposes deletion lifecycle', contents.data.includes('Delete private source')],
];

const failures = checks.filter(([, passed]) => !passed);
for (const [label, passed] of checks) console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
console.log(
  `\nNodeSlide agent-operability checks: ${checks.length - failures.length}/${checks.length}`,
);
if (failures.length > 0) process.exit(1);
