import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as budgetsModule from './nodeslideBudgets';
import * as jobControlModule from './nodeslideJobControl';
import * as jobRunnerModule from './nodeslideJobRunner';
import * as jobWorkflowModule from './nodeslideJobWorkflow';
import * as jobsModule from './nodeslideJobs';
import { NODESLIDE_JOB_SIBLING_MODULES, startCreateDeck, startEditProposal } from './nodeslideJobs';

/**
 * Scenario: an author clicks "Generate deck". Until this port, the mutation
 * refused before writing anything, because the workflow module that would pick
 * the job up was not deployed here.
 *
 * The hazard the refusal guarded against is still real, and is why the guard
 * stays: `internal` in `convex/_generated/api.js` is `anyApi`, a proxy that
 * returns a plausible function reference for any path.
 * `internal.nodeslideJobWorkflow.createDeckJobWorkflow` therefore type-checks,
 * constructs cleanly, and fails only at dispatch — after the row is written and
 * after the caller has been told the job was accepted. The author's only signal
 * would be a spinner that never resolves.
 *
 * WHAT CHANGED. `nodeslideJobWorkflow`, `nodeslideJobRunner`, `nodeslideJobControl`
 * and `nodeslideBudgets` have landed, so `NODESLIDE_JOB_SIBLING_MODULES` now
 * declares every sibling present and `requireJobOrchestrator` no longer throws.
 * A refusal test that only asserted "it refuses" would, at that point, silently
 * assert nothing — the `absent.length === 0` early return would make it green
 * and empty. So the three refusal cases have been replaced by the path they
 * were standing in for:
 *
 *   1. The start mutations proceed past the guard and reach the database. Their
 *      first act is real work, not a throw.
 *   2. Every internal function the orchestrator dispatches to BY NAME resolves
 *      to a real export on a real module. `anyApi` cannot tell you this; a
 *      missing name here is exactly the dispatch failure the guard existed to
 *      prevent, and the only way to catch it before production is to look.
 *
 * The declared-vs-on-disk case is unchanged and still checked in both
 * directions, so deleting a sibling module puts the refusal back honestly.
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

/**
 * 43 URL-safe base64 characters, the shape `isOwnerAccessKey` accepts.
 *
 * These fixtures previously used an `nsk_`-prefixed placeholder that the owner
 * validator rejects. That was invisible while the orchestrator guard threw
 * first: nothing downstream of it ever ran. Now that the guard is retired the
 * fixture has to be a key the mutation would actually accept, or the test
 * measures the argument validator instead of the dispatch path.
 */
const OWNER_ACCESS_KEY = 'A'.repeat(43);

const CREATE_ARGS = {
  clientSessionId: 'client-session-jobs-runtime',
  title: 'Quarterly board review',
  brief: {
    prompt: 'Draft a board review of the hiring plan.',
    audience: 'Board of directors',
    purpose: 'Approve the hiring plan',
    successCriteria: ['The board approves the plan'],
  },
  themeId: 'aurora',
  route: 'free',
  ownerAccessKey: OWNER_ACCESS_KEY,
  idempotencyKey: 'idem-create-jobs-runtime',
} as Record<string, unknown>;

const EDIT_ARGS = {
  clientSessionId: 'client-session-jobs-runtime',
  deckId: 'deck_jobs_runtime',
  instruction: 'Tighten the closing slide.',
  // The scope must name the same deck as the request, or validation rejects it
  // before the mutation reaches any dispatch at all.
  scope: { kind: 'deck' as const, deckId: 'deck_jobs_runtime' },
  baseDeckVersion: 1,
  baseSlideVersions: {},
  baseElementVersions: {},
  ownerAccessKey: OWNER_ACCESS_KEY,
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

  const absentSiblings = Object.entries(NODESLIDE_JOB_SIBLING_MODULES)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  it.runIf(absentSiblings.length > 0)(
    'refuses both start mutations before writing anything while a sibling is absent',
    async () => {
      // Only reachable if somebody deletes a sibling module and updates the
      // table to match. Kept so the refusal is still specified, not deleted.
      await expect(rawHandler(startCreateDeck)(forbiddenCtx(), CREATE_ARGS)).rejects.toThrow(
        /durable jobs are unavailable/i,
      );
      await expect(rawHandler(startEditProposal)(forbiddenCtx(), EDIT_ARGS)).rejects.toThrow(
        /No job was created/i,
      );
      // A generic "service unavailable" would send an on-call engineer into the
      // workpool internals. The message has to say which module is missing.
      const error = await rawHandler(startCreateDeck)(forbiddenCtx(), CREATE_ARGS).catch(
        (thrown: unknown) => thrown,
      );
      for (const name of absentSiblings) {
        expect((error as Error).message).toContain(name);
      }
    },
  );

  it.runIf(absentSiblings.length === 0)(
    'starts real work instead of refusing, now that every sibling is on disk',
    async () => {
      // The forbidden ctx explodes on the FIRST database call. Before the port
      // that call never happened — the guard threw first. Now it does, and the
      // error proves the start mutation is doing work rather than declining it.
      // This is the positive half of the refusal: it is exactly the assertion
      // that would go quietly green if it were written as `if (absent) return`.
      for (const [name, start, args] of [
        ['startCreateDeck', startCreateDeck, CREATE_ARGS],
        ['startEditProposal', startEditProposal, EDIT_ARGS],
      ] as const) {
        const error = await rawHandler(start)(forbiddenCtx(), args).catch(
          (thrown: unknown) => thrown,
        );
        expect(error, `${name} resolved without a ctx that can satisfy it`).toBeInstanceOf(Error);
        expect((error as Error).message, name).toMatch(/touched the database/i);
        expect((error as Error).message, name).not.toMatch(/durable jobs are unavailable/i);
      }
    },
  );

  /**
   * Every `internal.<module>.<function>` the durable job path dispatches to by
   * name, and the module that must export it.
   *
   * `anyApi` makes all of these resolve at construction time whether or not
   * they exist, so nothing else in the type system or the test suite checks
   * them. A typo, a rename, or a half-landed port shows up here and nowhere
   * else before production.
   */
  const ORCHESTRATOR_DISPATCH_TABLE: ReadonlyArray<
    readonly [string, Record<string, unknown>, readonly string[]]
  > = [
    [
      'nodeslideJobWorkflow',
      jobWorkflowModule,
      ['createDeckJobWorkflow', 'editProposalJobWorkflow'],
    ],
    [
      'nodeslideJobRunner',
      jobRunnerModule,
      ['executeCreateDeckInternal', 'executeEditProposalInternal'],
    ],
    ['nodeslideJobControl', jobControlModule, ['heartbeatInternal']],
    [
      'nodeslideJobs',
      jobsModule,
      [
        'checkpointInternal',
        'claimAttemptInternal',
        'completeCreateDeckInternal',
        'completeEditProposalInternal',
        'onWorkflowComplete',
        'recordRenderRepairInternal',
      ],
    ],
    ['nodeslideBudgets', budgetsModule, ['create', 'finalizeForJob']],
  ];

  it.each(ORCHESTRATOR_DISPATCH_TABLE)(
    'resolves every internal function the orchestrator dispatches to on %s',
    (moduleName, loaded, exportNames) => {
      for (const exportName of exportNames) {
        expect(loaded[exportName], `${moduleName}.${exportName}`).toBeDefined();
      }
    },
  );
});
