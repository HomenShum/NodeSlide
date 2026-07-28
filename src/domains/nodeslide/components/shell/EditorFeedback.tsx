import { useConvex } from 'convex/react';
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { NodeSlideUiContract } from '../../uiContract';

/** After this long on one loading stage, offer an honest retry instead of spinning forever. */
const LOADING_RETRY_AFTER_MS = 12_000;

/**
 * True once the realtime transport is actually up. Exported so the UI contract
 * publisher reports the same connection fact this screen renders, instead of a
 * second, independently-derived guess.
 */
export function useConvexConnectionReady(): boolean {
  const convex = useConvex();
  const [ready, setReady] = useState(() => convex.connectionState().isWebSocketConnected);
  useEffect(() => {
    if (ready) return;
    const interval = window.setInterval(() => {
      if (convex.connectionState().isWebSocketConnected) setReady(true);
    }, 300);
    return () => window.clearInterval(interval);
  }, [convex, ready]);
  return ready;
}

/**
 * A spinner that never changes is indistinguishable from a dead socket. This one names the
 * stage it is actually in — `connecting` before the realtime transport is up, then the deck
 * stage — and after LOADING_RETRY_AFTER_MS it stops implying progress and offers a retry.
 * The stage is on the DOM as `data-stage` so it can be read without inspecting a store.
 */
export function LoadingScreen({
  title,
  kind = 'preparing_sample',
  onLoadingState,
}: {
  title: string;
  kind?: 'preparing_sample' | 'opening_deck';
  /**
   * Reports this screen's live stage to the one component that publishes the UI
   * contract. The screen does not write contract attributes itself: a second
   * writer on the same attribute names is the failure mode the contract exists to
   * avoid. It reports; NodeSlideStudioContent publishes.
   */
  onLoadingState?: (state: NodeSlideUiContract['loading'] | null) => void;
}) {
  const connected = useConvexConnectionReady();
  const [startedAt] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  const stage = connected ? kind : 'connecting';
  const retryVisible = elapsedMs >= LOADING_RETRY_AFTER_MS;

  useEffect(() => {
    onLoadingState?.({ stage, elapsedMs, retryVisible });
    return () => onLoadingState?.(null);
  }, [elapsedMs, onLoadingState, retryVisible, stage]);
  const stageTitle = connected ? title : 'Connecting to the workspace service…';
  const stageDetail = connected
    ? 'Loading canonical slides, sources, comments, and revision clocks.'
    : 'Establishing the realtime connection before anything loads.';

  return (
    <main
      className="nodeslide-studio ns-loading-screen"
      data-testid="nodeslide-studio"
      aria-busy="true"
    >
      <output className="ns-sr-only" aria-live="polite">
        {stageTitle}
      </output>
      <div className="ns-loading-group" data-testid="ns-loading-stage" data-stage={stage}>
        <span className="ns-loading-mark" aria-hidden="true">
          <LoaderCircle className="ns-spin" size={20} />
        </span>
        <strong>{stageTitle}</strong>
        <p>{stageDetail}</p>
        {retryVisible ? (
          <div className="ns-loading-retry">
            <p>Still working — first-time sample setup can take longer than usual.</p>
            <button
              className="ns-button"
              type="button"
              onClick={() => window.location.reload()}
              data-testid="ns-loading-retry"
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export function RecoveryScreen({
  title,
  detail,
  primaryLabel,
  onPrimary,
  children,
}: {
  title: string;
  detail: string;
  primaryLabel: string;
  onPrimary: () => void;
  children?: ReactNode;
}) {
  return (
    <main className="nodeslide-studio ns-recovery-screen" data-testid="nodeslide-studio">
      <span className="ns-recovery-mark" aria-hidden="true">
        <ShieldAlert size={22} />
      </span>
      <span className="ns-eyebrow">Safe recovery</span>
      <h1>{title}</h1>
      <p>{detail}</p>
      {children}
      <button className="ns-button ns-button--accent" type="button" onClick={onPrimary}>
        {primaryLabel === 'Retry' ? <RefreshCw size={15} /> : <FolderOpen size={15} />}
        {primaryLabel}
      </button>
    </main>
  );
}

export interface StudioToast {
  kind: 'success' | 'error';
  message: string;
}

/**
 * An error toast never auto-dismisses. A failure that disappears on a timer is a failure the
 * user is not required to have seen.
 */
export function Toast({ toast, onClose }: { toast: StudioToast; onClose: () => void }) {
  useEffect(() => {
    if (toast.kind === 'error') return;
    const timeout = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(timeout);
  }, [onClose, toast.kind]);
  return (
    <output className={`ns-toast is-${toast.kind}`} aria-live="polite" data-toast-kind={toast.kind}>
      {toast.kind === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
      <span>{toast.message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss notification">
        <X size={14} />
      </button>
    </output>
  );
}
