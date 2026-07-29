/**
 * The knockout for the 2026-07-28 credential-disclosure path.
 *
 * Scenario, taken from the incident rather than invented: an agent enqueues a
 * durable NodeSlide job whose arguments fail Convex validation. Convex's
 * `ArgumentValidationError` echoes the ENTIRE rejected argument object, which
 * carries the deck's `ownerAccessKey` and the run's `executionAccessKey`. The
 * job row stores that message. A second party who holds nothing but the
 * `clientSessionId` calls `nodeslideJobs:listSessionJobs` and reads both keys.
 *
 * Every test here mints REAL capabilities with `createOwnerAccessKey()`. A
 * fixture string would prove the scrubber handles that fixture; minting proves
 * it handles the credential the product actually issues, and it fails the day
 * the minter's shape changes without the scrubber's.
 *
 * Both directions are asserted, because only one of them is the interesting
 * one. `leaks without the scrub` is the control: it runs the exact pre-fix
 * expression (collapse whitespace, slice to the bound) over the same input and
 * asserts the keys ARE present, so a scrubber that silently became a no-op
 * cannot leave these tests green. `keeps the diagnosis` is the other guard: an
 * error that no longer says which field was invalid is a different defect.
 */

import { describe, expect, it } from 'vitest';
import schema from '../schema';
import { createOwnerAccessKey } from './nodeslideAccess';
import type { NodeSlideSchemaLike, NodeSlideSchemaTableLike } from './nodeslideErasureContract';
import {
  NODESLIDE_CAPABILITY_LENGTH,
  NODESLIDE_PERSISTED_ERROR_FIELDS,
  NodeSlidePersistedErrorContractError,
  buildNodeSlidePersistedErrorFieldContract,
  isNodeSlideErrorFieldName,
  isNodeSlideSensitiveKey,
  redactNodeSlideErrorText,
  redactNodeSlideSecrets,
} from './nodeslideErrorRedaction';
import {
  NODESLIDE_JOB_MAX_ATTEMPTS,
  type NodeSlideJobRecord,
  advanceNodeSlideJob,
  claimNodeSlideJobAttempt,
  failNodeSlideJob,
  nodeSlideJobExecutionDigest,
  nodeSlideJobOwnerDigest,
  nodeSlideJobRequestDigest,
  publicNodeSlideJob,
} from './nodeslideJobState';

/** The pre-fix `boundedError`, kept verbatim so the control cannot drift. */
function unredactedBoundedError(value: string): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  return (clean || 'The durable NodeSlide job failed safely.').slice(0, 600);
}

/**
 * Convex's real `ArgumentValidationError` shape: a prose line, then the whole
 * rejected object rendered as a JS object literal, then the validator.
 */
function argumentValidationError(ownerAccessKey: string, executionAccessKey: string): string {
  return [
    'ArgumentValidationError: Object contains extra field `durableJob` that is not in the validator.',
    '',
    `Object: {jobId: "job_create_1", durableJob: {jobId: "job_create_1", ownerAccessKey: "${ownerAccessKey}", executionAccessKey: "${executionAccessKey}"}, request: {prompt: "Build a launch deck"}}`,
    'Validator: v.object({jobId: v.string(), request: v.any()})',
  ].join('\n');
}

