import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * A guided walkthrough that points at the wrong line is worse than none: the
 * reader trusts it, lands somewhere unrelated, and concludes the codebase is
 * incomprehensible. `.tours/` is generated from anchor strings in
 * `scripts/build-code-tours.mjs`, and this runs its `--check` mode so a
 * refactor that moves the code fails here instead of misleading someone later.
 */
describe('the committed CodeTours still point at the code they describe', () => {
  it('regenerates identically from the current source', () => {
    expect(() =>
      execFileSync(process.execPath, ['scripts/build-code-tours.mjs', '--check'], {
        cwd: new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
        encoding: 'utf8',
      }),
    ).not.toThrow();
  });
});
