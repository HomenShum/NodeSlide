import type { NodeSlideProofObligation, NodeSlideStorySpec } from './nodeslideStoryContext';

/**
 * Room-Ready — the decision layer over the existing StorySpec.
 *
 * A deck can satisfy every artifact gate in this project and still fail in the room. The gates
 * prove that a chart is a real chart. They do not ask what decision the audience must make, who
 * objects, or whether the deck fits the time available.
 *
 * This module is a SKILL over `NodeSlideStorySpec`, not a second schema owner. That constraint
 * comes from the design review and it is the important part: a separate document would let the
 * decision, the audience, and the story drift apart from the deck they describe. So Room-Ready
 * reads the StorySpec that already exists, and writes a receipt beside it.
 *
 * Three of the five tests already have an anchor in the current StorySpec:
 *   - `pacing` already carries a `decide` phase, but no decision sentence.
 *   - `memorableTakeaway` is the one-slide test, but nothing enforces it.
 *   - `pacing[].slideCount` is the rehearsal, but there is no time budget.
 *
 * The other two, the room map and the objection, have no anchor and are added here.
 *
 * Nothing in this module invents an answer. A field the author did not supply produces a finding,
 * never a default. That rule is the same one the artifact gates use: absence is reported, and it is
 * never scored as a pass.
 */

export const NODESLIDE_ROOM_READY_VERSION = 'nodeslide.room-ready/v1' as const;

/** How the audience receives the deck. The mode changes what "ready" means. */
export type NodeSlideCommunicationMode = 'speaker-led' | 'read-alone' | 'leave-behind';

/** One person or group in the room, and what they will push back on. */
export interface NodeSlideRoomStakeholder {
  id: string;
  /** The role, not the name. Example: "finance lead". */
  role: string;
  /** What this person needs to believe before they agree. */
  concern: string;
  /** The proof obligation that answers the concern, if one exists. */
  answeredByObligationId?: string;
}

/**
 * The decision intent an author states before slides exist.
 *
 * This is the extension. It attaches to a StorySpec; it does not replace one.
 */
export interface NodeSlideRoomIntent {
  schemaVersion: typeof NODESLIDE_ROOM_READY_VERSION;
  /**
   * One sentence naming the decision the audience must make.
   *
   * Not the subject ("Market B expansion"). Not the agenda ("market analysis, economics, rollout").
   * A decision an audience can agree to or refuse.
   */
  decision: string;
  stakeholders: NodeSlideRoomStakeholder[];
  communicationMode: NodeSlideCommunicationMode;
  /** Minutes available. The rehearsal test compares this against the pacing. */
  timeBudgetMinutes: number;
}

export type NodeSlideRoomTestId =
  | 'decision-sentence'
  | 'room-map'
  | 'objection'
  | 'one-slide'
  | 'rehearsal';

export type NodeSlideRoomVerdict = 'ready' | 'not-ready' | 'not-stated';

export interface NodeSlideRoomFinding {
  test: NodeSlideRoomTestId;
  verdict: NodeSlideRoomVerdict;
  /** What the author must change. Empty when the test is ready. */
  detail: string;
}

export interface NodeSlideRoomReadyReceipt {
  schemaVersion: typeof NODESLIDE_ROOM_READY_VERSION;
  findings: NodeSlideRoomFinding[];
  readyCount: number;
  /** True only when every test is ready. `not-stated` is not ready. */
  ready: boolean;
  summary: string;
}

/** Minutes one slide costs in a speaker-led meeting. Used by the rehearsal test. */
const MINUTES_PER_SLIDE = 1.5;

/**
 * Words that name a topic instead of a decision. A decision sentence must ask for an action.
 *
 * The test is deliberately weak: it catches the common failure, which is a subject line submitted
 * as a decision. It does not try to judge whether a real decision is a good one.
 */
const DECISION_VERBS = [
  'approve',
  'fund',
  'hire',
  'buy',
  'adopt',
  'ship',
  'launch',
  'sign',
  'commit',
  'choose',
  'select',
  'stop',
  'delay',
  'reject',
  'merge',
  'invest',
  'expand',
  'continue',
];

const normalise = (value: string): string => value.toLowerCase().trim();

/** Test 1. The decision sentence must name an action, not a topic. */
function testDecisionSentence(intent: NodeSlideRoomIntent | null): NodeSlideRoomFinding {
  if (!intent?.decision?.trim()) {
    return {
      test: 'decision-sentence',
      verdict: 'not-stated',
      detail:
        'No decision is stated. Write one sentence that names the decision the room must make.',
    };
  }
  const decision = normalise(intent.decision);
  const words = decision.split(/\s+/u).filter(Boolean);
  if (words.length < 4) {
    return {
      test: 'decision-sentence',
      verdict: 'not-ready',
      detail: `"${intent.decision}" is too short to be a decision. It reads as a subject.`,
    };
  }
  if (!DECISION_VERBS.some((verb) => decision.includes(verb))) {
    return {
      test: 'decision-sentence',
      verdict: 'not-ready',
      detail: `"${intent.decision}" names a topic, not an action. State what the room must agree to do.`,
    };
  }
  return { test: 'decision-sentence', verdict: 'ready', detail: '' };
}

