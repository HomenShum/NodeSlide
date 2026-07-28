/**
 * Scenario coverage for the only place NodeSlide talks to Google.
 *
 * Every request the integration makes goes through `createGoogleSlidesAdapter`,
 * so this file stands a fake Google in front of it and drives real owner
 * journeys: linking a presentation, being refused by `drive.file`, pushing a
 * reviewed plan, and being handed a degraded response. No credential is
 * involved and no packet leaves the machine — the seam is `options.fetch`, and
 * the endpoint the adapter chooses is itself an assertion here, because
 * "which URL does this call" is exactly the claim a capability label cannot
 * make.
 */
import { describe, expect, it } from 'vitest';
import {
  GoogleSlidesRestError,
  assertExecutableBatchUpdatePlan,
  createGoogleSlidesAdapter,
} from './adapter';
import type {
  GoogleSlidesBatchUpdatePlan,
  GoogleSlidesHttpResponse,
  GoogleSlidesPresentation,
  GoogleSlidesRequest,
} from './types';

// Deliberately NOT shaped like a real Google access token. The first version of this fixture used
// Google's real OAuth access-token prefix, and GitGuardian failed the pull request on it. The value
// was always fake, so the finding was a false positive — but the right fix is the fixture, not a
// waiver. A test credential shaped like a real one teaches everybody to wave the scanner through,
// and the one time it is right is the time it gets waved through too. The prefix is not repeated
// in this comment for the same reason.
const ACCESS_TOKEN = 'test-access-token-not-a-real-credential';
const PRESENTATION_ID = 'presentation_scenario_1';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A stand-in Google. It records every call and answers from a queue. */
function fakeGoogle(responses: GoogleSlidesHttpResponse[]) {
  const calls: RecordedCall[] = [];
  return {
    calls,
    fetch: async (url: string, init?: RequestInit): Promise<GoogleSlidesHttpResponse> => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      const next = responses.shift();
      if (!next) throw new Error('The scenario made more Google calls than it declared.');
      return next;
    },
  };
}

function jsonResponse(status: number, payload: unknown): GoogleSlidesHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

/** A load balancer or captive proxy answering with HTML instead of JSON. */
function htmlResponse(status: number, body: string): GoogleSlidesHttpResponse {
  return {
    ok: false,
    status,
    statusText: String(status),
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
    text: async () => body,
  };
}

function presentation(overrides: Partial<GoogleSlidesPresentation> = {}) {
  return {
    presentationId: PRESENTATION_ID,
    title: 'Quarterly review',
    revisionId: 'revision_1',
    pageSize: {
      width: { magnitude: 9_144_000, unit: 'EMU' },
      height: { magnitude: 5_143_500, unit: 'EMU' },
    },
    slides: [
      {
        objectId: 'g_slide_1',
        pageElements: [
          {
            objectId: 'g_shape_1',
            size: {
              width: { magnitude: 3_000_000, unit: 'EMU' },
              height: { magnitude: 900_000, unit: 'EMU' },
            },
            transform: { scaleX: 1, scaleY: 1, translateX: 500_000, translateY: 400_000 },
            shape: {
              shapeType: 'TEXT_BOX',
              text: { textElements: [{ textRun: { content: 'Opening claim' } }] },
            },
          },
        ],
      },
    ],
    ...overrides,
  } satisfies GoogleSlidesPresentation;
}

function reviewedPlan(requests: GoogleSlidesRequest[]): GoogleSlidesBatchUpdatePlan {
  return {
    kind: 'google_slides_batch_update',
    provider: 'google_slides',
    presentationId: PRESENTATION_ID,
    requiredRevisionId: 'revision_1',
    requests,
    body: { requests, writeControl: { requiredRevisionId: 'revision_1' } },
    blocked: false,
    blockedReasons: [],
  };
}

const INSERT_TEXT: GoogleSlidesRequest[] = [
  { insertText: { objectId: 'g_shape_1', insertionIndex: 0, text: 'Revised claim' } },
];