describe('NodeSlide persisted-error credential redaction', () => {
  it('strips both durable-job capabilities from the job row the public query returns', () => {
    const ownerAccessKey = createOwnerAccessKey();
    const executionAccessKey = createOwnerAccessKey();
    const message = argumentValidationError(ownerAccessKey, executionAccessKey);

    const failed = failNodeSlideJob(claimNodeSlideJobAttempt(job(), 2_000), message, 3_000);
    const stored = failed.error ?? '';
    const returned = publicNodeSlideJob(failed).error ?? '';

    expect(stored).not.toContain(ownerAccessKey);
    expect(stored).not.toContain(executionAccessKey);
    expect(returned).not.toContain(ownerAccessKey);
    expect(returned).not.toContain(executionAccessKey);
    expect(returned).toBe(stored);
  });

  it('leaks without the scrub — the control that keeps the assertion above honest', () => {
    const ownerAccessKey = createOwnerAccessKey();
    const executionAccessKey = createOwnerAccessKey();
    const message = argumentValidationError(ownerAccessKey, executionAccessKey);

    // Exactly what shipped before this change: whitespace collapse and a bound.
    const pre = unredactedBoundedError(message);
    expect(pre).toContain(ownerAccessKey);
    expect(pre).toContain(executionAccessKey);
    expect(pre.length).toBeLessThanOrEqual(600);

    // The bound was never the defence. It only chose how much survived.
    const post = redactNodeSlideErrorText(message, 600);
    expect(post).not.toContain(ownerAccessKey);
    expect(post).not.toContain(executionAccessKey);
  });

  it('keeps the diagnosis: which field, which validator, which error class', () => {
    const message = argumentValidationError(createOwnerAccessKey(), createOwnerAccessKey());
    const scrubbed = redactNodeSlideErrorText(message, 600);

    expect(scrubbed).toContain('ArgumentValidationError');
    expect(scrubbed).toContain('durableJob');
    expect(scrubbed).toContain('is not in the validator');
    // The key names survive; only their values are gone. An error that no
    // longer names the offending field would be a different defect.
    expect(scrubbed).toContain('ownerAccessKey');
    expect(scrubbed).toContain('executionAccessKey');
    expect(scrubbed).toContain('[REDACTED]');
    expect(scrubbed).toContain('Build a launch deck');
  });

  it('covers the checkpoint path, not only the failure path', () => {
    const ownerAccessKey = createOwnerAccessKey();
    // `checkpointInternal` accepts an arbitrary `error` string from an action
    // and reaches the row through `advanceNodeSlideJob`, not `failNodeSlideJob`.
    const next = advanceNodeSlideJob(
      claimNodeSlideJobAttempt(job(), 2_000),
      {
        status: 'running',
        phase: 'generating',
        progress: 40,
        error: `retrying after ownerAccessKey: "${ownerAccessKey}" was rejected`,
      },
      3_000,
    );
    expect(next.error).not.toContain(ownerAccessKey);
    expect(next.error).toContain('ownerAccessKey');
  });

  it('scrubs before it bounds, so no truncation offset can expose a fragment', () => {
    const ownerAccessKey = createOwnerAccessKey();
    // Straddle the 600-character bound: the key starts at 590, so a
    // bound-then-scrub order would store its first ten characters forever.
    const message = `${'x'.repeat(590)} ${ownerAccessKey} tail`;
    const scrubbed = redactNodeSlideErrorText(message, 600);

    expect(scrubbed.length).toBeLessThanOrEqual(600);
    expect(scrubbed).not.toContain(ownerAccessKey);
    for (let prefix = 12; prefix <= NODESLIDE_CAPABILITY_LENGTH; prefix += 1) {
      expect(scrubbed).not.toContain(ownerAccessKey.slice(0, prefix));
    }
  });

  it('removes a capability with no field name anywhere near it', () => {
    const ownerAccessKey = createOwnerAccessKey();
    // Rule A is the one that survives an error format nobody has seen. A stack
    // frame, a bare URL, a JSON array — none of these carry the field name.
    const shapes = [
      `at fetchDeck (https://example.test/api/deck?k=${ownerAccessKey}&v=2)`,
      `Unexpected token in ["a","${ownerAccessKey}"]`,
      `request failed: ${ownerAccessKey}`,
      `Authorization: Bearer ${ownerAccessKey}`,
    ];
    for (const shape of shapes) {
      expect(redactNodeSlideSecrets(shape)).not.toContain(ownerAccessKey);
    }
  });

  it('holds across 500 freshly minted capabilities, not one lucky fixture', () => {
    // Sustained rather than single-shot: a shape rule that works on one sample
    // and fails on the tail of the alphabet distribution is false confidence.
    const escaped: string[] = [];
    for (let index = 0; index < 500; index += 1) {
      const key = createOwnerAccessKey();
      if (redactNodeSlideSecrets(`ownerAccessKey: "${key}"`).includes(key)) escaped.push(key);
      if (redactNodeSlideSecrets(`bare ${key} bare`).includes(key)) escaped.push(key);
    }
    expect(escaped).toEqual([]);
  });

  it('leaves ids and digests alone, because a scrubbed error diagnoses nothing', () => {
    // Stable ids can be exactly 43 characters. Redacting them would be a
    // regression dressed as a fix — the whole point of the row is diagnosis.
    const survivors = [
      'agent_span_0123456789abcdef0123456789abcdef',
      'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'job_create_1',
      'nsession_0123456789abcdef0123456789abcdef',
    ];
    for (const value of survivors) {
      expect(redactNodeSlideSecrets(`failed for ${value}`)).toContain(value);
    }
  });

  it('removes third-party provider credentials quoted back by SDK errors', () => {
    // Assembled at runtime, never written as a literal. A test fixture that
    // LOOKS like a live credential is a live credential as far as a secret
    // scanner is concerned, and a security fix that trips the secret scanner
    // teaches everyone to click past it.
    const fixtures: ReadonlyArray<readonly [string, string]> = [
      ['401 from provider: Bearer ', ['sk', 'live', 'abcdefghijklmnop'].join('-')],
      ['github push failed: ', ['ghp', 'abcdefghijklmnopqrstuvwxyz012345'].join('_')],
      ['aws denied for ', `${'AK'}${'IA'}IOSFODNN7EXAMPLE`],
      ['maps error key=', `${'AI'}${'za'}SyA0123456789abcdefghijklmnopqrstuv`],
    ];
    for (const [prefix, secret] of fixtures) {
      expect(redactNodeSlideSecrets(`${prefix}${secret}`)).not.toContain(secret);
    }
  });

  it('falls back to a stated message instead of storing an empty error', () => {
    expect(redactNodeSlideErrorText('   ', 600, 'The job failed safely.')).toBe(
      'The job failed safely.',
    );
    // A message that is nothing BUT a secret must not become an empty string
    // that reads as "no error happened".
    expect(redactNodeSlideErrorText(createOwnerAccessKey(), 600, 'fallback')).toBe('[REDACTED]');
  });
});

