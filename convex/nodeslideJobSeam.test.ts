import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nodeslideStableId } from './lib/nodeslideIds';
import {
  nodeslideCreateJobRequestFields,
  nodeslideEditProposalJobRequestFields,
} from './lib/nodeslideJobValidators';
import { createDeckFromBrief, proposeEdit } from './nodeslideAgent';
import { NODESLIDE_UNPORTED_EDIT_PROPOSAL_ARGS, startEditProposal } from './nodeslideJobs';

/**
 * THE DURABLE JOB ARGUMENT SEAM.
 *
 * `convex/nodeslideJobRunner.ts` calls two public actions with an argument set
 * assembled from the job request plus runtime-only fields. Convex rejects any
 * undeclared field, and it rejects it at the callee boundary — before the
 * handler runs. That is a cheap failure, but it is a failure: measured against
 * the deployed backend, a durable create job reached `progress: 35`, spent
 * ~7 seconds, and died with
 *
 *   ArgumentValidationError: Object contains extra field `durableJob`
 *
 * and a durable edit job died the same way on `clientSessionId` (the first of
 * four undeclared fields, alphabetically).
 *
 * Nothing in the shipped client reaches either path — `NodeSlideStudio.tsx` and
 * the MCP server both call the actions directly, which is why the product works.
 * The durable path is reachable only through the public Convex API, and there it
 * was reliably broken.
 *
 * What this file pins:
 *
 *   1. The declared argument set of each action, read from the ACTUAL runtime
 *      validator via `exportArgs()` — not a regex over the source. Deleting the
 *      `durableJob` validator turns test 1 red and names the field.
 *   2. The output-identity binding, and specifically that it refuses BEFORE the
 *      handler touches the database or a provider. This is the constraint that
 *      made the port worth doing rather than just declaring the argument:
 *      accepting `durableJob` without binding `deckId` to the job id would move
 *      the failure from argument validation (free) to the runner's post-return
 *      check (after a paid provider call).
 *   3. The edit half's refusal at ENQUEUE, since a faithful port is not
 *      available here and a partial one would silently drop a spend ceiling.
 */

const convexDirectory = path.dirname(fileURLToPath(import.meta.url));

/** The argument names Convex will actually accept, from the registered validator. */
function declaredArgNames(fn: unknown): string[] {
  const exported = (fn as { exportArgs?: () => string }).exportArgs?.();
  if (!exported) throw new Error('Convex function did not export an argument validator.');
  const parsed = JSON.parse(exported) as { value?: Record<string, unknown> };
  return Object.keys(parsed.value ?? (parsed as Record<string, unknown>));
}

const runnerSource = readFileSync(path.join(convexDirectory, 'nodeslideJobRunner.ts'), 'utf8');

/**
 * What the runner sends, derived rather than restated.
 *
 * The runner spreads `...args.request`, and `args.request` is validated by the
 * job request validator — so the validator's own field list IS the spread. The
 * literal fields the runner adds on top are asserted against the runner source
 * below, so a runner that stops sending `durableJob` cannot leave this test
 * asserting a contract nobody has.
 */
function runnerSentArgNames(
  requestFields: Record<string, unknown>,
  literalExtras: readonly string[],
): string[] {
  return [...new Set([...Object.keys(requestFields), ...literalExtras])];
}

