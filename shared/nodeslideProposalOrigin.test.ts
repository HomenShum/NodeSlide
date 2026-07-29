import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_PROPOSAL_ORIGINS,
  NODESLIDE_PROPOSAL_ORIGIN_ATTRIBUTE,
  NODESLIDE_PROPOSAL_ORIGIN_ATTRIBUTE_VALUES,
  nodeSlideProposalOriginAttribute,
} from './nodeslideProposalOrigin';

/*
 * Scenario: an agent is about to accept a patch on the deck owner's behalf. It reads the
 * proposal card's attributes. Whatever this function returns is what that agent believes about
 * who wrote the change it is accepting.
 *
 * That framing decides every case below. There are exactly three honest answers — the model
 * route wrote it, the deterministic fallback wrote it, or the record is old enough that it does
 * not know — and one answer that is worse than saying nothing at all.
 */

describe('the value an agent reads off a proposal card', () => {
  it('passes through the two authorship values the planner receipt actually records', () => {
    for (const origin of NODESLIDE_PROPOSAL_ORIGINS) {
      expect(nodeSlideProposalOriginAttribute(origin)).toBe(origin);
    }
    // The vocabulary is the record's, not an invention of the presentation layer.
    expect(NODESLIDE_PROPOSAL_ORIGINS).toEqual(['free_route', 'deterministic_fallback']);
  });

  it('answers `unattributed` for a legacy record, which is a fact rather than a shrug', () => {
    /*
     * Rows written before this field existed genuinely do not know how they were authored.
     * Rendering nothing for them would make an absent attribute mean two different things — an
     * old row, and a surface that silently stopped publishing — and no gate can tell those
     * apart. So the attribute is always present and an old row says so in words.
     */
    expect(nodeSlideProposalOriginAttribute(undefined)).toBe('unattributed');
    expect(nodeSlideProposalOriginAttribute(null)).toBe('unattributed');
  });

  it('NEVER returns the literal string "undefined", for any input at all', () => {
    /*
     * The knockout that matters most. `String(patch.origin)` on a record without the field
     * produces the four-letter word "undefined", React sets it as an attribute value without
     * complaint, and a reader takes it for an answer. An absent attribute is a hole a gate can
     * see; "undefined" is a hole wearing the costume of an answer.
     */
    const hostile = [
      undefined,
      null,
      'undefined',
      'null',
      '',
      '   ',
      0,
      false,
      Number.NaN,
      {},
      [],
      { origin: 'free_route' },
      'FREE_ROUTE',
      'free route',
      'deterministic-fallback',
    ];
    for (const input of hostile) {
      let produced: string;
      try {
        produced = nodeSlideProposalOriginAttribute(input);
      } catch {
        // Refusing loudly is the correct outcome for anything outside the vocabulary.
        continue;
      }
      expect(produced, `input ${JSON.stringify(input)}`).not.toBe('undefined');
      expect(produced, `input ${JSON.stringify(input)}`).not.toBe('null');
      expect(NODESLIDE_PROPOSAL_ORIGIN_ATTRIBUTE_VALUES).toContain(produced);
    }
  });

  it('throws rather than stringifying a value nobody declared', () => {
    // Loud, not lenient. A silent coercion here is how an invented word ends up on a trust
    // surface and teaches every reader after it something false.
    expect(() => nodeSlideProposalOriginAttribute('undefined')).toThrow(/not declared authorship/);
    expect(() => nodeSlideProposalOriginAttribute('model')).toThrow(/not declared authorship/);
    expect(() => nodeSlideProposalOriginAttribute('')).toThrow(/not declared authorship/);
    expect(() => nodeSlideProposalOriginAttribute(0)).toThrow(/not declared authorship/);
    // The refusal names the value it refused, so the fix does not start with a bisect.
    expect(() => nodeSlideProposalOriginAttribute('model')).toThrow(/"model"/);
  });

  it('names the attribute once so the writers and the gates cannot disagree by typo', () => {
    expect(NODESLIDE_PROPOSAL_ORIGIN_ATTRIBUTE).toBe('data-proposal-origin');
    // `unattributed` is in the ATTRIBUTE vocabulary and deliberately not in the RECORD's: a row
    // never stores "we don't know", it simply has no field. Collapsing the two lists would let
    // a writer persist the placeholder as though it were a measurement.
    expect(NODESLIDE_PROPOSAL_ORIGIN_ATTRIBUTE_VALUES).toContain('unattributed');
    expect(NODESLIDE_PROPOSAL_ORIGINS).not.toContain('unattributed');
  });
});
