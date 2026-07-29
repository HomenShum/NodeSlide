/**
 * Credential redaction for text that gets PERSISTED or RETURNED.
 *
 * Why this module exists, stated plainly so the next person does not have to
 * reconstruct it from a diff: on 2026-07-28 a durable job was enqueued with a
 * malformed argument. Convex's `ArgumentValidationError` message echoes the
 * entire rejected argument object, that object carried `ownerAccessKey` and
 * `executionAccessKey`, `failNodeSlideJob` wrote the message onto the job row,
 * and `nodeslideJobs:listSessionJobs` — a public query whose only argument is a
 * `clientSessionId` — handed both capabilities back in plaintext.
 *
 * The 600-character bound on the stored error was already there. It is why the
 * leak looked handled: a bound is not a redaction, it only decides how much of
 * the secret survives. So the scrub runs BEFORE the bound, everywhere, and the
 * bound is applied to already-scrubbed text.
 *
 * The specific validation error that tripped it was closed separately (PR #114,
 * by declaring the `durableJob` validator on the create path). That fix is the
 * one caller. This module is the boundary: any future validation error, on any
 * action reachable from a job, lands on the same scrubber.
 *
 * THREE RULES, in decreasing strength. Each is derived or predicate-based
 * rather than a hand-written list of key names, because this repo has been
 * bitten repeatedly by hand lists going stale — the same reasoning that made
 * `nodeslideErasureContract.ts` derive its table set from the schema.
 *
 *   A. CAPABILITY SHAPE (`redactCapabilityShapedValues`). NodeSlide's owner and
 *      execution capabilities are both `createOwnerAccessKey()` output: 256
 *      random bits, base64url, exactly 43 characters. That shape is matched
 *      wherever it appears — inside a stack frame, a URL, a JSON blob, an
 *      un-keyed fragment — with no dependence on an adjacent field name. This
 *      is the rule that actually closes the reported leak, and the only rule
 *      that survives an error format nobody has seen yet.
 *
 *   B. SENSITIVE KEY ADJACENCY (`redactSensitiveKeyedValues`). Reuses
 *      `isNodeSlideSensitiveKey`, the predicate the owner-export path already
 *      uses to withhold columns. Any `key: value`, `key=value`, or
 *      `"key":"value"` pair whose key satisfies that predicate loses its value
 *      and KEEPS ITS KEY. Keeping the key is not cosmetic: an error that no
 *      longer says which field was invalid is a different defect, and the
 *      knockout test asserts both directions.
 *
 *   C. THIRD-PARTY CREDENTIAL SHAPES (`redactKnownCredentialShapes`). Bearer
 *      headers, `sk_`/`api_`-style provider keys, GitHub/GitLab tokens, AWS
 *      access key ids, Google API keys. Model and search providers are called
 *      from actions reachable by a job, and their SDK errors quote request
 *      headers. These patterns were already in the export path; they now live
 *      here once and the export path calls in.
 *
 * WHAT THIS PROVABLY COVERS
 *   - Any NodeSlide owner/execution capability, anywhere in the string, keyed
 *     or not. Proven by minting a real key with `createOwnerAccessKey()` in the
 *     test rather than by asserting against a fixture.
 *   - Any value adjacent to a key the export predicate calls sensitive.
 *   - The five third-party token shapes listed above.
 *
 * WHAT IT CANNOT COVER, stated so nobody reads silence as coverage
 *   - A secret with no recognizable shape sitting next to a key the predicate
 *     does not consider sensitive (`nickname: "hunter2"`). Rule B is only as
 *     good as the predicate, which is a name heuristic.
 *   - A secret that has been transformed — base64'd, url-encoded, split across
 *     concatenated fragments, or hex-expanded — before reaching the text.
 *   - A capability of some FUTURE shape that is not `createOwnerAccessKey()`
 *     output. `NODESLIDE_CAPABILITY_PATTERN` is the single definition of that
 *     shape and `nodeslideAccess.ts` builds its validator from it, so the two
 *     cannot silently disagree; but a genuinely new credential type has to be
 *     added here.
 *   - Non-credential private content. This is a credential scrub, not a PII
 *     scrub. Prompt text quoted back by a provider error is still stored.
 *
 * KNOWN FALSE-NEGATIVE BOUND on rule A: a stable id like `agent_span_<32 hex>`
 * can be exactly 43 characters and is deliberately NOT redacted, because
 * redacting ids would gut the diagnostic value the error exists for. The test
 * for that exclusion is `[a-z0-9_]`-only: real capabilities avoid it with
 * probability 1 - (37/64)^43, about 6e-11. A capability that unlucky is still
 * caught by rule B whenever it appears next to its field name.
 */

