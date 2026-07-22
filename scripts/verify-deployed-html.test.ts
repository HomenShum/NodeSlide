import { describe, expect, it } from 'vitest';
import { verifyDeployedHtml } from './verify-deployed-html.mjs';

describe('verifyDeployedHtml', () => {
  const dist =
    '<script type="module" src="/assets/index-exact123.js"></script><link rel="stylesheet" href="/assets/index-exact123.css">';

  it('returns the exact entry when the authenticated immutable response matches', () => {
    expect(verifyDeployedHtml(dist, `<html><body>${dist}</body></html>`)).toBe(
      '/assets/index-exact123.js',
    );
  });

  it('fails closed when the immutable response serves a different deployment', () => {
    expect(() =>
      verifyDeployedHtml(dist, '<script type="module" src="/assets/index-stale456.js"></script>'),
    ).toThrow(/different hashed asset manifest/i);
  });

  it('fails closed when script identity matches but CSS or another hashed asset differs', () => {
    expect(() =>
      verifyDeployedHtml(
        dist,
        '<script type="module" src="/assets/index-exact123.js"></script><link rel="stylesheet" href="/assets/index-stale456.css">',
      ),
    ).toThrow(/different hashed asset manifest/i);
    expect(() =>
      verifyDeployedHtml(
        dist,
        `${dist}<link rel="modulepreload" href="/assets/injected-other.js">`,
      ),
    ).toThrow(/different hashed asset manifest/i);
  });

  it('fails closed on a protection login page or malformed response', () => {
    expect(() => verifyDeployedHtml(dist, '<html><title>Log in to Vercel</title></html>')).toThrow(
      /did not reference/i,
    );
  });
});
