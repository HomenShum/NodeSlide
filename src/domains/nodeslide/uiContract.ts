/**
 * NodeSlide UI contract — a machine-readable surface for agents driving the UI.
 *
 * QA agents, scripted drives, and coding assistants should never have to infer app
 * state from pixels or copy strings. The app PUBLISHES its state: a versioned window
 * object for JS-eval consumers plus mirrored `data-ns-*` attributes for
 * selector-based consumers (Playwright waits, pixels.cjs asserts, CSS-only checks).
 *
 * Contract rules (the reason this file is trustworthy):
 * - Values describe what the app IS DOING, never what it wants to appear to do; a
 *   publisher may only report a phase/stage it is actually rendering.
 * - Additive evolution only: bump `version` on breaking shape changes.
 * - No secrets, no user content — ids, phases, counts, and booleans only.
 *
 * WHERE THE ATTRIBUTES LAND, and why it is not the studio root.
 * The studio already publishes an identity surface on `main.nodeslide-studio`
 * (`data-app-id`, `data-agent-surface`, `data-screen-*`, `data-mcp-compat`,
 * `data-ns-theme`). This contract deliberately does NOT share that node:
 * - every phase change unmounts one `main` and mounts another, so an element
 *   handle held by an agent goes stale at exactly the moment the state it is
 *   watching changes;
 * - the approver and presenter phases render no `.nodeslide-studio` root at all,
 *   so a studio-rooted contract would go silently blank in two real phases.
 * `document.documentElement` outlives every shell swap, which is the whole point
 * of a phase channel. The two attribute families are disjoint by name, so no
 * attribute has two writers — see the `data-ns-theme` note on the publisher.
 */

export const NODESLIDE_UI_CONTRACT_VERSION = 'nodeslide.ui-contract/v1' as const;

export type NodeSlideUiPhase =
  | 'landing'
  | 'loading'
  | 'workspace'
  | 'recovery'
  | 'present'
  /** The capability-token approver review screen; this repo ships it, parity did not. */
  | 'approve';
export type NodeSlideUiLoadingStage = 'connecting' | 'preparing_sample' | 'opening_deck';
export type NodeSlideUiConnection = 'connecting' | 'ready';

export interface NodeSlideUiContract {
  version: typeof NODESLIDE_UI_CONTRACT_VERSION;
  phase: NodeSlideUiPhase;
  connection: NodeSlideUiConnection;
  /**
   * Reported on the window object only. The studio root owns the theme ATTRIBUTE —
   * see `publishNodeSlideUiContract`. Both read the same `studioTheme` state, so
   * they cannot disagree.
   */
  theme: 'light' | 'dark';
  loading?: {
    stage: NodeSlideUiLoadingStage;
    /** Milliseconds since this loading phase began. */
    elapsedMs: number;
    retryVisible: boolean;
  };
  deck?: {
    id: string;
    version: number;
    slideCount: number;
  };
  /** The active durable job, when one is running or awaiting review. */
  job?: {
    /** Absent until the server has admitted the job and returned a row id. */
    id?: string;
    status: string;
    phase: string;
    /**
     * Admission-time routing decision (advisory_v1) when the server published one.
     * The server-side receipt carries it (`AgentSessionJobReceipt.routingReceipt`)
     * but the client-side `AgentSessionJobHandle` does not retain it, so nothing in
     * this repo can populate this field yet. Typed, never published — the linter
     * does not assert `data-ns-routing` for that reason.
     */
    routing?:
      | { kind: 'selected'; modelId: string; estimatedMicroUsd: number | null }
      | { kind: 'refused'; code: string };
  };
  updatedAt: number;
}

declare global {
  interface Window {
    __NODESLIDE_UI_CONTRACT__?: NodeSlideUiContract;
  }
}

/** Every attribute this contract owns. Exported so the gate asserts a list, not a guess. */
export const NODESLIDE_UI_CONTRACT_ATTRIBUTES = [
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
  'data-ns-routing',
] as const;

