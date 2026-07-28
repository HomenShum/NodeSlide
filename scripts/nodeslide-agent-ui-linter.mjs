#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The trust-surface census lives in a sibling module because it walks the whole src tree
// rather than a fixed file list, but it is NOT a second gate: its checks are appended to
// this list and share this exit code. Two gates over the same rule drift; one does not.
import { clauseRunMode, trustSurfaceChecks } from './nodeslide-trust-surface-census.mjs';

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
  contract: ['src/domains/nodeslide/uiContract.ts'],
};

/**
 * The contract attributes an agent is entitled to find. A missing attribute is a
 * silent capability loss — nothing else in the repo fails when the app simply stops
 * publishing one — so presence is asserted here by name, not by value.
 * `data-ns-routing` is intentionally NOT in this list: the client-side job handle
 * does not retain the admission routing receipt, so nothing can publish it yet, and
 * a gate on an attribute with no producer is a gate that can only be satisfied by a
 * lie. `data-ns-theme` is intentionally NOT here either — the studio root owns it.
 */
const contractAttributes = [
  'data-ns-contract',
  'data-ns-phase',
  'data-ns-connection',
  'data-ns-loading-stage',
  'data-ns-loading-elapsed-ms',
  'data-ns-loading-retry',
  'data-ns-deck-id',
  'data-ns-deck-version',
  'data-ns-slide-count',
  'data-ns-job-status',
  'data-ns-job-phase',
];

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
  // Re-pointed. This check arrived asserting `data-agent-web-consent="session"`, the attribute
  // on the session-scoped consent checkbox. That checkbox was deliberately deleted by the
  // zero-friction consent redesign — naming an external model and pressing send IS the consent
  // now — so the check had been failing against a control the product removed on purpose, and
  // reinstating the control to satisfy it would have been the wrong repair. Web egress is still
  // opt-in per send through the research toggle, so that is what the DOM now advertises.
  [
    'composer exposes web consent posture',
    contents.agent.includes('data-agent-web-consent="per-send"'),
  ],
  ['composer exposes cancellation', contents.agent.includes('data-testid="ai-cancel-run"')],
  [
    'trace exposes durable journal',
    contents.trace.includes('aria-label="Durable agent run journal"'),
  ],
  ['data exposes deletion lifecycle', contents.data.includes('Delete private source')],
  // The UI contract. A byte-identical copy of this module once sat on an abandoned
  // branch with zero callers; a gate on the module alone would have passed there.
  // So the wiring is asserted too: the publisher must be CALLED from the component
  // that decides which shell renders.
  [
    'ui contract is published, not merely defined',
    contents.studio.includes('publishNodeSlideUiContract('),
  ],
  [
    'ui contract publishes its version level',
    contents.contract.includes("setAttribute('data-ns-contract'"),
  ],
  [
    'ui contract leaves data-ns-theme to the studio root',
    !contents.contract.includes("setAttribute('data-ns-theme'") &&
      contents.studio.includes('data-ns-theme={studioTheme}'),
  ],
  [
    'failed shells publish no loading stage',
    contents.contract.includes("removeAttribute('data-ns-loading-stage')"),
  ],
  ...contractAttributes.map((attribute) => [
    `ui contract publishes ${attribute}`,
    contents.contract.includes(`setAttribute('${attribute}'`),
  ]),
];

const { checks: trustChecks, census } = await trustSurfaceChecks();
checks.push(...trustChecks);

const failures = checks.filter(([, passed]) => !passed);
for (const [label, passed, detail] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
  if (detail && !passed) console.log(`     ${detail}`);
}

/*
 * Say what ran and what did not. A gate that prints only PASS lines invites the reader to
 * believe it covered the whole rule; two of the trust-surface clauses need a real browser and
 * are reported not-run here rather than being quietly counted as passes. `npm run
 * lint:nodeslide-trust-surfaces` prints the full census with every enumerated surface.
 */
console.log('\nTrust-surface clause coverage:');
for (const [clause, mode, note] of await clauseRunMode()) {
  console.log(`  [${mode}] ${clause}`);
  if (mode === 'NOT-RUN') console.log(`      not-run — ${note}`);
}
console.log(
  `\nTrust-surface census: ${census.annotated.length} enumerated, ` +
    `${census.notRun.length} not-run, ${census.byComponent.size} components swept`,
);
console.log(
  `\nNodeSlide agent-operability checks: ${checks.length - failures.length}/${checks.length}`,
);
if (failures.length > 0) process.exit(1);
