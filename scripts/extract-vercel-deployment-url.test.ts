import { describe, expect, it } from 'vitest';
import { extractVercelDeploymentUrl } from './extract-vercel-deployment-url.mjs';

describe('extractVercelDeploymentUrl', () => {
  it('extracts the immutable origin from noisy ANSI output and excludes the alias', () => {
    const output = [
      '\u001b[2KProduction      https://nodeslide-abc123-owner.vercel.app',
      'Building...',
      '\u001b[1A\u001b[2KProduction      https://nodeslide-abc123-owner.vercel.app',
      '▲ Aliased         https://nodeslide.vercel.app',
    ].join('\n');

    expect(extractVercelDeploymentUrl(output, 'https://nodeslide.vercel.app')).toBe(
      'https://nodeslide-abc123-owner.vercel.app',
    );
  });

  it('fails closed when no immutable deployment URL exists', () => {
    expect(() =>
      extractVercelDeploymentUrl(
        '▲ Aliased https://nodeslide.vercel.app',
        'https://nodeslide.vercel.app',
      ),
    ).toThrow(/did not contain/i);
  });

  it('fails closed when output mixes two deployments', () => {
    expect(() =>
      extractVercelDeploymentUrl(
        'https://nodeslide-one-owner.vercel.app https://nodeslide-two-owner.vercel.app',
        'https://nodeslide.vercel.app',
      ),
    ).toThrow(/multiple/i);
  });
});
