import { query } from './_generated/server';
import { NODESLIDE_DEPLOYED_BUILD_SHA } from './lib/nodeslideBuildIdentity.generated';

const SCHEMA_VERSION = 'nodeslide.convex-build-identity/v1' as const;

/** Public, non-secret identity used to bind production evidence to deployed backend code. */
export const get = query({
  args: {},
  handler: () => ({
    schemaVersion: SCHEMA_VERSION,
    commitSha: /^[0-9a-f]{40}$/u.test(NODESLIDE_DEPLOYED_BUILD_SHA)
      ? NODESLIDE_DEPLOYED_BUILD_SHA
      : null,
  }),
});
