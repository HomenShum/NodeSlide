'use node';

import { type LicensedImageResult, NODESLIDE_IMAGE_SEARCH_CONSENT } from '../../shared/nodeslide';

/**
 * License-aware image search against the Openverse catalog.
 *
 * Reliability posture (8-point checklist):
 * - TIMEOUT: AbortController with a hard 10s budget.
 * - SSRF: only https://api.openverse.org may be fetched; the URL is built here
 *   and re-validated before the request leaves the process.
 * - BOUND_READ: response bodies are read through a 1MB cap and cancelled beyond it.
 * - BOUND: results are mapped into a fixed shape and truncated to 8 entries.
 * - HONEST_STATUS: failures return `{ ok: false, reason }`; no fake successes.
 */

export const OPENVERSE_ALLOWED_HOST = 'api.openverse.org' as const;
export const OPENVERSE_TIMEOUT_MS = 10_000;
export const OPENVERSE_MAX_RESPONSE_BYTES = 1_000_000;
export const OPENVERSE_MAX_RESULTS = 8;
export const OPENVERSE_MAX_QUERY_LENGTH = 200;

export type OpenverseSearchOutcome =
  | { ok: true; results: LicensedImageResult[] }
  | { ok: false; reason: string };

interface OpenverseRawResult {
  id?: string;
  title?: string;
  thumbnail?: string;
  url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  creator?: string;
  foreign_landing_url?: string;
}

export function assertImageSearchConsent(consent: string | undefined): void {
  if (consent !== NODESLIDE_IMAGE_SEARCH_CONSENT) {
    throw new Error(
      'Explicit image search consent is required before sending this query to Openverse.',
    );
  }
}

export function buildOpenverseSearchUrl(query: string): string {
  const trimmed = query.trim().slice(0, OPENVERSE_MAX_QUERY_LENGTH);
  if (!trimmed) throw new Error('Enter a search query before searching Openverse.');
  const url = new URL(`https://${OPENVERSE_ALLOWED_HOST}/v1/images/`);
  url.searchParams.set('q', trimmed);
  url.searchParams.set('license_type', 'commercial');
  url.searchParams.set('page_size', String(OPENVERSE_MAX_RESULTS));
  return url.toString();
}

/** SSRF guard: every outbound URL must resolve to the Openverse API host over https. */
export function assertAllowlistedOpenverseUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Refusing to fetch a malformed URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== OPENVERSE_ALLOWED_HOST) {
    throw new Error(`Refusing to fetch outside the ${OPENVERSE_ALLOWED_HOST} allowlist.`);
  }
}

async function readBoundedText(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > OPENVERSE_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const decoder = new TextDecoder();
  return `${chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('')}${decoder.decode()}`;
}

export function mapOpenverseResults(raw: unknown): LicensedImageResult[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const rows = (raw as { results?: unknown }).results;
  if (!Array.isArray(rows)) return [];
  const mapped: LicensedImageResult[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const item = row as OpenverseRawResult;
    const url = typeof item.url === 'string' ? item.url : '';
    if (!url || url.length > 2_000) continue;
    const license =
      typeof item.license === 'string' && item.license
        ? `${item.license.toUpperCase()}${item.license_version ? ` ${item.license_version}` : ''}`
        : 'Unknown license';
    mapped.push({
      id: typeof item.id === 'string' && item.id ? item.id : url,
      title: (typeof item.title === 'string' && item.title ? item.title : 'Untitled image').slice(
        0,
        320,
      ),
      thumbnailUrl: typeof item.thumbnail === 'string' ? item.thumbnail.slice(0, 2_000) : '',
      url,
      license,
      licenseUrl: typeof item.license_url === 'string' ? item.license_url.slice(0, 2_000) : '',
      creator: (typeof item.creator === 'string' && item.creator
        ? item.creator
        : 'Unknown creator'
      ).slice(0, 160),
      foreignLandingUrl:
        typeof item.foreign_landing_url === 'string'
          ? item.foreign_landing_url.slice(0, 2_000)
          : '',
    });
    if (mapped.length >= OPENVERSE_MAX_RESULTS) break;
  }
  return mapped;
}

export async function searchOpenverseImages(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenverseSearchOutcome> {
  let searchUrl: string;
  try {
    searchUrl = buildOpenverseSearchUrl(query);
    assertAllowlistedOpenverseUrl(searchUrl);
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : 'Invalid search query.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENVERSE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(searchUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, reason: `Openverse responded with status ${response.status}.` };
    }
    const text = await readBoundedText(response);
    if (text === null) {
      return {
        ok: false,
        reason: 'The Openverse response exceeded the 1MB safety cap and was discarded.',
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: 'Openverse returned a response that was not valid JSON.' };
    }
    return { ok: true, results: mapOpenverseResults(parsed) };
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    return {
      ok: false,
      reason: aborted
        ? `Openverse did not respond within ${OPENVERSE_TIMEOUT_MS / 1000}s.`
        : 'The Openverse request failed before a response arrived.',
    };
  } finally {
    clearTimeout(timer);
  }
}
