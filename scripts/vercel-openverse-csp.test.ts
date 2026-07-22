import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production content security policy', () => {
  it('permits the consented Openverse embed fetch without widening script or object sources', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const policy = vercel.headers
      .flatMap((entry) => entry.headers)
      .find((header) => header.key === 'Content-Security-Policy')?.value;

    expect(policy).toContain(
      "connect-src 'self' https://api.openai.com https://api.openverse.org https://*.convex.cloud",
    );
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("media-src 'self' data: blob: https:");
    expect(policy).not.toContain('connect-src *');
  });
});
