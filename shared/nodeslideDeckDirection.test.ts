import { describe, expect, it } from 'vitest';
import {
  type DeckDirectionCandidate,
  describeDeckDirection,
  describeRestoreDirectionChange,
  isEnforcedProfile,
  shortDigest,
} from './nodeslideDeckDirection';

/**
 * The scenario: someone applies "Finance reporting" to a board deck, works for a week, then reopens
 * it. The deck IS governed — the server validates every patch against the profile it was applied at
 * — but the product never said which direction is in force, so a refusal arrives with no visible
 * cause and a restore can silently drop the governance entirely.
 *
 * The adversarial case that drives the design is digest drift. The server binds governance to id
 * AND digest; the panel matched on id alone. So a profile edited after it was applied would be drawn
 * as "active" while a different version of it was the thing actually enforced. Every test that
 * involves two digests exists to stop that quiet lie.
 */

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

const profile = (over: Partial<DeckDirectionCandidate> = {}): DeckDirectionCandidate => ({
  id: 'finance-reporting',
  name: 'Finance reporting',
  source: { digest: DIGEST_A },
  ...over,
});

describe('what governs this deck right now', () => {
  it('reports none when the deck has no binding', () => {
    expect(describeDeckDirection({ profiles: [profile()] })).toEqual({ kind: 'none' });
  });

  it('names the direction when the binding resolves exactly', () => {
    const status = describeDeckDirection({
      activeProfileId: 'finance-reporting',
      activeProfileDigest: DIGEST_A,
      profiles: [profile()],
    });

    expect(status).toEqual({
      kind: 'governed',
      profileId: 'finance-reporting',
      digest: DIGEST_A,
      name: 'Finance reporting',
    });
  });

  it('refuses to call a profile active when only its id matches', () => {
    // The profile was edited after it was applied. The deck is governed by the OLD version.
    // Drawing this card as active would tell the user the thing on screen is what is enforced.
    const status = describeDeckDirection({
      activeProfileId: 'finance-reporting',
      activeProfileDigest: DIGEST_A,
      profiles: [profile({ source: { digest: DIGEST_B } })],
    });

    expect(status.kind).toBe('unresolved');
    expect(status.kind === 'unresolved' && status.reason).toMatch(
      /earlier version of "Finance reporting"/u,
    );
    expect(status.kind === 'unresolved' && status.reason).toMatch(
      /applying it again would change what is enforced/u,
    );
  });

  it('says so when the enforced profile is not available here at all', () => {
    const status = describeDeckDirection({
      activeProfileId: 'imported-from-elsewhere',
      activeProfileDigest: DIGEST_A,
      profiles: [profile()],
    });

    expect(status.kind).toBe('unresolved');
    expect(status.kind === 'unresolved' && status.reason).toMatch(
      /not among the signatures available here/u,
    );
  });

  it('reports a half-written binding rather than rendering the half it has', () => {
    // The server throws on this state. Guessing here would show a direction the server rejects.
    const idOnly = describeDeckDirection({ activeProfileId: 'finance-reporting', profiles: [] });
    const digestOnly = describeDeckDirection({ activeProfileDigest: DIGEST_A, profiles: [] });

    expect(idOnly.kind).toBe('unresolved');
    expect(digestOnly.kind).toBe('unresolved');
    expect(idOnly.kind === 'unresolved' && idOnly.reason).toMatch(
      /only half of a direction binding/u,
    );
  });
});

describe('which card may be drawn as enforced', () => {
  it('accepts the profile whose id and digest both match', () => {
    const status = describeDeckDirection({
      activeProfileId: 'finance-reporting',
      activeProfileDigest: DIGEST_A,
      profiles: [profile()],
    });

    expect(isEnforcedProfile(profile(), status)).toBe(true);
  });

  it('rejects the same profile at a different digest', () => {
    const status = describeDeckDirection({
      activeProfileId: 'finance-reporting',
      activeProfileDigest: DIGEST_A,
      profiles: [profile()],
    });

    expect(isEnforcedProfile(profile({ source: { digest: DIGEST_B } }), status)).toBe(false);
  });

  it('marks nothing as enforced while the binding is unresolved', () => {
    const status = describeDeckDirection({
      activeProfileId: 'finance-reporting',
      activeProfileDigest: DIGEST_A,
      profiles: [profile({ source: { digest: DIGEST_B } })],
    });

    expect(isEnforcedProfile(profile({ source: { digest: DIGEST_B } }), status)).toBe(false);
  });
});

describe('what a restore would do to governance', () => {
  const governed = describeDeckDirection({
    activeProfileId: 'finance-reporting',
    activeProfileDigest: DIGEST_A,
    profiles: [profile()],
  });
  const otherGoverned = describeDeckDirection({
    activeProfileId: 'startup-narrative',
    activeProfileDigest: DIGEST_B,
    profiles: [
      profile({ id: 'startup-narrative', name: 'Startup narrative', source: { digest: DIGEST_B } }),
    ],
  });
  const none = { kind: 'none' } as const;

  it('warns that restoring a pre-activation version drops the direction', () => {
    const message = describeRestoreDirectionChange({ current: governed, target: none });

    expect(message).toMatch(/predates the active direction/u);
    expect(message).toMatch(/removes "Finance reporting"/u);
    expect(message).toMatch(/no longer be checked against it/u);
  });

  it('says when a restore puts a direction back in force', () => {
    const message = describeRestoreDirectionChange({ current: none, target: governed });

    expect(message).toMatch(/puts that direction back in force/u);
  });

  it('names both sides when a restore swaps one direction for another', () => {
    const message = describeRestoreDirectionChange({ current: governed, target: otherGoverned });

    expect(message).toMatch(/from "Finance reporting" to "Startup narrative"/u);
  });

  it('stays silent when governance does not change', () => {
    // A warning on every restore is a warning nobody reads. Only speak when something changes.
    expect(describeRestoreDirectionChange({ current: none, target: none })).toBeNull();
    expect(describeRestoreDirectionChange({ current: governed, target: governed })).toBeNull();
  });

  it('treats a digest change as a real change, not a no-op', () => {
    const sameIdNewDigest = {
      kind: 'governed' as const,
      profileId: 'finance-reporting',
      digest: DIGEST_B,
      name: 'Finance reporting',
    };

    expect(
      describeRestoreDirectionChange({ current: governed, target: sameIdNewDigest }),
    ).not.toBeNull();
  });
});

describe('digest display', () => {
  it('shortens a sha256 for reading without losing the prefix meaning', () => {
    expect(shortDigest(DIGEST_A)).toBe('aaaaaaaa');
    expect(shortDigest('a'.repeat(64))).toBe('aaaaaaaa');
  });
});