/** Test 2. Each stakeholder concern must map to a proof obligation. */
function testRoomMap(
  intent: NodeSlideRoomIntent | null,
  obligations: NodeSlideProofObligation[],
): NodeSlideRoomFinding {
  if (!intent || intent.stakeholders.length === 0) {
    return {
      test: 'room-map',
      verdict: 'not-stated',
      detail: 'No stakeholders are listed. Name who is in the room and what each one must believe.',
    };
  }
  const obligationIds = new Set(obligations.map((item) => item.id));
  const unanswered = intent.stakeholders.filter(
    (person) => !person.answeredByObligationId || !obligationIds.has(person.answeredByObligationId),
  );
  if (unanswered.length > 0) {
    return {
      test: 'room-map',
      verdict: 'not-ready',
      detail: `${unanswered.length} concern(s) have no proof obligation: ${unanswered
        .map((person) => person.role)
        .join(', ')}.`,
    };
  }
  return { test: 'room-map', verdict: 'ready', detail: '' };
}

/**
 * Test 3. At least one stakeholder concern must be answered by an obligation that is supported.
 *
 * A deck that only answers the easy concerns is not ready for the room. An obligation the author
 * marked `blocked` does not answer anything yet.
 */
function testObjection(
  intent: NodeSlideRoomIntent | null,
  obligations: NodeSlideProofObligation[],
): NodeSlideRoomFinding {
  if (!intent || intent.stakeholders.length === 0) {
    return {
      test: 'objection',
      verdict: 'not-stated',
      detail: 'No stakeholders are listed, so no objection can be answered.',
    };
  }
  const byId = new Map(obligations.map((item) => [item.id, item]));
  const answered = intent.stakeholders.filter((person) => {
    const obligation = person.answeredByObligationId
      ? byId.get(person.answeredByObligationId)
      : undefined;
    return obligation?.fulfillment === 'supported';
  });
  if (answered.length === 0) {
    return {
      test: 'objection',
      verdict: 'not-ready',
      detail: 'No objection has supported proof. Every concern is unanswered or still blocked.',
    };
  }
  return { test: 'objection', verdict: 'ready', detail: '' };
}

/** Test 4. The takeaway must exist and must not repeat the decision word for word. */
function testOneSlide(
  spec: NodeSlideStorySpec,
  intent: NodeSlideRoomIntent | null,
): NodeSlideRoomFinding {
  const takeaway = spec.memorableTakeaway?.trim();
  if (!takeaway) {
    return {
      test: 'one-slide',
      verdict: 'not-stated',
      detail: 'No memorable takeaway is stated. Name the one thing the room must remember.',
    };
  }
  if (intent?.decision && normalise(takeaway) === normalise(intent.decision)) {
    return {
      test: 'one-slide',
      verdict: 'not-ready',
      detail: 'The takeaway repeats the decision. The takeaway must give the reason to agree.',
    };
  }
  return { test: 'one-slide', verdict: 'ready', detail: '' };
}

/** Test 5. The pacing must fit the time available. */
function testRehearsal(
  spec: NodeSlideStorySpec,
  intent: NodeSlideRoomIntent | null,
): NodeSlideRoomFinding {
  if (!intent || !intent.timeBudgetMinutes) {
    return {
      test: 'rehearsal',
      verdict: 'not-stated',
      detail: 'No time budget is stated. Give the minutes available.',
    };
  }
  const slides = spec.pacing.reduce((total, phase) => total + phase.slideCount, 0);
  if (slides === 0) {
    return {
      test: 'rehearsal',
      verdict: 'not-stated',
      detail: 'The pacing has no slides, so the rehearsal cannot be measured.',
    };
  }
  const needed = slides * MINUTES_PER_SLIDE;
  if (needed > intent.timeBudgetMinutes) {
    return {
      test: 'rehearsal',
      verdict: 'not-ready',
      detail: `${slides} slides need about ${needed} minutes. The budget is ${intent.timeBudgetMinutes} minutes.`,
    };
  }
  return { test: 'rehearsal', verdict: 'ready', detail: '' };
}

/**
 * Run the five Room-Ready tests over a StorySpec and its room intent.
 *
 * The receipt reports every test. A missing field gives `not-stated`, which is not ready. The
 * caller cannot read a silent omission as a pass.
 */
export function evaluateRoomReady(
  spec: NodeSlideStorySpec,
  intent: NodeSlideRoomIntent | null,
): NodeSlideRoomReadyReceipt {
  const obligations = spec.proofObligations ?? [];
  const findings: NodeSlideRoomFinding[] = [
    testDecisionSentence(intent),
    testRoomMap(intent, obligations),
    testObjection(intent, obligations),
    testOneSlide(spec, intent),
    testRehearsal(spec, intent),
  ];
  const readyCount = findings.filter((finding) => finding.verdict === 'ready').length;
  const notStated = findings.filter((finding) => finding.verdict === 'not-stated').length;
  return {
    schemaVersion: NODESLIDE_ROOM_READY_VERSION,
    findings,
    readyCount,
    ready: readyCount === findings.length,
    summary: `${readyCount} of ${findings.length} room tests ready; ${notStated} not stated.`,
  };
}