describe('durable job argument seam', () => {
  it('sends durableJob from the runner on both paths', () => {
    // Guards the derivation above: if the runner stops passing these, the
    // "undeclared" sets below would go quietly empty and assert nothing.
    expect(runnerSource).toMatch(/executeCreateDeckInternal/);
    expect(runnerSource).toMatch(/executeEditProposalInternal/);
    expect(runnerSource.match(/durableJob: \{/g)?.length ?? 0).toBe(2);
    expect(runnerSource).toMatch(/\.\.\.args\.request/);
  });

  it('declares every argument the runner sends to createDeckFromBrief', () => {
    const declared = declaredArgNames(createDeckFromBrief);
    const sent = runnerSentArgNames(nodeslideCreateJobRequestFields, ['durableJob']);
    const undeclared = sent.filter((name) => !declared.includes(name));
    // KNOCKOUT: delete the `durableJob` validator from createDeckFromBrief and
    // this fails naming `durableJob` — the exact string the deployed backend
    // put in the failed job's error field.
    expect(
      undeclared,
      `nodeslideJobRunner sends these to nodeslideAgent.createDeckFromBrief and Convex will reject the call: ${undeclared.join(', ')}`,
    ).toEqual([]);
    expect(declared).toContain('durableJob');
  });

  it('records exactly which proposeEdit arguments are still unported', () => {
    const declared = declaredArgNames(proposeEdit);
    const sent = runnerSentArgNames(nodeslideEditProposalJobRequestFields, [
      'ownerAccessKey',
      'idempotencyKey',
      'durableJob',
    ]);
    const undeclared = sent.filter((name) => !declared.includes(name)).sort();
    // Drift in EITHER direction is a red test: porting `proposeEdit` without
    // removing the entry here, or claiming a field is unported when the action
    // now declares it.
    expect(undeclared).toEqual([...NODESLIDE_UNPORTED_EDIT_PROPOSAL_ARGS].sort());
    // The two that make a partial port dishonest rather than merely incomplete.
    expect(undeclared).toContain('maxCostUsd');
    expect(undeclared).toContain('sourceRefreshBinding');
  });
});

/**
 * A ctx whose every database and dispatch call fails the test.
 *
 * The point is the ORDER. `createDeckFromBrief` reaches the database at
 * `authorizeExecutionInternal`, which is the first thing after the identity
 * binding. So "threw about identity" and "threw about touching the database"
 * are two distinguishable outcomes that tell us exactly where the refusal
 * happened — without needing a live backend.
 */
function forbiddenCtx() {
  const explode = (operation: string) => () => {
    throw new Error(`createDeckFromBrief touched ${operation} before refusing the binding.`);
  };
  return {
    runMutation: explode('the database (runMutation)'),
    runQuery: explode('the database (runQuery)'),
    scheduler: { runAfter: explode('the scheduler') },
    storage: { store: explode('storage') },
  };
}

type Handler = (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;
/** Convex wraps the handler; `_handler` is the raw function the runtime calls. */
function rawHandler(fn: unknown): Handler {
  return (fn as { _handler: Handler })._handler;
}

const OWNER_ACCESS_KEY = 'A'.repeat(43);
const EXECUTION_ACCESS_KEY = 'B'.repeat(43);
const JOB_ID = 'nodeslide_job_seam_fixture';

function createArgs(durableJob: Record<string, unknown>): Record<string, unknown> {
  return {
    clientSessionId: 'client-session-seam',
    title: 'Quarterly board review',
    brief: {
      prompt: 'Draft a board review of the hiring plan.',
      audience: 'Board of directors',
      purpose: 'Approve the hiring plan',
      successCriteria: ['The board approves the plan'],
    },
    themeId: 'quiet-precision',
    route: 'free',
    providerMode: 'deterministic',
    durableJob,
  };
}

/** The binding the runner derives before it dispatches. */
const boundDurableJob = {
  jobId: JOB_ID,
  deckId: nodeslideStableId('deck_job', JOB_ID),
  projectId: nodeslideStableId('project_nodeslide_job', JOB_ID),
  ownerAccessKey: OWNER_ACCESS_KEY,
  executionAccessKey: EXECUTION_ACCESS_KEY,
};

describe('durable create output-identity binding', () => {
  it('accepts the binding the runner actually derives', async () => {
    // The positive control. A correctly bound job must get PAST the identity
    // check — proven by the ctx exploding at admission, the very next step.
    // Without this case, deleting the whole feature would leave the negative
    // cases below passing for the wrong reason.
    const error = await rawHandler(createDeckFromBrief)(
      forbiddenCtx(),
      createArgs(boundDurableJob),
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/touched the database \(runQuery\)/i);
    expect((error as Error).message).not.toMatch(/output identity/i);
  });

  it.each([
    ['deckId', { ...boundDurableJob, deckId: 'deck_ms5hoqkp_535b1fd69f63ff5b2d809e81f9dac6b0' }],
    ['deckId minted the direct way', { ...boundDurableJob, deckId: `deck_${'0'.repeat(32)}` }],
    ['projectId', { ...boundDurableJob, projectId: 'project_nodeslide_1' }],
    ['jobId', { ...boundDurableJob, jobId: 'nodeslide_job_someone_elses' }],
  ])(
    'refuses a durable create whose %s does not derive from the job id, before any spend',
    async (_label, durableJob) => {
      // KNOCKOUT: remove the `deckId !== nodeslideStableId('deck_job', jobId)`
      // comparison and these stop throwing about identity — they reach
      // `authorizeExecutionInternal` and throw "touched the database" instead.
      // The assertion pair below is what makes that a red test rather than a
      // differently-worded green one.
      const error = await rawHandler(createDeckFromBrief)(
        forbiddenCtx(),
        createArgs(durableJob),
      ).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/durable NodeSlide job output identity is invalid/i);
      // The whole reason this check sits at the top of the handler: an identity
      // mismatch caught after generation is a mismatch caught after the provider
      // has been paid. Nothing may have run yet.
      expect((error as Error).message).not.toMatch(/touched/i);
    },
  );

  it.each([
    ['owner', { ...boundDurableJob, ownerAccessKey: 'nsk_not_a_capability' }],
    ['execution', { ...boundDurableJob, executionAccessKey: 'nsk_not_a_capability' }],
  ])('refuses a durable create carrying an invalid %s capability', async (_label, durableJob) => {
    const error = await rawHandler(createDeckFromBrief)(
      forbiddenCtx(),
      createArgs(durableJob),
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/durable NodeSlide job owner capability is invalid/i);
    expect((error as Error).message).not.toMatch(/touched/i);
  });
});

describe('durable edit proposal refusal', () => {
  it('refuses at enqueue, before writing a row or consuming quota', async () => {
    // KNOCKOUT for the chosen option: delete `requireEditProposalSeam()` from
    // `startEditProposal` and this fails — the mutation reaches the database
    // again, which is precisely the path that ends in a failed job 7s later.
    const jobsCtx = {
      db: {
        query: () => {
          throw new Error('startEditProposal touched the database before refusing.');
        },
        insert: () => {
          throw new Error('startEditProposal touched the database before refusing.');
        },
        get: () => {
          throw new Error('startEditProposal touched the database before refusing.');
        },
        patch: () => {
          throw new Error('startEditProposal touched the database before refusing.');
        },
      },
      runMutation: () => {
        throw new Error('startEditProposal touched the database before refusing.');
      },
      runQuery: () => {
        throw new Error('startEditProposal touched the database before refusing.');
      },
    };
    const error = await rawHandler(startEditProposal)(jobsCtx, {
      clientSessionId: 'client-session-seam',
      deckId: 'deck_seam_fixture',
      instruction: 'Tighten the closing slide.',
      scope: { kind: 'deck', deckId: 'deck_seam_fixture', operationMode: 'copy' },
      baseDeckVersion: 1,
      baseSlideVersions: {},
      baseElementVersions: {},
      ownerAccessKey: OWNER_ACCESS_KEY,
      idempotencyKey: 'idem-edit-seam',
    }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/touched the database/i);
    // A bare "unavailable" would send an on-call engineer into the workpool.
    // The refusal has to name the seam and the working alternative.
    for (const field of NODESLIDE_UNPORTED_EDIT_PROPOSAL_ARGS) {
      expect((error as Error).message).toContain(field);
    }
    expect((error as Error).message).toMatch(/no quota was consumed/i);
    expect((error as Error).message).toMatch(/nodeslideAgent\.proposeEdit/);
  });
});
