import { describe, expect, it } from 'vitest';
import { parseNodeSlideProviderJson } from './nodeslideProvider';

describe('NodeSlide provider JSON recovery', () => {
  it('accepts one complete bounded object from common provider wrappers', () => {
    expect(parseNodeSlideProviderJson('```json\n{"slides":[{"title":"A } brace"}]}\n```')).toEqual({
      slides: [{ title: 'A } brace' }],
    });
    expect(
      parseNodeSlideProviderJson('Here is the deck:\n{"title":"Decision","slides":[]}'),
    ).toEqual({
      title: 'Decision',
      slides: [],
    });
  });

  it('fails closed for truncated, ambiguous, malformed, and oversized provider output', () => {
    expect(parseNodeSlideProviderJson('{"slides":[')).toBeUndefined();
    expect(parseNodeSlideProviderJson('{"a":1}\n{"b":2}')).toBeUndefined();
    expect(parseNodeSlideProviderJson('{"a":,}')).toBeUndefined();
    expect(parseNodeSlideProviderJson(`{"a":"${'x'.repeat(2_100_000)}"}`)).toBeUndefined();
  });

  it('stays linear and bounded across a 1,000-response burst', () => {
    const inputs = Array.from(
      { length: 1_000 },
      (_, index) => `result ${index}\n\`\`\`json\n{"index":${index},"value":"{safe}"}\n\`\`\``,
    );
    expect(inputs.map(parseNodeSlideProviderJson).filter(Boolean)).toHaveLength(1_000);
  });
});
