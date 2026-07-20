import { describe, expect, it, vi } from 'vitest';
import {
  createNodeSlideAssistantStreamProjector,
  partialJsonStringField,
} from './nodeslideAssistantStream';

describe('NodeSlide durable assistant streaming', () => {
  it('extracts only the incremental summary string from incomplete structured output', () => {
    expect(partialJsonStringField('{"summary":"A sharper', 'summary')).toBe('A sharper');
    expect(
      partialJsonStringField('{"note":"\\"summary\\": fake","summary":"Real\\ncopy', 'summary'),
    ).toBe('Real\ncopy');
    expect(partialJsonStringField('{"summary":"Waiting on \\u20', 'summary')).toBe('Waiting on ');
    expect(partialJsonStringField('{"operations":[]}', 'summary')).toBeUndefined();
  });

  it('persists bounded live prefixes and completes with the validated summary', async () => {
    const write = vi.fn(async () => undefined);
    const projector = createNodeSlideAssistantStreamProjector({ write, minChunkChars: 8 });

    await projector.observe({
      delta: 'unused',
      accumulatedText: '{"summary":"Sharper',
      attempt: 1,
      repairAttempt: false,
    });
    await projector.observe({
      delta: ' unused',
      accumulatedText: '{"summary":"Sharper thesis for the board.',
      attempt: 1,
      repairAttempt: false,
    });
    expect(write).toHaveBeenCalledWith({
      content: 'Sharper thesis for the board.',
      state: 'streaming',
    });
    expect(await projector.complete('Sharper thesis for the board.', ['source-board'])).toBe(true);
    expect(write).toHaveBeenLastCalledWith({
      content: 'Sharper thesis for the board.',
      state: 'complete',
      sourceIds: ['source-board'],
    });
  });

  it('marks a visible first attempt interrupted instead of presenting repaired JSON as its stream', async () => {
    const write = vi.fn(async () => undefined);
    const projector = createNodeSlideAssistantStreamProjector({ write, minChunkChars: 8 });
    await projector.observe({
      delta: '',
      accumulatedText: '{"summary":"Visible first draft',
      attempt: 1,
      repairAttempt: false,
    });
    await projector.observe({
      delta: '',
      accumulatedText: '{"summary":"Repaired draft',
      attempt: 2,
      repairAttempt: true,
    });

    expect(projector.wasInterrupted()).toBe(true);
    expect(await projector.complete('Repaired draft')).toBe(false);
    expect(write).toHaveBeenLastCalledWith({
      content:
        'The initial provider draft was discarded while NodeSlide repaired its structured response.',
      state: 'interrupted',
    });
  });
});
