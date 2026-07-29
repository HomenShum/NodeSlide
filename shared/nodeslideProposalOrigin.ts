/**
 * Proposal authorship as a machine-readable fact.
 *
 * WHY THIS EXISTS
 * Both proposal trust surfaces already DISCLOSE deterministic-fallback authorship in visible
 * copy, and that copy is correct: the variation card renders "Deterministic fallback" plus a
 * "Fallback reason:" line, and the agent thread renders the planner's own step message
 * (`Planner · deterministic fallback: proposed N operations.`). What neither surface published
 * was an ATTRIBUTE. Trust-surfaces clause 1 asks that the state a decision turns on be
 * inspectable without a store, and for a proposal the decisive fact is who authored it — a
 * plan the model actually produced and a plan the deterministic fallback produced after the
 * provider failed are not the same offer, however identical the operations look.
 *
 * An agent reading the DOM could only recover authorship by string-matching English prose, so
 * the disclosure was legible to a person and invisible to a reader. This module is the single
 * place that turns a record's `origin` into the value written on the DOM.
 *
 * THE VOCABULARY IS THE RECORD'S, PLUS ONE
 * `free_route` and `deterministic_fallback` are exactly the planner receipt's own two values
 * (`convex/lib/nodeslideEditPlanner.ts`, `NodeSlideEditPlannerReceipt.origin`) and exactly the
 * variation record's own two (`nodeslideProposalOriginValidator`). Nothing is invented here.
 *
 * `unattributed` is the third, and it is not a synonym for either. Rows written before this
 * field existed genuinely do not know how they were authored. Rendering nothing for them would
 * make "the attribute is missing" mean two different things — a legacy row, and a surface that
 * silently stopped publishing — and a gate cannot tell those apart. So the attribute is ALWAYS
 * present and a legacy row says so in words.
 *
 * WHAT IS NEVER WRITTEN
 * The string `"undefined"`. An attribute stamped with the text of a missing value is worse
 * than an absent attribute: absent is a hole a gate can see, `"undefined"` is a hole wearing
 * the costume of an answer, and a reader that trusts it learns something false. So the mapping
 * refuses anything outside its vocabulary loudly rather than stringifying it — see the throw
 * below, and `nodeslideProposalOrigin.test.ts` for the knockout that pins it.
 */

/** The attribute every proposal surface publishes. Named once so the gates cannot mistype it. */
export const NODESLIDE_PROPOSAL_ORIGIN_ATTRIBUTE = 'data-proposal-origin';

/** Authorship as the planner and the variation harness record it. */
export type NodeSlideProposalOrigin = 'free_route' | 'deterministic_fallback';

/** Declared authorship a record can carry. `unattributed` is not one of these — see below. */
export const NODESLIDE_PROPOSAL_ORIGINS: readonly NodeSlideProposalOrigin[] = [
  'free_route',
  'deterministic_fallback',
];

/**
 * The honest value for a record that predates authorship provenance. It is a real answer
 * ("this row does not know"), which is why it is published rather than omitted.
 */
export const NODESLIDE_PROPOSAL_ORIGIN_UNATTRIBUTED = 'unattributed';

/** Every value the DOM attribute may carry. A value outside this set fails the census. */
export const NODESLIDE_PROPOSAL_ORIGIN_ATTRIBUTE_VALUES = [
  'free_route',
  'deterministic_fallback',
  'unattributed',
] as const;

export type NodeSlideProposalOriginAttributeValue =
  (typeof NODESLIDE_PROPOSAL_ORIGIN_ATTRIBUTE_VALUES)[number];

/**
 * Map a record's `origin` onto the attribute value.
 *
 * Takes `unknown` on purpose. The compiler already stops a typed caller from passing garbage;
 * this signature is for the boundary where the compiler is not looking — a serialized row, a
 * hand-built fixture, a future refactor that drops `origin` from the type and leaves the call
 * site reading `undefined` off a plain object. Absent is answered with `unattributed`; anything
 * else throws, because the alternative is stamping a surface with a value nobody declared.
 */
export function nodeSlideProposalOriginAttribute(
  origin: unknown,
): NodeSlideProposalOriginAttributeValue {
  if (origin === undefined || origin === null) return NODESLIDE_PROPOSAL_ORIGIN_UNATTRIBUTED;
  if (origin === 'free_route' || origin === 'deterministic_fallback') return origin;
  throw new Error(
    [
      `NodeSlide proposal origin ${JSON.stringify(origin)} is not declared authorship.`,
      `Expected one of ${NODESLIDE_PROPOSAL_ORIGINS.join(', ')}, or an absent value for an`,
      'unattributed legacy record. Refusing to write it onto a trust surface.',
    ].join(' '),
  );
}
