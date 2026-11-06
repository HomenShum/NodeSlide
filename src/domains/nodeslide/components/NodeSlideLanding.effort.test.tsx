// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSlideLanding } from './NodeSlideLanding';

/**
 * Scenario: a designer opens the landing composer, deliberately sets Reasoning effort to High on
 * Claude Sonnet 5.5 (whose own default is High), then switches the model to Claude Opus 5.5 (whose
 * default is Medium). The effort they picked must survive the switch. An effort they never touched
 * must follow the model, so a fresh Opus 5.5 composer reads Medium. Before round 4 the picker kept
 * only the effort value and guessed "untouched" from equality with the previous row's default, so the
 * deliberate High was replaced with Medium.
 */
const SONNET = 'anthropic/claude-sonnet-5.5';
const OPUS = 'anthropic/claude-opus-5.5';

function renderLanding() {
  return render(
    <NodeSlideLanding
      clientSessionId="session-1"
      recentDecks={[]}
      creating={false}
      onCreate={() => undefined}
      onExploreSample={() => undefined}
      onOpenProjects={() => undefined}
      onOpenDeck={() => undefined}
    />,
  );
}

const model = () => screen.getByTestId('landing-model-select') as HTMLSelectElement;
const effort = () => screen.getByTestId('landing-effort-select') as HTMLSelectElement;
const pickModel = (id: string) => fireEvent.change(model(), { target: { value: id } });
const pickEffort = (id: string) => fireEvent.change(effort(), { target: { value: id } });

describe('landing composer effort across model changes', () => {
  afterEach(cleanup);

  it('keeps a deliberately chosen effort equal to the previous row default', () => {
    renderLanding();
    pickModel(SONNET);
    expect(effort().value).toBe('high');
    pickEffort('high');
    pickModel(OPUS);
    expect(effort().value).toBe('high');
  });

  it('keeps a chosen Medium when moving from Opus 5.5 to Sonnet 5.5', () => {
    renderLanding();
    pickModel(OPUS);
    pickEffort('medium');
    pickModel(SONNET);
    expect(effort().value).toBe('medium');
  });

  it('moves an untouched effort to each row default', () => {
    renderLanding();
    expect(effort().value).toBe('high');
    pickModel(OPUS);
    expect(effort().value).toBe('medium');
    pickModel(SONNET);
    expect(effort().value).toBe('high');
  });

  it('falls to the row default when the chosen effort is unsupported, and shows it again after', () => {
    renderLanding();
    pickModel(OPUS);
    pickEffort('xhigh');
    pickModel('moonshotai/kimi-k3');
    expect(effort().value).toBe('high');
    pickModel(OPUS);
    expect(effort().value).toBe('xhigh');
  });
});
