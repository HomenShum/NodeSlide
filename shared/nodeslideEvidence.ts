/**
 * Evidence-lineage helpers (pure; no React/Convex/DOM types).
 *
 * Web research stores TEXT excerpts on source records — snippet into
 * `citation`, plus `retrievedAt`/`contentDigest`. There is no screenshot
 * pipeline, so the UI must say "text excerpt · no visual snapshot" instead of
 * faking a screenshot badge. These helpers make that storage path testable and
 * give the Evidence tab an honest, deterministic highlight of the claim terms
 * inside the stored excerpt.
 */

export interface WebSourceExcerptInput {
  title: string;
  url: string;
  snippet: string;
  provider: string;
}

export interface NormalizedWebSourceExcerpt {
  title: string;
  url: string;
  snippet: string;
  provider: string;
}

export const WEB_SOURCE_TITLE_MAX = 180;
export const WEB_SOURCE_EXCERPT_MAX = 1000;
export const WEB_SOURCE_PROVIDER_MAX = 80;
export const WEB_SOURCE_URL_MAX = 900;

function requiredEvidenceText(value: string, label: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error(`${label} is required.`);
  if (clean.length > max) throw new Error(`${label} exceeds ${max} characters.`);
  return clean;
}

/**
 * Validates one web-source excerpt exactly as the storage mutation persists
 * it: text fields are whitespace-normalized and length-capped (throwing on
 * empty/oversized input), while a malformed or non-http(s) URL skips the row
 * by returning null — a bad URL must never abort the whole research run.
 */
export function normalizeWebSourceExcerpt(
  input: WebSourceExcerptInput,
): NormalizedWebSourceExcerpt | null {
  const title = requiredEvidenceText(input.title, 'web source title', WEB_SOURCE_TITLE_MAX);
  const snippet = requiredEvidenceText(input.snippet, 'web source excerpt', WEB_SOURCE_EXCERPT_MAX);
  const provider = requiredEvidenceText(
    input.provider,
    'web source provider',
    WEB_SOURCE_PROVIDER_MAX,
  );
  let url: string;
  try {
    const parsed = new URL(input.url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
    url = parsed.toString().slice(0, WEB_SOURCE_URL_MAX);
  } catch {
    return null;
  }
  return { title, url, snippet, provider };
}

/** Words too generic to count as claim evidence inside an excerpt. */
const CLAIM_TERM_STOPWORDS = new Set([
  'about',
  'after',
  'also',
  'been',
  'before',
  'between',
  'could',
  'every',
  'from',
  'have',
  'into',
  'more',
  'most',
  'other',
  'over',
  'should',
  'slide',
  'source',
  'than',
  'that',
  'their',
  'them',
  'there',
  'these',
  'they',
  'this',
  'through',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'will',
  'with',
  'would',
  'your',
]);

/**
 * Significant terms shared between the citing claim text and the stored
 * excerpt. Tokens must be 4+ characters, non-stopword, and actually present in
 * the excerpt (case-insensitive) — nothing is highlighted that the source does
 * not literally contain. Returned sorted for deterministic rendering.
 */
export function evidenceClaimTerms(claimTexts: readonly string[], excerpt: string): string[] {
  const excerptLower = excerpt.toLowerCase();
  const terms = new Set<string>();
  for (const claim of claimTexts) {
    for (const raw of claim.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (raw.length < 4) continue;
      if (CLAIM_TERM_STOPWORDS.has(raw)) continue;
      if (!excerptLower.includes(raw)) continue;
      terms.add(raw);
    }
  }
  return [...terms].sort();
}

export interface ExcerptSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Splits the excerpt into ordered segments with claim terms marked, matching
 * case-insensitively on whole occurrences. Overlaps resolve to the earliest
 * (then longest) match; the concatenation of segment texts always equals the
 * original excerpt, so the UI can never alter the stored evidence.
 */
export function highlightExcerpt(excerpt: string, terms: readonly string[]): ExcerptSegment[] {
  if (!excerpt) return [];
  const lower = excerpt.toLowerCase();
  const matches: Array<{ start: number; end: number }> = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(needle, from);
      if (at === -1) break;
      matches.push({ start: at, end: at + needle.length });
      from = at + needle.length;
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const segments: ExcerptSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue; // overlap already covered
    if (match.start > cursor) {
      segments.push({ text: excerpt.slice(cursor, match.start), highlighted: false });
    }
    segments.push({ text: excerpt.slice(match.start, match.end), highlighted: true });
    cursor = match.end;
  }
  if (cursor < excerpt.length) {
    segments.push({ text: excerpt.slice(cursor), highlighted: false });
  }
  return segments;
}
