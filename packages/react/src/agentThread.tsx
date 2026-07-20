import type { FormEvent } from 'react';

export type NodeSlideAgentThreadRole =
  | 'user'
  | 'assistant'
  | 'planner'
  | 'executor'
  | 'verifier'
  | 'system';

export interface NodeSlideAgentThreadEntry {
  id: string;
  role: NodeSlideAgentThreadRole;
  text: string;
  status?: 'working' | 'awaiting_review' | 'completed' | 'failed';
  parentEntryId?: string;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number;
}

export interface DeckAgentThreadProps {
  entries: readonly NodeSlideAgentThreadEntry[];
  value: string;
  onValueChange(value: string): void;
  onSubmit(value: string): void;
  onCancel?: () => void;
  disabled?: boolean;
  busy?: boolean;
  submitLabel?: string;
}

/** Controlled thread transcript and composer; model/runtime ownership stays with the host. */
export function DeckAgentThread({
  entries,
  value,
  onValueChange,
  onSubmit,
  onCancel,
  disabled = false,
  busy = false,
  submitLabel = 'Send',
}: DeckAgentThreadProps) {
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled || busy) return;
    onSubmit(trimmed);
  }

  return (
    <section
      aria-busy={busy}
      aria-label="Agent thread"
      className="nsx-agent-thread"
      data-nodeslide-surface="agent-thread"
    >
      <ol aria-live="polite" className="nsx-agent-entries">
        {entries.map((entry) => (
          <li
            className={`nsx-agent-entry nsx-agent-entry--${entry.role}`}
            data-parent-entry-id={entry.parentEntryId}
            key={entry.id}
          >
            <header>
              <strong>{entry.role}</strong>
              {entry.status ? <span>{entry.status.replace('_', ' ')}</span> : null}
            </header>
            <p>{entry.text}</p>
            {entry.inputTokens !== undefined || entry.outputTokens !== undefined ? (
              <small>
                {entry.inputTokens ?? 0} → {entry.outputTokens ?? 0} tokens
                {entry.costMicroUsd === undefined
                  ? ''
                  : ` · $${(entry.costMicroUsd / 1_000_000).toFixed(4)}`}
              </small>
            ) : null}
          </li>
        ))}
      </ol>
      <form className="nsx-agent-composer" onSubmit={submit}>
        <label>
          <span>Ask the presentation agent</span>
          <textarea
            disabled={disabled}
            onChange={(event) => onValueChange(event.currentTarget.value)}
            value={value}
          />
        </label>
        <div>
          {busy && onCancel ? (
            <button onClick={onCancel} type="button">
              Cancel
            </button>
          ) : null}
          <button disabled={disabled || busy || value.trim().length === 0} type="submit">
            {submitLabel}
          </button>
        </div>
      </form>
    </section>
  );
}
