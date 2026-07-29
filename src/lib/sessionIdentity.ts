const SESSION_ID_KEY = 'parity.studio.sessionId';
const OWNER_ACCESS_KEY = 'nodeslide.ownerAccessKey';
const DECK_ACCESS_KEY = 'nodeslide.deckAccess.v1';

export interface OwnerAccessPersistenceReceipt {
  durable: boolean;
  deckAccessDurable: boolean;
  primaryAccessDurable: boolean;
}

/** Bytes of entropy in a fallback session id. 16 bytes = 128 bits, above randomUUID's 122. */
const SESSION_ID_ENTROPY_BYTES = 16;

/**
 * Session ids are a de-facto bearer token, so they are minted at full entropy or not at all.
 *
 * `nodeslideJobs:listSessionJobs` takes a session id as its ONLY argument and has no other
 * authorization: whoever holds the string reads that session's job receipts, including the
 * free-text `error` field. That makes the id's unguessability the entire access control.
 *
 * The previous fallback was `session-${Date.now()}-${Math.random().toString(36).slice(2)}`, which
 * fails that job twice over. `Date.now()` is public knowledge to the second, and `Math.random()` is
 * explicitly not cryptographically random — V8 seeds it from a 128-bit xorshift state that is
 * recoverable from a handful of outputs. So the search space is not 122 bits; it is "the second the
 * session started" times a PRNG an attacker can often solve outright.
 *
 * `crypto.getRandomValues` is the fix rather than a second-best: it is available in every context
 * that has `crypto` at all — including the non-secure contexts and older browsers the old fallback
 * was written for — while `crypto.randomUUID` is restricted to secure contexts. So the branch that
 * previously degraded to guessable now degrades to a different CSPRNG call, and
 * `convex/lib/nodeslideAccess.ts` already mints owner capabilities exactly this way.
 *
 * If neither API exists we THROW rather than mint. A weak session id is not a degraded session, it
 * is a readable one, and failing to start is the honest outcome — callers surface a real error
 * instead of silently handing the user an id that leaks.
 */
function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(SESSION_ID_ENTROPY_BYTES);
    crypto.getRandomValues(bytes);
    return `session-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  throw new Error(
    'NodeSlide cannot mint a session id: no cryptographic randomness is available. ' +
      'A session id is the only authorization on session-scoped reads, so a guessable one ' +
      'would expose this session to anyone who guesses it. Refusing rather than degrading.',
  );
}

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'server-session';
  const existing =
    readStorage(window.localStorage, SESSION_ID_KEY) ??
    readStorage(window.sessionStorage, SESSION_ID_KEY);
  if (existing) return existing;
  const next = randomId();
  writeStorage(window.localStorage, SESSION_ID_KEY, next);
  return next;
}

export function resetSessionId(): string {
  if (typeof window === 'undefined') return 'server-session';
  const next = randomId();
  writeStorage(window.localStorage, SESSION_ID_KEY, next);
  return next;
}

/** Returns the server-issued capability for the deterministic sample deck. */
export function getStoredOwnerAccessKey(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return readStorage(window.localStorage, OWNER_ACCESS_KEY) ?? undefined;
}

/**
 * Persists a server-issued anonymous owner capability. It is durable across
 * tabs for private-preview continuity, but is not account authentication.
 */
export function storeDeckOwnerAccessKey(
  deckId: string,
  ownerAccessKey: string,
  primary = false,
): OwnerAccessPersistenceReceipt {
  const unavailable: OwnerAccessPersistenceReceipt = {
    durable: false,
    deckAccessDurable: false,
    primaryAccessDurable: false,
  };
  if (typeof window === 'undefined' || !deckId || !ownerAccessKey) return unavailable;
  const access = readDeckAccess();
  access[deckId] = ownerAccessKey;
  const deckAccessDurable = writeStorage(
    window.localStorage,
    DECK_ACCESS_KEY,
    JSON.stringify(access),
  );
  const primaryAccessDurable =
    !primary || writeStorage(window.localStorage, OWNER_ACCESS_KEY, ownerAccessKey);
  return {
    durable: deckAccessDurable && primaryAccessDurable,
    deckAccessDurable,
    primaryAccessDurable,
  };
}

export function getDeckOwnerAccessKey(deckId: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return readDeckAccess()[deckId];
}

/**
 * Drops the local capability for a deck that no longer exists. Called after a
 * confirmed erasure: leaving the key behind would keep offering the deck in
 * "recent decks" and would let a retry authenticate against a tombstone.
 */
export function forgetDeckOwnerAccessKey(deckId: string): void {
  if (typeof window === 'undefined' || !deckId) return;
  const access = readDeckAccess();
  const forgotten = access[deckId];
  if (forgotten === undefined) return;
  delete access[deckId];
  writeStorage(window.localStorage, DECK_ACCESS_KEY, JSON.stringify(access));
  if (readStorage(window.localStorage, OWNER_ACCESS_KEY) === forgotten) {
    try {
      window.localStorage.removeItem(OWNER_ACCESS_KEY);
    } catch {
      // Hardened contexts may refuse removal; the in-memory state is already clear.
    }
  }
}

export function listStoredDeckAccess(): Array<{ deckId: string; ownerAccessKey: string }> {
  return Object.entries(readDeckAccess()).map(([deckId, ownerAccessKey]) => ({
    deckId,
    ownerAccessKey,
  }));
}

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The
    // caller still receives a usable in-memory value for the current mount.
    return false;
  }
}

function readDeckAccess(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const raw = readStorage(window.localStorage, DECK_ACCESS_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          Boolean(entry[0]) && typeof entry[1] === 'string' && entry[1].length > 0,
      ),
    );
  } catch {
    return {};
  }
}
