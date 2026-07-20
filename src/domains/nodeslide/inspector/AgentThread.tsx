import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  GitBranch,
  Loader2,
  Search,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import {
  type DeckPatch,
  type NodeSlideAgentMessage,
  type NodeSlideAgentRun,
  type NodeSlideAgentRunStatus,
  isNodeSlideAgentModelId,
  nodeSlideAgentModel,
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
  onCancelRun?: (runId: string) => void;
}

export function AgentThread({
  runs,
  messages,
  patches,
  onAcceptPatch,
  onRejectPatch,
  onOpenTrace,
  onPreviewPatch,
  onCancelRun,
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
  const latestMessage = messages.reduce<NodeSlideAgentMessage | undefined>((latest, message) => {
    const latestTime = latest?.updatedAt ?? latest?.createdAt ?? -1;
    const messageTime = message.updatedAt ?? message.createdAt;
    return messageTime >= latestTime ? message : latest;
  }, undefined);
  const tailKey = `${orderedRuns.length}:${messages.length}:${latestMessage?.id ?? ''}:${latestMessage?.updatedAt ?? latestMessage?.createdAt ?? ''}:${latestMessage?.content.length ?? 0}:${latestMessage?.streamState ?? ''}:${orderedRuns[orderedRuns.length - 1]?.status ?? ''}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: tailKey is the intentional trigger — re-pin the scroll to the newest turn whenever the thread tail changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tailKey]);

  if (orderedRuns.length === 0) {
    return (
      <div
        className="px-3 py-6 text-center text-xs text-muted-foreground"
        data-testid="agent-thread-empty"
      >
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
          onCancelRun={onCancelRun}
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
  onCancelRun,
}: {
  run: NodeSlideAgentRun;
  messages: readonly NodeSlideAgentMessage[];
  patch: AiReviewablePatch | undefined;
  onAcceptPatch: (patch: DeckPatch) => void;
  onRejectPatch: (patch: DeckPatch) => void;
  onOpenTrace: ((runId: string) => void) | undefined;
  onPreviewPatch: ((patch: AiReviewablePatch | null) => void) | undefined;
  onCancelRun: ((runId: string) => void) | undefined;
}) {
  const active = ACTIVE_STATUSES.includes(run.status);
  const steps = messages.filter((message) => message.role === 'tool' && !message.handoff);
  const handoffs = messages.filter((message) => message.role === 'tool' && message.handoff);
  const prose = messages.filter((message) => message.role === 'assistant');
  const citationCount = new Set(messages.flatMap((message) => message.sourceIds ?? [])).size;
  const patchReviewable = patch && ['draft', 'validating', 'ready', 'stale'].includes(patch.status);

  return (
    <section
      className="flex flex-col gap-2"
      data-testid="agent-thread-turn"
      data-run-id={run.id}
      data-status={run.status}
    >
      {/* User turn */}
      <div className="self-end max-w-[92%] break-words rounded-lg bg-primary/10 px-3 py-2 text-xs text-foreground">
        {run.instruction}
      </div>

      {/* Assistant turn */}
      <div className="flex max-w-[96%] flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusIcon status={run.status} />
          <span data-testid="agent-thread-status">{STATUS_LABEL[run.status]}</span>
          <span className="text-muted-foreground/60">· {modelDisplayName(run.model)}</span>
          {citationCount > 0 && (
            <span
              className="ml-auto inline-flex items-center gap-1"
              data-testid="agent-thread-citations"
            >
              <Search aria-hidden className="size-3" />
              {citationCount} source{citationCount === 1 ? '' : 's'}
            </span>
          )}
          {active && onCancelRun && (
            <button
              type="button"
              className={`${citationCount > 0 ? '' : 'ml-auto '}rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground`}
              data-testid="ai-cancel-run"
              onClick={() => onCancelRun(run.id)}
            >
              Cancel
            </button>
          )}
        </div>

        {/* Visible steps (tool messages) — the Cursor-style timeline */}
        {steps.length > 0 && (
          <ol className="flex flex-col gap-0.5" data-testid="agent-thread-steps">
            {steps.map((step) => {
              const label = humanizeToolName(step.toolName);
              const content = step.content ?? '';
              // Self-labeled steps ("Planner · …", "Verify: …", "Repair · …",
              // "Read context: …") drop the redundant prefix from the visible
              // text so the line fits the 340px rail without truncating the
              // substance; the full message stays available in the title.
              const display = content.toLowerCase().startsWith(label.toLowerCase())
                ? content.slice(label.length).replace(/^[\s:·—-]+/u, '')
                : content;
              return (
                <li
                  key={step.id}
                  className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                >
                  <Wrench aria-hidden className="mt-0.5 size-3 shrink-0" />
                  <span className="font-medium">{label}</span>
                  <span className="truncate" title={step.content}>
                    {display}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {handoffs.length > 0 && <NestedHandoffs messages={handoffs} />}

        {/* Streamed prose */}
        {prose.map((message) => (
          <p
            key={message.id}
            className={`whitespace-pre-wrap break-words text-xs leading-relaxed ${
              message.streamState === 'interrupted'
                ? 'text-muted-foreground line-through decoration-muted-foreground/50'
                : 'text-foreground'
            }`}
            data-testid={message.streamState ? 'agent-thread-stream' : undefined}
            data-stream-state={message.streamState}
            aria-live={message.streamState === 'streaming' ? 'polite' : undefined}
          >
            {message.streamState === 'streaming' ? (
              <span className="mr-1 font-medium">Drafting ·</span>
            ) : null}
            {message.streamState === 'interrupted' ? (
              <span className="mr-1 font-medium no-underline">Draft discarded ·</span>
            ) : null}
            {message.content}
            {message.streamState === 'streaming' ? (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-current align-middle"
                data-testid="agent-thread-stream-cursor"
              />
            ) : null}
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
            <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
              {patch.summary ?? 'Proposed change'}
            </span>
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

function NestedHandoffs({ messages }: { messages: readonly NodeSlideAgentMessage[] }) {
  const ids = new Set(messages.flatMap((message) => (message.handoff ? [message.handoff.id] : [])));
  const roots = messages.filter(
    (message) => !message.handoff?.parentId || !ids.has(message.handoff.parentId),
  );
  const childrenByParent = new Map<string, NodeSlideAgentMessage[]>();
  for (const message of messages) {
    const parentId = message.handoff?.parentId;
    if (!parentId || !ids.has(parentId)) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(message);
    childrenByParent.set(parentId, children);
  }

  return (
    <ol className="flex flex-col gap-1" data-testid="agent-thread-handoffs">
      {roots.map((message) => (
        <HandoffRow
          key={message.id}
          message={message}
          nestedMessages={childrenByParent.get(message.handoff?.id ?? '') ?? []}
        />
      ))}
    </ol>
  );
}

function HandoffRow({
  message,
  nestedMessages,
}: {
  message: NodeSlideAgentMessage;
  nestedMessages: readonly NodeSlideAgentMessage[];
}) {
  const handoff = message.handoff;
  if (!handoff) return null;
  return (
    <li
      className="rounded border border-border/70 bg-background/60 px-2 py-1.5 text-[11px]"
      data-testid="agent-thread-handoff"
      data-handoff-id={handoff.id}
      data-handoff-parent-id={handoff.parentId}
      data-handoff-status={handoff.status}
    >
      <div className="flex items-center gap-1 text-muted-foreground">
        <GitBranch aria-hidden className="size-3 shrink-0" />
        <strong className="font-medium text-foreground">{handoff.from}</strong>
        <span aria-hidden>→</span>
        <strong className="font-medium text-foreground">{handoff.to}</strong>
        <span className="ml-auto capitalize">{handoff.status}</span>
      </div>
      <p className="mt-1 text-muted-foreground">{message.content}</p>
      {nestedMessages.length > 0 ? (
        <ol
          className="mt-1.5 border-l border-border pl-2"
          data-testid="agent-thread-handoff-children"
        >
          {nestedMessages.map((child) => (
            <li
              key={child.id}
              className="py-1"
              data-testid="agent-thread-handoff-child"
              data-handoff-id={child.handoff?.id}
              data-handoff-parent-id={child.handoff?.parentId}
              data-handoff-status={child.handoff?.status}
            >
              <div className="flex items-center gap-1 text-muted-foreground">
                <ChevronRight aria-hidden className="size-3 shrink-0" />
                <strong className="font-medium text-foreground">{child.handoff?.to}</strong>
                <span className="ml-auto capitalize">{child.handoff?.status}</span>
              </div>
              <p className="mt-0.5 text-muted-foreground">{child.content}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

/** Step labels for the visible timeline (moved from AiInspector with the old flat list). */
function modelDisplayName(model: string) {
  return isNodeSlideAgentModelId(model) ? nodeSlideAgentModel(model).label : model;
}

function humanizeToolName(toolName?: string) {
  if (!toolName) return 'Tool';
  const knownLabels: Record<string, string> = {
    candidate_validation: 'Validation',
    web_research: 'Web research',
    source_snapshot: 'Source capture',
    read_context: 'Read context',
    verify: 'Verify',
    repair: 'Repair',
  };
  if (knownLabels[toolName]) return knownLabels[toolName];
  return toolName.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function StatusIcon({ status }: { status: NodeSlideAgentRunStatus }) {
  if (ACTIVE_STATUSES.includes(status))
    return <Loader2 aria-hidden className="size-3 animate-spin" />;
  if (status === 'awaiting_review')
    return <CircleDashed aria-hidden className="size-3 text-primary" />;
  if (status === 'completed')
    return <CheckCircle2 aria-hidden className="size-3 text-emerald-600" />;
  return <XCircle aria-hidden className="size-3 text-destructive" />;
}
