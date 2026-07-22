import { describe, expect, it } from 'vitest';
import {
  isSensitiveCredentialKey,
  redactNodeGymDiagnostic,
} from './lib/node-gym-redaction-core.mjs';

describe('NodeGym diagnostic redaction', () => {
  it('removes exact tokens, keyed credentials, bare capabilities, paths, and tracebacks', () => {
    const capability = 'C'.repeat(43);
    const exactDeckId = 'deck_private_diagnostic_id';
    const value = [
      `deck=${exactDeckId}`,
      `{"nested":{"ownerAccessKey":"${capability}","password":"do-not-persist"}}`,
      `fallback capability ${'D'.repeat(43)}`,
      'Traceback (most recent call last): File "C:\\Users\\developer\\private.py", line 1',
    ].join('\n');
    const redacted = redactNodeGymDiagnostic(value, { tokens: [exactDeckId] });
    expect(redacted).not.toContain(exactDeckId);
    expect(redacted).not.toContain(capability);
    expect(redacted).not.toContain('do-not-persist');
    expect(redacted).not.toContain('C:\\Users\\developer');
    expect(redacted).not.toContain('private.py');
    expect(redacted).toContain('[REDACTED_EXACT_TOKEN]');
    expect(redacted).toContain('[REDACTED_TRACEBACK]');
  });

  it('recognizes credential key variants without treating usage counters as credentials', () => {
    expect(isSensitiveCredentialKey('owner_access_key')).toBe(true);
    expect(isSensitiveCredentialKey('client-secret')).toBe(true);
    expect(isSensitiveCredentialKey('outputTokens')).toBe(false);
  });

  it('does not mistake a 64-character digest for a 43-character capability', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    expect(redactNodeGymDiagnostic(digest)).toBe(digest);
  });
});
