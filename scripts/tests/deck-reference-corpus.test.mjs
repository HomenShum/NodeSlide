import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateDeckReferenceCorpus } from '../validate-deck-reference-corpus.mjs';

const corpus = JSON.parse(
  await readFile(
    new URL('../../benchmarks/deck-reference-corpus/v1/references.json', import.meta.url),
    'utf8',
  ),
);

describe('deck reference corpus', () => {
  it('covers real finance and research personas from 50-100 slides down to opportunity memos', () => {
    expect(validateDeckReferenceCorpus(corpus)).toEqual([]);
  });

  it('rejects a compression workflow that silently permits invented numbers', () => {
    const unsafe = structuredClone(corpus);
    unsafe.transformations[0].lossBudget.unsourcedNumbers = 1;

    expect(validateDeckReferenceCorpus(unsafe)).toContain(
      `${unsafe.transformations[0].id} lossBudget.unsourcedNumbers must be zero`,
    );
  });

  it('rejects a benchmark whose reference cannot be traced', () => {
    const ungrounded = structuredClone(corpus);
    ungrounded.transformations[0].sourceRefs.push('private-missing-deck');

    expect(validateDeckReferenceCorpus(ungrounded)).toContain(
      `${ungrounded.transformations[0].id} references unknown source private-missing-deck`,
    );
  });
});