function adapterFor(google: ReturnType<typeof fakeGoogle>, baseUrl?: string) {
  return createGoogleSlidesAdapter({
    fetch: google.fetch,
    auth: () => ({ Authorization: `Bearer ${ACCESS_TOKEN}` }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  });
}

describe('an owner links a Google Slides presentation', () => {
  it('reads it from the Slides v1 REST endpoint with a bearer credential', async () => {
    const google = fakeGoogle([jsonResponse(200, presentation())]);

    const result = await adapterFor(google).getPresentation(PRESENTATION_ID);

    // The endpoint is the capability claim. If this URL ever changes, the
    // integration is talking to something other than Google Slides.
    expect(google.calls).toHaveLength(1);
    expect(google.calls[0]?.url).toBe(
      `https://slides.googleapis.com/v1/presentations/${PRESENTATION_ID}`,
    );
    expect(google.calls[0]?.method).toBe('GET');
    expect(google.calls[0]?.headers['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(google.calls[0]?.body).toBeUndefined();

    expect(result.source.revisionId).toBe('revision_1');
    expect(result.normalized.presentation.slides).toHaveLength(1);
    expect(result.normalized.presentation.slides[0]?.elements[0]?.content).toContain(
      'Opening claim',
    );
  });

  it('refuses a response for a different presentation than the one requested', async () => {
    // The adversarial case behind `drive.file`: a redirect, a cached proxy, or
    // a hostile response body that hands back somebody else's deck. Accepting
    // it would overwrite this deck's baseline with a stranger's content.
    const google = fakeGoogle([
      jsonResponse(200, presentation({ presentationId: 'presentation_someone_else' })),
    ]);

    await expect(adapterFor(google).getPresentation(PRESENTATION_ID)).rejects.toThrow(
      'returned a different presentationId',
    );
  });

  it('never opens a request for an empty presentation id', async () => {
    const google = fakeGoogle([]);

    await expect(adapterFor(google).getPresentation('   ')).rejects.toThrow(
      'presentationId is required',
    );
    expect(google.calls).toHaveLength(0);
  });

  it('percent-encodes a hostile id instead of letting it reshape the path', async () => {
    const google = fakeGoogle([jsonResponse(404, { error: { code: 404 } })]);

    await expect(
      adapterFor(google).getPresentation('../../presentations/other:batchUpdate'),
    ).rejects.toBeInstanceOf(GoogleSlidesRestError);
    expect(google.calls[0]?.url).toBe(
      'https://slides.googleapis.com/v1/presentations/..%2F..%2Fpresentations%2Fother%3AbatchUpdate',
    );
  });
});

describe('Google refuses or degrades', () => {
  it('surfaces a drive.file scope refusal with its status and body', async () => {
    // A pasted Drive id that this app was never granted. `drive.file` is
    // supposed to refuse it, and the refusal has to reach the owner intact
    // rather than becoming a generic failure.
    const refusal = {
      error: {
        code: 403,
        status: 'PERMISSION_DENIED',
        message: 'The caller does not have permission',
      },
    };
    const google = fakeGoogle([jsonResponse(403, refusal)]);

    const error = await adapterFor(google)
      .getPresentation(PRESENTATION_ID)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GoogleSlidesRestError);
    expect((error as GoogleSlidesRestError).status).toBe(403);
    expect((error as GoogleSlidesRestError).responseBody).toEqual(refusal);
  });

  it('does not put the access token into the error it throws', async () => {
    const google = fakeGoogle([jsonResponse(401, { error: { code: 401 } })]);

    const error = await adapterFor(google)
      .getPresentation(PRESENTATION_ID)
      .catch((thrown: unknown) => thrown);

    const serialized = `${(error as Error).message}${JSON.stringify(
      (error as GoogleSlidesRestError).responseBody,
    )}${(error as Error).stack ?? ''}`;
    expect(serialized).not.toContain(ACCESS_TOKEN);
  });

  it('survives a non-JSON body from an edge that is not Google', async () => {
    const google = fakeGoogle([htmlResponse(502, '<html><body>Bad Gateway</body></html>')]);

    const error = await adapterFor(google)
      .getPresentation(PRESENTATION_ID)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GoogleSlidesRestError);
    expect((error as GoogleSlidesRestError).status).toBe(502);
    expect((error as GoogleSlidesRestError).responseBody).toContain('Bad Gateway');
  });

  it('reports a rate limit as a rate limit rather than as no change', async () => {
    const google = fakeGoogle([
      jsonResponse(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }),
    ]);

    await expect(adapterFor(google).batchUpdate(reviewedPlan(INSERT_TEXT))).rejects.toMatchObject({
      status: 429,
    });
  });
});

