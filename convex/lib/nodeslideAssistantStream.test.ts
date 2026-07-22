import { describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_ASSISTANT_STREAM_CONTENT_LIMIT,
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

  it('ignores nested, array, and JSON-looking summary fields', () => {
    expect(
      partialJsonStringField(
        '{"operations":[{"summary":"raw operation text"}],"summary":"Visible top level',
        'summary',
      ),
    ).toBe('Visible top level');
    expect(
      partialJsonStringField(
        '{"operations":{"nested":{"summary":"raw nested text"}},"summary":"Safe prefix',
        'summary',
      ),
    ).toBe('Safe prefix');
    expect(
      partialJsonStringField(
        '{"operations":[{"value":"\\"summary\\":\\"string spoof\\""}]}',
        'summary',
      ),
    ).toBeUndefined();
    expect(
      partialJsonStringField('{"operations":[{"summary":"raw operation text', 'summary'),
    ).toBeUndefined();
  });

  it('decodes a real escaped top-level key without accepting escaped-key spoofs', () => {
    expect(partialJsonStringField('{"sum\\u006dary":"Escaped key prefix', 'summary')).toBe(
      'Escaped key prefix',
    );
    expect(
      partialJsonStringField(
        '{"not\\"summary":"spoof","summary":"Actual top-level prefix',
        'summary',
      ),
    ).toBe('Actual top-level prefix');
    expect(
      partialJsonStringField('{"note":"\\"summary\\": spoof only"}', 'summary'),
    ).toBeUndefined();
  });

  it('fails closed when a malformed earlier member precedes summary-looking bytes', () => {
    expect(
      partialJsonStringField('{"operations":[,],"summary":"must not stream', 'summary'),
    ).toBeUndefined();
    expect(partialJsonStringField('{"note":"bad\\q","summary":"must not stream', 'summary')).toBe(
      undefined,
    );
    expect(partialJsonStringField('{"summary":"bad\\qprefix', 'summary')).toBeUndefined();
  });

  it('never persists a nested summary before the validated top-level field arrives', async () => {
    const write = vi.fn(async () => undefined);
    const projector = createNodeSlideAssistantStreamProjector({ write, minChunkChars: 8 });

    await projector.observe({
      delta: '',
      accumulatedText: '{"operations":[{"summary":"raw operation prefix',
      attempt: 1,
      repairAttempt: false,
    });
    expect(write).not.toHaveBeenCalled();
    expect(projector.hasStarted()).toBe(false);

    await projector.observe({
      delta: '',
      accumulatedText:
        '{"operations":[{"summary":"raw operation"}],"summary":"Safe assistant prefix',
      attempt: 1,
      repairAttempt: false,
    });
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenLastCalledWith({
      content: 'Safe assistant prefix',
      state: 'streaming',
    });
    expect(await projector.complete('Safe assistant prefix completed')).toBe(true);
    expect(write).toHaveBeenLastCalledWith({
      content: 'Safe assistant prefix completed',
      state: 'complete',
    });
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

  it('interrupts once when an untrusted summary crosses the persistence bound', async () => {
    const write = vi.fn(async () => undefined);
    const projector = createNodeSlideAssistantStreamProjector({ write, minChunkChars: 8 });
    await projector.observe({
      delta: '',
      accumulatedText: '{"summary":"Visible prefix',
      attempt: 1,
      repairAttempt: false,
    });
    for (let index = 0; index < 20; index += 1) {
      await projector.observe({
        delta: 'x',
        accumulatedText: `{"summary":"Visible prefix${'x'.repeat(
          NODESLIDE_ASSISTANT_STREAM_CONTENT_LIMIT + index + 1,
        )}`,
        attempt: 1,
        repairAttempt: false,
      });
    }

    expect(projector.wasInterrupted()).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith({
      content: "The provider draft exceeded NodeSlide's safe streaming limit and was discarded.",
      state: 'interrupted',
    });
  });

  it('withholds a validated completion that rewrites the persisted prefix', async () => {
    const write = vi.fn(async () => undefined);
    const projector = createNodeSlideAssistantStreamProjector({ write, minChunkChars: 8 });
    await projector.observe({
      delta: '',
      accumulatedText: '{"summary":"Visible provider prefix',
      attempt: 1,
      repairAttempt: false,
    });

    expect(await projector.complete('Different validated summary')).toBe(false);
    expect(projector.wasInterrupted()).toBe(true);
    expect(write).toHaveBeenLastCalledWith({
      content:
        'The validated assistant result did not extend the visible provider prefix and was withheld.',
      state: 'interrupted',
    });
  });
});
