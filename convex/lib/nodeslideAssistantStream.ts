import type { NodeSlideProviderTextDelta } from './nodeslideProvider';

export type NodeSlideAssistantStreamState = 'streaming' | 'complete' | 'interrupted';

export const NODESLIDE_ASSISTANT_STREAM_CONTENT_LIMIT = 4000;

export interface NodeSlideAssistantStreamUpdate {
  content: string;
  state: NodeSlideAssistantStreamState;
  sourceIds?: string[];
}

/**
 * Projects only the assistant-readable `summary` string out of the provider's
 * streamed structured response. Raw JSON and operations are never persisted in
 * the conversation. Writes are bounded so token-sized deltas do not become a
 * mutation per token.
 */
export function createNodeSlideAssistantStreamProjector(args: {
  write: (update: NodeSlideAssistantStreamUpdate) => Promise<void>;
  minChunkChars?: number;
}) {
  const minChunkChars = Math.max(8, Math.min(80, args.minChunkChars ?? 24));
  let persisted = '';
  let started = false;
  let interrupted = false;

  return {
    async observe(event: NodeSlideProviderTextDelta): Promise<void> {
      if (interrupted) return;
      if (event.repairAttempt) {
        interrupted = true;
        if (started) {
          await bestEffortWrite(args.write, {
            content:
              'The initial provider draft was discarded while NodeSlide repaired its structured response.',
            state: 'interrupted',
          });
        }
        return;
      }
      const summary = partialJsonStringField(event.accumulatedText, 'summary');
      if (summary === undefined || !summary.startsWith(persisted)) return;
      if (summary.length > NODESLIDE_ASSISTANT_STREAM_CONTENT_LIMIT) {
        interrupted = true;
        if (started) {
          await bestEffortWrite(args.write, {
            content:
              "The provider draft exceeded NodeSlide's safe streaming limit and was discarded.",
            state: 'interrupted',
          });
        }
        return;
      }
      const requiredDelta = started ? minChunkChars : 1;
      if (summary.length - persisted.length < requiredDelta) return;
      if (await bestEffortWrite(args.write, { content: summary, state: 'streaming' })) {
        persisted = summary;
        started = true;
      }
    },

    async complete(validatedSummary: string, sourceIds: readonly string[] = []): Promise<boolean> {
      if (!started || interrupted) return false;
      if (!validatedSummary.startsWith(persisted)) {
        interrupted = true;
        await bestEffortWrite(args.write, {
          content:
            'The validated assistant result did not extend the visible provider prefix and was withheld.',
          state: 'interrupted',
        });
        return false;
      }
      const completed = await bestEffortWrite(args.write, {
        content: validatedSummary,
        state: 'complete',
        ...(sourceIds.length ? { sourceIds: sourceIds.slice(0, 32) } : {}),
      });
      if (completed) persisted = validatedSummary;
      return completed;
    },

    async interrupt(message: string): Promise<void> {
      interrupted = true;
      if (!started) return;
      await bestEffortWrite(args.write, { content: message, state: 'interrupted' });
    },

    hasStarted(): boolean {
      return started;
    },

    wasInterrupted(): boolean {
      return interrupted;
    },
  };
}

async function bestEffortWrite(
  write: (update: NodeSlideAssistantStreamUpdate) => Promise<void>,
  update: NodeSlideAssistantStreamUpdate,
): Promise<boolean> {
  try {
    await write(update);
    return true;
  } catch {
    return false;
  }
}

/**
 * Incrementally decodes one top-level JSON string field without attempting to
 * parse the incomplete target value. Completed members before the target are
 * still structurally validated, so a nested or JSON-looking `summary` cannot be
 * mistaken for the assistant-readable field. An unfinished escape is withheld
 * until the next provider delta.
 */
