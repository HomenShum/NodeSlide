import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The agent-session layer is only worth porting if something mounts it.
 *
 * `NodeSlideStudio` needs Convex, `@nodeslide/react`, and a browser worker to
 * render, so there is no cheap DOM assertion available for the mount. This is a
 * source-level sensor instead: it fails if the provider is unwrapped from the
 * studio tree, which is the regression that would quietly turn `session/` back
 * into the dead code it was on the abandoned `port/google-slides-durable-session`
 * branch.
 *
 * A source assertion earns its place only if it can fail, so the negative
 * control below is part of the test, not decoration.
 */
const STUDIO_SOURCE = readFileSync(
  fileURLToPath(new URL('../NodeSlideStudio.tsx', import.meta.url)),
  'utf8',
);

/** Provider opens, and the studio content is inside it before the provider closes. */
const MOUNT_PATTERN =
  /<AgentSessionProvider\s+clientSessionId=\{clientSessionId\}>[\s\S]*?<NodeSlideStudioContent[\s\S]*?<\/AgentSessionProvider>/u;

describe('NodeSlideStudio mounts the agent session', () => {
  it('imports the provider from the session barrel', () => {
    expect(STUDIO_SOURCE).toMatch(/import \{ AgentSessionProvider \} from '\.\/session';/u);
  });

  it('wraps the studio content in the provider', () => {
    expect(STUDIO_SOURCE).toMatch(MOUNT_PATTERN);
  });

  it('derives one client session id and passes it to both the provider and the content', () => {
    expect(STUDIO_SOURCE).toMatch(
      /const clientSessionId = useMemo\(\(\) => getOrCreateSessionId\(\), \[\]\);/u,
    );
    expect(STUDIO_SOURCE).toMatch(
      /<NodeSlideStudioContent clientSessionId=\{clientSessionId\} \/>/u,
    );
    // Exactly one derivation: a second call site would let the provider and the
    // content disagree about which tab they belong to.
    expect(STUDIO_SOURCE.match(/getOrCreateSessionId\(\)/gu)).toHaveLength(1);
  });

  it('negative control: the sensor rejects a studio that drops the provider', () => {
    const unwrapped = STUDIO_SOURCE.replace(MOUNT_PATTERN, '<NodeSlideStudioContent />');
    expect(unwrapped).not.toBe(STUDIO_SOURCE);
    expect(unwrapped).not.toMatch(MOUNT_PATTERN);
  });
});