import type { NodeSlideSchemaLike } from './nodeslideErasureContract';

export const NODESLIDE_ERROR_REDACTION_VERSION = 'nodeslide.error-redaction/v1';

export const NODESLIDE_REDACTED = '[REDACTED]';

/**
 * The one definition of a NodeSlide bearer capability's shape.
 * `convex/lib/nodeslideAccess.ts` builds both its generator length and its
 * validator from these, so the scrubber cannot fall behind the minter.
 */
export const NODESLIDE_CAPABILITY_BYTES = 32;
export const NODESLIDE_CAPABILITY_LENGTH = 43;
export const NODESLIDE_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Same alphabet and length, scanned mid-string with token boundaries. */
const CAPABILITY_IN_TEXT = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g;

/** Lowercase-hex-and-underscore only: that is a stable id, not 256 random bits. */
const IDENTIFIER_SHAPED = /^[a-z0-9_]+$/;

/**
 * Field-level sensitivity, expressed as one predicate rather than a per-table
 * list. A new column named `providerRefreshToken` is withheld the moment it
 * exists; nobody has to remember to add it anywhere.
 *
 * This moved here from `nodeslideDataExport.ts` unchanged so the export path
 * and the error scrubber cannot drift apart. The export re-exports it under its
 * original name.
 */
export function isNodeSlideSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    [
      'owneraccesskey',
      'shareslug',
      'idempotencykey',
      'ownerdigest',
      'clientsessionid',
      'tokendigest',
    ].includes(normalized)
  ) {
    return true;
  }
  if (
    normalized.includes('ciphertext') ||
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('privatekey') ||
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('capabilitykey') ||
    normalized.endsWith('capability') ||
    normalized.endsWith('capabilitytoken')
  ) {
    return true;
  }
  if (normalized.endsWith('storageid')) return true;
  if (normalized.endsWith('cleanupdigest') || normalized.endsWith('cleanuptoken')) return true;
  return /^(?:access|refresh|auth|authorization|bearer|oauth|provider)?token(?:ciphertext|value)?$/.test(
    normalized,
  );
}

/** Rule A. Key-name independent, and therefore the one that closes the leak. */
export function redactCapabilityShapedValues(value: string): string {
  return value.replace(CAPABILITY_IN_TEXT, (match, lead: string, token: string) =>
    IDENTIFIER_SHAPED.test(token) ? match : `${lead}${NODESLIDE_REDACTED}`,
  );
}

/**
 * Rule B. `key: "v"`, `key='v'`, `"key":"v"`, `key=v`, `key: v`.
 * The key is preserved verbatim; only the value is replaced.
 */
