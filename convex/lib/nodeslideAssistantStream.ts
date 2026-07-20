import type { NodeSlideProviderTextDelta } from './nodeslideProvider';

export type NodeSlideAssistantStreamState = 'streaming' | 'complete' | 'interrupted';

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
      const requiredDelta = started ? minChunkChars : 1;
      if (summary.length - persisted.length < requiredDelta) return;
      if (await bestEffortWrite(args.write, { content: summary, state: 'streaming' })) {
        persisted = summary;
        started = true;
      }
    },

    async complete(validatedSummary: string, sourceIds: readonly string[] = []): Promise<boolean> {
      if (!started || interrupted) return false;
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
 * Incrementally decodes one JSON string field without attempting to parse an
 * incomplete response. The scanner skips escaped quotes and returns only the
 * complete prefix that is safe to display; an unfinished escape is withheld
 * until the next provider delta.
 */
export function partialJsonStringField(source: string, field: string): string | undefined {
  let cursor = 0;
  while (cursor < source.length) {
    const quote = source.indexOf('"', cursor);
    if (quote < 0) return undefined;
    const key = readJsonString(source, quote);
    if (!key.closed) return undefined;
    cursor = key.next;
    if (key.value !== field) continue;
    let separator = skipWhitespace(source, cursor);
    if (source[separator] !== ':') continue;
    separator = skipWhitespace(source, separator + 1);
    if (source[separator] !== '"') continue;
    return readJsonString(source, separator).value;
  }
  return undefined;
}

function readJsonString(
  source: string,
  openingQuote: number,
): { value: string; next: number; closed: boolean } {
  let value = '';
  let cursor = openingQuote + 1;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === '"') return { value, next: cursor + 1, closed: true };
    if (character !== '\\') {
      value += character;
      cursor += 1;
      continue;
    }
    const escapeCode = source[cursor + 1];
    if (escapeCode === undefined) return { value, next: source.length, closed: false };
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
      if (digits.length < 4) return { value, next: source.length, closed: false };
      if (!/^[0-9a-f]{4}$/iu.test(digits)) return { value, next: cursor + 2, closed: false };
      value += String.fromCharCode(Number.parseInt(digits, 16));
      cursor += 6;
      continue;
    }
    return { value, next: cursor + 2, closed: false };
  }
  return { value, next: cursor, closed: false };
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length && /\s/u.test(source[cursor] ?? '')) cursor += 1;
  return cursor;
}
