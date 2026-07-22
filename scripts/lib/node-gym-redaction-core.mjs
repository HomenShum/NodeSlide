const SENSITIVE_CREDENTIAL_KEYS = new Set([
  'accesskey',
  'accesstoken',
  'apikey',
  'authorization',
  'bearertoken',
  'capabilitykey',
  'clientsecret',
  'credential',
  'credentials',
  'owneraccesskey',
  'ownercapability',
  'password',
  'refreshtoken',
  'secret',
  'sessiontoken',
  'token',
]);

export const NODE_SLIDE_CAPABILITY_PATTERN_SOURCE =
  '(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])';

export function isSensitiveCredentialKey(value) {
  return SENSITIVE_CREDENTIAL_KEYS.has(
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]/gu, ''),
  );
}

/**
 * Sanitizes text that can be persisted in production and NodeGym evidence.
 * Exact in-memory capabilities supplied by the caller are removed first, then
 * credential-shaped fields, bare NodeSlide capabilities, local paths, and
 * language runtime tracebacks are collapsed to bounded stable markers.
 */
export function redactNodeGymDiagnostic(value, { tokens = [], maxLength = 1_500 } = {}) {
  let next = String(value instanceof Error ? value.message : value);
  const exactTokens = tokens
    .filter((token) => typeof token === 'string' && token.length > 0)
    .sort((left, right) => right.length - left.length);
  for (const token of exactTokens) next = next.replaceAll(token, '[REDACTED_EXACT_TOKEN]');

  next = next
    .replace(/Traceback \(most recent call last\):[\s\S]*/giu, '[REDACTED_TRACEBACK]')
    .replace(
      /((?:"|')?(?:owner[_-]?access[_-]?key|owner[_-]?capability|access[_-]?key|access[_-]?token|api[_-]?key|authorization|bearer[_-]?token|client[_-]?secret|credentials?|password|refresh[_-]?token|secret|session[_-]?token|token)(?:"|')?\s*[:=]\s*)(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;}]+)/giu,
      '$1[REDACTED_SECRET]',
    )
    .replace(new RegExp(NODE_SLIDE_CAPABILITY_PATTERN_SOURCE, 'gu'), '[REDACTED_CAPABILITY]')
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED_SECRET]')
    .replace(/\b(?:prod|dev|preview):[^|\s]+\|[^\s"']+/giu, '[REDACTED_DEPLOY_KEY]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n]*/gu, '[REDACTED_LOCAL_PATH]')
    .replace(/\/(?:Users|home|tmp)\/[^\r\n]*/gu, '[REDACTED_LOCAL_PATH]')
    .replace(
      /(?:^|\s)at\s+(?:async\s+)?[^\r\n]*(?:node:internal|file:\/\/\/)[^\r\n]*/giu,
      ' [REDACTED_STACK]',
    )
    .replace(/\s+/gu, ' ')
    .trim();
  return next.slice(0, Math.max(0, maxLength));
}
