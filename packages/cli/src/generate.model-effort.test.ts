import { describe, expect, it } from 'vitest';
import { NODESLIDE_OFFERED_AGENT_MODELS } from '../../../shared/nodeslide';
import { resolveGenerateEffort } from './generate';

describe('CLI model and reasoning-effort compatibility', () => {
  it('lets a risk analyst select GLM without also knowing its effort matrix', () => {
    expect(resolveGenerateEffort('z-ai/glm-5.2')).toBe('high');
  });

  it('keeps the fast default for the recommended Kimi route', () => {
    expect(resolveGenerateEffort('moonshotai/kimi-k3')).toBe('low');
  });

  it('refuses an explicit unsupported pair before a paid production request', () => {
    expect(() => resolveGenerateEffort('z-ai/glm-5.2', 'low')).toThrow(
      'z-ai/glm-5.2 does not support --effort low',
    );
  });

  it('resolves a supported default for every offered model under burst reuse', () => {
    for (let cycle = 0; cycle < 100; cycle += 1) {
      for (const model of NODESLIDE_OFFERED_AGENT_MODELS) {
        expect(model.supportedEfforts).toContain(resolveGenerateEffort(model.id));
      }
    }
  });
});
