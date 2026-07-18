import { CheckCircle2, ChevronRight, CircleDashed, Loader2, Search, Wrench, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type {
  DeckPatch,
  NodeSlideAgentMessage,
  NodeSlideAgentRun,
  NodeSlideAgentRunStatus,
} from '../../../../shared/nodeslide';
import type { AiReviewablePatch } from './reviewTypes';

/**
 * AgentThread — the conversational projection of durable agent state
 * (docs/AI_TAB_THREAD_REBUILD.md, slice 1).
 *
 * Cursor/v0 shape: each nodeslide_agent_run is one turn — user bubble
 * (instruction) → visible steps (tool messages) → assistant prose → inline
 * patch card accepted/rejected in place. No new queries: runs, messages, and
 * patches are the SAME props AiInspector already receives; this component only
 * re-projects them as a thread instead of a form result.
 */

const ACTIVE_STATUSES: readonly NodeSlideAgentRunStatus[] = [
  'queued',
  'researching',
  'planning',
  'validating',
];

const STATUS_LABEL: Record<NodeSlideAgentRunStatus, string> = {
  queued: 'Queued',
  researching: 'Researching',
  planning: 'Planning',
  validating: 'Validating',
  awaiting_review: 'Ready for review',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export interface AgentThreadProps {
  runs: readonly NodeSlideAgentRun[];
  messages: readonly NodeSlideAgentMessage[];
  patches: readonly AiReviewablePatch[];
  onAcceptPatch: (patch: DeckPatch) => void;
  onRejectPatch: (patch: DeckPatch) => void;
  onOpenTrace?: (runId: string) => void;
  onPreviewPatch?: (patch: AiReviewablePatch | null) => void;
}

export function AgentThread({
  runs,
  messages,
  patches,
  onAcceptPatch,
  onRejectPatch,
  onOpenTrace,
  onPreviewPatch,
}: AgentThreadProps) {
  const orderedRuns = useMemo(() => [...runs].sort((a, b) => a.createdAt - b.createdAt), [runs]);
  const messagesByRun = useMemo(() => {
    const grouped = new Map<string, NodeSlideAgentMessage[]>();
    for (const message of messages) {
      const bucket = grouped.get(message.runId) ?? [];
      bucket.push(message);
      grouped.set(message.runId, bucket);
    }
    for (const bucket of grouped.values()) bucket.sort((a, b) => a.createdAt - b.createdAt);
    return grouped;
  }, [messages]);
  const patchById = useMemo(() => {
    const byId = new Map<string, AiReviewablePatch>();
    for (const patch of patches) byId.set(patch.id, patch);
    return byId;
  }, [patches]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const tailKey = `${orderedRuns.length}:${messages.length}:${orderedRuns[orderedRuns.length - 1]?.status ?? ''}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tailKey]);

  if (orderedRuns.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground" data-testid="agent-thread-empty">
        Ask the agent below — every run lands here as a reviewable turn.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3"
      data-testid="agent-thread"
      aria-label="Agent conversation"
    >
      {orderedRuns.map((run) => (
        <ThreadTurn
          key={run.id}
          run={run}
          messages={messagesByRun.get(run.id) ?? []}
          patch={run.patchId ? patchById.get(run.patchId) : undefined}
          onAcceptPatch={onAcceptPatch}
          onRejectPatch={onRejectPatch}
          onOpenTrace={onOpenTrace}
          onPreviewPatch={onPreviewPatch}
        />
      ))}
    </div>
  );
}

function ThreadTurn({
  run,
  messages,
  patch,
  onAcceptPatch,
  onRejectPatch,
  onOpenTrace,
  onPreviewPatch,
}: {
  run: NodeSlideAgentRun;
  messages: readonly NodeSlideAgentMessage[];
  patch: AiReviewablePatch | undefined;
  onAcceptPatch: (patch: DeckPatch) => void;
  onRejectPatch: (patch: DeckPatch) => void;
  onOpenTrace: ((runId: string) => void) | undefined;
  onPreviewPatch: ((patch: AiReviewablePatch | null) => void) | undefined;
}) {
  const active = ACTIVE_STATUSES.includes(run.status);
  const steps = messages.filter((message) => message.role === 'tool');
  const prose = messages.filter((message) => message.role === 'assistant');
  const citationCount = new Set(messages.flatMap((message) => message.sourceIds ?? [])).size;
  const patchReviewable = patch && ['draft', 'validating', 'ready', 'stale'].includes(patch.status);

  return (
    <section className="flex flex-col gap-2" data-testid="agent-thread-turn" data-run-id={run.id} data-status={run.status}>
      {/* User turn */}
      <div className="self-end max-w-[92%] rounded-lg bg-primary/10 px-3 py-2 text-xs text-foreground">
        {run.instruction}
      </div>

      {/* Assistant turn */}
      <div className="flex max-w-[96%] flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusIcon status={run.status} />
          <span data-testid="agent-thread-status">{STATUS_LABEL[run.status]}</span>
          <span className="text-muted-foreground/60">· {run.model}</span>
          {citationCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-1" data-testid="agent-thread-citations">
              <Search aria-hidden className="size-3" />
              {citationCount} source{citationCount === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {/* Visible steps (tool messages) — the Cursor-style timeline */}
        {steps.length > 0 && (
          <ol className="flex flex-col gap-0.5" data-testid="agent-thread-steps">
            {steps.map((step) => (
              <li key={step.id} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Wrench aria-hidden className="mt-0.5 size-3 shrink-0" />
                <span className="font-mono text-[10px] uppercase tracking-wide">{step.toolName ?? 'tool'}</span>
                <span className="truncate">{step.content}</span>
              </li>
            ))}
          </ol>
        )}

        {/* Streamed prose */}
        {prose.map((message) => (
          <p key={message.id} className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
            {message.content}
          </p>
        ))}
        {active && prose.length === 0 && (
          <p className="text-xs italic text-muted-foreground" aria-live="off">
            Working…
          </p>
        )}
        {run.status === 'failed' && run.error && (
          <p className="text-xs text-destructive" data-testid="agent-thread-error">
            {run.error}
          </p>
        )}

        {/* Inline patch card — accept in place */}
        {patch && patchReviewable && (
          <div
            className="mt-1 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5"
            data-testid="agent-thread-patch"
            onMouseEnter={() => onPreviewPatch?.(patch)}
            onMouseLeave={() => onPreviewPatch?.(null)}
          >
            <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{patch.summary ?? 'Proposed change'}</span>
            <button
              type="button"
              className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
              data-testid="agent-thread-patch-accept"
              onClick={() => onAcceptPatch(patch)}
            >
              Accept
            </button>
            <button
              type="button"
              className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
              data-testid="agent-thread-patch-reject"
              onClick={() => onRejectPatch(patch)}
            >
              Reject
            </button>
          </div>
        )}
        {patch && !patchReviewable && (
          <p className="text-[11px] text-muted-foreground" data-testid="agent-thread-patch-settled">
            Patch {patch.status}.
          </p>
        )}

        {onOpenTrace && (
          <button
            type="button"
            className="mt-0.5 inline-flex items-center gap-0.5 self-start text-[10px] text-muted-foreground hover:text-foreground"
            data-testid="agent-thread-open-trace"
            onClick={() => onOpenTrace(run.id)}
          >
            Trace <ChevronRight aria-hidden className="size-3" />
          </button>
        )}
      </div>
    </section>
  );
}

function StatusIcon({ status }: { status: NodeSlideAgentRunStatus }) {
  if (ACTIVE_STATUSES.includes(status)) return <Loader2 aria-hidden className="size-3 animate-spin" />;
  if (status === 'awaiting_review') return <CircleDashed aria-hidden className="size-3 text-primary" />;
  if (status === 'completed') return <CheckCircle2 aria-hidden className="size-3 text-emerald-600" />;
  return <XCircle aria-hidden className="size-3 text-destructive" />;
}
