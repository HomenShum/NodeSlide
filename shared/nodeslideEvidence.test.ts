import { describe, expect, it } from 'vitest';
import {
  evidenceClaimTerms,
  highlightExcerpt,
  normalizeWebSourceExcerpt,
} from './nodeslideEvidence';

/**
 * Scenario: an owner runs web research; the agent persists text excerpts as
 * source records (there is no screenshot pipeline). These validators are the
 * exact storage path used by attachWebSourcesInternal, so they must reject
 * garbage the same way the mutation always has: throw on empty/oversized text
 * (the search adapter guarantees non-empty snippets, so silence would hide a
 * contract break) and SKIP — never abort the run — on a malformed URL.
 */
describe('normalizeWebSourceExcerpt (source-excerpt storage validators)', () => {
  const valid = {
    title: 'EV adoption in 2026',
    url: 'https://example.com/ev-report',
    snippet: 'Global EV adoption reached 28% of new sales in 2026.',
    provider: 'tavily',
  };

  it('normalizes whitespace and keeps a valid excerpt intact', () => {
    const normalized = normalizeWebSourceExcerpt({
      ...valid,
      title: '  EV   adoption\n in 2026 ',
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.title).toBe('EV adoption in 2026');
    expect(normalized?.snippet).toBe(valid.snippet);
    expect(normalized?.url).toBe('https://example.com/ev-report');
    expect(normalized?.provider).toBe('tavily');
  });

  it('throws on an empty excerpt instead of storing a blank snapshot', () => {
    expect(() => normalizeWebSourceExcerpt({ ...valid, snippet: '   ' })).toThrow(
      /web source excerpt is required/,
    );
  });

  it('throws on an oversized excerpt (1000-char cap) instead of truncating silently', () => {
    expect(() => normalizeWebSourceExcerpt({ ...valid, snippet: 'x'.repeat(1001) })).toThrow(
      /exceeds 1000 characters/,
    );
  });

  it('throws on empty title and provider', () => {
    expect(() => normalizeWebSourceExcerpt({ ...valid, title: '' })).toThrow(
      /web source title is required/,
    );
    expect(() => normalizeWebSourceExcerpt({ ...valid, provider: '\t' })).toThrow(
      /web source provider is required/,
    );
  });

  it('skips (returns null) on malformed or non-http URLs so one bad row never aborts the run', () => {
    expect(normalizeWebSourceExcerpt({ ...valid, url: 'not a url' })).toBeNull();
    expect(normalizeWebSourceExcerpt({ ...valid, url: 'javascript:alert(1)' })).toBeNull();
    expect(normalizeWebSourceExcerpt({ ...valid, url: 'ftp://example.com/file' })).toBeNull();
  });

  it('caps stored URLs at 900 characters', () => {
    const long = `https://example.com/${'a'.repeat(2000)}`;
    const normalized = normalizeWebSourceExcerpt({ ...valid, url: long });
    expect(normalized?.url.length).toBe(900);
  });
});

/**
 * Scenario: a slide claims "EV adoption reached 28%" citing a web source. The
 * Evidence tab must highlight ONLY terms the stored excerpt literally
 * contains — an honest text highlight, never invented emphasis.
 */
describe('evidenceClaimTerms', () => {
  const excerpt = 'Global EV adoption reached 28% of new sales in 2026, led by China.';

  it('returns significant claim tokens that literally appear in the excerpt', () => {
    const terms = evidenceClaimTerms(['EV adoption reached 28% in China'], excerpt);
    expect(terms).toEqual(['adoption', 'china', 'reached']);
  });

  it('drops short tokens, stopwords, and terms absent from the excerpt', () => {
    const terms = evidenceClaimTerms(['This slide is about hydrogen with more of them'], excerpt);
    expect(terms).toEqual([]);
  });

  it('returns nothing when there is no claim text', () => {
    expect(evidenceClaimTerms([], excerpt)).toEqual([]);
  });
});

describe('highlightExcerpt', () => {
  it('splits into segments whose concatenation reproduces the excerpt exactly', () => {
    const excerpt = 'Adoption grew; adoption will keep growing.';
    const segments = highlightExcerpt(excerpt, ['adoption']);
    expect(segments.map((segment) => segment.text).join('')).toBe(excerpt);
    expect(
      segments.filter((segment) => segment.highlighted).map((segment) => segment.text),
    ).toEqual(['Adoption', 'adoption']);
  });

  it('resolves overlapping terms without duplicating or dropping text', () => {
    const excerpt = 'renewable energy';
    const segments = highlightExcerpt(excerpt, ['renewable energy', 'energy']);
    expect(segments.map((segment) => segment.text).join('')).toBe(excerpt);
    expect(segments[0]).toEqual({ text: 'renewable energy', highlighted: true });
  });

  it('returns a single plain segment when no term matches', () => {
    const segments = highlightExcerpt('No matches here.', ['absent']);
    expect(segments).toEqual([{ text: 'No matches here.', highlighted: false }]);
  });

  it('returns an empty list for an empty excerpt (honest no-capture, nothing to fake)', () => {
    expect(highlightExcerpt('', ['term'])).toEqual([]);
  });
});
