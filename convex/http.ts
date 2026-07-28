import { httpRouter } from 'convex/server';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

const http = httpRouter();

/**
 * Google's OAuth redirect target.
 *
 * The route itself decides nothing. It bounds the two attacker-controlled
 * parameters, hands them to `nodeslideGoogleAuth.complete`, and redirects to
 * the URL that action returns. Everything that matters — matching the state
 * digest against a stored, unconsumed, unexpired session, exchanging the code
 * with the PKCE verifier, and refusing a scope grant that is not the one the
 * app asked for — happens there, where it can be tested without a browser.
 */
http.route({
  path: '/api/nodeslide/google/oauth/callback',
  method: 'GET',
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const state = url.searchParams.get('state')?.trim();
    if (!state || state.length > 256) {
      return new Response('This Google Slides connection link is invalid or expired.', {
        status: 400,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        },
      });
    }
    const code = url.searchParams.get('code')?.trim();
    const error = url.searchParams.get('error')?.trim();
    if ((code?.length ?? 0) > 4096 || (error?.length ?? 0) > 256) {
      return new Response('This Google Slides connection response is invalid.', {
        status: 400,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        },
      });
    }
    const { redirectTo } = await ctx.runAction(internal.nodeslideGoogleAuth.complete, {
      state,
      ...(code ? { code } : {}),
      ...(error ? { error } : {}),
    });
    return new Response(null, {
      status: 302,
      headers: {
        'cache-control': 'no-store',
        location: redirectTo,
        'referrer-policy': 'no-referrer',
      },
    });
  }),
});

export default http;