describe('NodeSlide persisted-error field contract', () => {
  it('places every error-named string column in the real schema', () => {
    expect(() =>
      buildNodeSlidePersistedErrorFieldContract(schema as unknown as NodeSlideSchemaLike),
    ).not.toThrow();
  });

  it('refuses a new error column that nobody has said where to scrub', () => {
    // The failure mode this contract exists for: somebody adds a column, the
    // tree compiles, the tests pass, and a fresh disclosure path ships quietly.
    const grown = schemaGrownBy('nodeslide_future_failures', {
      validator: {
        kind: 'object',
        fields: {
          deckId: { kind: 'string' },
          lastError: { kind: 'string', isOptional: 'optional' },
        },
      },
      indexes: [{ indexDescriptor: 'by_deck', fields: ['deckId'] }],
    });
    expect(() => buildNodeSlidePersistedErrorFieldContract(grown)).toThrow(
      NodeSlidePersistedErrorContractError,
    );
    expect(() => buildNodeSlidePersistedErrorFieldContract(grown)).toThrow(
      /nodeslide_future_failures\.lastError/,
    );
  });

  it('states a redaction site for every declared field', () => {
    for (const entry of NODESLIDE_PERSISTED_ERROR_FIELDS) {
      expect(entry.redactedAt).toMatch(/^convex\/.+\.ts .+/);
      expect(entry.detail.length).toBeGreaterThan(40);
    }
  });

  it('declares the sinks the name rule cannot find, and admits which they are', () => {
    // `nodeslide_evidence_steps.detail` carries provider failure text under a
    // name with no `error` in it. Nothing mechanical can find it, so the
    // contract must not pretend the derived half is the whole surface.
    const handDeclared = NODESLIDE_PERSISTED_ERROR_FIELDS.filter(
      (entry) => !isNodeSlideErrorFieldName(entry.field),
    );
    expect(handDeclared.map((entry) => `${entry.table}.${entry.field}`)).toEqual([
      'nodeslide_evidence_steps.detail',
    ]);
  });

  it('shares one definition of a sensitive key with the owner-export path', () => {
    expect(isNodeSlideSensitiveKey('ownerAccessKey')).toBe(true);
    expect(isNodeSlideSensitiveKey('executionAccessKey')).toBe(true);
    expect(isNodeSlideSensitiveKey('accessTokenCiphertext')).toBe(true);
    expect(isNodeSlideSensitiveKey('deckId')).toBe(false);
    expect(isNodeSlideSensitiveKey('phase')).toBe(false);
  });
});

function schemaGrownBy(table: string, definition: NodeSlideSchemaTableLike): NodeSlideSchemaLike {
  const real = schema as unknown as NodeSlideSchemaLike;
  return { tables: { ...real.tables, [table]: definition } };
}

function job(overrides: Partial<NodeSlideJobRecord> = {}): NodeSlideJobRecord {
  return {
    id: 'job_create_1',
    kind: 'create_deck',
    clientSessionId: 'session_1',
    admissionQuotaSubject: 'preview-subject',
    ownerDigest: nodeSlideJobOwnerDigest('owner-capability'),
    executionDigest: nodeSlideJobExecutionDigest('workflow-capability'),
    idempotencyKey: 'create_1',
    requestDigest: nodeSlideJobRequestDigest({ prompt: 'Build a launch deck', files: [] }),
    status: 'queued',
    phase: 'queued',
    progress: 0,
    attempt: 0,
    maxAttempts: NODESLIDE_JOB_MAX_ATTEMPTS,
    streamId: 'stream_1',
    memoryIds: ['memory_1'],
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}
