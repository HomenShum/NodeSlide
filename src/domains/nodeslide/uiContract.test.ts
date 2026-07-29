// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NODESLIDE_UI_CONTRACT_ATTRIBUTES,
  NODESLIDE_UI_CONTRACT_VERSION,
  type NodeSlideUiContract,
  publishNodeSlideUiContract,
  readNodeSlideUiContract,
  resolveNodeSlideInitialTheme,
} from './uiContract';

// Repo-relative: under `@vitest-environment jsdom`, `import.meta.url` is an http URL.
const studioSource = readFileSync('src/domains/nodeslide/NodeSlideStudio.tsx', 'utf8');
const contractSource = readFileSync('src/domains/nodeslide/uiContract.ts', 'utf8');
const feedbackSource = readFileSync(
  'src/domains/nodeslide/components/shell/EditorFeedback.tsx',
  'utf8',
);

function clearContract() {
  for (const attribute of NODESLIDE_UI_CONTRACT_ATTRIBUTES) {
    document.documentElement.removeAttribute(attribute);
  }
  document.documentElement.removeAttribute('data-ns-theme');
  // Not `= undefined`: the declared global is optional-without-undefined
  // (exactOptionalPropertyTypes), so the property has to go, not be blanked.
  Reflect.deleteProperty(window, '__NODESLIDE_UI_CONTRACT__');
  window.localStorage.clear();
}

const workspaceState: Omit<NodeSlideUiContract, 'version' | 'updatedAt'> = {
  phase: 'workspace',
  connection: 'ready',
  theme: 'light',
  deck: { id: 'deck_1', version: 7, slideCount: 12 },
};

afterEach(clearContract);

describe('publishNodeSlideUiContract', () => {
  it('publishes the contract level so an agent can detect what it is talking to', () => {
    publishNodeSlideUiContract(workspaceState);
    expect(document.documentElement.getAttribute('data-ns-contract')).toBe(
      NODESLIDE_UI_CONTRACT_VERSION,
    );
    expect(readNodeSlideUiContract()?.version).toBe(NODESLIDE_UI_CONTRACT_VERSION);
  });

  it('publishes the state the DOM identity attributes cannot carry', () => {
    publishNodeSlideUiContract({
      ...workspaceState,
      job: { id: 'job_9', status: 'running', phase: 'drafting' },
    });
    const root = document.documentElement;
    expect(root.getAttribute('data-ns-phase')).toBe('workspace');
    expect(root.getAttribute('data-ns-connection')).toBe('ready');
    expect(root.getAttribute('data-ns-deck-id')).toBe('deck_1');
    expect(root.getAttribute('data-ns-deck-version')).toBe('7');
    expect(root.getAttribute('data-ns-slide-count')).toBe('12');
    expect(root.getAttribute('data-ns-job-status')).toBe('running');
    expect(root.getAttribute('data-ns-job-phase')).toBe('drafting');
  });

  // The recorded collision: parity's publisher wrote data-ns-theme to <html> while
  // this repo writes it on .nodeslide-studio, keys every dark CSS rule off it, and
  // fails a production QA run on a mismatch. One attribute, two writers, two nodes.
  it('never writes data-ns-theme — the studio root owns that attribute', () => {
    publishNodeSlideUiContract({ ...workspaceState, theme: 'dark' });
    expect(document.documentElement.hasAttribute('data-ns-theme')).toBe(false);
    // The theme still travels, on the object channel, from the same state.
    expect(readNodeSlideUiContract()?.theme).toBe('dark');
    expect(contractSource).not.toContain("setAttribute('data-ns-theme'");
    expect(studioSource).toContain('data-ns-theme={studioTheme}');
  });

  // A boot shell in a sibling repo shipped an infinite shimmer because mounting was
  // the only exit from the loading state. A failure that publishes a loading stage is
  // that bug in machine-readable form.
  it('makes a failed shell unmistakable from a loading one', () => {
    publishNodeSlideUiContract({
      phase: 'loading',
      connection: 'connecting',
      theme: 'light',
      loading: { stage: 'connecting', elapsedMs: 13_000, retryVisible: true },
    });
    const root = document.documentElement;
    expect(root.getAttribute('data-ns-phase')).toBe('loading');
    expect(root.getAttribute('data-ns-loading-stage')).toBe('connecting');
    expect(root.getAttribute('data-ns-loading-elapsed-ms')).toBe('13000');
    expect(root.getAttribute('data-ns-loading-retry')).toBe('true');

    publishNodeSlideUiContract({ phase: 'recovery', connection: 'ready', theme: 'light' });
    expect(root.getAttribute('data-ns-phase')).toBe('recovery');
    expect(root.hasAttribute('data-ns-loading-stage')).toBe(false);
    expect(root.hasAttribute('data-ns-loading-elapsed-ms')).toBe(false);
    expect(root.hasAttribute('data-ns-loading-retry')).toBe(false);
    expect(readNodeSlideUiContract()?.loading).toBeUndefined();
  });

  it('retracts deck and job attributes when the state they described is gone', () => {
    publishNodeSlideUiContract({
      ...workspaceState,
      job: { status: 'running', phase: 'drafting' },
    });
    publishNodeSlideUiContract({ phase: 'landing', connection: 'ready', theme: 'light' });
    const root = document.documentElement;
    for (const attribute of ['data-ns-deck-id', 'data-ns-deck-version', 'data-ns-slide-count']) {
      expect(root.hasAttribute(attribute)).toBe(false);
    }
    for (const attribute of ['data-ns-job-status', 'data-ns-job-phase', 'data-ns-routing']) {
      expect(root.hasAttribute(attribute)).toBe(false);
    }
  });

  // The unarmed-sensor failure this port exists to avoid: a byte-identical copy of
  // this module sat on an abandoned branch with zero callers.
  it('is wired into the component that decides which shell renders', () => {
    expect(studioSource).toContain("from './uiContract'");
    expect(studioSource).toContain('publishNodeSlideUiContract(');
    expect(studioSource).toContain('resolveNodeSlideInitialTheme');
  });

  /**
   * Regression, caught by the CI runtime smoke. Reading `connection` from
   * `ConvexReactClient.connectionState()` lazily CONSTRUCTS the sync client, which
   * opens the websocket. Every query on the landing shell is 'skip', so the probe made
   * the app dial a deployment it had decided not to dial — fatal against the CI
   * placeholder URL, and a real behaviour change in production. The contract reports
   * connection state; it must not cause it.
   */
  it('does not probe the realtime transport to describe it', () => {
    // A call, not the prose explaining why there is no call.
    expect(studioSource).not.toMatch(/\bconvex\.connectionState\(/u);
    expect(studioSource).not.toMatch(/\buseConvexConnectionReady\(/u);
    expect(feedbackSource).not.toContain('export function useConvexConnectionReady');
  });
});

describe('resolveNodeSlideInitialTheme', () => {
  it('prefers the stored studio preference', () => {
    window.localStorage.setItem('nodeslide.v3.theme', 'dark');
    expect(resolveNodeSlideInitialTheme()).toBe('dark');
  });

  it('falls back to light when nothing is stored and no OS signal is available', () => {
    expect(resolveNodeSlideInitialTheme()).toBe('light');
  });

  it('ignores a stored value that is not a theme', () => {
    window.localStorage.setItem('nodeslide.v3.theme', 'sepia');
    expect(resolveNodeSlideInitialTheme()).toBe('light');
  });
});
