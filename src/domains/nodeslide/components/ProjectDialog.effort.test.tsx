// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProjectDialog } from './ProjectDialog';

/**
 * Scenario: a designer opens New deck, deliberately sets Reasoning effort to High on Claude Sonnet 5.5
 * (whose own default is High), then switches the model to Claude Opus 5.5 (default Medium). The
 * effort they picked must survive the switch, and an effort they never touched must follow the model.
 * A saved draft's effort counts as chosen. The picker used to guess "untouched" from equality with the
 * previous row's default, so the deliberate High became Medium.
 */
const SONNET = 'anthropic/claude-sonnet-5.5';
const OPUS = 'anthropic/claude-opus-5.5';

function renderDialog(initialDraft?: Parameters<typeof ProjectDialog>[0]['initialDraft']) {
  return render(
    <ProjectDialog
      open
      clientSessionId="session-1"
      recentDecks={[]}
      creating={false}
      onClose={() => undefined}
      onCreate={() => undefined}
      onOpenDeck={() => undefined}
      {...(initialDraft ? { initialDraft } : {})}
    />,
  );
}

const model = () => screen.getByTestId('create-model-select') as HTMLSelectElement;
const effort = () => screen.getByTestId('create-effort-select') as HTMLSelectElement;
const pickModel = (id: string) => fireEvent.change(model(), { target: { value: id } });
const pickEffort = (id: string) => fireEvent.change(effort(), { target: { value: id } });

describe('new-deck dialog effort across model changes', () => {
  // jsdom has no <dialog> modal API; the dialog only needs to be open for its form to render.
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open');
    };
  });
  afterEach(cleanup);

  it('keeps a deliberately chosen effort equal to the previous row default', () => {
    renderDialog();
    pickModel(SONNET);
    pickEffort('high');
    pickModel(OPUS);
    expect(effort().value).toBe('high');
  });

  it('keeps a chosen Medium when moving from Opus 5.5 to Sonnet 5.5', () => {
    renderDialog();
    pickModel(OPUS);
    pickEffort('medium');
    pickModel(SONNET);
    expect(effort().value).toBe('medium');
  });

  it('moves an untouched effort to each row default', () => {
    renderDialog();
    expect(effort().value).toBe('high');
    pickModel(OPUS);
    expect(effort().value).toBe('medium');
    pickModel(SONNET);
    expect(effort().value).toBe('high');
  });

  it('treats the effort saved in a draft as chosen', () => {
    renderDialog({
      title: '',
      prompt: '',
      providerMode: 'openrouter_free',
      providerModel: SONNET,
      providerEffort: 'high',
    });
    pickModel(OPUS);
    expect(effort().value).toBe('high');
  });
});