export function partialJsonStringField(source: string, field: string): string | undefined {
  let cursor = skipWhitespace(source, 0);
  if (source[cursor] !== '{') return undefined;
  cursor += 1;

  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] === '}') return undefined;
    if (source[cursor] !== '"') return undefined;

    const key = readJsonString(source, cursor);
    if (!key.valid || !key.closed) return undefined;
    cursor = skipWhitespace(source, key.next);
    if (source[cursor] !== ':') return undefined;
    cursor = skipWhitespace(source, cursor + 1);

    if (key.value === field) {
      if (source[cursor] !== '"') return undefined;
      const value = readJsonString(source, cursor);
      return value.valid ? value.value : undefined;
    }

    const valueEnd = skipCompleteJsonValue(source, cursor);
    if (valueEnd === undefined) return undefined;
    cursor = skipWhitespace(source, valueEnd);
    if (source[cursor] === ',') {
      cursor += 1;
      continue;
    }
    if (source[cursor] === '}') return undefined;
    return undefined;
  }
  return undefined;
}

function readJsonString(
  source: string,
  openingQuote: number,
): { value: string; next: number; closed: boolean; valid: boolean } {
  if (source[openingQuote] !== '"') {
    return { value: '', next: openingQuote, closed: false, valid: false };
  }
  let value = '';
  let cursor = openingQuote + 1;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '"') return { value, next: cursor + 1, closed: true, valid: true };
    if (character !== '\\') {
      if ((character?.charCodeAt(0) ?? 0) <= 0x1f) {
        return { value, next: cursor, closed: false, valid: false };
      }
      value += character;
      cursor += 1;
      continue;
    }
    const escapeCode = source[cursor + 1];
    if (escapeCode === undefined) {
      return { value, next: source.length, closed: false, valid: true };
    }
    const simpleEscapes: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    if (escapeCode in simpleEscapes) {
      value += simpleEscapes[escapeCode];
      cursor += 2;
      continue;
    }
    if (escapeCode === 'u') {
      const digits = source.slice(cursor + 2, cursor + 6);
      if (digits.length < 4) {
        return { value, next: source.length, closed: false, valid: true };
      }
      if (!/^[0-9a-f]{4}$/iu.test(digits)) {
        return { value, next: cursor + 2, closed: false, valid: false };
      }
      value += String.fromCharCode(Number.parseInt(digits, 16));
      cursor += 6;
      continue;
    }
    return { value, next: cursor + 2, closed: false, valid: false };
  }
  return { value, next: cursor, closed: false, valid: true };
}

function skipCompleteJsonValue(source: string, start: number): number | undefined {
  const first = source[start];
  if (first === '"') {
    const value = readJsonString(source, start);
    return value.valid && value.closed ? value.next : undefined;
  }

  if (first === '{' || first === '[') {
    const closers: string[] = [first === '{' ? '}' : ']'];
    let cursor = start + 1;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === '"') {
        const value = readJsonString(source, cursor);
        if (!value.valid || !value.closed) return undefined;
        cursor = value.next;
        continue;
      }
      if (character === '{' || character === '[') {
        closers.push(character === '{' ? '}' : ']');
        cursor += 1;
        continue;
      }
      if (character === '}' || character === ']') {
        if (closers.pop() !== character) return undefined;
        cursor += 1;
        if (closers.length === 0) {
          return isCompleteJsonValue(source.slice(start, cursor)) ? cursor : undefined;
        }
        continue;
      }
      cursor += 1;
    }
    return undefined;
  }

  let cursor = start;
  while (cursor < source.length && source[cursor] !== ',' && source[cursor] !== '}') cursor += 1;
  if (cursor === source.length) return undefined;
  return isCompleteJsonValue(source.slice(start, cursor)) ? cursor : undefined;
}

function isCompleteJsonValue(source: string): boolean {
  try {
    JSON.parse(source);
    return true;
  } catch {
    return false;
  }
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length && /\s/u.test(source[cursor] ?? '')) cursor += 1;
  return cursor;
}