/**
 * Publish the current UI state. Call from the component that RENDERS the state —
 * never speculatively. Attributes land on <html> so they survive shell remounts.
 *
 * DELIBERATELY ABSENT: `data-ns-theme`.
 * The studio root owns that attribute. It is set as JSX on `main.nodeslide-studio`,
 * every dark rule in nodeslideV3.css is keyed off `.nodeslide-studio[data-ns-theme="dark"]`,
 * and `scripts/capture-gap-closure-ui-qa.mjs` fails a production run when the studio
 * root's value does not match the theme it asked for. Writing the same attribute name
 * here, on a different node, would give one attribute two writers free to disagree —
 * with no CSS in either repo keyed off `html[data-ns-theme]` to make the divergence
 * visible. The theme still travels in the contract OBJECT (`contract.theme`), from the
 * same `studioTheme` state the studio root renders.
 *
 * FAILURE IS NOT LOADING: `data-ns-loading-*` is REMOVED whenever `loading` is absent.
 * A shell that has failed reports `data-ns-phase="recovery"` with no loading stage, so
 * an agent can never read a stalled failure as an in-progress load. While a load is
 * genuinely in flight, `data-ns-loading-retry="true"` marks the point where the app has
 * stopped implying progress and is offering a retry.
 */
export function publishNodeSlideUiContract(
  next: Omit<NodeSlideUiContract, 'version' | 'updatedAt'>,
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const contract: NodeSlideUiContract = {
    version: NODESLIDE_UI_CONTRACT_VERSION,
    ...next,
    updatedAt: Date.now(),
  };
  window.__NODESLIDE_UI_CONTRACT__ = contract;
  const root = document.documentElement;
  root.setAttribute('data-ns-contract', contract.version);
  root.setAttribute('data-ns-phase', contract.phase);
  root.setAttribute('data-ns-connection', contract.connection);
  if (contract.loading) {
    root.setAttribute('data-ns-loading-stage', contract.loading.stage);
    root.setAttribute('data-ns-loading-elapsed-ms', String(contract.loading.elapsedMs));
    root.setAttribute('data-ns-loading-retry', contract.loading.retryVisible ? 'true' : 'false');
  } else {
    root.removeAttribute('data-ns-loading-stage');
    root.removeAttribute('data-ns-loading-elapsed-ms');
    root.removeAttribute('data-ns-loading-retry');
  }
  if (contract.deck) {
    root.setAttribute('data-ns-deck-id', contract.deck.id);
    root.setAttribute('data-ns-deck-version', String(contract.deck.version));
    root.setAttribute('data-ns-slide-count', String(contract.deck.slideCount));
  } else {
    root.removeAttribute('data-ns-deck-id');
    root.removeAttribute('data-ns-deck-version');
    root.removeAttribute('data-ns-slide-count');
  }
  if (contract.job) {
    root.setAttribute('data-ns-job-status', contract.job.status);
    root.setAttribute('data-ns-job-phase', contract.job.phase);
    if (contract.job.routing) {
      root.setAttribute('data-ns-routing', contract.job.routing.kind);
    } else {
      root.removeAttribute('data-ns-routing');
    }
  } else {
    root.removeAttribute('data-ns-job-status');
    root.removeAttribute('data-ns-job-phase');
    root.removeAttribute('data-ns-routing');
  }
}

/** Read the last published contract (agents: prefer this over DOM scraping). */
export function readNodeSlideUiContract(): NodeSlideUiContract | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.__NODESLIDE_UI_CONTRACT__;
}

/**
 * The one theme resolution every surface shares: the stored studio preference first
 * (`nodeslide.v3.theme`, the key `readStudioPreference('theme')` writes), then the OS
 * preference, then light. The studio root's `data-ns-theme` is seeded from this.
 */
export function resolveNodeSlideInitialTheme(): 'light' | 'dark' {
  try {
    const stored = window.localStorage.getItem('nodeslide.v3.theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // Storage may be unavailable (private mode); fall through to the OS signal.
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  }
  return 'light';
}
