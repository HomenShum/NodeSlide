import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  DeckPatch,
  NodeSlideAgentMessage,
  NodeSlideAgentRun,
} from '../../../../shared/nodeslide';
import { AgentThread } from './AgentThread';

/**
 * Scenario: a deck owner runs the live agent twice — one completed turn with a
 * reviewable patch, one still working. The thread must render BOTH turns in
 * order (multi-turn), show the visible tool steps, surface citations, keep the
 * patch actions inline, and never show a working shimmer on a settled run.
 * renderToStaticMarkup matches the repo's inspector test idiom (TraceInspector).
 */

function run(overrides: Partial<NodeSlideAgentRun>): NodeSlideAgentRun {
  return {
    id: 'run-1',
    deckId: 'deck-1',
    idempotencyKey: 'idem-1',
    instruction: 'Tighten the headline on slide 2',
    status: 'completed',
    provider: 'openrouter',
    model: 'moonshotai/kimi-k3',
    webResearch: false,
    attempt: 1,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  } as NodeSlideAgentRun;
}

function message(overrides: Partial<NodeSlideAgentMessage>): NodeSlideAgentMessage {
  return {
    id: 'msg-1',
    deckId: 'deck-1',
    runId: 'run-1',
    role: 'assistant',
    content: 'Done — tightened to eight words.',
    createdAt: 1,
    ...overrides,
  } as NodeSlideAgentMessage;
}

const reviewablePatch = {
  id: 'patch-1',
  deckId: 'deck-1',
  status: 'ready',
  summary: 'Rewrite slide 2 headline',
} as DeckPatch;

describe('AgentThread', () => {
  it('renders multi-turn conversation: settled turn with steps, citations, and inline patch; active turn with working state', () => {
    const html = renderToStaticMarkup(
      <AgentThread
        runs={[
          run({ id: 'run-2', instruction: 'Now add a source for the market size', status: 'researching', createdAt: 10 }),
          run({ id: 'run-1', patchId: 'patch-1' }),
        ]}
        messages={[
          message({ id: 'm1', runId: 'run-1', role: 'tool', toolName: 'read_slide', content: 'Read slide 2', createdAt: 1 }),
          message({ id: 'm2', runId: 'run-1', role: 'assistant', sourceIds: ['src-a', 'src-b'], createdAt: 2 }),
        ]}
        patches={[reviewablePatch]}
        onAcceptPatch={() => {}}
        onRejectPatch={() => {}}
      />,
    );

    // Multi-turn, chronological: run-1 (createdAt 1) renders before run-2 (createdAt 10)
    expect(html.indexOf('Tighten the headline')).toBeGreaterThan(-1);
    expect(html.indexOf('Tighten the headline')).toBeLessThan(html.indexOf('add a source for the market size'));

    // Visible step timeline from the tool message
    expect(html).toContain('read_slide');
    expect(html).toContain('Read slide 2');

    // Citations surfaced
    expect(html).toContain('2 sources');

    // Inline patch card with accept/reject in place
    expect(html).toContain('Rewrite slide 2 headline');
    expect(html).toContain('agent-thread-patch-accept');
    expect(html).toContain('agent-thread-patch-reject');

    // Active turn shows honest working state; settled turn does not
    expect(html).toContain('Researching');
    expect(html).toContain('Working…');
    const settledTurn = html.slice(html.indexOf('data-run-id="run-1"'), html.indexOf('data-run-id="run-2"'));
    expect(settledTurn).not.toContain('Working…');
  });

  it('renders a failed run with its error text, and a settled patch without action buttons', () => {
    const html = renderToStaticMarkup(
      <AgentThread
        runs={[run({ id: 'run-3', status: 'failed', error: 'provider timeout', patchId: 'patch-2' })]}
        messages={[]}
        patches={[{ ...reviewablePatch, id: 'patch-2', status: 'applied' } as DeckPatch]}
        onAcceptPatch={() => {}}
        onRejectPatch={() => {}}
      />,
    );
    expect(html).toContain('provider timeout');
    expect(html).toContain('Patch applied');
    expect(html).not.toContain('agent-thread-patch-accept');
  });

  it('renders the empty-state invitation when no runs exist', () => {
    const html = renderToStaticMarkup(
      <AgentThread runs={[]} messages={[]} patches={[]} onAcceptPatch={() => {}} onRejectPatch={() => {}} />,
    );
    expect(html).toContain('agent-thread-empty');
  });
});
