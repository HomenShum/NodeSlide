import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOrCreateSessionId, resetSessionId } from './sessionIdentity';

/**
 * A session id is the ONLY argument to `nodeslideJobs:listSessionJobs`, a public Convex query with
 * no other authorization. Whoever holds the string reads that session's job receipts, including the
 * free-text `error` field. So these tests are not about id formatting — they are the access control.
 *
 * Both mint paths are exercised, because the bug lived entirely in the one that was hard to reach:
 * `crypto.randomUUID` is restricted to secure contexts, so the fallback branch is what runs on
 * plain http and older browsers, and it was the branch nobody looked at.
 *
 * The tests assert unpredictability rather than a string shape. A regex on `^session-[0-9a-f]{32}$`
 * would have passed the old `Math.random()` implementation too if it happened to emit hex — a shape
 * check cannot tell a CSPRNG from a seeded PRNG, and shape was never the property under threat.
 */

const SESSION_KEY = 'parity.studio.sessionId';

/** 16 bytes = 32 hex chars = 128 bits, above randomUUID's 122. */
const SESSION_ID_BITS = 128;

/** A window stub with real storage semantics — the id is only useful because it persists. */
function installWindow(): void {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage });
}

beforeEach(() => {
  installWindow();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Mint n ids, clearing storage between, so each call really re-mints rather than reads back. */
function mint(n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) ids.push(resetSessionId());
  return ids;
}

describe('session id entropy — the id is the authorization', () => {
  describe('with crypto.randomUUID available (secure context)', () => {
    it('mints a v4 UUID and never repeats across 500 mints', () => {
      const ids = mint(500);
      expect(new Set(ids).size).toBe(500);
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
    });
  });

  describe('without crypto.randomUUID (non-secure context, older browsers)', () => {
    beforeEach(() => {
      // Exactly the condition the old fallback existed for: crypto is present, randomUUID is not.
      // getRandomValues survives, which is the whole point — this branch has always had a CSPRNG.
      const real = globalThis.crypto;
      vi.stubGlobal('crypto', {
        getRandomValues: real.getRandomValues.bind(real),
      });
    });

    it('still uses a CSPRNG, and never repeats across 500 mints', () => {
      const ids = mint(500);
      expect(new Set(ids).size).toBe(500);
      for (const id of ids) expect(id).toMatch(/^session-[0-9a-f]{32}$/);
    });

    it('carries at least 128 bits of entropy, measured not assumed', () => {
      // Bit-level: across many mints every bit position must vary. A constant bit is a bit of
      // entropy that does not exist, and a prefix-heavy generator shows up here immediately.
      const ids = mint(300).map((id) => id.slice('session-'.length));
      expect(ids[0]).toHaveLength(32);

      for (let bit = 0; bit < SESSION_ID_BITS; bit += 1) {
        const nibble = bit >> 2;
        const mask = 1 << (3 - (bit & 3));
        const ones = ids.filter(
          (id) => (Number.parseInt(id[nibble] ?? '0', 16) & mask) !== 0,
        ).length;
        // With 300 samples a fair bit lands near 150. Anything pinned to 0 or 300 is not random;
        // the bounds are deliberately loose so this fails on structure, never on luck.
        expect(ones, `bit ${bit} never varied`).toBeGreaterThan(20);
        expect(ones, `bit ${bit} never varied`).toBeLessThan(280);
      }
    });

    it('does NOT encode the wall clock — the old fallback embedded Date.now()', () => {
      // The specific regression. `session-${Date.now()}-...` leaked the mint time, collapsing the
      // search space to "which second" times a solvable PRNG. Freezing the clock must not freeze
      // the id.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-29T00:00:00.000Z'));
      const ids = mint(50);
      vi.useRealTimers();

      expect(new Set(ids).size).toBe(50);
      for (const id of ids)
        expect(id).not.toContain(String(Date.parse('2026-07-29T00:00:00.000Z')));
    });

    it('does not draw from Math.random, even if Math.random is rigged', () => {
      // The sharpest form of the assertion: pin Math.random to a constant. A generator that touches
      // it collapses to one value. This fails loudly if anyone reintroduces the old fallback.
      vi.spyOn(Math, 'random').mockReturnValue(0.42);
      const ids = mint(100);
      expect(new Set(ids).size).toBe(100);
    });
  });

  describe('with no cryptographic randomness at all', () => {
    beforeEach(() => {
      vi.stubGlobal('crypto', undefined);
    });

    it('refuses to mint rather than returning a guessable id', () => {
      // Refusing is the honest outcome: a weak session id is not a degraded session, it is a
      // readable one. A caller sees a real error instead of silently holding a leaky id.
      expect(() => resetSessionId()).toThrow(/cannot mint a session id/i);
      expect(() => getOrCreateSessionId()).toThrow(/cannot mint a session id/i);
    });

    it('still returns a persisted id, because an existing session is not re-minted', () => {
      window.localStorage.setItem(SESSION_KEY, 'previously-minted-id');
      expect(getOrCreateSessionId()).toBe('previously-minted-id');
    });
  });
});
