import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_ROOM_READY_VERSION,
  type NodeSlideRoomIntent,
  evaluateRoomReady,
} from './nodeslideRoomReady';
import type { NodeSlideStorySpec } from './nodeslideStoryContext';

/**
 * The scenario is a real one. An owner takes a deck into a board meeting. Every chart in the deck
 * is a genuine native chart, because the artifact gates proved it. The owner still cannot say what
 * the board must decide, does not know who objects, and has 24 slides for a 15-minute slot.
 *
 * The artifact gates cannot see any of that. These tests describe what Room-Ready sees instead.
 *
 * The positive cases matter as much as the negative ones here. An earlier check in this project
 * rejected legitimate work because its rule was too strict, and the tests did not catch it because
 * they were all adversarial. So each test below has an honest counterpart.
 */

const spec = (over: Partial<NodeSlideStorySpec> = {}): NodeSlideStorySpec => ({
  narrativeJob: 'Show that the second salon location pays for itself inside two quarters.',
  audienceNeed: 'The board needs to know the payback period before it releases the capital.',
  memorableTakeaway: 'The second location pays back in five months at the current margin.',
  proofObligations: [
    {
      id: 'ob-margin',
      claim: 'Current margin supports the payback',
      requiredMaterialKinds: ['numeric-series'],
      materialIds: ['m-1'],
      fulfillment: 'supported',
    },
    {
      id: 'ob-staffing',
      claim: 'Staffing cost is covered',
      requiredMaterialKinds: ['dataset'],
      materialIds: ['m-2'],
      fulfillment: 'constructible',
    },
  ],
  pacing: [
    { phase: 'orient', slideCount: 2, intent: 'frame the decision' },
    { phase: 'build', slideCount: 3, intent: 'show the numbers' },
    { phase: 'prove', slideCount: 2, intent: 'answer the objections' },
    { phase: 'decide', slideCount: 1, intent: 'ask for the capital' },
  ],
  ...over,
});

const intent = (over: Partial<NodeSlideRoomIntent> = {}): NodeSlideRoomIntent => ({
  schemaVersion: NODESLIDE_ROOM_READY_VERSION,
  decision: 'Approve the capital for the second salon location.',
  stakeholders: [
    {
      id: 's-1',
      role: 'finance lead',
      concern: 'Payback is too slow',
      answeredByObligationId: 'ob-margin',
    },
    {
      id: 's-2',
      role: 'operations lead',
      concern: 'Staffing is not solved',
      answeredByObligationId: 'ob-staffing',
    },
  ],
  communicationMode: 'speaker-led',
  timeBudgetMinutes: 15,
  ...over,
});

describe('Room-Ready: a deck that passes every artifact gate and still fails the room', () => {
  it('reports ready when the author stated the decision, the room, and the time', () => {
    const receipt = evaluateRoomReady(spec(), intent());
    expect(receipt.ready).toBe(true);
    expect(receipt.readyCount).toBe(5);
  });

  it('extends the existing StorySpec and does not replace it', () => {
    // The spec fields keep their meaning. Room-Ready reads them; it does not own them.
    const receipt = evaluateRoomReady(spec(), intent());
    expect(receipt.schemaVersion).toBe(NODESLIDE_ROOM_READY_VERSION);
    expect(receipt.findings).toHaveLength(5);
  });
});

describe('test 1 — the decision sentence', () => {
  it('rejects a subject submitted as a decision', () => {
    // Long enough to pass the length check, so the verb check is the one under test.
    const receipt = evaluateRoomReady(
      spec(),
      intent({ decision: 'Second salon location market expansion' }),
    );
    const finding = receipt.findings.find((item) => item.test === 'decision-sentence');
    expect(finding?.verdict).toBe('not-ready');
    expect(finding?.detail).toMatch(/names a topic, not an action/u);
  });

  it('rejects a decision too short to be one', () => {
    const receipt = evaluateRoomReady(spec(), intent({ decision: 'Second location expansion' }));
    const finding = receipt.findings.find((item) => item.test === 'decision-sentence');
    expect(finding?.verdict).toBe('not-ready');
    expect(finding?.detail).toMatch(/too short/u);
  });

  it('rejects an agenda line', () => {
    const receipt = evaluateRoomReady(
      spec(),
      intent({ decision: 'Market analysis, economics, and rollout' }),
    );
    expect(receipt.findings[0].verdict).toBe('not-ready');
  });

  it('reports not-stated when there is no decision at all', () => {
    const receipt = evaluateRoomReady(spec(), intent({ decision: '' }));
    expect(receipt.findings[0].verdict).toBe('not-stated');
    expect(receipt.ready).toBe(false);
  });
});