export function redactSensitiveKeyedValues(value: string): string {
  return value.replace(
    /(["'`]?)([A-Za-z_$][A-Za-z0-9_$-]*)\1(\s*[:=]\s*)(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s,;}\])]+))/g,
    (match, quote: string, key: string, separator: string, ...rest: unknown[]) => {
      if (!isNodeSlideSensitiveKey(key)) return match;
      const doubleQuoted = rest[0];
      const singleQuoted = rest[1];
      const backQuoted = rest[2];
      if (typeof doubleQuoted === 'string') {
        return `${quote}${key}${quote}${separator}"${NODESLIDE_REDACTED}"`;
      }
      if (typeof singleQuoted === 'string') {
        return `${quote}${key}${quote}${separator}'${NODESLIDE_REDACTED}'`;
      }
      if (typeof backQuoted === 'string') {
        return `${quote}${key}${quote}${separator}\`${NODESLIDE_REDACTED}\``;
      }
      return `${quote}${key}${quote}${separator}${NODESLIDE_REDACTED}`;
    },
  );
}

/** Rule C. Provider and platform credential shapes quoted back by SDK errors. */
export function redactKnownCredentialShapes(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${NODESLIDE_REDACTED}`)
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, NODESLIDE_REDACTED)
    .replace(/\b(?:ghp|github_pat|glpat)[-_][A-Za-z0-9_-]{12,}\b/gi, NODESLIDE_REDACTED)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, NODESLIDE_REDACTED)
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, NODESLIDE_REDACTED);
}

/**
 * All three rules, in the order that matters: rule B first so a sensitive
 * value is removed with its key intact even when it does not look like a
 * capability, then the shape rules for everything B could not see.
 */
export function redactNodeSlideSecrets(value: string): string {
  return redactKnownCredentialShapes(
    redactCapabilityShapedValues(redactSensitiveKeyedValues(value)),
  );
}

/**
 * The single entry point every persisted-error write must use.
 *
 * Scrub, then collapse whitespace, then bound — in that order. Bounding first
 * is what made the original leak look handled: it decided how much of the
 * capability survived, not whether it did. Because the secret is already
 * `[REDACTED]` by the time the slice happens, no truncation offset can expose
 * a fragment of it.
 */
export function redactNodeSlideErrorText(
  value: string,
  maxLength: number,
  fallback = 'The operation failed safely.',
): string {
  const scrubbed = redactNodeSlideSecrets(value).replace(/\s+/gu, ' ').trim();
  if (!scrubbed) return fallback;
  return scrubbed.slice(0, Math.max(1, maxLength));
}

/* ------------------------------------------------------------------ *
 * The contract: which persisted fields carry error text, derived from
 * the schema so a new one cannot arrive unclassified.
 * ------------------------------------------------------------------ */

export interface NodeSlidePersistedErrorField {
  /** Physical table in `convex/schema.ts`. */
  readonly table: string;
  readonly field: string;
  /** Where the scrub is applied. A field with no site is an open hole. */
  readonly redactedAt: string;
  readonly detail: string;
}

/**
 * Every persisted string field that carries failure text.
 *
 * The name-derived half of this list is CHECKED, not trusted:
 * `buildNodeSlidePersistedErrorFieldContract` walks the real schema for string
 * fields whose normalized name contains `error` and throws on any that is not
 * declared here. Adding `nodeslide_x.lastError` to the schema fails a test
 * until somebody says where it is scrubbed.
 *
 * The rest are sinks the name rule CANNOT derive — free-text columns that
 * happen to receive caught-exception text under a name with no `error` in it.
 * They are declared by hand because nothing mechanical can find them, and that
 * asymmetry is the honest limit of this contract.
 */
export const NODESLIDE_PERSISTED_ERROR_FIELDS: readonly NodeSlidePersistedErrorField[] = [
  {
    table: 'nodeslide_agent_jobs',
    field: 'error',
    redactedAt: 'convex/lib/nodeslideJobState.ts boundedError / advanceNodeSlideJob',
    detail:
      'The reported leak. Written by failNodeSlideJob, checkpointInternal, and the pause/cancel transitions in nodeslideJobControl.ts, and returned by the public listSessionJobs query. Scrubbed in nodeslideJobState.ts so every writer is covered by construction rather than by each caller remembering.',
  },
  {
    table: 'nodeslide_agent_runs',
    field: 'error',
    redactedAt: 'convex/nodeslide.ts advanceAgentRunInternal',
    detail:
      'Terminal agent-run failure text, surfaced in the Trace tab. Same exposure class as the job row: an action failure quoted verbatim.',
  },
  {
    table: 'nodeslide_agent_runs',
    field: 'otelExportError',
    redactedAt: 'convex/nodeslide.ts markAgentTelemetryExportInternal',
    detail:
      'OTLP exporter failure. Fed from nodeslideTelemetry.ts, where the caught error is an HTTP client error whose message can quote the request — including an Authorization header.',
  },
  {
    table: 'nodeslide_evidence_captures',
    field: 'error',
    redactedAt: 'convex/nodeslide.ts recordEvidenceCaptureInternal',
    detail:
      'Web-evidence capture failure, from a third-party browsing provider. Provider SDK errors quote request URLs, which carry API keys in query strings.',
  },
  {
    table: 'nodeslide_google_sync_states',
    field: 'errorMessage',
    redactedAt: 'convex/nodeslideGoogleSlidesRuntime.ts boundedError',
    detail:
      'Google Slides runtime failure. The highest-value sink after the job row: the caller holds an OAuth access token and googleapis errors quote request context.',
  },
  {
    table: 'nodeslide_google_sync_states',
    field: 'errorCode',
    redactedAt: 'convex/nodeslideGoogleSlidesRuntime.ts boundedError / boundedErrorOrUndefined',
    detail:
      'A short machine code, not free text, but it is a v.string() written from the same mutation arguments as errorMessage. Scrubbed on the same path so the pair cannot diverge; a real code contains no credential shape and passes through unchanged.',
  },
  {
    table: 'nodeslide_source_refresh_schedules',
    field: 'lastError',
    redactedAt: 'convex/nodeslideSourceRefresh.ts recordFailureInternal',
    detail:
      'Source-monitoring fetch failure, returned to the deck owner by the schedule listing. The caught error is an outbound fetch failure whose message quotes the URL.',
  },
  {
    table: 'nodeslide_evidence_steps',
    field: 'detail',
    redactedAt: 'convex/nodeslide.ts recordEvidenceCaptureInternal',
    detail:
      'NOT name-derivable. A per-step note that carries the capture failure reason when step.status is "error", so it is the same provider text as nodeslide_evidence_captures.error under a name the rule cannot see. Declared by hand; the contract builder does not require it.',
  },
];

const NAME_DERIVED_TABLES_FIELDS = new Set(
  NODESLIDE_PERSISTED_ERROR_FIELDS.map((entry) => `${entry.table}.${entry.field}`),
);

export class NodeSlidePersistedErrorContractError extends Error {}

/** A schema field name that this contract claims to be able to find on its own. */
export function isNodeSlideErrorFieldName(field: string): boolean {
  return field
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .includes('error');
}

/**
 * Walks the real schema and refuses any string field whose name contains
 * `error` and which nobody has said where to scrub.
 *
 * This is the same move `buildNodeSlideErasureContract` makes and for the same
 * reason: the list that matters is in `convex/schema.ts`, so the schema is the
 * list. A hand-written enumeration of leak sites is correct on the day it is
 * written and silently wrong the first time somebody adds a column.
 */
export function buildNodeSlidePersistedErrorFieldContract(
  schema: NodeSlideSchemaLike,
): readonly NodeSlidePersistedErrorField[] {
  const undeclared: string[] = [];
  for (const [table, definition] of Object.entries(schema.tables)) {
    for (const [field, spec] of Object.entries(definition.validator.fields ?? {})) {
      if (spec.kind !== 'string') continue;
      if (!isNodeSlideErrorFieldName(field)) continue;
      if (!NAME_DERIVED_TABLES_FIELDS.has(`${table}.${field}`)) {
        undeclared.push(`${table}.${field}`);
      }
    }
  }
  if (undeclared.length > 0) {
    throw new NodeSlidePersistedErrorContractError(
      `NodeSlide persisted-error contract cannot place ${undeclared.join(', ')}: a string field whose name contains "error" must be declared in NODESLIDE_PERSISTED_ERROR_FIELDS with the site that scrubs it. An error column with no redaction site is a credential-disclosure path.`,
    );
  }
  return NODESLIDE_PERSISTED_ERROR_FIELDS;
}