describe('an owner pushes a reviewed plan', () => {
  it('writes to :batchUpdate bound to the revision the plan was reviewed against', async () => {
    const google = fakeGoogle([
      jsonResponse(200, {
        presentationId: PRESENTATION_ID,
        replies: [{}],
        writeControl: { requiredRevisionId: 'revision_2' },
      }),
    ]);

    const response = await adapterFor(google).batchUpdate(reviewedPlan(INSERT_TEXT));

    expect(google.calls[0]?.url).toBe(
      `https://slides.googleapis.com/v1/presentations/${PRESENTATION_ID}:batchUpdate`,
    );
    expect(google.calls[0]?.method).toBe('POST');
    expect(JSON.parse(google.calls[0]?.body ?? '{}')).toEqual({
      requests: INSERT_TEXT,
      writeControl: { requiredRevisionId: 'revision_1' },
    });
    expect(response.writeControl?.requiredRevisionId).toBe('revision_2');
  });

  it('sends nothing when the executed requests differ from the reviewed ones', async () => {
    // The whole point of review-gated sync. A plan whose body drifted from the
    // requests the owner approved must fail before the socket is opened, not
    // after Google has already applied it.
    const google = fakeGoogle([]);
    const tampered = reviewedPlan(INSERT_TEXT);
    tampered.body = {
      requests: [{ deleteObject: { objectId: 'g_shape_1' } }],
      writeControl: { requiredRevisionId: 'revision_1' },
    };

    await expect(adapterFor(google).batchUpdate(tampered)).rejects.toThrow(
      'must contain the exact planned requests',
    );
    expect(google.calls).toHaveLength(0);
  });

  it('sends nothing when the plan carries no revision guard', async () => {
    const google = fakeGoogle([]);
    const unguarded = reviewedPlan(INSERT_TEXT);
    unguarded.requiredRevisionId = '';

    await expect(adapterFor(google).batchUpdate(unguarded)).rejects.toThrow(
      'non-empty requiredRevisionId guard',
    );
    expect(google.calls).toHaveLength(0);
  });

  it('sends nothing when planning already blocked the push', async () => {
    const google = fakeGoogle([]);
    const blocked = reviewedPlan(INSERT_TEXT);
    blocked.blocked = true;
    blocked.blockedReasons = ['unsupported_element'];

    await expect(adapterFor(google).batchUpdate(blocked)).rejects.toThrow('plan is blocked');
    expect(google.calls).toHaveLength(0);
  });

  it('sends nothing for an empty request list', async () => {
    const google = fakeGoogle([]);

    await expect(adapterFor(google).batchUpdate(reviewedPlan([]))).rejects.toThrow(
      'at least one request',
    );
    expect(google.calls).toHaveLength(0);
  });
});

describe('a long editing session, many pushes', () => {
  it('re-guards every push with the revision Google last returned', async () => {
    // Sustained use, not a single call: a guard that is only correct on the
    // first push is a lost-update bug that appears an hour into a session.
    const revisions = ['revision_1', 'revision_2', 'revision_3', 'revision_4'];
    const google = fakeGoogle(
      revisions.slice(1).map((next) =>
        jsonResponse(200, {
          presentationId: PRESENTATION_ID,
          replies: [{}],
          writeControl: { requiredRevisionId: next },
        }),
      ),
    );
    const adapter = adapterFor(google);

    let current = revisions[0] as string;
    for (let push = 0; push < 3; push += 1) {
      const plan = reviewedPlan(INSERT_TEXT);
      plan.requiredRevisionId = current;
      plan.body = { requests: INSERT_TEXT, writeControl: { requiredRevisionId: current } };
      const response = await adapter.batchUpdate(plan);
      expect(JSON.parse(google.calls[push]?.body ?? '{}').writeControl.requiredRevisionId).toBe(
        current,
      );
      current = response.writeControl?.requiredRevisionId as string;
    }

    expect(google.calls).toHaveLength(3);
    expect(current).toBe('revision_4');
    // Every single call was revision-bound; none fell back to a blind write.
    for (const call of google.calls) {
      expect(JSON.parse(call.body ?? '{}').writeControl.requiredRevisionId).toBeTruthy();
    }
  });

  it('keeps the guard mandatory even when a caller overrides the base URL', async () => {
    const google = fakeGoogle([jsonResponse(200, { presentationId: PRESENTATION_ID })]);

    await adapterFor(google, 'https://slides.googleapis.com/v1/').batchUpdate(
      reviewedPlan(INSERT_TEXT),
    );

    // A trailing slash must not produce a double-slashed path that silently
    // 404s in production while every unit test passes.
    expect(google.calls[0]?.url).toBe(
      `https://slides.googleapis.com/v1/presentations/${PRESENTATION_ID}:batchUpdate`,
    );
  });
});

describe('the executable-plan assertion on its own', () => {
  it('accepts exactly the shape the runtime is allowed to execute', () => {
    expect(() => assertExecutableBatchUpdatePlan(reviewedPlan(INSERT_TEXT))).not.toThrow();
  });

  it('rejects a body bound to a revision other than the plan guard', () => {
    const mismatched = reviewedPlan(INSERT_TEXT);
    mismatched.body = {
      requests: INSERT_TEXT,
      writeControl: { requiredRevisionId: 'revision_99' },
    };

    expect(() => assertExecutableBatchUpdatePlan(mismatched)).toThrow('not bound to its');
  });
});
