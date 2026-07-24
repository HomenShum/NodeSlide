import type { SignatureProfile } from './nodeslideSignature';

/**
 * Describe what governs a deck right now, from the deck's own two fields.
 *
 * The commitment already exists and is already enforced: `activateProfile` writes
 * `activeSignatureProfileId` and `activeSignatureProfileDigest` onto the deck, and every patch is
 * validated against them before it is accepted. What the product never did was *say* so. After a
 * reload nothing named the active direction, so a user could not tell a governed deck from an
 * ungoverned one, and a refusal arrived with no visible cause.
 *
 * This derives that answer from the current snapshot and nothing else. It deliberately stores
 * nothing: a second copy of "what governs this deck" could disagree with the deck row, and then the
 * visible answer and the enforced answer differ — which is worse than showing nothing at all.
 *
 * The subtle part is the digest. The server resolves the active profile by id AND digest — the
 * storage key is `${stableId}_${digest}` — so governance is bound to one specific *version* of a
 * profile. The Design panel matched on id alone, which means a profile could be drawn as active
 * while a different version of it was the thing actually being enforced. That is a quiet lie, and
 * `unresolved` exists to replace it with a statement.
 */

export type DeckDirectionStatus =
  | { kind: 'none' }
  | { kind: 'governed'; profileId: string; digest: string; name: string }
  | { kind: 'unresolved'; profileId: string | null; digest: string | null; reason: string };

/** Enough of a profile to identify it. Keeps the describer usable from tests and from packs. */
export type DeckDirectionCandidate = Pick<SignatureProfile, 'id' | 'name'> & {
  source: Pick<SignatureProfile['source'], 'digest'>;
};

export function shortDigest(digest: string): string {
  const hex = digest.startsWith('sha256:') ? digest.slice(7) : digest;
  return hex.slice(0, 8);
}

export function describeDeckDirection(input: {
  // `| undefined` is spelled out because this repo runs `exactOptionalPropertyTypes`, and the deck
  // fields are genuinely absent — not merely unpassed — when a deck has never been governed.
  activeProfileId?: string | null | undefined;
  activeProfileDigest?: string | null | undefined;
  profiles: readonly DeckDirectionCandidate[];
}): DeckDirectionStatus {
  const profileId = input.activeProfileId ?? null;
  const digest = input.activeProfileDigest ?? null;

  if (profileId === null && digest === null) return { kind: 'none' };

  // The server throws on a half-written binding rather than guessing. Say the same thing here
  // instead of rendering the half we happen to have.
  if (profileId === null || digest === null) {
    return {
      kind: 'unresolved',
      profileId,
      digest,
      reason:
        'This deck records only half of a direction binding, so nothing can be resolved from it. The server refuses this state too.',
    };
  }

  const exact = input.profiles.find(
    (profile) => profile.id === profileId && profile.source.digest === digest,
  );
  if (exact) {
    return { kind: 'governed', profileId, digest, name: exact.name };
  }

  // Same id, different digest: the profile was edited after it was applied. The deck is still
  // governed — by the version it was applied at, which is not the one on screen.
  const sameId = input.profiles.find((profile) => profile.id === profileId);
  if (sameId) {
    return {
      kind: 'unresolved',
      profileId,
      digest,
      reason: `This deck is governed by an earlier version of "${sameId.name}" (${shortDigest(digest)}). The version listed here has changed since it was applied, so applying it again would change what is enforced.`,
    };
  }

  return {
    kind: 'unresolved',
    profileId,
    digest,
    reason: `A direction is enforced on this deck (${profileId} · ${shortDigest(digest)}) but it is not among the signatures available here, so its rules cannot be shown.`,
  };
}

/**
 * Whether a listed profile is the one actually being enforced.
 *
 * Both parts are required, because that is what the server requires. Matching on id alone draws a
 * profile as active when a different version of it governs.
 */
export function isEnforcedProfile(
  profile: DeckDirectionCandidate,
  status: DeckDirectionStatus,
): boolean {
  return (
    status.kind === 'governed' &&
    profile.id === status.profileId &&
    profile.source.digest === status.digest
  );
}

/**
 * What a restore would do to the deck's governance, stated before it is accepted.
 *
 * Restoring carries governance with content: `restoredSnapshot` clones the target version's deck
 * and overrides only identity and new-write fields, so the target's binding — or its absence — is
 * what survives. That is the right semantic, because keeping the current signature over restored
 * content would produce a hybrid state that never historically existed. But it happens in silence,
 * and a user restoring a layout should not lose the deck's design governance without being told.
 */
export function describeRestoreDirectionChange(input: {
  current: DeckDirectionStatus;
  target: DeckDirectionStatus;
}): string | null {
  const { current, target } = input;
  const label = (status: DeckDirectionStatus) =>
    status.kind === 'governed'
      ? status.name
      : status.kind === 'none'
        ? 'no direction'
        : 'an unresolved direction';

  if (current.kind === 'none' && target.kind === 'none') return null;

  if (current.kind === 'governed' && target.kind === 'none') {
    return `This version predates the active direction. Restoring it removes "${current.name}" as the deck's direction, and later edits will no longer be checked against it.`;
  }
  if (current.kind === 'none' && target.kind === 'governed') {
    return `This version carries the direction "${target.name}". Restoring it puts that direction back in force, and later edits will be checked against it.`;
  }
  if (current.kind === 'governed' && target.kind === 'governed') {
    if (current.profileId === target.profileId && current.digest === target.digest) return null;
    return `Restoring changes the deck's direction from "${current.name}" to "${target.name}". Later edits will be checked against the restored one.`;
  }
  return `Restoring changes the deck's direction from ${label(current)} to ${label(target)}.`;
}
