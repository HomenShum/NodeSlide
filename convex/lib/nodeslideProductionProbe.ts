import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_PRODUCTION_PROBE_TTL_MS = 2 * 60 * 60 * 1_000;
const PROBE_CLEANUP_DOMAIN = 'nodeslide.production-probe-cleanup/v1';

export function isNodeSlideProductionProbeCleanupToken(value: string): boolean {
  return /^probe_[A-Za-z0-9_-]{43}$/u.test(value);
}

export function nodeSlideProductionProbeFields(token: string, now: number) {
  if (!isNodeSlideProductionProbeCleanupToken(token)) {
    throw new Error('Invalid NodeSlide production probe cleanup token.');
  }
  return {
    productionProbeCleanupDigest: nodeslideContentDigest(
      [PROBE_CLEANUP_DOMAIN, token].join('\u001f'),
    ),
    productionProbeExpiresAt: now + NODESLIDE_PRODUCTION_PROBE_TTL_MS,
  };
}
