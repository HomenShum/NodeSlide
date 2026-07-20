import { describe, expect, it, vi } from 'vitest';
import { NODESLIDE_IMAGE_SEARCH_CONSENT } from '../../shared/nodeslide';
import {
  OPENVERSE_MAX_RESPONSE_BYTES,
  OPENVERSE_MAX_RESULTS,
  assertAllowlistedOpenverseUrl,
  assertImageSearchConsent,
  buildOpenverseSearchUrl,
  mapOpenverseResults,
  searchOpenverseImages,
} from './nodeslideImageSearch';

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function openverseRow(index: number) {
  return {
    id: `img-${index}`,
    title: `Turbine ${index}`,
    thumbnail: `https://api.openverse.org/v1/images/img-${index}/thumb/`,
    url: `https://live.staticflickr.com/turbine-${index}.jpg`,
    license: 'by',
    license_version: '2.0',
    license_url: 'https://creativecommons.org/licenses/by/2.0/',
    creator: `Photographer ${index}`,
    foreign_landing_url: `https://flickr.com/photos/turbine-${index}`,
  };
}

describe('Openverse image search: consent gate', () => {
  it('rejects a missing or wrong consent receipt and accepts only the exact one', () => {
    expect(() => assertImageSearchConsent(undefined)).toThrow(/consent/i);
    expect(() => assertImageSearchConsent('')).toThrow(/consent/i);
    // Receipts are operation-specific and intentionally not interchangeable.
    expect(() => assertImageSearchConsent('nodeslide_web_research_v1')).toThrow(/consent/i);
    expect(() => assertImageSearchConsent(NODESLIDE_IMAGE_SEARCH_CONSENT)).not.toThrow();
  });
});

describe('Openverse image search: SSRF allowlist', () => {
  it('builds only api.openverse.org URLs with the commercial license filter', () => {
    const url = new URL(buildOpenverseSearchUrl('  wind turbines  '));
    expect(url.hostname).toBe('api.openverse.org');
    expect(url.protocol).toBe('https:');
    expect(url.searchParams.get('q')).toBe('wind turbines');
    expect(url.searchParams.get('license_type')).toBe('commercial');
    expect(url.searchParams.get('page_size')).toBe(String(OPENVERSE_MAX_RESULTS));
  });

  it('rejects every non-allowlisted URL an attacker could smuggle in', () => {
    for (const hostile of [
      'https://evil.example.com/v1/images/',
      'https://api.openverse.org.evil.com/v1/images/',
      'http://api.openverse.org/v1/images/', // https only
      'https://localhost:6379/',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(() => assertAllowlistedOpenverseUrl(hostile)).toThrow(/refusing to fetch/i);
    }
    expect(() =>
      assertAllowlistedOpenverseUrl('https://api.openverse.org/v1/images/?q=x'),
    ).not.toThrow();
  });
});

describe('Openverse image search: field mapping', () => {
  it('maps API rows into the bounded LicensedImageResult shape', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ results: [openverseRow(1)] }));
    const outcome = await searchOpenverseImages('wind turbines', fetchMock);
    expect(outcome).toEqual({
      ok: true,
      results: [
        {
          id: 'img-1',
          title: 'Turbine 1',
          thumbnailUrl: 'https://api.openverse.org/v1/images/img-1/thumb/',
          url: 'https://live.staticflickr.com/turbine-1.jpg',
          license: 'BY 2.0',
          licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
          creator: 'Photographer 1',
          foreignLandingUrl: 'https://flickr.com/photos/turbine-1',
        },
      ],
    });
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.hostname).toBe('api.openverse.org');
    expect(requested.searchParams.get('license_type')).toBe('commercial');
  });

  it('caps results at 8, drops rows without a usable url, and defaults missing credit fields', () => {
    const rows = Array.from({ length: 20 }, (_, index) => openverseRow(index));
    expect(mapOpenverseResults({ results: rows })).toHaveLength(OPENVERSE_MAX_RESULTS);
    expect(mapOpenverseResults({ results: [{ title: 'no url' }] })).toEqual([]);
    const sparse = mapOpenverseResults({
      results: [{ url: 'https://example.com/a.jpg' }],
    });
    expect(sparse[0]?.creator).toBe('Unknown creator');
    expect(sparse[0]?.license).toBe('Unknown license');
    expect(mapOpenverseResults(null)).toEqual([]);
    expect(mapOpenverseResults({ results: 'nope' })).toEqual([]);
  });
});

describe('Openverse image search: honest failure states', () => {
  it('reports a non-2xx status instead of fabricating an empty success', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, { status: 503 }));
    const outcome = await searchOpenverseImages('turbines', fetchMock);
    expect(outcome).toEqual({ ok: false, reason: 'Openverse responded with status 503.' });
  });

  it('discards responses beyond the 1MB cap instead of buffering them', async () => {
    const oversized = `{"results": ["${'x'.repeat(OPENVERSE_MAX_RESPONSE_BYTES + 64)}"]}`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(oversized));
    const outcome = await searchOpenverseImages('turbines', fetchMock);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('Expected the oversized response to fail closed.');
    expect(outcome.reason).toMatch(/1MB safety cap/);
  });

  it('reports malformed JSON and network failures honestly', async () => {
    const badJson = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>err</html>'));
    expect(await searchOpenverseImages('turbines', badJson)).toEqual({
      ok: false,
      reason: 'Openverse returned a response that was not valid JSON.',
    });
    const network = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const outcome = await searchOpenverseImages('turbines', network);
    expect(outcome.ok).toBe(false);
  });

  it('fails closed on an empty query without touching the network', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const outcome = await searchOpenverseImages('   ', fetchMock);
    expect(outcome.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Openverse image search: action wiring', () => {
  it('the convex action enforces consent, honest errors, and the shared search core', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../nodeslideImages.ts', import.meta.url), 'utf8');
    expect(source).toContain('assertImageSearchConsent(args.consent)');
    expect(source).toContain('searchOpenverseImages(query)');
    expect(source).toContain('if (!outcome.ok) throw new ConvexError(outcome.reason)');
  });
});