describe('test 2 — the room map', () => {
  it('rejects a concern with no proof obligation behind it', () => {
    const receipt = evaluateRoomReady(
      spec(),
      intent({
        stakeholders: [{ id: 's-1', role: 'finance lead', concern: 'Payback is too slow' }],
      }),
    );
    const finding = receipt.findings.find((item) => item.test === 'room-map');
    expect(finding?.verdict).toBe('not-ready');
    expect(finding?.detail).toMatch(/finance lead/u);
  });

  it('rejects a concern pointing at an obligation that does not exist', () => {
    const receipt = evaluateRoomReady(
      spec(),
      intent({
        stakeholders: [
          { id: 's-1', role: 'legal', concern: 'Lease risk', answeredByObligationId: 'ob-missing' },
        ],
      }),
    );
    expect(receipt.findings.find((item) => item.test === 'room-map')?.verdict).toBe('not-ready');
  });
});

describe('test 3 — the objection', () => {
  it('rejects a deck where every concern is answered only by blocked proof', () => {
    const blocked = spec({
      proofObligations: [
        {
          id: 'ob-margin',
          claim: 'Current margin supports the payback',
          requiredMaterialKinds: ['numeric-series'],
          materialIds: [],
          fulfillment: 'blocked',
        },
      ],
    });
    const receipt = evaluateRoomReady(
      blocked,
      intent({
        stakeholders: [
          {
            id: 's-1',
            role: 'finance lead',
            concern: 'Payback',
            answeredByObligationId: 'ob-margin',
          },
        ],
      }),
    );
    const finding = receipt.findings.find((item) => item.test === 'objection');
    expect(finding?.verdict).toBe('not-ready');
    expect(finding?.detail).toMatch(/unanswered or still blocked/u);
  });

  it('accepts a deck where at least one objection has supported proof', () => {
    // One supported obligation is enough. The test asks for a real answer, not for perfection.
    expect(
      evaluateRoomReady(spec(), intent()).findings.find((item) => item.test === 'objection')
        ?.verdict,
    ).toBe('ready');
  });
});

describe('test 4 — the one-slide test', () => {
  it('rejects a takeaway that only repeats the decision', () => {
    const receipt = evaluateRoomReady(
      spec({ memorableTakeaway: 'Approve the capital for the second salon location.' }),
      intent(),
    );
    const finding = receipt.findings.find((item) => item.test === 'one-slide');
    expect(finding?.verdict).toBe('not-ready');
    expect(finding?.detail).toMatch(/reason to agree/u);
  });

  it('reports not-stated when the takeaway is empty', () => {
    const receipt = evaluateRoomReady(spec({ memorableTakeaway: '' }), intent());
    expect(receipt.findings.find((item) => item.test === 'one-slide')?.verdict).toBe('not-stated');
  });
});

describe('test 5 — the rehearsal', () => {
  it('rejects a deck that cannot fit the time it has', () => {
    // 24 slides at 1.5 minutes each needs 36 minutes. The slot is 15.
    const long = spec({
      pacing: [{ phase: 'build', slideCount: 24, intent: 'everything' }],
    });
    const receipt = evaluateRoomReady(long, intent({ timeBudgetMinutes: 15 }));
    const finding = receipt.findings.find((item) => item.test === 'rehearsal');
    expect(finding?.verdict).toBe('not-ready');
    expect(finding?.detail).toMatch(/36 minutes/u);
  });

  it('accepts a deck that fits', () => {
    // 8 slides need 12 minutes. The slot is 15.
    expect(
      evaluateRoomReady(spec(), intent()).findings.find((item) => item.test === 'rehearsal')
        ?.verdict,
    ).toBe('ready');
  });

  it('reports not-stated when no time budget is given', () => {
    const receipt = evaluateRoomReady(spec(), intent({ timeBudgetMinutes: 0 }));
    expect(receipt.findings.find((item) => item.test === 'rehearsal')?.verdict).toBe('not-stated');
  });
});

describe('absence is reported, never scored', () => {
  it('reports every test as not-stated when there is no room intent', () => {
    const receipt = evaluateRoomReady(spec(), null);
    expect(receipt.ready).toBe(false);
    expect(receipt.readyCount).toBeLessThan(5);
    expect(receipt.summary).toMatch(/not stated/u);
  });

  it('never returns ready when one test is not-stated', () => {
    const receipt = evaluateRoomReady(spec(), intent({ timeBudgetMinutes: 0 }));
    expect(receipt.ready).toBe(false);
  });
});
