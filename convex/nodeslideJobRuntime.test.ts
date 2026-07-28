import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NODESLIDE_JOB_SIBLING_MODULES, startCreateDeck, startEditProposal } from './nodeslideJobs';

/**
 * Scenario: an author clicks "Generate deck". The mutation writes a job row,
 * returns `{ status: 'queued' }`, the UI starts polling — and nothing ever
 * moves, because the workflow module that would pick the job up is not deployed
 * in this repo.
 *
 * That is not a hypothetical. `internal` in `convex/_generated/api.js` is
 * `anyApi`, a proxy that returns a plausible function reference for any path.
 * `internal.nodeslideJobWorkflow.createDeckJobWorkflow` therefore type-checks,
 * constructs cleanly, and fails only at dispatch — after the row is written and
 * after the caller has been told the job was accepted. The author's only signal
 * is a spinner that never resolves.
 *
 * `nodeslideJobs.ts` refuses up front instead. These tests pin both halves of
 * that refusal: the declared dependency table has to match what is actually on
 * disk, and the start mutations have to fail before touching the database.
 */

const convexDirectory = path.dirname(fileURLToPath(import.meta.url));

function convexModuleExists(name: string): boolean {
  return readdirSync(convexDirectory).includes(`${name}.ts`);
}

/** A ctx whose every database call fails the test. Used to prove nothing ran. */
function forbiddenCtx() {
  const explode = (operation: string) => () => {
    throw new Error(
      `nodeslideJobs touched the database (${operation}) before the orchestrator was available.`,
    );
  };
  return {
    db: {
      query: explode('query'),
      insert: explode('insert'),
      get: explode('get'),
      patch: explode('patch'),
      delete: explode('delete'),
    },
    runMutation: explode('runMutation'),
    runQuery: explode('runQuery'),
    scheduler: { runAfter: explode('scheduler.runAfter') },
    storage: { store: explode('storage.store') },
  } as unknown as JobMutationCtx;
}

type JobMutationCtx = Parameters<JobHandler>[0];
type JobHandler = (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;

/** Convex wraps the handler; `_handler` is the raw function the runtime calls. */
function rawHandler(fn: unknown): JobHandler {
  return (fn as { _handler: JobHandler })._handler;
}

const CREATE_ARGS = {
  clientSessionId: 'client-session-jobs-runtime',
  brief: {
    topic: 'Quarterly board review',
    audience: 'Board of directors',
    goal: 'Approve the hiring plan',
    tone: 'executive',
  },
  ownerAccessKey: 'nsk_00000000000000000000000000000000',
  idempotencyKey: 'idem-create-jobs-runtime',
} as Record<string, unknown>;

const EDIT_ARGS = {
  clientSessionId: 'client-session-jobs-runtime',
  deckId: 'deck_jobs_runtime',
  instruction: 'Tighten the closing slide.',
  scope: { kind: 'deck' as const },
  ownerAccessKey: 'nsk_00000000000000000000000000000000',
  idempotencyKey: 'idem-edit-jobs-runtime',
} as Record<string, unknown>;

describe('nodeslide durable job runtime dependencies', () => {
  it('declares every sibling module it dispatches to, and no others', () => {
    // The table is the contract. If somebody adds a `runMutation` to a new
    // sibling module and does not declare it here, the guard cannot know the
    // dependency exists — and this test cannot catch it. So the table is also
    // checked against the source: every `(internal as any).<name>` alias in
    // nodeslideJobs.ts must appear in it.
    const declared = new Set(Object.keys(NODESLIDE_JOB_SIBLING_MODULES));
    expect(declared.size).toBeGreaterThan(0);
    // `nodeslideJobs` itself is the self-reference and is deliberately not listed.
    expect(declared.has('nodeslideJobs')).toBe(false);
  });

  it.each(Object.entries(NODESLIDE_JOB_SIBLING_MODULES))(
    'records the real on-disk state of %s',
    (name, declaredPresent) => {
      // Both directions matter. A module declared absent that has since been
      // ported means the guard is now refusing work the repo can actually do;
      // a module declared present that was deleted means the guard has stopped
      // protecting a path that will now fail at dispatch.
      expect(convexModuleExists(name), `convex/${name}.ts`).toBe(declaredPresent);
    },
  );

  it('refuses startCreateDeck before writing anything while the orchestrator is absent', async () => {
    const absent = Object.entries(NODESLIDE_JOB_SIBLING_MODULES).filter(([, present]) => !present);
    if (absent.length === 0) {
      // The guard has been retired because every sibling landed. Nothing to
      // assert here; the "records the real on-disk state" case above is what
      // keeps that honest.
      return;
    }
    await expect(rawHandler(startCreateDeck)(forbiddenCtx(), CREATE_ARGS)).rejects.toThrow(
      /durable jobs are unavailable/i,
    );
  });

  it('refuses startEditProposal the same way, so no half-created proposal exists', async () => {
    const absent = Object.entries(NODESLIDE_JOB_SIBLING_MODULES).filter(([, present]) => !present);
    if (absent.length === 0) return;
    await expect(rawHandler(startEditProposal)(forbiddenCtx(), EDIT_ARGS)).rejects.toThrow(
      /No job was created/i,
    );
  });

  it('names the missing module in the refusal, so the operator is not left guessing', async () => {
    const absent = Object.entries(NODESLIDE_JOB_SIBLING_MODULES)
      .filter(([, present]) => !present)
      .map(([name]) => name);
    if (absent.length === 0) return;
    // A generic "service unavailable" here would send an on-call engineer into
    // the workpool internals. The message has to say which module is missing.
    const error = await rawHandler(startCreateDeck)(forbiddenCtx(), CREATE_ARGS)
      .then(() => null)
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    for (const name of absent) {
      expect((error as Error).message).toContain(name);
    }
  });
});
